import { describe, expect, it, vi } from "vitest";

import { createEtherealClient } from "./ethereal.js";

describe("Ethereal delivery adapter", () => {
  it("maps sender, recipient, content, provider id, and preview URL", async () => {
    const sendMail = vi.fn(async (message: Record<string, unknown>) => {
      expect(message).toMatchObject({
        from: { name: "Demo Sender", address: "sender@example.com" },
        to: "recipient@example.com",
        subject: "Hello",
        text: "Message body",
        html: "Message body",
      });
      return { messageId: "<message-1@example.com>" };
    });
    const close = vi.fn();
    const client = createEtherealClient({
      createTransport: () => ({ sendMail, close }),
      getTestMessageUrl: () => "https://ethereal.email/message/1",
    });

    await expect(
      client.send({
        fromEmail: "sender@example.com",
        fromName: "Demo Sender",
        recipient: "recipient@example.com",
        subject: "Hello",
        body: "Message body",
      }),
    ).resolves.toEqual({
      messageId: "<message-1@example.com>",
      previewUrl: "https://ethereal.email/message/1",
    });
    expect(sendMail).toHaveBeenCalledOnce();
    client.close();
    expect(close).toHaveBeenCalledOnce();
  });
});
