import type { EmailStatus, SearchIndexStatus } from "@prisma/client";

export interface EmailSearchDocument {
  id: string;
  userId: string;
  campaignId: string;
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  failureReason: string | null;
  previewUrl: string | null;
}

export interface SearchIndexRepository {
  findForIndex(emailId: string): Promise<EmailSearchDocument | null>;
  markIndexStatus(input: {
    emailId: string;
    status: SearchIndexStatus;
    indexedAt: Date | null;
    error: string | null;
  }): Promise<void>;
}

export interface SearchEmailRecord {
  id: string;
  recipient: string;
  subject: string;
  scheduledAt: Date;
  sentAt: Date | null;
  status: EmailStatus;
  previewUrl: string | null;
  failureReason: string | null;
}

export interface SearchDatabaseRepository {
  findOwnedByIds(userId: string, ids: string[]): Promise<SearchEmailRecord[]>;
}

export interface SearchHit {
  id: string;
}

export interface SearchClient {
  ping(): Promise<void>;
  indices: {
    exists(input: { index: string }): Promise<boolean>;
    create(input: { index: string; mappings: Record<string, unknown> }): Promise<void>;
  };
  index(input: { index: string; id: string; document: EmailSearchDocument }): Promise<void>;
  search(input: {
    index: string;
    from: number;
    size: number;
    query: Record<string, unknown>;
    sort: Array<Record<string, "asc" | "desc">>;
  }): Promise<{ total: number; hits: SearchHit[] }>;
}
