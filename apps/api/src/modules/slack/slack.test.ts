import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { AuthUser, UserRepository } from "../auth/types.js";
import { createSlackService, type SlackService } from "./service.js";
import type { SlackConnectionRepository, SlackOAuthClient } from "./types.js";

const user: AuthUser = {
  id: "slack-user",
  googleId: "slack-google-user",
  email: "slack@example.com",
  name: "Slack User",
  avatarUrl: null,
};

const users: UserRepository = {
  upsertGoogleUser: async () => user,
  findById: async (id) => (id === user.id ? user : null),
};

const createSlackTestService = (): SlackService => ({
  authorizationUrl: () => ({
    state: "test-state",
    url: "https://slack.com/oauth/v2/authorize?state=test-state",
  }),
  completeAuthorization: async () => {},
  disconnect: async () => {},
  status: async () => ({
    connected: true,
    teamName: "Workspace",
    channelName: "alerts",
    channelId: "C123",
  }),
  setChannel: async () => {},
  notifySenderLimit: async () => true,
});

describe("Slack integration routes", () => {
  it("requires an authenticated session", async () => {
    const response = await request(
      createApp({ userRepository: users, slackService: createSlackTestService() }),
    ).get("/integrations/slack/status");
    expect(response.status).toBe(401);
  });

  it("stores OAuth state in the session and exposes connection status", async () => {
    const app = createApp({
      userRepository: users,
      enableTestAuthAdapter: true,
      slackService: createSlackTestService(),
    });
    const agent = request.agent(app);
    await agent.post("/auth/__test__/login");

    const connect = await agent.get("/integrations/slack/connect");
    const status = await agent.get("/integrations/slack/status");

    expect(connect.status).toBe(302);
    expect(connect.headers.location).toContain("slack.com/oauth");
    expect(status.body).toEqual({
      connected: true,
      teamName: "Workspace",
      channelName: "alerts",
      channelId: "C123",
    });
  });

  it("deduplicates the same sender/hour Slack notification", async () => {
    let posts = 0;
    const repository: SlackConnectionRepository = {
      upsertConnected: async () => {
        throw new Error("not used");
      },
      findForUser: async () => ({
        id: "connection",
        userId: user.id,
        teamId: "T123",
        teamName: "Workspace",
        channelId: "C123",
        channelName: "alerts",
        accessTokenEnc: "encrypted",
        scope: "chat:write",
        status: "CONNECTED",
        connectedAt: new Date(),
        disconnectedAt: null,
      }),
      disconnect: async () => {},
      setChannel: async () => {},
    };
    const oauth: SlackOAuthClient = {
      authorizationUrl: () => "https://slack.test",
      exchangeCode: async () => {
        throw new Error("not used");
      },
      postMessage: async () => {
        posts += 1;
      },
    };
    const claimed = new Set<string>();
    const service = createSlackService(
      repository,
      oauth,
      async (key) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
      { encrypt: (value) => value, decrypt: () => "slack-token" },
    );
    const input = {
      userId: user.id,
      senderId: "sender-1",
      senderEmail: "sender@example.com",
      hourlyLimit: 1,
      windowStart: new Date("2026-08-30T10:00:00.000Z"),
    };

    expect(await service.notifySenderLimit(input)).toBe(true);
    expect(await service.notifySenderLimit(input)).toBe(false);
    expect(posts).toBe(1);
  });
});
