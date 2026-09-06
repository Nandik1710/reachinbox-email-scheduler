import type { PrismaClient } from "@prisma/client";

import { prisma } from "../../db/client.js";
import type {
  EmailSearchDocument,
  SearchDatabaseRepository,
  SearchIndexRepository,
  SearchEmailRecord,
} from "./types.js";

const toDocument = (email: {
  id: string;
  userId: string;
  campaignId: string;
  senderId: string;
  recipient: string;
  subject: string;
  status: EmailSearchDocument["status"];
  scheduledAt: Date;
  sentAt: Date | null;
  failureReason: string | null;
  previewUrl: string | null;
  campaign: { body: string };
}): EmailSearchDocument => ({
  id: email.id,
  userId: email.userId,
  campaignId: email.campaignId,
  senderId: email.senderId,
  recipient: email.recipient,
  subject: email.subject,
  body: email.campaign.body,
  status: email.status,
  scheduledAt: email.scheduledAt.toISOString(),
  sentAt: email.sentAt?.toISOString() ?? null,
  failureReason: email.failureReason,
  previewUrl: email.previewUrl,
});

export const createPrismaSearchIndexRepository = (
  client: PrismaClient = prisma,
): SearchIndexRepository => ({
  async findForIndex(emailId) {
    const email = await client.email.findUnique({
      where: { id: emailId },
      include: { campaign: true },
    });
    return email ? toDocument(email) : null;
  },

  async markIndexStatus(input) {
    await client.email.update({
      where: { id: input.emailId },
      data: {
        searchIndexStatus: input.status,
        searchIndexedAt: input.indexedAt,
        searchIndexError: input.error,
      },
    });
  },
});

export const createPrismaSearchDatabaseRepository = (
  client: PrismaClient = prisma,
): SearchDatabaseRepository => ({
  async findOwnedByIds(userId, ids): Promise<SearchEmailRecord[]> {
    if (ids.length === 0) return [];
    return client.email.findMany({
      where: { userId, id: { in: ids } },
      orderBy: { id: "asc" },
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
    });
  },
});
