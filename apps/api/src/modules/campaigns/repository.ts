import type {
  CampaignStatus,
  EmailStatus,
  Prisma,
  PrismaClient,
  SenderStatus,
} from "@prisma/client";

import { prisma } from "../../db/client.js";
import type { QueueEmailInput } from "../../queue/types.js";

export interface SenderRecord {
  id: string;
  email: string;
  displayName: string | null;
}

export interface CampaignRecord {
  id: string;
  subject: string;
  startAt: Date;
  delayMs: number;
  hourlyLimit: number;
  status: CampaignStatus;
  totalEmails: number;
  createdAt: Date;
}

export interface EmailRecord {
  id: string;
  recipient: string;
  subject: string;
  scheduledAt: Date;
  sentAt: Date | null;
  status: EmailStatus;
  previewUrl: string | null;
  failureReason: string | null;
}

export interface CampaignTransaction {
  createCampaign(input: {
    id: string;
    userId: string;
    senderId: string | null;
    subject: string;
    body: string;
    startAt: Date;
    delayMs: number;
    hourlyLimit: number;
  }): Promise<CampaignRecord>;
  createEmails(
    input: Array<{
      id: string;
      userId: string;
      campaignId: string;
      senderId: string;
      recipient: string;
      subject: string;
      scheduledAt: Date;
      queueJobId: string;
    }>,
  ): Promise<void>;
}

export interface CampaignRepository {
  findActiveSenders(userId: string): Promise<SenderRecord[]>;
  findActiveSender(userId: string, senderId: string): Promise<SenderRecord | null>;
  withTransaction<T>(callback: (transaction: CampaignTransaction) => Promise<T>): Promise<T>;
  markEmailsQueued(emailIds: string[]): Promise<void>;
  findPendingQueueEmails(userId: string, campaignId: string): Promise<QueueEmailInput[] | null>;
  listEmails(input: {
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
  }): Promise<{ items: EmailRecord[]; total: number }>;
}

const toCampaignRecord = (campaign: {
  id: string;
  subject: string;
  startAt: Date;
  delayMs: number;
  hourlyLimit: number;
  status: CampaignStatus;
  createdAt: Date;
  _count: { emails: number };
}): CampaignRecord => ({
  id: campaign.id,
  subject: campaign.subject,
  startAt: campaign.startAt,
  delayMs: campaign.delayMs,
  hourlyLimit: campaign.hourlyLimit,
  status: campaign.status,
  totalEmails: campaign._count.emails,
  createdAt: campaign.createdAt,
});

export const createPrismaCampaignRepository = (
  client: PrismaClient = prisma,
): CampaignRepository => ({
  async findActiveSenders(userId) {
    return client.sender.findMany({
      where: { userId, status: "ACTIVE" satisfies SenderStatus },
      orderBy: { id: "asc" },
      select: { id: true, email: true, displayName: true },
    });
  },

  async findActiveSender(userId, senderId) {
    return client.sender.findFirst({
      where: { id: senderId, userId, status: "ACTIVE" satisfies SenderStatus },
      select: { id: true, email: true, displayName: true },
    });
  },

  async withTransaction(callback) {
    return client.$transaction(async (transaction) => {
      const wrappedTransaction: CampaignTransaction = {
        async createCampaign(input) {
          const campaign = await transaction.campaign.create({
            data: {
              id: input.id,
              userId: input.userId,
              senderId: input.senderId,
              subject: input.subject,
              body: input.body,
              startAt: input.startAt,
              delayMs: input.delayMs,
              hourlyLimit: input.hourlyLimit,
              status: "SCHEDULED",
            },
            include: { _count: { select: { emails: true } } },
          });
          return toCampaignRecord(campaign);
        },
        async createEmails(input) {
          await transaction.email.createMany({ data: input });
        },
      };

      return callback(wrappedTransaction);
    });
  },

  async markEmailsQueued(emailIds) {
    if (emailIds.length === 0) return;
    await client.email.updateMany({
      where: { id: { in: emailIds }, status: "PENDING" },
      data: { status: "QUEUED" },
    });
  },

  async findPendingQueueEmails(userId, campaignId) {
    const campaign = await client.campaign.findFirst({ where: { id: campaignId, userId } });
    if (!campaign) return null;
    const emails = await client.email.findMany({
      where: { userId, campaignId, status: "PENDING" },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
      select: { id: true, campaignId: true, scheduledAt: true, queueJobId: true },
    });
    return emails.map((email) => ({
      emailId: email.id,
      campaignId: email.campaignId,
      scheduledAt: email.scheduledAt,
      queueJobId: email.queueJobId,
    }));
  },

  async listEmails(input) {
    const where: Prisma.EmailWhereInput = {
      userId: input.userId,
      status: { in: input.statuses },
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
      ...(input.senderId ? { senderId: input.senderId } : {}),
      ...(input.search
        ? {
            OR: [
              { recipient: { contains: input.search } },
              { subject: { contains: input.search } },
            ],
          }
        : {}),
      ...(input.from || input.to
        ? input.view === "sent"
          ? {
              sentAt: {
                ...(input.from ? { gte: input.from } : {}),
                ...(input.to ? { lte: input.to } : {}),
              },
            }
          : {
              scheduledAt: {
                ...(input.from ? { gte: input.from } : {}),
                ...(input.to ? { lte: input.to } : {}),
              },
            }
        : {}),
    };

    const [items, total] = await client.$transaction([
      client.email.findMany({
        where,
        orderBy:
          input.view === "scheduled"
            ? [{ scheduledAt: "asc" }, { id: "asc" }]
            : [{ sentAt: "desc" }, { scheduledAt: "desc" }, { id: "desc" }],
        skip: input.skip,
        take: input.take,
        select: {
          id: true,
          recipient: true,
          subject: true,
          scheduledAt: true,
          sentAt: true,
          status: true,
          previewUrl: true,
          failureReason: true,
        },
      }),
      client.email.count({ where }),
    ]);

    return { items, total };
  },
});
