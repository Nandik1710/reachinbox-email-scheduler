import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { disconnectDatabase, prisma } from "./db/client.js";
import { getMissingGoogleOAuthConfig } from "./modules/auth/configuration.js";
import { connectSessionStore, disconnectSessionStore } from "./modules/auth/session.js";
import { createBullMqQueueInsertionService } from "./queue/bullmq.js";
import { createBullBoard } from "./queue/bull-board.js";
import { createEmailSearchIndexer } from "./modules/search/service.js";
import { createElasticsearchClient } from "./modules/search/client.js";
import { createInfrastructureReadinessCheck } from "./health.js";
import { Redis } from "ioredis";
import { logger } from "./lib/logger.js";

let server: ReturnType<typeof app.listen> | undefined;
const queueInsertionService = createBullMqQueueInsertionService();
const bullBoard = createBullBoard();
const searchIndexer = createEmailSearchIndexer();
const readinessRedis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1 });
const readinessCheck = createInfrastructureReadinessCheck({
  database: prisma,
  redis: readinessRedis,
  search: createElasticsearchClient(),
});
const app = createApp({
  queueInsertionService,
  bullBoardRouter: bullBoard.router,
  searchIndexer,
  readinessCheck,
});

const closeServer = async (): Promise<void> => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server?.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

const shutdown = async (signal: string) => {
  logger.info({ signal }, "API shutting down gracefully.");
  try {
    await closeServer();
    await bullBoard.close();
    await queueInsertionService.close?.();
    await readinessRedis.quit();
    await disconnectSessionStore();
    await disconnectDatabase();
    process.exit(0);
  } catch (error: unknown) {
    console.error("Graceful shutdown failed.", error);
    process.exitCode = 1;
  }
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

async function start(): Promise<void> {
  const missingGoogleConfig = getMissingGoogleOAuthConfig();
  if (missingGoogleConfig.length > 0) {
    logger.warn(
      { missing: missingGoogleConfig },
      "Google OAuth is unavailable until its configuration is set.",
    );
  }
  if (!env.SESSION_SECRET && env.NODE_ENV !== "test") {
    logger.warn("SESSION_SECRET is not set; local sessions use a development-only fallback.");
  }

  await connectSessionStore();
  await prisma.$connect();
  await searchIndexer.initialize();
  server = app.listen(env.PORT, () => {
    logger.info({ url: env.API_URL }, "API listening.");
  });
}

void start().catch(async (error: unknown) => {
  logger.fatal({ err: error }, "API startup failed.");
  await readinessRedis.quit().catch(() => undefined);
  await disconnectSessionStore();
  await disconnectDatabase();
  process.exitCode = 1;
});
