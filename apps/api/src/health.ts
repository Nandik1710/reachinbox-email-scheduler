import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";

import type { SearchClient } from "./modules/search/types.js";

export interface ReadinessCheck {
  status: "ready" | "not_ready" | "unknown";
  checks: Record<string, "up" | "down" | "not_configured">;
}

export interface InfrastructureDependencies {
  database: Pick<PrismaClient, "$queryRaw">;
  redis: Pick<Redis, "ping">;
  search: Pick<SearchClient, "ping">;
}

export const createInfrastructureReadinessCheck = (
  dependencies: InfrastructureDependencies,
): (() => Promise<ReadinessCheck>) => {
  return async () => {
    const checks = await Promise.all(
      [
        ["database", () => dependencies.database.$queryRaw`SELECT 1`],
        ["redis", () => dependencies.redis.ping()],
        ["elasticsearch", () => dependencies.search.ping()],
      ].map(async ([name, check]) => {
        try {
          await (check as () => Promise<unknown>)();
          return [name, "up"] as const;
        } catch {
          return [name, "down"] as const;
        }
      }),
    );
    const result = Object.fromEntries(checks) as ReadinessCheck["checks"];
    return {
      status: Object.values(result).every((value) => value === "up") ? "ready" : "not_ready",
      checks: result,
    };
  };
};
