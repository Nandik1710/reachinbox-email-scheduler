import type { PrismaClient, SlackConnectionStatus } from "@prisma/client";

import { prisma } from "../../db/client.js";
import type { SlackConnectionRecord, SlackConnectionRepository } from "./types.js";

const toRecord = (connection: {
  id: string;
  userId: string;
  teamId: string;
  teamName: string | null;
  channelId: string | null;
  channelName: string | null;
  accessTokenEnc: string;
  scope: string | null;
  status: SlackConnectionStatus;
  connectedAt: Date;
  disconnectedAt: Date | null;
}): SlackConnectionRecord => connection;

export const createPrismaSlackConnectionRepository = (
  client: PrismaClient = prisma,
): SlackConnectionRepository => ({
  async upsertConnected(input) {
    const connection = await client.slackConnection.upsert({
      where: { userId: input.userId },
      create: { ...input, status: "CONNECTED", disconnectedAt: null },
      update: { ...input, status: "CONNECTED", disconnectedAt: null },
    });
    return toRecord(connection);
  },

  async findForUser(userId) {
    const connection = await client.slackConnection.findUnique({ where: { userId } });
    return connection ? toRecord(connection) : null;
  },

  async disconnect(userId, disconnectedAt) {
    await client.slackConnection.updateMany({
      where: { userId, status: "CONNECTED" },
      data: { status: "DISCONNECTED", disconnectedAt },
    });
  },

  async setChannel(userId, channelId, channelName) {
    await client.slackConnection.updateMany({
      where: { userId, status: "CONNECTED" },
      data: { channelId, channelName },
    });
  },
});
