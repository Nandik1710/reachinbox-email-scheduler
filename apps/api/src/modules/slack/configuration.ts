import { env } from "../../config/env.js";

export const getMissingSlackConfig = (): string[] =>
  ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_TOKEN_ENCRYPTION_KEY"].filter(
    (name) => !env[name as keyof typeof env],
  );

export const isSlackConfigured = (): boolean => getMissingSlackConfig().length === 0;
