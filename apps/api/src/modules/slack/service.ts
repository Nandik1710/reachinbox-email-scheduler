import { randomUUID } from "node:crypto";

import { getMissingSlackConfig, isSlackConfigured } from "./configuration.js";
import { createSlackOAuthClient } from "./client.js";
import { decryptSlackToken, encryptSlackToken } from "./crypto.js";
import { createPrismaSlackConnectionRepository } from "./repository.js";
import type {
  SlackConnectionRepository,
  SlackConnectionStatusResponse,
  SlackOAuthClient,
} from "./types.js";
import { logger } from "../../lib/logger.js";

export interface SlackTokenCodec {
  encrypt(token: string): string;
  decrypt(value: string): string;
}

export class SlackServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SlackServiceError";
  }
}

export interface SlackService {
  authorizationUrl(): { url: string; state: string };
  completeAuthorization(
    userId: string,
    state: string | undefined,
    expectedState: string | undefined,
    code: string | undefined,
  ): Promise<void>;
  disconnect(userId: string): Promise<void>;
  status(userId: string): Promise<SlackConnectionStatusResponse>;
  setChannel(userId: string, channelId: string, channelName: string | null): Promise<void>;
  notifySenderLimit(input: {
    userId: string;
    senderEmail: string;
    senderId: string;
    hourlyLimit: number;
    windowStart: Date;
  }): Promise<boolean>;
}

export const createSlackService = (
  repository: SlackConnectionRepository = createPrismaSlackConnectionRepository(),
  oauth: SlackOAuthClient = createSlackOAuthClient(),
  claimNotification?: (key: string) => Promise<boolean>,
  tokenCodec: SlackTokenCodec = { encrypt: encryptSlackToken, decrypt: decryptSlackToken },
): SlackService => ({
  authorizationUrl() {
    if (!isSlackConfigured()) {
      throw new SlackServiceError(
        503,
        "SLACK_NOT_CONFIGURED",
        `Slack OAuth is not configured. Missing: ${getMissingSlackConfig().join(", ")}.`,
      );
    }
    const state = randomUUID();
    return { state, url: oauth.authorizationUrl(state) };
  },

  async completeAuthorization(userId, state, expectedState, code) {
    if (!isSlackConfigured()) {
      throw new SlackServiceError(503, "SLACK_NOT_CONFIGURED", "Slack OAuth is not configured.");
    }
    if (!state || !expectedState || state !== expectedState) {
      throw new SlackServiceError(
        400,
        "SLACK_STATE_INVALID",
        "The Slack OAuth state was invalid or expired.",
      );
    }
    if (!code)
      throw new SlackServiceError(
        400,
        "SLACK_CODE_MISSING",
        "Slack did not provide an authorization code.",
      );
    const result = await oauth.exchangeCode(code);
    await repository.upsertConnected({
      userId,
      teamId: result.teamId,
      teamName: result.teamName,
      channelId: result.channelId,
      channelName: result.channelName,
      accessTokenEnc: tokenCodec.encrypt(result.accessToken),
      scope: result.scope,
    });
  },

  async disconnect(userId) {
    await repository.disconnect(userId, new Date());
  },

  async status(userId) {
    const connection = await repository.findForUser(userId);
    return {
      connected: connection?.status === "CONNECTED",
      teamName: connection?.status === "CONNECTED" ? connection.teamName : null,
      channelName: connection?.status === "CONNECTED" ? connection.channelName : null,
      channelId: connection?.status === "CONNECTED" ? connection.channelId : null,
    };
  },

  async setChannel(userId, channelId, channelName) {
    await repository.setChannel(userId, channelId, channelName);
  },

  async notifySenderLimit(input) {
    const connection = await repository.findForUser(input.userId);
    if (!connection || connection.status !== "CONNECTED" || !connection.channelId) return false;
    const dedupKey = `slack-limit:${input.senderId}:${input.windowStart.getTime()}`;
    if (claimNotification && !(await claimNotification(dedupKey))) return false;
    try {
      await oauth.postMessage({
        accessToken: tokenCodec.decrypt(connection.accessTokenEnc),
        channelId: connection.channelId,
        text: `Sender ${input.senderEmail} reached its hourly limit of ${input.hourlyLimit}. New emails are being rescheduled until the next hour.`,
      });
      return true;
    } catch (error: unknown) {
      logger.warn({ err: error, senderId: input.senderId }, "Slack limit notification failed.");
      return false;
    }
  },
});
