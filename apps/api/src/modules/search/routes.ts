import { Router, type NextFunction, type Request, type Response } from "express";

import { emailSearchQuerySchema } from "../../contracts/search.js";
import { SearchServiceError, type EmailSearchIndexer } from "./service.js";

const asyncRoute =
  (handler: (request: Request, response: Response, next: NextFunction) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response, next).catch(next);
  };

export const createSearchRouter = (indexer: EmailSearchIndexer): Router => {
  const router = Router();
  router.get(
    "/emails",
    asyncRoute(async (request, response) => {
      const parsed = emailSearchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        response.status(400).json({
          error: {
            code: "INVALID_SEARCH_QUERY",
            message: "The search query is invalid.",
            details: parsed.error.flatten(),
          },
        });
        return;
      }
      if (!request.user) {
        response
          .status(401)
          .json({ error: { code: "AUTH_REQUIRED", message: "You must be signed in." } });
        return;
      }
      try {
        response.json(await indexer.search(request.user.id, parsed.data));
      } catch (error: unknown) {
        if (error instanceof SearchServiceError) {
          response
            .status(error.status)
            .json({ error: { code: error.code, message: error.message } });
          return;
        }
        throw error;
      }
    }),
  );
  return router;
};
