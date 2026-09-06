import { Worker } from "bullmq";
import { Redis } from "ioredis";

import { env } from "../config/env.js";
import { prisma } from "../db/client.js";
import { createEtherealClient } from "../integrations/ethereal.js";
import { createPrismaEmailDeliveryRepository } from "../modules/emails/delivery-repository.js";
import { createSlackService } from "../modules/slack/service.js";
import { createEmailSearchIndexer } from "../modules/search/service.js";
import { type QueueJobData } from "./bullmq.js";
import { EmailWorkerProcessor } from "./processor.js";
import { rescheduleRateLimitedJob } from "./reschedule.js";
import { RedisSenderThrottle } from "./throttle.js";
import { logger } from "../lib/logger.js";

export const startBullMqWorker = async (): Promise<void> => {
  const deliveryClient = createEtherealClient();
  const repository = createPrismaEmailDeliveryRepository();
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const searchIndexer = createEmailSearchIndexer();
  await searchIndexer.initialize();
  const slack = createSlackService(
    undefined,
    undefined,
    async (key) => (await connection.set(key, "1", "EX", 3_700, "NX")) === "OK",
  );
  const processor = new EmailWorkerProcessor(
    repository,
    deliveryClient,
    () => new Date(),
    new RedisSenderThrottle(connection),
    slack,
    searchIndexer,
  );
  const worker = new Worker<QueueJobData>(
    env.EMAIL_QUEUE_NAME,
    async (job) => {
      const result = await processor.process(job);
      if (result.status === "rate_limited") {
        await rescheduleRateLimitedJob(job, result.nextAvailableAt);
      }
      return result;
    },
    { connection, concurrency: env.WORKER_CONCURRENCY },
  );

  worker.on("completed", (job, result) => {
    logger.info({ jobId: job.id, status: result.status }, "Email job completed.");
  });
  worker.on("failed", (job, error) => {
    logger.error({ err: error, jobId: job?.id }, "Email job failed.");
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Worker shutting down gracefully.");
    await worker.close();
    deliveryClient.close();
    await connection.quit();
    await prisma.$disconnect();
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
};
