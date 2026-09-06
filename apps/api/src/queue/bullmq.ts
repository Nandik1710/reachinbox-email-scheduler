import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { env } from "../config/env.js";
import type { QueueEmailInput, QueueInsertionService } from "./types.js";

export interface QueueJobData {
  emailId: string;
  campaignId: string;
  scheduledAt: string;
}

export interface QueueLike {
  add(
    name: string,
    data: QueueJobData,
    options: {
      jobId: string;
      delay: number;
      attempts: number;
      backoff: { type: "exponential"; delay: number };
    },
  ): Promise<unknown>;
  close(): Promise<void>;
}

export const createQueueJobId = (emailId: string, scheduledAt: Date): string =>
  `email-${emailId}-${scheduledAt.getTime()}`;

export const calculateJobDelay = (scheduledAt: Date, now = new Date()): number =>
  Math.max(0, scheduledAt.getTime() - now.getTime());

export class BullMqQueueInsertionService implements QueueInsertionService {
  constructor(private readonly queue: QueueLike) {}

  async enqueueEmails(emails: QueueEmailInput[]): Promise<void> {
    await Promise.all(
      emails.map((email) =>
        this.queue.add(
          "send-email",
          {
            emailId: email.emailId,
            campaignId: email.campaignId,
            scheduledAt: email.scheduledAt.toISOString(),
          },
          {
            jobId: email.queueJobId,
            delay: calculateJobDelay(email.scheduledAt),
            attempts: env.EMAIL_MAX_ATTEMPTS,
            backoff: { type: "exponential", delay: 1_000 },
          },
        ),
      ),
    );
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export const createBullMqQueueInsertionService = (): BullMqQueueInsertionService => {
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue<QueueJobData>(env.EMAIL_QUEUE_NAME, { connection });
  return new BullMqQueueInsertionService(queue);
};
