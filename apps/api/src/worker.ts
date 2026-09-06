import { disconnectDatabase, prisma } from "./db/client.js";
import { startBullMqWorker } from "./queue/worker.js";
import { logger } from "./lib/logger.js";

const start = async (): Promise<void> => {
  await prisma.$connect();
  await startBullMqWorker();
  logger.info("BullMQ email worker is listening for delayed email jobs.");
};

void start().catch(async (error: unknown) => {
  logger.fatal({ err: error }, "Email worker startup failed.");
  await disconnectDatabase();
  process.exitCode = 1;
});
