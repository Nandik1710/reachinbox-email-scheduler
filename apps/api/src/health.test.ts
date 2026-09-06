import request from "supertest";
import { describe, expect, it } from "vitest";

import app, { createApp } from "./app.js";
import { createInfrastructureReadinessCheck } from "./health.js";

describe("health endpoint", () => {
  it("reports that the API scaffold is alive", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ service: "api", status: "ok" });
  });

  it("exposes dependency-aware readiness", async () => {
    const readinessCheck = createInfrastructureReadinessCheck({
      database: { $queryRaw: async () => [] } as never,
      redis: { ping: async () => "PONG" },
      search: { ping: async () => undefined },
    });
    const response = await request(createApp({ readinessCheck })).get("/health/ready");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "ready",
      checks: { database: "up", redis: "up", elasticsearch: "up" },
    });
  });

  it("returns 503 when a dependency is unavailable", async () => {
    const response = await request(
      createApp({
        readinessCheck: async () => ({
          status: "not_ready" as const,
          checks: { database: "up" as const, redis: "down" as const },
        }),
      }),
    ).get("/health/ready");
    expect(response.status).toBe(503);
    expect(response.body.status).toBe("not_ready");
  });
});
