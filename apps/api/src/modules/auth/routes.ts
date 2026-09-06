import { Router, type NextFunction, type Request, type Response } from "express";

import { env } from "../../config/env.js";
import { isGoogleOAuthConfigured, getMissingGoogleOAuthConfig } from "./configuration.js";
import type { PassportInstance } from "./passport.js";
import { SESSION_COOKIE_NAME } from "./session.js";
import type { AuthUser, UserRepository } from "./types.js";

const sendError = (response: Response, status: number, code: string, message: string): void => {
  response.status(status).json({ error: { code, message } });
};

const userResponse = (user: AuthUser) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  avatarUrl: user.avatarUrl,
});

export const requireAuth = (request: Request, response: Response, next: NextFunction): void => {
  if (request.isAuthenticated()) {
    next();
    return;
  }

  sendError(response, 401, "AUTH_REQUIRED", "You must be signed in to access this resource.");
};

export const createAuthRouter = (
  passport: PassportInstance,
  users: UserRepository,
  enableTestAuthAdapter = false,
): Router => {
  const router = Router();

  router.get("/google", (request, response, next) => {
    if (!isGoogleOAuthConfigured()) {
      sendError(
        response,
        503,
        "OAUTH_NOT_CONFIGURED",
        `Google OAuth is not configured. Missing: ${getMissingGoogleOAuthConfig().join(", ")}.`,
      );
      return;
    }

    passport.authenticate("google", {
      scope: ["profile", "email"],
      // passport-google-oauth20 supports boolean state generation at runtime;
      // its older type declaration only accepts a string here.
      state: true as unknown as string,
    })(request, response, next);
  });

  router.get(
    "/google/callback",
    (request, response, next) => {
      if (!isGoogleOAuthConfigured()) {
        sendError(
          response,
          503,
          "OAUTH_NOT_CONFIGURED",
          `Google OAuth is not configured. Missing: ${getMissingGoogleOAuthConfig().join(", ")}.`,
        );
        return;
      }

      passport.authenticate("google", {
        failureRedirect: `${env.WEB_URL}/login?error=oauth_failed`,
      })(request, response, next);
    },
    (_request, response) => {
  response
    .status(302)
    .set("Location", `${env.WEB_URL}/auth/callback`)
    .end();
    },
  );

  router.get("/me", (request, response) => {
    if (!request.isAuthenticated() || !request.user) {
      response.json({ authenticated: false, user: null });
      return;
    }

    response.json({ authenticated: true, user: userResponse(request.user) });
  });

  router.post("/logout", (request, response) => {
    request.logout((logoutError) => {
      if (logoutError) {
        sendError(response, 500, "LOGOUT_FAILED", "Unable to sign out safely.");
        return;
      }

      request.session.destroy((sessionError) => {
        if (sessionError) {
          sendError(response, 500, "LOGOUT_FAILED", "Unable to sign out safely.");
          return;
        }

        response.clearCookie(SESSION_COOKIE_NAME, { httpOnly: true, sameSite: "lax" });
        response.status(204).send();
      });
    });
  });

  if (enableTestAuthAdapter) {
    router.post("/__test__/login", async (request, response) => {
      try {
        const user = await users.upsertGoogleUser({
          googleId: "isolated-test-google-user",
          email: "test@example.com",
          name: "Test User",
          avatarUrl: null,
        });

        request.login(user, (loginError) => {
          if (loginError) {
            sendError(response, 500, "TEST_LOGIN_FAILED", "Test authentication adapter failed.");
            return;
          }

          response.status(204).send();
        });
      } catch (error: unknown) {
        sendError(
          response,
          500,
          "TEST_LOGIN_FAILED",
          error instanceof Error ? error.message : "Test authentication adapter failed.",
        );
      }
    });
  }

  return router;
};
