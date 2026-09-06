import { env } from "../config/env.js";
import type { EmailDeliveryClient } from "../integrations/ethereal.js";
import type { EmailDeliveryRepository } from "../modules/emails/delivery-repository.js";
import type { QueueJobData } from "./bullmq.js";
import { effectiveSenderLimits, type SenderThrottle } from "./throttle.js";
import type { SlackService } from "../modules/slack/service.js";
import type { EmailSearchIndexer } from "../modules/search/service.js";

export interface WorkerJob {
  data: QueueJobData;
  attemptsMade: number;
  opts: { attempts?: number };
}

export type WorkerProcessResult =
  { status: "sent" | "failed" | "skipped" } | { status: "rate_limited"; nextAvailableAt: Date };

export class EmailWorkerProcessor {
  constructor(
    private readonly repository: EmailDeliveryRepository,
    private readonly deliveryClient: EmailDeliveryClient,
    private readonly now: () => Date = () => new Date(),
    private readonly throttle?: SenderThrottle,
    private readonly slack?: SlackService,
    private readonly searchIndexer?: EmailSearchIndexer,
  ) {}

  async process(job: WorkerJob): Promise<WorkerProcessResult> {
    const claimed = await this.repository.claimEmailForDelivery(job.data.emailId, this.now());
    if (!claimed) return { status: "skipped" };

    if (this.throttle) {
      const limits = effectiveSenderLimits({
        campaignDelayMs: claimed.campaignDelayMs,
        campaignHourlyLimit: claimed.campaignHourlyLimit,
      });
      const reservation = await this.throttle.reserve({
        senderId: claimed.senderId,
        now: this.now(),
        minDelayMs: limits.minDelayMs,
        hourlyLimit: limits.hourlyLimit,
      });
      if (!reservation.allowed) {
        await this.repository.releaseEmailAfterRateLimit(
          claimed.id,
          claimed.attemptNumber,
          this.now(),
        );
        return { status: "rate_limited", nextAvailableAt: reservation.nextAvailableAt };
      }
      if (reservation.reachedHourlyLimit && this.slack) {
        await this.slack.notifySenderLimit({
          userId: claimed.userId,
          senderId: claimed.senderId,
          senderEmail: claimed.senderEmail,
          hourlyLimit: limits.hourlyLimit,
          windowStart: reservation.windowStart,
        });
      }
    }

    let delivery;
    try {
      delivery = await this.deliveryClient.send({
        fromEmail: claimed.senderEmail,
        fromName: claimed.senderName,
        recipient: claimed.recipient,
        subject: claimed.subject,
        body: claimed.body,
      });
    } catch (error: unknown) {
      const attempts = job.opts.attempts ?? env.EMAIL_MAX_ATTEMPTS;
      const retryable = job.attemptsMade + 1 < attempts;
      const message = error instanceof Error ? error.message : "Email delivery failed.";
      await this.repository.markEmailFailure({
        emailId: claimed.id,
        attemptNumber: claimed.attemptNumber,
        errorMessage: message,
        retryable,
        failedAt: this.now(),
      });
      void this.searchIndexer?.indexEmailById(claimed.id);
      if (retryable) throw error;
      return { status: "failed" };
    }

    await this.repository.markEmailSent({
      emailId: claimed.id,
      attemptNumber: claimed.attemptNumber,
      providerMessageId: delivery.messageId,
      previewUrl: delivery.previewUrl,
      sentAt: this.now(),
    });
    void this.searchIndexer?.indexEmailById(claimed.id);
    return { status: "sent" };
  }
}
