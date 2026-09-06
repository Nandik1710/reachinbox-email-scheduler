import { describe, expect, it, vi } from "vitest";

import { emailIndexMapping } from "./mapping.js";
import { buildEmailSearchQuery, EmailSearchIndexer } from "./service.js";
import type { SearchClient, SearchDatabaseRepository, SearchIndexRepository } from "./types.js";

const queryInput = {
  search: "launch",
  status: "QUEUED" as const,
  campaignId: "cmj2x8m3e0000abcd12345678",
  senderId: "cmj2x8m3e0001abcd12345678",
  dateField: "scheduledAt" as const,
  from: new Date("2026-08-01T00:00:00.000Z"),
  to: new Date("2026-08-31T23:59:59.000Z"),
  page: 2,
  pageSize: 10,
};

const document = {
  id: "clx-email-1",
  userId: "user-1",
  campaignId: "campaign-1",
  senderId: "sender-1",
  recipient: "person@example.com",
  subject: "Launch",
  body: "The launch is ready.",
  status: "QUEUED" as const,
  scheduledAt: "2026-08-30T10:00:00.000Z",
  sentAt: null,
  failureReason: null,
  previewUrl: null,
};

const record = {
  id: document.id,
  recipient: document.recipient,
  subject: document.subject,
  scheduledAt: new Date(document.scheduledAt),
  sentAt: null,
  status: document.status,
  previewUrl: null,
  failureReason: null,
};

describe("email search", () => {
  it("declares stable keyword, text, and date mappings", () => {
    expect(emailIndexMapping.properties.userId).toEqual({ type: "keyword" });
    expect(emailIndexMapping.properties.subject).toEqual({ type: "text" });
    expect(emailIndexMapping.properties.body).toEqual({ type: "text" });
    expect(emailIndexMapping.properties.scheduledAt).toEqual({ type: "date" });
    expect(emailIndexMapping.properties.previewUrl).toEqual({ type: "keyword", index: false });
  });

  it("builds a tenant-scoped query with text, field, and date filters", () => {
    const query = buildEmailSearchQuery("user-1", queryInput) as {
      bool: { must: Array<Record<string, unknown>>; filter: Array<Record<string, unknown>> };
    };

    expect(query.bool.filter).toEqual([
      { term: { userId: "user-1" } },
      { term: { status: "QUEUED" } },
      { term: { campaignId: "cmj2x8m3e0000abcd12345678" } },
      { term: { senderId: "cmj2x8m3e0001abcd12345678" } },
      {
        range: {
          scheduledAt: {
            gte: "2026-08-01T00:00:00.000Z",
            lte: "2026-08-31T23:59:59.000Z",
          },
        },
      },
    ]);
    expect(query.bool.must[0]).toEqual({
      multi_match: { query: "launch", fields: ["recipient", "subject", "body"] },
    });
  });

  it("indexes a document and records the successful status", async () => {
    const index = vi.fn(async () => undefined);
    const markIndexStatus = vi.fn(async () => undefined);
    const client = {
      indices: {
        exists: vi.fn(async () => true),
        create: vi.fn(async () => undefined),
      },
      index,
      search: vi.fn(),
    } as unknown as SearchClient;
    const repository = {
      findForIndex: vi.fn(async () => document),
      markIndexStatus,
    } as unknown as SearchIndexRepository;
    const databaseRepository = { findOwnedByIds: vi.fn() } as unknown as SearchDatabaseRepository;
    const indexer = new EmailSearchIndexer(client, repository, databaseRepository);

    await expect(indexer.indexEmailById(document.id)).resolves.toBe(true);
    expect(index).toHaveBeenCalledWith(expect.objectContaining({ id: document.id, document }));
    expect(markIndexStatus).toHaveBeenCalledWith(
      expect.objectContaining({ emailId: document.id, status: "INDEXED", error: null }),
    );
  });

  it("keeps MySQL-owned records authoritative when rehydrating search hits", async () => {
    const search = vi.fn(async (input: Parameters<SearchClient["search"]>[0]) => {
      void input;
      return {
        total: 2,
        hits: [{ id: "owned" }, { id: "not-owned" }],
      };
    });
    const client = {
      indices: { exists: vi.fn(), create: vi.fn() },
      index: vi.fn(),
      search,
    } as unknown as SearchClient;
    const databaseRepository = {
      findOwnedByIds: vi.fn(async (userId: string, ids: string[]) => {
        expect(userId).toBe("user-1");
        expect(ids).toEqual(["owned", "not-owned"]);
        return [{ ...record, id: "owned" }];
      }),
    } as unknown as SearchDatabaseRepository;
    const indexer = new EmailSearchIndexer(client, {} as SearchIndexRepository, databaseRepository);

    const result = await indexer.search("user-1", {
      search: "launch",
      dateField: "scheduledAt",
      page: 1,
      pageSize: 25,
    });

    expect(result.items).toEqual([{ ...record, id: "owned" }]);
    expect(result.total).toBe(2);
    expect(search.mock.calls[0]?.[0]?.query).toEqual(
      expect.objectContaining({
        bool: expect.objectContaining({ filter: [{ term: { userId: "user-1" } }] }),
      }),
    );
  });

  it("retries indexing and records a failure without throwing to the caller", async () => {
    const error = new Error("Elasticsearch offline");
    const markIndexStatus = vi.fn(async () => undefined);
    const client = {
      indices: { exists: vi.fn(), create: vi.fn() },
      index: vi.fn(async () => {
        throw error;
      }),
      search: vi.fn(),
    } as unknown as SearchClient;
    const repository = {
      findForIndex: vi.fn(async () => document),
      markIndexStatus,
    } as unknown as SearchIndexRepository;
    const indexer = new EmailSearchIndexer(client, repository, {} as SearchDatabaseRepository);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(indexer.indexEmailById(document.id)).resolves.toBe(false);
    expect(client.index).toHaveBeenCalledTimes(3);
    expect(markIndexStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        emailId: document.id,
        status: "FAILED",
        error: error.message,
      }),
    );
    errorSpy.mockRestore();
  });
});
