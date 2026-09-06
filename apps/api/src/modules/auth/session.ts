import session from "express-session";
import { RedisStore } from "connect-redis";
import { createClient, type RedisClientType } from "redis";

import { env } from "../../config/env.js";
import { getSessionSecret } from "./configuration.js";
import { logger } from "../../lib/logger.js";

declare module "express-session" {
  interface SessionData {
    slackOauthState?: string;
  }
}

export const SESSION_COOKIE_NAME = "connect.sid";

const isTestRuntime = env.NODE_ENV === "test" || Boolean(process.env.VITEST);
const redisClient: RedisClientType | null = isTestRuntime
  ? null
  : createClient({ url: env.REDIS_URL });

if (redisClient) {
  redisClient.on("error", (error: unknown) => {
    logger.error({ err: error }, "Redis session store error.");
  });
}

const redisStore = redisClient ? new RedisStore({ client: redisClient }) : undefined;

export const createSessionMiddleware = (): ReturnType<typeof session> => {
  const options: session.SessionOptions = {
    name: SESSION_COOKIE_NAME,
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  };

  if (redisStore) options.store = redisStore;
  return session(options);
};

export const connectSessionStore = async (): Promise<void> => {
  if (redisClient && !redisClient.isOpen) await redisClient.connect();
};

export const disconnectSessionStore = async (): Promise<void> => {
  if (redisClient?.isOpen) await redisClient.quit();
};
