import request from "supertest";
import { describe, expect, it } from "vitest";
import type { CampaignStatus, EmailStatus } from "@prisma/client";

import { createApp } from "../../app.js";
import type { AuthUser, UserRepository } from "../auth/types.js";
import type {
  CampaignRepository,
  CampaignRecord,
  CampaignTransaction,
  EmailRecord,
  SenderRecord,
} from "./repository.js";
import { parseRecipientSource, RecipientSourceError } from "./recipient-parser.js";
import { CampaignSchedulingService } from "./service.js";
import { EmailListingService } from "../emails/service.js";
import type { QueueEmailInput, QueueInsertionService } from "../../queue/types.js";

const user: AuthUser = {
  id: "campaign-test-user",
  googleId: "campaign-test-google-user",
  email: "campaign@example.com",
  name: "Campaign Tester",
  avatarUrl: null,
};

const senders: SenderRecord[] = [
  { id: "sender-one", email: "one@example.com", displayName: "One" },
  { id: "sender-two", email: "two@example.com", displayName: "Two" },
];

const createUserRepository = (): UserRepository => ({
  upsertGoogleUser: async () => user,
  findById: async (id) => (id === user.id ? user : null),
});

class FakeCampaignRepository implements CampaignRepository {
  campaigns: CampaignRecord[] = [];
  emails: EmailRecord[] = [];
  failEmailInsert = false;
  lastListUserId: string | undefined;

  async findActiveSenders(): Promise<SenderRecord[]> {
    return senders;
  }

  async findActiveSender(_userId: string, senderId: string): Promise<SenderRecord | null> {
    return senders.find((sender) => sender.id === senderId) ?? null;
  }

  async withTransaction<T>(callback: (transaction: CampaignTransaction) => Promise<T>): Promise<T> {
    const campaignsBefore = [...this.campaigns];
    const emailsBefore = [...this.emails];
    try {
      return await callback({
        createCampaign: async (input) => {
          const campaign: CampaignRecord = {
            id: input.id,
            subject: input.subject,
            startAt: input.startAt,
            delayMs: input.delayMs,
            hourlyLimit: input.hourlyLimit,
            status: "SCHEDULED" as CampaignStatus,
            totalEmails: 0,
            createdAt: new Date(),
          };
          this.campaigns.push(campaign);
          return campaign;
        },
        createEmails: async (inputs) => {
          if (this.failEmailInsert) throw new Error("simulated email insert failure");
          this.emails.push(
            ...inputs.map((input) => ({
              id: input.id,
              recipient: input.recipient,
              subject: input.subject,
              scheduledAt: input.scheduledAt,
              sentAt: null,
              status: "PENDING" as EmailStatus,
              previewUrl: null,
              failureReason: null,
            })),
          );
        },
      });
    } catch (error: unknown) {
      this.campaigns = campaignsBefore;
      this.emails = emailsBefore;
      throw error;
    }
  }

  async listEmails(input: {
    userId: string;
    statuses: EmailStatus[];
    search?: string;
    campaignId?: string;
    senderId?: string;
    from?: Date;
    to?: Date;
    skip: number;
    take: number;
    view: "scheduled" | "sent";
  }): Promise<{ items: EmailRecord[]; total: number }> {
    this.lastListUserId = input.userId;
    return { items: [], total: 0 };
  }

  async markEmailsQueued(emailIds: string[]): Promise<void> {
    for (const email of this.emails) {
      if (emailIds.includes(email.id) && email.status === "PENDING") email.status = "QUEUED";
    }
  }

  async findPendingQueueEmails(
    userId: string,
    campaignId: string,
  ): Promise<QueueEmailInput[] | null> {
    if (userId !== user.id || !this.campaigns.some((campaign) => campaign.id === campaignId))
      return null;
    return this.emails
      .filter((email) => email.status === "PENDING")
      .map((email) => ({
        emailId: email.id,
        campaignId,
        scheduledAt: email.scheduledAt,
        queueJobId: `email-${email.id}-${email.scheduledAt.getTime()}`,
      }));
  }
}

class FakeQueueInsertionService implements QueueInsertionService {
  jobs: QueueEmailInput[] = [];

  async enqueueEmails(emails: QueueEmailInput[]): Promise<void> {
    this.jobs.push(...emails);
  }
}

const validSchedule = (recipientContent: string) => ({
  subject: "Project update",
  body: "Hello there",
  recipientContent,
  startAt: new Date(Date.now() + 60_000),
  delayMs: 2_000,
  hourlyLimit: 50,
});

describe("recipient parsing", () => {
  it("normalizes emails, counts duplicates, and reports invalid values", () => {
    const result = parseRecipientSource(
      "email\nAlice@Example.com\nalice@example.com\nnot-an-email\n",
    );

    expect(result).toEqual({
      detected: 3,
      accepted: ["alice@example.com"],
      rejected: [{ value: "not-an-email", reason: "invalid_email" }],
      duplicates: 1,
    });
  });

  it("reads the email column from CSV and supports quoted values", () => {
    const result = parseRecipientSource(
      'name,email\n"Alice Smith",Alice@Example.com\n"Bob",bob@example.com',
    );

    expect(result.accepted).toEqual(["alice@example.com", "bob@example.com"]);
    expect(result.detected).toBe(2);
  });

  it("rejects malformed CSV and oversized content", () => {
    expect(() => parseRecipientSource('name,email\n"Alice,alice@example.com')).toThrow(
      RecipientSourceError,
    );
    expect(() => parseRecipientSource("a".repeat(1_000_001))).toThrow(RecipientSourceError);
  });
});

