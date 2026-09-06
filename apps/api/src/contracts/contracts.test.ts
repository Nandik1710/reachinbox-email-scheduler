import { describe, expect, it } from "vitest";

import { emailListQuerySchema } from "./emails.js";
import { scheduleCampaignRequestSchema } from "./campaigns.js";

describe("request contracts", () => {
  it("accepts a valid campaign schedule request", () => {
    const result = scheduleCampaignRequestSchema.safeParse({
      subject: "A useful introduction",
      body: "Hello from the scheduler.",
      recipients: ["first@example.com", "second@example.com"],
      startAt: "2026-09-01T10:00:00.000Z",
      delayMs: 2000,
      hourlyLimit: 200,
    });

    expect(result.success).toBe(true);
  });

  it("rejects invalid recipients and unsafe limits", () => {
    const result = scheduleCampaignRequestSchema.safeParse({
      subject: "Test",
      body: "Body",
      recipients: ["not-an-email"],
      startAt: "2026-09-01T10:00:00.000Z",
      delayMs: -1,
      hourlyLimit: 0,
    });

    expect(result.success).toBe(false);
  });

  it("applies safe pagination defaults to email list queries", () => {
    const result = emailListQuerySchema.parse({});

    expect(result).toMatchObject({ page: 1, pageSize: 25 });
  });
});
