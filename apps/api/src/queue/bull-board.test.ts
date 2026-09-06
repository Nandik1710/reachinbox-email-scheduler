import express, { Router } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import type { AuthUser, UserRepository } from "../modules/auth/types.js";

const user: AuthUser = {
  id: "bull-board-user",
  googleId: "bull-board-google-user",
  email: "queues@example.com",
  name: "Queues User",
  avatarUrl: null,
};

const userRepository: UserRepository = {
  upsertGoogleUser: async () => user,
  findById: async (id) => (id === user.id ? user : null),
};

describe("Bull Board route", () => {
  it("protects queue visibility with the application session", async () => {
    const board = Router();
    board.get("/", (_request, response) => response.json({ queues: ["email-sends"] }));
    const app = createApp({
      userRepository,
      enableTestAuthAdapter: true,
      bullBoardRouter: board,
    });

    const unauthorized = await request(app).get("/admin/queues/");
    expect(unauthorized.status).toBe(401);

    const agent = request.agent(express().use(app));
    await agent.post("/auth/__test__/login");
    const authorized = await agent.get("/admin/queues/");
    expect(authorized.status).toBe(200);
    expect(authorized.body).toEqual({ queues: ["email-sends"] });
  });
});
