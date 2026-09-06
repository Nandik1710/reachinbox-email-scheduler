import { env } from "../../config/env.js";
import type { EmailSearchQuery, EmailSearchResponse } from "../../contracts/search.js";
import { createElasticsearchClient } from "./client.js";
import { emailIndexMapping } from "./mapping.js";
import {
  createPrismaSearchDatabaseRepository,
  createPrismaSearchIndexRepository,
} from "./repository.js";
import type {
  SearchClient,
  SearchDatabaseRepository,
  SearchIndexRepository,
  SearchHit,
} from "./types.js";
import { logger } from "../../lib/logger.js";

export const buildEmailSearchQuery = (
  userId: string,
  input: EmailSearchQuery,
): Record<string, unknown> => {
  const filters: Record<string, unknown>[] = [{ term: { userId } }];
  if (input.status) filters.push({ term: { status: input.status } });
  if (input.campaignId) filters.push({ term: { campaignId: input.campaignId } });
  if (input.senderId) filters.push({ term: { senderId: input.senderId } });
  if (input.from || input.to) {
    filters.push({
      range: {
        [input.dateField]: {
          ...(input.from ? { gte: input.from.toISOString() } : {}),
          ...(input.to ? { lte: input.to.toISOString() } : {}),
        },
      },
    });
  }

  return {
    bool: {
      must: input.search
        ? [{ multi_match: { query: input.search, fields: ["recipient", "subject", "body"] } }]
        : [{ match_all: {} }],
      filter: filters,
    },
  };
};

export class SearchServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SearchServiceError";
  }
}

const wait = async (milliseconds: number): Promise<void> => {
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
};

export class EmailSearchIndexer {
  constructor(
    private readonly client: SearchClient,
    private readonly repository: SearchIndexRepository,
    private readonly databaseRepository: SearchDatabaseRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async initialize(): Promise<boolean> {
    try {
      if (!(await this.client.indices.exists({ index: env.ELASTICSEARCH_INDEX }))) {
        try {
          await this.client.indices.create({
            index: env.ELASTICSEARCH_INDEX,
            mappings: emailIndexMapping,
          });
        } catch (error: unknown) {
          if (!(error instanceof Error && error.message.includes("resource_already_exists")))
            throw error;
        }
      }
      return true;
    } catch (error: unknown) {
      logger.warn({ err: error }, "Elasticsearch unavailable; using degraded mode.");
      return false;
    }
  }

  async indexEmailById(emailId: string): Promise<boolean> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= env.SEARCH_INDEX_MAX_ATTEMPTS; attempt += 1) {
      try {
        const document = await this.repository.findForIndex(emailId);
        if (!document) return false;
        await this.client.index({ index: env.ELASTICSEARCH_INDEX, id: document.id, document });
        await this.repository.markIndexStatus({
          emailId,
          status: "INDEXED",
          indexedAt: this.now(),
          error: null,
        });
        return true;
      } catch (error: unknown) {
        lastError = error;
        await wait(env.SEARCH_INDEX_RETRY_DELAY_MS * attempt);
      }
    }

    const message =
      lastError instanceof Error ? lastError.message : "Elasticsearch indexing failed.";
    try {
      await this.repository.markIndexStatus({
        emailId,
        status: "FAILED",
        indexedAt: null,
        error: message.slice(0, 2_000),
      });
    } catch (statusError: unknown) {
      logger.error({ err: statusError, emailId }, "Could not persist search failure status.");
    }
    logger.error({ err: lastError, emailId }, "Elasticsearch indexing failed.");
    return false;
  }

  async search(userId: string, input: EmailSearchQuery): Promise<EmailSearchResponse> {
    try {
      const result = await this.client.search({
        index: env.ELASTICSEARCH_INDEX,
        from: (input.page - 1) * input.pageSize,
        size: input.pageSize,
        query: buildEmailSearchQuery(userId, input),
        sort: [{ [input.dateField]: "desc" }, { id: "asc" }],
      });
      const records = await this.databaseRepository.findOwnedByIds(
        userId,
        result.hits.map((hit) => hit.id),
      );
      const byId = new Map(records.map((record) => [record.id, record]));
      const items = result.hits.flatMap((hit: SearchHit) => {
        const record = byId.get(hit.id);
        return record ? [record] : [];
      });
      return {
        items,
        page: input.page,
        pageSize: input.pageSize,
        total: result.total,
        totalPages: result.total === 0 ? 0 : Math.ceil(result.total / input.pageSize),
      };
    } catch {
      throw new SearchServiceError(
        503,
        "SEARCH_UNAVAILABLE",
        "Elasticsearch is unavailable. MySQL remains available for scheduled and sent email lists.",
      );
    }
  }
}

export const createEmailSearchIndexer = (): EmailSearchIndexer =>
  new EmailSearchIndexer(
    createElasticsearchClient(),
    createPrismaSearchIndexRepository(),
    createPrismaSearchDatabaseRepository(),
  );
