import { prisma, disconnectDatabase } from "../db/client.js";
import { env } from "../config/env.js";
import { createPrismaCampaignRepository } from "../modules/campaigns/repository.js";
import { CampaignSchedulingService } from "../modules/campaigns/service.js";
import { createBullMqQueueInsertionService } from "../queue/bullmq.js";

const recipient = process.argv[2];

const main = async (): Promise<void> => {
  if (!recipient) {
    throw new Error("Usage: pnpm smoke:schedule recipient@example.com");
  }

  const user = await prisma.user.findUnique({ where: { googleId: env.SEED_DEMO_GOOGLE_ID } });
  if (!user) {
    throw new Error("Seed the database first so the smoke command has a demo user.");
  }

  const queue = createBullMqQueueInsertionService();
  try {
    const service = new CampaignSchedulingService(createPrismaCampaignRepository(), queue);
    const result = await service.schedule(user.id, {
      subject: "ReachInbox queue smoke test",
      body: "This is a local Ethereal smoke test.",
      recipientContent: recipient,
      startAt: new Date(Date.now() + 15_000),
      delayMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
      hourlyLimit: 1,
    });
    console.info(JSON.stringify(result, null, 2));
  } finally {
    await queue.close?.();
    await disconnectDatabase();
  }
};

void main().catch(async (error: unknown) => {
  console.error("Queue smoke scheduling failed.", error);
  await disconnectDatabase();
  process.exitCode = 1;
});
