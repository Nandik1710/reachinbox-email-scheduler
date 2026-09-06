import { describe, expect, it } from "vitest";

import type {
  EmailDeliveryClient,
  EmailDeliveryInput,
  EmailDeliveryResult,
} from "../integrations/ethereal.js";
import type {
  ClaimedEmail,
  EmailDeliveryRepository,
} from "../modules/emails/delivery-repository.js";
import type { QueueJobData } from "./bullmq.js";
import { EmailWorkerProcessor, type WorkerJob } from "./processor.js";
import { InMemorySenderThrottle } from "./throttle.js";
import type { SlackService } from "../modules/slack/service.js";

const claimedEmail: ClaimedEmail = {
  id: "email-123",
  userId: "user-123",
  senderId: "sender-123",
  recipient: "recipient@example.com",
  subject: "Hello",
  body: "Message body",
  senderEmail: "sender@example.com",
  senderName: "Sender",
  campaignDelayMs: 2_000,
  campaignHourlyLimit: 3,
  attemptNumber: 1,
};

const job = (attemptsMade = 0): WorkerJob => ({
  data: {
    emailId: claimedEmail.id,
    campaignId: "campaign-123",
    scheduledAt: new Date().toISOString(),
  } satisfies QueueJobData,
  attemptsMade,
  opts: { attempts: 3 },
});

class FakeDeliveryRepository implements EmailDeliveryRepository {
  claims: Array<ClaimedEmail | null> = [claimedEmail, null];
  sent: Array<{ emailId: string; providerMessageId: string }> = [];
  failures: Array<{ emailId: string; retryable: boolean }> = [];

  async claimEmailForDelivery(): Promise<ClaimedEmail | null> {
    return this.claims.shift() ?? null;
  }

  async releaseEmailAfterRateLimit(): Promise<void> {}

  async markEmailSent(input: {
    emailId: string;
    attemptNumber: number;
    providerMessageId: string;
    previewUrl: string | null;
    sentAt: Date;
  }): Promise<boolean> {
    this.sent.push({ emailId: input.emailId, providerMessageId: input.providerMessageId });
    return true;
  }

  async markEmailFailure(input: {
    emailId: string;
    attemptNumber: number;
    errorMessage: string;
    retryable: boolean;
    failedAt: Date;
  }): Promise<void> {
    this.failures.push({ emailId: input.emailId, retryable: input.retryable });
  }
}

class FakeDeliveryClient implements EmailDeliveryClient {
  sends: EmailDeliveryInput[] = [];
  shouldFail = false;

  async send(input: EmailDeliveryInput): Promise<EmailDeliveryResult> {
    this.sends.push(input);
    if (this.shouldFail) throw new Error("SMTP unavailable");
    return { messageId: "message-123", previewUrl: "https://ethereal.email/message/123" };
  }

  close(): void {}
}

const fakeSlack: SlackService = {
  authorizationUrl: () => ({ state: "state", url: "https://slack.test" }),
  completeAuthorization: async () => {},
  disconnect: async () => {},
  status: async () => ({ connected: false, teamName: null, channelName: null, channelId: null }),
  setChannel: async () => {},
  notifySenderLimit: async () => true,
};

describe("email worker processor", () => {
  it("does not send a duplicate job after the email is already claimed/sent", async () => {
    const repository = new FakeDeliveryRepository();
    const client = new FakeDeliveryClient();
    const processor = new EmailWorkerProcessor(
      repository,
      client,
      () => new Date("2026-08-30T10:00:00.000Z"),
    );

    expect(await processor.process(job())).toEqual({ status: "sent" });
    expect(await processor.process(job())).toEqual({ status: "skipped" });
    expect(client.sends).toHaveLength(1);
    expect(repository.sent).toHaveLength(1);
  });

  it("records retryable failures and marks the final failure terminal", async () => {
    const repository = new FakeDeliveryRepository();
    repository.claims = [claimedEmail, { ...claimedEmail, attemptNumber: 2 }];
    const client = new FakeDeliveryClient();
    client.shouldFail = true;
    const processor = new EmailWorkerProcessor(repository, client);

    await expect(processor.process(job(0))).rejects.toThrow("SMTP unavailable");
    expect(await processor.process(job(2))).toEqual({ status: "failed" });
    expect(repository.failures).toEqual([
      { emailId: claimedEmail.id, retryable: true },
      { emailId: claimedEmail.id, retryable: false },
    ]);
  });

  it("reserves sender capacity atomically and returns a future time when throttled", async () => {
    const repository = new FakeDeliveryRepository();
    repository.claims = [
      claimedEmail,
      { ...claimedEmail, id: "email-456", attemptNumber: 1 },
      { ...claimedEmail, id: "email-789", attemptNumber: 1 },
    ];
    const throttle = new InMemorySenderThrottle();
    const client = new FakeDeliveryClient();
    const now = new Date("2026-08-30T10:00:00.000Z");
    const processor = new EmailWorkerProcessor(repository, client, () => now, throttle, fakeSlack);

    expect(await processor.process(job())).toEqual({ status: "sent" });
    const second = await processor.process(job());
    expect(second.status).toBe("rate_limited");
    if (second.status === "rate_limited") {
      expect(second.nextAvailableAt).toEqual(new Date("2026-08-30T10:00:02.000Z"));
    }
    expect(await processor.process(job())).toEqual({
      status: "rate_limited",
      nextAvailableAt: new Date("2026-08-30T10:00:02.000Z"),
    });
    expect(client.sends).toHaveLength(1);
  });
});
