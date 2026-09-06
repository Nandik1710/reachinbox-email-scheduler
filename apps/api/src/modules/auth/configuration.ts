import { env } from "../../config/env.js";

export const getMissingGoogleOAuthConfig = (): string[] => {
  if (env.NODE_ENV === "test") return ["disabled in test environment"];

  const missing: string[] = [];
  if (!env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (!env.GOOGLE_CALLBACK_URL) missing.push("GOOGLE_CALLBACK_URL");
  return missing;
};

export const isGoogleOAuthConfigured = (): boolean => getMissingGoogleOAuthConfig().length === 0;

export const getSessionSecret = (): string => {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production.");
  }

  return "development-only-session-secret-change-me-123456";
};
