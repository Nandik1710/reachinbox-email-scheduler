import { randomUUID } from "node:crypto";

import type {
  ScheduleCampaignRequest,
  ScheduleCampaignResponse,
} from "../../contracts/campaigns.js";
import { env } from "../../config/env.js";
import { createQueueJobId } from "../../queue/bullmq.js";
import { deferredQueueInsertionService, type QueueInsertionService } from "../../queue/types.js";
import { parseRecipientSource, type RecipientParseResult } from "./recipient-parser.js";
import type { CampaignRepository, CampaignRecord, SenderRecord } from "./repository.js";
import type { EmailSearchIndexer } from "../search/service.js";

export class CampaignRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "CampaignRequestError";
  }
}

const toRecipientSummary = (parsed: RecipientParseResult) => ({
  detected: parsed.detected,
  accepted: parsed.accepted.length,
  rejected: parsed.rejected.length,
  duplicates: parsed.duplicates,
  rejectedItems: parsed.rejected,
});

const toCampaignResponse = (campaign: CampaignRecord, totalEmails: number) => ({
  id: campaign.id,
  subject: campaign.subject,
  startAt: campaign.startAt,
  delayMs: campaign.delayMs,
  hourlyLimit: campaign.hourlyLimit,
  status: campaign.status,
  totalEmails,
  createdAt: campaign.createdAt,
});

export class CampaignSchedulingService {
  constructor(
    private readonly repository: CampaignRepository,
    private readonly queueInsertionService: QueueInsertionService = deferredQueueInsertionService,
    private readonly searchIndexer?: EmailSearchIndexer,
  ) {}

  async listSenders(userId: string): Promise<SenderRecord[]> {
    return this.repository.findActiveSenders(userId);
  }

  async schedule(
    userId: string,
    input: ScheduleCampaignRequest,
  ): Promise<ScheduleCampaignResponse> {
    if (input.startAt.getTime() <= Date.now()) {
      throw new CampaignRequestError(422, "START_TIME_IN_PAST", "startAt must be in the future.");
    }

    const source = input.recipientContent ?? input.recipients?.join("\n");
    if (!source) {
      throw new CampaignRequestError(
        400,
        "RECIPIENT_SOURCE_REQUIRED",
        "A recipient list or recipientContent is required.",
      );
    }

    let parsed: RecipientParseResult;
    try {
      parsed = parseRecipientSource(source);
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && "status" in error) throw error;
      throw new CampaignRequestError(
        422,
        "INVALID_RECIPIENT_SOURCE",
        "The recipient source could not be parsed.",
      );
    }

    if (parsed.accepted.length === 0) {
      throw new CampaignRequestError(
        422,
        "NO_VALID_RECIPIENTS",
        "The recipient source did not contain any valid email addresses.",
        { rejectedItems: parsed.rejected },
      );
    }

    if (input.delayMs < env.MIN_DELAY_BETWEEN_EMAILS_MS) {
      throw new CampaignRequestError(
        422,
        "DELAY_TOO_SHORT",
        `delayMs must be at least ${env.MIN_DELAY_BETWEEN_EMAILS_MS} milliseconds.`,
      );
    }

    const activeSenders = input.senderId
      ? await this.repository.findActiveSender(userId, input.senderId)
      : await this.repository.findActiveSenders(userId);

    if (!activeSenders || (Array.isArray(activeSenders) && activeSenders.length === 0)) {
      throw new CampaignRequestError(
        input.senderId ? 404 : 409,
        input.senderId ? "SENDER_NOT_FOUND" : "NO_ACTIVE_SENDERS",
        input.senderId
          ? "The selected sender was not found or is inactive."
          : "No active sender is available for this campaign.",
      );
    }

    const senders: SenderRecord[] = Array.isArray(activeSenders) ? activeSenders : [activeSenders];
    const campaignId = randomUUID();
    const emailIds = parsed.accepted.map(() => randomUUID());
    const campaign = await this.repository.withTransaction(async (transaction) => {
      const createdCampaign = await transaction.createCampaign({
        id: campaignId,
        userId,
        senderId: input.senderId ?? (senders.length === 1 ? (senders[0]?.id ?? null) : null),
        subject: input.subject,
        body: input.body,
        startAt: input.startAt,
        delayMs: input.delayMs,
        hourlyLimit: input.hourlyLimit,
      });

      await transaction.createEmails(
        parsed.accepted.map((recipient, index) => ({
          id: emailIds[index] as string,
          userId,
          campaignId,
          senderId: senders[index % senders.length]?.id as string,
          recipient,
          subject: input.subject,
          scheduledAt: new Date(input.startAt.getTime() + index * input.delayMs),
          queueJobId: createQueueJobId(
            emailIds[index] as string,
            new Date(input.startAt.getTime() + index * input.delayMs),
          ),
        })),
      );

      return createdCampaign;
    });

    const queueEmails = parsed.accepted.map((_, index) => {
      const emailId = emailIds[index] as string;
      const scheduledAt = new Date(input.startAt.getTime() + index * input.delayMs);
      return {
        emailId,
        campaignId,
        scheduledAt,
        queueJobId: createQueueJobId(emailId, scheduledAt),
      };
    });

    try {
      await this.queueInsertionService.enqueueEmails(queueEmails);
      await this.repository.markEmailsQueued(emailIds);
      for (const emailId of emailIds) void this.searchIndexer?.indexEmailById(emailId);
    } catch (error: unknown) {
      throw new CampaignRequestError(
        503,
        "QUEUE_INSERTION_FAILED",
        "The campaign was saved, but one or more queue jobs could not be inserted. Retry the campaign enqueue operation.",
        {
          campaignId,
          emailCount: emailIds.length,
          cause: error instanceof Error ? error.message : "unknown",
        },
      );
    }

    return {
      campaign: toCampaignResponse(campaign, parsed.accepted.length),
      recipients: toRecipientSummary(parsed),
      queue: { status: "queued", enqueued: queueEmails.length },
    };
  }

  async enqueuePending(userId: string, campaignId: string): Promise<{ enqueued: number }> {
    const emails = await this.repository.findPendingQueueEmails(userId, campaignId);
    if (emails === null) {
      throw new CampaignRequestError(404, "CAMPAIGN_NOT_FOUND", "The campaign was not found.");
    }
    if (emails.length === 0) return { enqueued: 0 };

    try {
      await this.queueInsertionService.enqueueEmails(emails);
      await this.repository.markEmailsQueued(emails.map((email) => email.emailId));
      for (const email of emails) void this.searchIndexer?.indexEmailById(email.emailId);
      return { enqueued: emails.length };
    } catch (error: unknown) {
      throw new CampaignRequestError(
        503,
        "QUEUE_INSERTION_FAILED",
        "The pending campaign emails could not be inserted into the queue. Try again.",
        {
          campaignId,
          emailCount: emails.length,
          cause: error instanceof Error ? error.message : "unknown",
        },
      );
    }
  }
}
