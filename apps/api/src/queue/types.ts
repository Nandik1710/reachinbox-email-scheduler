export interface QueueEmailInput {
  emailId: string;
  campaignId: string;
  scheduledAt: Date;
  queueJobId: string;
}

export interface QueueInsertionService {
  enqueueEmails(emails: QueueEmailInput[]): Promise<void>;
  close?(): Promise<void>;
}

/** Queue insertion is intentionally deferred until the BullMQ milestone. */
export const deferredQueueInsertionService: QueueInsertionService = {
  async enqueueEmails(): Promise<void> {
    throw new Error("Queue insertion is not implemented for this application instance.");
  },
};
