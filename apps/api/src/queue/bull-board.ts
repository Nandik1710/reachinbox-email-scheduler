import { createBullBoard as createBullBoardApi } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { env } from "../config/env.js";

export interface BullBoardHandle {
  router: ReturnType<ExpressAdapter["getRouter"]>;
  close(): Promise<void>;
}

export const createBullBoard = (): BullBoardHandle => {
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(env.EMAIL_QUEUE_NAME, { connection });
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");
  createBullBoardApi({
    queues: [new BullMQAdapter(queue)],
    serverAdapter,
  });

  return {
    router: serverAdapter.getRouter(),
    async close() {
      await queue.close();
      await connection.quit();
    },
  };
};
