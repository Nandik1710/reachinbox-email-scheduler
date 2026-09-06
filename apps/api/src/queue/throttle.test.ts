import { describe, expect, it } from "vitest";

import { HOUR_MS, InMemorySenderThrottle } from "./throttle.js";

describe("sender throttling", () => {
  it("enforces minimum delay and hourly rollover", async () => {
    const throttle = new InMemorySenderThrottle();
    const senderId = "sender-1";
    const first = await throttle.reserve({
      senderId,
      now: new Date("2026-08-30T10:00:00.000Z"),
      minDelayMs: 2_000,
      hourlyLimit: 2,
    });
    const second = await throttle.reserve({
      senderId,
      now: new Date("2026-08-30T10:00:01.000Z"),
      minDelayMs: 2_000,
      hourlyLimit: 2,
    });
    const third = await throttle.reserve({
      senderId,
      now: new Date("2026-08-30T10:00:02.000Z"),
      minDelayMs: 2_000,
      hourlyLimit: 2,
    });
    const nextHour = await throttle.reserve({
      senderId,
      now: new Date("2026-08-30T11:00:00.000Z"),
      minDelayMs: 2_000,
      hourlyLimit: 2,
    });

    expect(first.allowed).toBe(true);
    expect(first.reachedHourlyLimit).toBe(false);
    expect(second).toMatchObject({
      allowed: false,
      nextAvailableAt: new Date("2026-08-30T10:00:02.000Z"),
    });
    expect(third).toMatchObject({ allowed: true, reachedHourlyLimit: true });
    expect(nextHour).toMatchObject({
      allowed: true,
      windowStart: new Date("2026-08-30T11:00:00.000Z"),
    });
    expect(nextHour.windowStart.getTime() - third.windowStart.getTime()).toBe(HOUR_MS);
  });

  it("allows only one reservation per available slot under concurrent callers", async () => {
    const throttle = new InMemorySenderThrottle();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        throttle.reserve({
          senderId: "sender-concurrent",
          now: new Date("2026-08-30T12:00:00.000Z"),
          minDelayMs: 2_000,
          hourlyLimit: 1,
        }),
      ),
    );
    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(results.filter((result) => !result.allowed)).toHaveLength(9);
  });
});
