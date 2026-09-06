export const emailIndexMapping = {
  properties: {
    id: { type: "keyword" },
    userId: { type: "keyword" },
    campaignId: { type: "keyword" },
    senderId: { type: "keyword" },
    recipient: { type: "keyword" },
    subject: { type: "text" },
    body: { type: "text" },
    status: { type: "keyword" },
    scheduledAt: { type: "date" },
    sentAt: { type: "date" },
    failureReason: { type: "text" },
    previewUrl: { type: "keyword", index: false },
  },
} as const;

export const emailIndexName = (index: string): string => index;
