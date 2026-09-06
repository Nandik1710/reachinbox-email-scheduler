import { z } from "zod";

import { databaseIdSchema, emailStatusSchema, paginatedEmailResponseSchema } from "./emails.js";

export const emailSearchQuerySchema = z.object({
  search: z.string().trim().max(320).optional(),
  status: emailStatusSchema.optional(),
  campaignId: databaseIdSchema.optional(),
  senderId: databaseIdSchema.optional(),
  dateField: z.enum(["scheduledAt", "sentAt"]).default("scheduledAt"),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const emailSearchResponseSchema = paginatedEmailResponseSchema;

export type EmailSearchQuery = z.infer<typeof emailSearchQuerySchema>;
export type EmailSearchResponse = z.infer<typeof emailSearchResponseSchema>;
