import type { EmailStatus, PrismaClient } from "@prisma/client";

import { env } from "../../config/env.js";
import { prisma } from "../../db/client.js";

export interface ClaimedEmail {
  id: string;
  userId: string;
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
  senderEmail: string;
  senderName: string | null;
  campaignDelayMs: number;
  campaignHourlyLimit: number;
  attemptNumber: number;
}

export interface EmailDeliveryRepository {
  claimEmailForDelivery(emailId: string, now: Date): Promise<ClaimedEmail | null>;
  releaseEmailAfterRateLimit(
    emailId: string,
    attemptNumber: number,
    releasedAt: Date,
  ): Promise<void>;
  markEmailSent(input: {
    emailId: string;
    attemptNumber: number;
    providerMessageId: string;
    previewUrl: string | null;
    sentAt: Date;
  }): Promise<boolean>;
  markEmailFailure(input: {
    emailId: string;
    attemptNumber: number;
    errorMessage: string;
    retryable: boolean;
    failedAt: Date;
  }): Promise<void>;
}

export const createPrismaEmailDeliveryRepository = (
  client: PrismaClient = prisma,
): EmailDeliveryRepository => ({
  async claimEmailForDelivery(emailId, now) {
    const staleBefore = new Date(now.getTime() - env.PROCESSING_TIMEOUT_MS);
    return client.$transaction(async (transaction) => {
      const claimed = await transaction.email.updateMany({
        where: {
          id: emailId,
          OR: [
            { status: { in: ["PENDING", "QUEUED"] satisfies EmailStatus[] } },
            { status: "PROCESSING", processingStartedAt: { lt: staleBefore } },
          ],
        },
        data: {
          status: "PROCESSING",
          processingStartedAt: now,
          attemptCount: { increment: 1 },
          failureReason: null,
        },
      });

      if (claimed.count !== 1) return null;

      const email = await transaction.email.findUnique({
        where: { id: emailId },
        include: { campaign: true, sender: true },
      });
      if (!email) return null;

      await transaction.emailDeliveryAttempt.create({
        data: {
          emailId: email.id,
          attemptNumber: email.attemptCount,
          startedAt: now,
        },
      });

      return {
        id: email.id,
        userId: email.userId,
        senderId: email.senderId,
        recipient: email.recipient,
        subject: email.subject,
        body: email.campaign.body,
        senderEmail: email.sender.email,
        senderName: email.sender.displayName,
        campaignDelayMs: email.campaign.delayMs,
        campaignHourlyLimit: email.campaign.hourlyLimit,
        attemptNumber: email.attemptCount,
      };
    });
  },

  async releaseEmailAfterRateLimit(emailId, attemptNumber, releasedAt) {
    await client.$transaction(async (transaction) => {
      await transaction.emailDeliveryAttempt.update({
        where: { emailId_attemptNumber: { emailId, attemptNumber } },
        data: { completedAt: releasedAt, errorMessage: "Rate limited; job rescheduled." },
      });
      await transaction.email.updateMany({
        where: { id: emailId, status: "PROCESSING" },
        data: { status: "QUEUED", processingStartedAt: null },
      });
    });
  },

  async markEmailSent(input) {
    return client.$transaction(async (transaction) => {
      const updated = await transaction.email.updateMany({
        where: { id: input.emailId, status: "PROCESSING" },
        data: {
          status: "SENT",
          sentAt: input.sentAt,
          processingStartedAt: null,
          providerMessageId: input.providerMessageId,
          previewUrl: input.previewUrl,
          failedAt: null,
          failureReason: null,
        },
      });

      if (updated.count !== 1) return false;

      await transaction.emailDeliveryAttempt.update({
        where: {
          emailId_attemptNumber: { emailId: input.emailId, attemptNumber: input.attemptNumber },
        },
        data: {
          completedAt: input.sentAt,
          providerMessageId: input.providerMessageId,
        },
      });
      return true;
    });
  },

  async markEmailFailure(input) {
    await client.$transaction(async (transaction) => {
      await transaction.emailDeliveryAttempt.update({
        where: {
          emailId_attemptNumber: { emailId: input.emailId, attemptNumber: input.attemptNumber },
        },
        data: { completedAt: input.failedAt, errorMessage: input.errorMessage },
      });
      await transaction.email.updateMany({
        where: { id: input.emailId, status: "PROCESSING" },
        data: input.retryable
          ? { status: "QUEUED", processingStartedAt: null, failureReason: input.errorMessage }
          : {
              status: "FAILED",
              processingStartedAt: null,
              failedAt: input.failedAt,
              failureReason: input.errorMessage,
            },
      });
    });
  },
});
