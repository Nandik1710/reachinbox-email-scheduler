import type { SlackConnectionStatus } from "@prisma/client";

export interface SlackConnectionRecord {
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
}

export interface SlackConnectionRepository {
  upsertConnected(input: {
    userId: string;
    teamId: string;
    teamName: string | null;
    channelId: string | null;
    channelName: string | null;
    accessTokenEnc: string;
    scope: string | null;
  }): Promise<SlackConnectionRecord>;
  findForUser(userId: string): Promise<SlackConnectionRecord | null>;
  disconnect(userId: string, disconnectedAt: Date): Promise<void>;
  setChannel(userId: string, channelId: string, channelName: string | null): Promise<void>;
}

export interface SlackOAuthResult {
  accessToken: string;
  teamId: string;
  teamName: string | null;
  channelId: string | null;
  channelName: string | null;
  scope: string | null;
}

export interface SlackOAuthClient {
  authorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<SlackOAuthResult>;
  postMessage(input: { accessToken: string; channelId: string; text: string }): Promise<void>;
}

export interface SlackConnectionStatusResponse {
  connected: boolean;
  teamName: string | null;
  channelName: string | null;
  channelId: string | null;
}
