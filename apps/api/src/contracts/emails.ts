import { z } from "zod";

export const emailStatusSchema = z.enum(["PENDING", "QUEUED", "PROCESSING", "SENT", "FAILED"]);
export const databaseIdSchema = z.union([z.string().cuid(), z.string().uuid()]);

export const emailListQuerySchema = z.object({
  status: emailStatusSchema.optional(),
  search: z.string().trim().max(320).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  campaignId: databaseIdSchema.optional(),
  senderId: databaseIdSchema.optional(),
});

export const emailListItemSchema = z.object({
  id: z.string(),
  recipient: z.string().email(),
  subject: z.string(),
  scheduledAt: z.coerce.date(),
  sentAt: z.coerce.date().nullable(),
  status: emailStatusSchema,
  previewUrl: z.string().url().nullable(),
  failureReason: z.string().nullable(),
});

export const paginatedEmailResponseSchema = z.object({
  items: z.array(emailListItemSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export type EmailListQuery = z.infer<typeof emailListQuerySchema>;
export type EmailListItem = z.infer<typeof emailListItemSchema>;
export type PaginatedEmailResponse = z.infer<typeof paginatedEmailResponseSchema>;
