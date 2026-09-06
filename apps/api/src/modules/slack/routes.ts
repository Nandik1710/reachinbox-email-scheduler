import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { env } from "../../config/env.js";
import type { SlackService } from "./service.js";
import { SlackServiceError } from "./service.js";

const sendError = (response: Response, error: unknown): void => {
  if (error instanceof SlackServiceError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  response
    .status(502)
    .json({ error: { code: "SLACK_REQUEST_FAILED", message: "Slack request failed." } });
};

const userId = (request: Request): string => {
  if (!request.user) throw new SlackServiceError(401, "AUTH_REQUIRED", "You must be signed in.");
  return request.user.id;
};

export const createSlackRouter = (service: SlackService): Router => {
  const router = Router();

  router.get("/connect", (request, response) => {
    try {
      const result = service.authorizationUrl();
      request.session.slackOauthState = result.state;
      response
        .status(302)
        .set("Location", result.url)
        .end();
    } catch (error: unknown) {
      sendError(response, error);
    }
  });

  router.get("/reconnect", (request, response) => {
    try {
      const result = service.authorizationUrl();
      request.session.slackOauthState = result.state;
      response.redirect(result.url);
    } catch (error: unknown) {
      sendError(response, error);
    }
  });

  router.get("/callback", async (request, response) => {
    try {
      const state = typeof request.query.state === "string" ? request.query.state : undefined;
      const code = typeof request.query.code === "string" ? request.query.code : undefined;
      const expectedState = request.session.slackOauthState;
      delete request.session.slackOauthState;
      await service.completeAuthorization(userId(request), state, expectedState, code);
      response
        .status(302)
        .set("Location", `${env.WEB_URL}/?slack=connected`)
        .end();
    } catch (error: unknown) {
      sendError(response, error);
    }
  });

  router.get("/status", async (request, response) => {
    try {
      response.json(await service.status(userId(request)));
    } catch (error: unknown) {
      sendError(response, error);
    }
  });

  router.post("/disconnect", async (request, response) => {
    try {
      await service.disconnect(userId(request));
      response.status(204).send();
    } catch (error: unknown) {
      sendError(response, error);
    }
  });

  router.post("/channel", async (request, response) => {
    try {
      const input = z
        .object({
          channelId: z.string().min(1),
          channelName: z.string().min(1).nullable().optional(),
        })
        .parse(request.body);
      await service.setChannel(userId(request), input.channelId, input.channelName ?? null);
      response.status(204).send();
    } catch (error: unknown) {
      sendError(response, error);
    }
  });

  return router;
};
