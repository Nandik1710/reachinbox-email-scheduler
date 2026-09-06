import type { ErrorRequestHandler } from "express";
import multer from "multer";

import { CampaignRequestError } from "../modules/campaigns/service.js";
import { RecipientSourceError } from "../modules/campaigns/recipient-parser.js";
import { logger } from "../lib/logger.js";

export const errorHandler: ErrorRequestHandler = (error, _request, response, next) => {
  void next;
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(413).json({
      error: {
        code: "RECIPIENT_FILE_TOO_LARGE",
        message: "The recipient file must be 1 MB or smaller.",
      },
    });
    return;
  }

  if (error instanceof CampaignRequestError || error instanceof RecipientSourceError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error instanceof CampaignRequestError && error.details === undefined
          ? {}
          : { details: error instanceof CampaignRequestError ? error.details : undefined }),
      },
    });
    return;
  }

  logger.error({ err: error }, "Unhandled API error.");
  response
    .status(500)
    .json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred." } });
};
