import cors from "cors";
import express from "express";
import helmet from "helmet";
import { Passport } from "passport";

import { env } from "./config/env.js";
import { prisma } from "./db/client.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createCampaignRouter } from "./modules/campaigns/routes.js";
import { CampaignSchedulingService } from "./modules/campaigns/service.js";
import { createEmailRouter } from "./modules/emails/routes.js";
import { EmailListingService } from "./modules/emails/service.js";
import { createPrismaCampaignRepository } from "./modules/campaigns/repository.js";
import type { QueueInsertionService } from "./queue/types.js";
import { createAuthRouter, requireAuth } from "./modules/auth/routes.js";
import { configurePassport } from "./modules/auth/passport.js";
import { createPrismaUserRepository } from "./modules/auth/repository.js";
import { createSessionMiddleware } from "./modules/auth/session.js";
import type { UserRepository } from "./modules/auth/types.js";
import { createSlackRouter } from "./modules/slack/routes.js";
import { createSlackService, type SlackService } from "./modules/slack/service.js";
import { createSearchRouter } from "./modules/search/routes.js";
import { EmailSearchIndexer } from "./modules/search/service.js";
import { createElasticsearchClient } from "./modules/search/client.js";
import {
  createPrismaSearchDatabaseRepository,
  createPrismaSearchIndexRepository,
} from "./modules/search/repository.js";
import type { Router } from "express";
import type { ReadinessCheck } from "./health.js";
import { pinoHttp } from "pino-http";
import { logger } from "./lib/logger.js";

export interface AppOptions {
  userRepository?: UserRepository;
  enableTestAuthAdapter?: boolean;
  campaignService?: CampaignSchedulingService;
  emailListingService?: EmailListingService;
  queueInsertionService?: QueueInsertionService;
  slackService?: SlackService;
  searchIndexer?: EmailSearchIndexer;
  bullBoardRouter?: Router;
  readinessCheck?: () => Promise<ReadinessCheck>;
}

export const createApp = (options: AppOptions = {}) => {
  const app = express();
  const users = options.userRepository ?? createPrismaUserRepository(prisma);
  const passport = new Passport();
  const searchIndexer =
    options.searchIndexer ??
    new EmailSearchIndexer(
      createElasticsearchClient(),
      createPrismaSearchIndexRepository(),
      createPrismaSearchDatabaseRepository(),
    );
  const campaignService =
    options.campaignService ??
    new CampaignSchedulingService(
      createPrismaCampaignRepository(),
      options.queueInsertionService,
      searchIndexer,
    );

  configurePassport(passport, users);

  app.use(helmet());
  app.use(pinoHttp({ logger }));
  app.use(cors({ origin: env.WEB_URL, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(createSessionMiddleware());
  app.use(passport.initialize());
  app.use(passport.session());

  app.get("/health", (_request, response) => {
    response.json({ service: "api", status: "ok" });
  });
  app.get("/health/live", (_request, response) => {
    response.json({ service: "api", status: "ok" });
  });
  app.get("/health/ready", async (_request, response, next) => {
    if (!options.readinessCheck) {
      response.status(503).json({ status: "unknown", checks: {} });
      return;
    }
    try {
      const result = await options.readinessCheck();
      response.status(result.status === "ready" ? 200 : 503).json(result);
    } catch (error: unknown) {
      next(error);
    }
  });

  app.use("/auth", createAuthRouter(passport, users, options.enableTestAuthAdapter));

  app.use("/api/campaigns", requireAuth, createCampaignRouter(campaignService));
  app.use("/api/emails", requireAuth, createEmailRouter(options.emailListingService));
  app.use(
    "/integrations/slack",
    requireAuth,
    createSlackRouter(options.slackService ?? createSlackService()),
  );
  app.use("/api/search", requireAuth, createSearchRouter(searchIndexer));
  if (options.bullBoardRouter) app.use("/admin/queues", requireAuth, options.bullBoardRouter);

  app.get("/api/profile", requireAuth, (request, response) => {
    const user = request.user;
    if (!user) {
      response.status(401).json({
        error: {
          code: "AUTH_REQUIRED",
          message: "You must be signed in to access this resource.",
        },
      });
      return;
    }
    response.json({
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    });
  });

  app.use(errorHandler);

  return app;
};

const app = createApp();

export default app;
