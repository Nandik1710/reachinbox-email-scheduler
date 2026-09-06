import "dotenv/config";
import { z } from "zod";

const optionalNonEmpty = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const isTestRuntime = process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);

const optionalHexKey = z.preprocess(
  (value) => {
    if (value === "") return undefined;
    // Tests use isolated Slack adapters and must not be blocked by a developer's
    // unrelated local .env value. Development/production still fail closed below.
    if (isTestRuntime && typeof value === "string" && !/^[0-9a-fA-F]{64}$/.test(value)) {
      return undefined;
    }
    return value;
  },
  z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_URL: z.string().url().default("http://localhost:5173"),
  API_URL: z.string().url().default("http://localhost:4000"),
  DATABASE_URL: z.string().min(1).default("mysql://app:app@localhost:3306/email_scheduler"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  ELASTICSEARCH_URL: z.string().url().default("http://localhost:9200"),
  ELASTICSEARCH_INDEX: z.string().min(1).default("scheduled-emails"),
  SEARCH_INDEX_MAX_ATTEMPTS: z.coerce.number().int().positive().max(10).default(3),
  SEARCH_INDEX_RETRY_DELAY_MS: z.coerce.number().int().nonnegative().default(250),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  GOOGLE_CLIENT_ID: optionalNonEmpty,
  GOOGLE_CLIENT_SECRET: optionalNonEmpty,
  GOOGLE_CALLBACK_URL: z.string().url().default("http://localhost:4000/auth/google/callback"),
  SESSION_SECRET: optionalNonEmpty,
  ETHEREAL_HOST: z.string().min(1).default("smtp.ethereal.email"),
  ETHEREAL_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  ETHEREAL_USER: optionalNonEmpty,
  ETHEREAL_PASSWORD: optionalNonEmpty,
  SLACK_CLIENT_ID: optionalNonEmpty,
  SLACK_CLIENT_SECRET: optionalNonEmpty,
  SLACK_REDIRECT_URI: z.string().url().default("http://localhost:4000/integrations/slack/callback"),
  SLACK_TOKEN_ENCRYPTION_KEY: optionalHexKey,
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  MIN_DELAY_BETWEEN_EMAILS_MS: z.coerce.number().int().nonnegative().default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().positive().default(200),
  EMAIL_QUEUE_NAME: z.string().min(1).default("email-sends"),
  EMAIL_MAX_ATTEMPTS: z.coerce.number().int().positive().max(10).default(3),
  PROCESSING_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  SEED_DEMO_GOOGLE_ID: z.string().min(1).default("local-demo-user"),
  SEED_DEMO_EMAIL: z.string().email().default("demo@local.test"),
  SEED_DEMO_NAME: z.string().min(1).default("Local Demo User"),
});

const parsedEnv = envSchema.safeParse(process.env);
if (!parsedEnv.success) {
  const issues = parsedEnv.error.issues
    .map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration. ${issues}`);
}

export const env = parsedEnv.data;
