import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../../app.js";
import type { AuthUser, UserRepository } from "./types.js";

const testUser: AuthUser = {
  id: "test-user-id",
  googleId: "isolated-test-google-user",
  email: "test@example.com",
  name: "Test User",
  avatarUrl: null,
};

const createTestRepository = (): UserRepository => ({
  upsertGoogleUser: async () => testUser,
  findById: async (id) => (id === testUser.id ? testUser : null),
});

describe("authentication", () => {
  it("rejects protected API requests without a session", async () => {
    const response = await request(createApp({ userRepository: createTestRepository() })).get(
      "/api/profile",
    );

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_REQUIRED");
  });

  it("persists session identity through the isolated test adapter", async () => {
    const app = createApp({ userRepository: createTestRepository(), enableTestAuthAdapter: true });
    const agent = request.agent(app);

    const loginResponse = await agent.post("/auth/__test__/login");
    const profileResponse = await agent.get("/api/profile");
    const sessionResponse = await agent.get("/auth/me");

    expect(loginResponse.status).toBe(204);
    expect(profileResponse.status).toBe(200);
    expect(profileResponse.body).toEqual({
      id: testUser.id,
      email: testUser.email,
      name: testUser.name,
      avatarUrl: null,
    });
    expect(sessionResponse.body).toEqual({
      authenticated: true,
      user: { id: testUser.id, email: testUser.email, name: testUser.name, avatarUrl: null },
    });
  });

  it("destroys the session on logout", async () => {
    const app = createApp({ userRepository: createTestRepository(), enableTestAuthAdapter: true });
    const agent = request.agent(app);

    await agent.post("/auth/__test__/login");
    const logoutResponse = await agent.post("/auth/logout");
    const profileResponse = await agent.get("/api/profile");
    const sessionResponse = await agent.get("/auth/me");

    expect(logoutResponse.status).toBe(204);
    expect(profileResponse.status).toBe(401);
    expect(sessionResponse.body).toEqual({ authenticated: false, user: null });
  });

  it("does not pretend Google OAuth is available when credentials are missing", async () => {
    const response = await request(createApp({ userRepository: createTestRepository() })).get(
      "/auth/google",
    );

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe("OAUTH_NOT_CONFIGURED");
  });
});