describe("campaign scheduling", () => {
  it("creates a campaign and pending emails in one transaction", async () => {
    const repository = new FakeCampaignRepository();
    const queue = new FakeQueueInsertionService();
    const service = new CampaignSchedulingService(repository, queue);
    const result = await service.schedule(
      user.id,
      validSchedule("Alice@Example.com\nalice@example.com\nbob@example.com"),
    );

    expect(result.campaign.status).toBe("SCHEDULED");
    expect(result.campaign.totalEmails).toBe(2);
    expect(result.recipients).toMatchObject({
      detected: 3,
      accepted: 2,
      rejected: 0,
      duplicates: 1,
    });
    expect(repository.emails).toHaveLength(2);
    expect(queue.jobs).toHaveLength(2);
    expect(queue.jobs[0]?.queueJobId).toContain(queue.jobs[0]?.emailId);
    expect(repository.emails[1]!.scheduledAt.getTime()).toBe(
      repository.emails[0]!.scheduledAt.getTime() + 2_000,
    );
  });

  it("rolls back the campaign when email creation fails", async () => {
    const repository = new FakeCampaignRepository();
    repository.failEmailInsert = true;
    const service = new CampaignSchedulingService(repository, new FakeQueueInsertionService());

    await expect(service.schedule(user.id, validSchedule("person@example.com"))).rejects.toThrow(
      "simulated email insert failure",
    );
    expect(repository.campaigns).toHaveLength(0);
    expect(repository.emails).toHaveLength(0);
  });

  it("rejects an unavailable sender and a past start time", async () => {
    const repository = new FakeCampaignRepository();
    const service = new CampaignSchedulingService(repository, new FakeQueueInsertionService());

    await expect(
      service.schedule(user.id, {
        ...validSchedule("person@example.com"),
        senderId: "missing-sender",
      }),
    ).rejects.toMatchObject({ code: "SENDER_NOT_FOUND" });
    await expect(
      service.schedule(user.id, {
        ...validSchedule("person@example.com"),
        startAt: new Date(Date.now() - 1_000),
      }),
    ).rejects.toMatchObject({ code: "START_TIME_IN_PAST" });
  });

  it("can retry pending queue insertion without creating another campaign", async () => {
    const repository = new FakeCampaignRepository();
    const queue = new FakeQueueInsertionService();
    const service = new CampaignSchedulingService(repository, queue);
    const originalEnqueue = queue.enqueueEmails.bind(queue);
    let firstAttempt = true;
    queue.enqueueEmails = async (emails) => {
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error("Redis unavailable");
      }
      await originalEnqueue(emails);
    };

    await expect(
      service.schedule(user.id, validSchedule("person@example.com")),
    ).rejects.toMatchObject({
      code: "QUEUE_INSERTION_FAILED",
    });
    expect(repository.campaigns).toHaveLength(1);
    expect(repository.emails[0]?.status).toBe("PENDING");

    const result = await service.enqueuePending(user.id, repository.campaigns[0]!.id);
    expect(result).toEqual({ enqueued: 1 });
    expect(repository.emails[0]?.status).toBe("QUEUED");
    expect(queue.jobs).toHaveLength(1);
  });
});

describe("campaign and email routes", () => {
  it("requires authentication and accepts a multipart recipient file", async () => {
    const repository = new FakeCampaignRepository();
    const queue = new FakeQueueInsertionService();
    const app = createApp({
      userRepository: createUserRepository(),
      enableTestAuthAdapter: true,
      campaignService: new CampaignSchedulingService(repository, queue),
      emailListingService: new EmailListingService(repository),
    });

    const unauthorized = await request(app)
      .post("/api/campaigns")
      .send(validSchedule("person@example.com"));
    const agent = request.agent(app);
    await agent.post("/auth/__test__/login");
    const authorized = await agent
      .post("/api/campaigns")
      .field("subject", "Multipart campaign")
      .field("body", "Hello")
      .field("startAt", new Date(Date.now() + 60_000).toISOString())
      .field("delayMs", "2000")
      .field("hourlyLimit", "50")
      .attach("recipientsFile", Buffer.from("email\nperson@example.com\n"), "leads.csv");

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(201);
    expect(authorized.body.recipients).toMatchObject({ detected: 1, accepted: 1 });
    expect(queue.jobs).toHaveLength(1);
  });

  it("returns paginated scheduled and sent views with tenant ownership", async () => {
    const repository = new FakeCampaignRepository();
    const app = createApp({
      userRepository: createUserRepository(),
      enableTestAuthAdapter: true,
      campaignService: new CampaignSchedulingService(repository),
      emailListingService: new EmailListingService(repository),
    });
    const agent = request.agent(app);
    await agent.post("/auth/__test__/login");

    const scheduled = await agent.get("/api/emails/scheduled?page=2&pageSize=10");
    const sent = await agent.get("/api/emails/sent?search=example.com");

    expect(scheduled.status).toBe(200);
    expect(scheduled.body).toMatchObject({ page: 2, pageSize: 10, total: 0, totalPages: 0 });
    expect(sent.status).toBe(200);
    expect(repository.lastListUserId).toBe(user.id);
  });

  it("rejects invalid query limits", async () => {
    const repository = new FakeCampaignRepository();
    const app = createApp({
      userRepository: createUserRepository(),
      enableTestAuthAdapter: true,
      campaignService: new CampaignSchedulingService(repository),
      emailListingService: new EmailListingService(repository),
    });
    const agent = request.agent(app);
    await agent.post("/auth/__test__/login");

    const response = await agent.get("/api/emails/scheduled?pageSize=101");
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_EMAIL_QUERY");
  });
});
