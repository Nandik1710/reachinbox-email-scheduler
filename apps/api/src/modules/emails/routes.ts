import { Router, type NextFunction, type Request, type Response } from "express";

import { emailListQuerySchema } from "../../contracts/emails.js";
import { createPrismaCampaignRepository } from "../campaigns/repository.js";
import { EmailListingService } from "./service.js";

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

export const createEmailRouter = (
  service = new EmailListingService(createPrismaCampaignRepository()),
): Router => {
  const router = Router();

  const list = (view: "scheduled" | "sent") =>
    asyncRoute(async (request, response) => {
      const parsed = emailListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        sendError(
          response,
          400,
          "INVALID_EMAIL_QUERY",
          "The email list query is invalid.",
          parsed.error.flatten(),
        );
        return;
      }

      const userId = request.user?.id;
      if (!userId) {
        sendError(response, 401, "AUTH_REQUIRED", "You must be signed in to list emails.");
        return;
      }

      const result = await service.list(userId, view, parsed.data);
      response.json(result);
    });

  router.get("/scheduled", list("scheduled"));
  router.get("/sent", list("sent"));

  return router;
};
