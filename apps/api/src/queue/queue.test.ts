import { describe, expect, it } from "vitest";

import {
  calculateJobDelay,
  BullMqQueueInsertionService,
  createQueueJobId,
  type QueueJobData,
  type QueueLike,
} from "./bullmq.js";
import type { QueueEmailInput } from "./types.js";

class FakeQueue implements QueueLike {
  jobs: Array<{
    name: string;
    data: QueueJobData;
    options: {
      jobId: string;
      delay: number;
      attempts: number;
      backoff: { type: "exponential"; delay: number };
    };
  }> = [];

  async add(
    name: string,
    data: QueueJobData,
    options: {
      jobId: string;
      delay: number;
      attempts: number;
      backoff: { type: "exponential"; delay: number };
    },
  ): Promise<void> {
    this.jobs.push({ name, data, options });
  }

  async close(): Promise<void> {}
}

describe("BullMQ scheduling", () => {
  it("calculates only non-negative delays", () => {
    const now = new Date("2026-08-30T10:00:00.000Z");
    expect(calculateJobDelay(new Date("2026-08-30T10:00:02.000Z"), now)).toBe(2_000);
    expect(calculateJobDelay(new Date("2026-08-30T09:59:59.000Z"), now)).toBe(0);
  });

  it("adds deterministic delayed jobs with stable payloads", async () => {
    const queue = new FakeQueue();
    const service = new BullMqQueueInsertionService(queue);
    const scheduledAt = new Date(Date.now() + 60_000);
    const input: QueueEmailInput = {
      emailId: "email-123",
      campaignId: "campaign-123",
      scheduledAt,
      queueJobId: createQueueJobId("email-123", scheduledAt),
    };

    await service.enqueueEmails([input]);

    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]).toMatchObject({
      name: "send-email",
      data: {
        emailId: input.emailId,
        campaignId: input.campaignId,
        scheduledAt: scheduledAt.toISOString(),
      },
      options: {
        jobId: input.queueJobId,
        attempts: 3,
        backoff: { type: "exponential", delay: 1_000 },
      },
    });
    expect(queue.jobs[0]!.options.delay).toBeGreaterThan(59_000);
    expect(queue.jobs[0]!.options.delay).toBeLessThanOrEqual(60_000);
  });
});
