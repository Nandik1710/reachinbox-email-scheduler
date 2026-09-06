import { z } from "zod";

const recipientValueSchema = z.string().trim().min(1).max(320);
export const MAX_RECIPIENT_SOURCE_BYTES = 1_000_000;

export const campaignStatusSchema = z.enum([
  "DRAFT",
  "SCHEDULED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export const scheduleCampaignRequestSchema = z
  .object({
    subject: z.string().trim().min(1).max(998),
    body: z.string().min(1).max(100_000),
    recipients: z.array(recipientValueSchema).min(1).max(10_000).optional(),
    recipientContent: z.string().trim().min(1).max(MAX_RECIPIENT_SOURCE_BYTES).optional(),
    startAt: z.coerce.date(),
    delayMs: z.coerce.number().int().min(0).max(86_400_000),
    hourlyLimit: z.coerce.number().int().positive().max(100_000),
    senderId: z.string().cuid().optional(),
  })
  .superRefine((value, context) => {
    if (Boolean(value.recipients) === Boolean(value.recipientContent)) {
      context.addIssue({
        code: "custom",
        path: ["recipients"],
        message: "Provide exactly one of recipients or recipientContent.",
      });
    }
  });

export const campaignResponseSchema = z.object({
  id: z.string(),
  subject: z.string(),
  startAt: z.coerce.date(),
  delayMs: z.number().int().nonnegative(),
  hourlyLimit: z.number().int().positive(),
  status: campaignStatusSchema,
  totalEmails: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
});

export const recipientRejectionSchema = z.object({
  value: z.string(),
  reason: z.string(),
});

export const recipientImportSummarySchema = z.object({
  detected: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  rejectedItems: z.array(recipientRejectionSchema),
});

export const scheduleCampaignResponseSchema = z.object({
  campaign: campaignResponseSchema,
  recipients: recipientImportSummarySchema,
  queue: z.object({
    status: z.enum(["queued", "pending_insertion"]),
    enqueued: z.number().int().nonnegative().optional(),
  }),
});

export type ScheduleCampaignRequest = z.infer<typeof scheduleCampaignRequestSchema>;
export type CampaignResponse = z.infer<typeof campaignResponseSchema>;
export type ScheduleCampaignResponse = z.infer<typeof scheduleCampaignResponseSchema>;
