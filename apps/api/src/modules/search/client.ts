import { Client } from "@elastic/elasticsearch";

import { env } from "../../config/env.js";
import type { EmailSearchDocument, SearchClient } from "./types.js";

export const createElasticsearchClient = (): SearchClient => {
  const client = new Client({ node: env.ELASTICSEARCH_URL });
  return {
    async ping() {
      await client.ping();
    },
    indices: {
      async exists(input) {
        return Boolean(await client.indices.exists(input));
      },
      async create(input) {
        await client.indices.create(input as never);
      },
    },
    async index(input) {
      await client.index({ index: input.index, id: input.id, document: input.document });
    },
    async search(input) {
      const response = await client.search<EmailSearchDocument>({
        index: input.index,
        from: input.from,
        size: input.size,
        query: input.query,
        sort: input.sort,
      });
      const total =
        typeof response.hits.total === "number"
          ? response.hits.total
          : (response.hits.total?.value ?? 0);
      return {
        total,
        hits: response.hits.hits.flatMap((hit) => (hit._id ? [{ id: hit._id }] : [])),
      };
    },
  };
};
