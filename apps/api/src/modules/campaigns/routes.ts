import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";

import { scheduleCampaignRequestSchema } from "../../contracts/campaigns.js";
import { createPrismaCampaignRepository } from "./repository.js";
import { CampaignSchedulingService } from "./service.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1_000_000, files: 1 },
});

const parseRecipientsField = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const parseRequestBody = (request: Request): Record<string, unknown> => {
  const body = request.body as Record<string, unknown>;
  const content = request.file?.buffer.toString("utf8");
  return {
    ...body,
    recipients: parseRecipientsField(body.recipients),
    ...(content ? { recipientContent: content } : {}),
  };
};

const sendError = (
  response: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): void => {
  response
    .status(status)
    .json({ error: { code, message, ...(details === undefined ? {} : { details }) } });
};

const asyncRoute =
  (handler: (request: Request, response: Response, next: NextFunction) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response, next).catch(next);
  };

export const createCampaignRouter = (
  service = new CampaignSchedulingService(createPrismaCampaignRepository()),
): Router => {
  const router = Router();

  router.get(
    "/senders",
    asyncRoute(async (request, response) => {
      const userId = request.user?.id;
      if (!userId) {
        sendError(response, 401, "AUTH_REQUIRED", "You must be signed in to list senders.");
        return;
      }
      response.json({ items: await service.listSenders(userId) });
    }),
  );

  router.post(
    "/",
    upload.single("recipientsFile"),
    asyncRoute(async (request, response) => {
      const parsed = scheduleCampaignRequestSchema.safeParse(parseRequestBody(request));
      if (!parsed.success) {
        sendError(
          response,
          400,
          "INVALID_SCHEDULE_REQUEST",
          "The campaign request is invalid.",
          parsed.error.flatten(),
        );
        return;
      }

      const userId = request.user?.id;
      if (!userId) {
        sendError(response, 401, "AUTH_REQUIRED", "You must be signed in to schedule a campaign.");
        return;
      }

      const result = await service.schedule(userId, parsed.data);
      response.status(201).json(result);
    }),
  );

  router.post(
    "/:campaignId/enqueue",
    asyncRoute(async (request, response) => {
      const userId = request.user?.id;
      if (!userId) {
        sendError(response, 401, "AUTH_REQUIRED", "You must be signed in to enqueue a campaign.");
        return;
      }
      const campaignId = request.params.campaignId;
      if (typeof campaignId !== "string") {
        sendError(response, 400, "INVALID_CAMPAIGN_ID", "A campaign ID is required.");
        return;
      }
      const result = await service.enqueuePending(userId, campaignId);
      response.json({ campaignId, queue: { status: "queued", ...result } });
    }),
  );

  return router;
};
