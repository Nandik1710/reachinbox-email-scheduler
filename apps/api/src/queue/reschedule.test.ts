import { describe, expect, it } from "vitest";

import { rescheduleRateLimitedJob } from "./reschedule.js";

describe("rate-limited BullMQ rescheduling", () => {
  it("moves the existing logical job to the returned time and signals BullMQ", async () => {
    const moved: Array<{ timestamp: number; token?: string }> = [];
    const job = {
      token: "worker-token",
      moveToDelayed: async (timestamp: number, token?: string) => {
        moved.push({ timestamp, token });
      },
    };

    await expect(
      rescheduleRateLimitedJob(
        job,
        new Date("2026-08-30T10:00:00.000Z"),
        new Date("2026-08-30T09:59:59.000Z"),
      ),
    ).rejects.toMatchObject({ name: "DelayedError" });
    expect(moved).toEqual([
      { timestamp: new Date("2026-08-30T10:00:00.000Z").getTime(), token: "worker-token" },
    ]);
  });
});
