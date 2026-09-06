export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface SlackStatus {
  connected: boolean;
  teamName: string | null;
  channelName: string | null;
  channelId: string | null;
}

export interface EmailItem {
  id: string;
  recipient: string;
  subject: string;
  scheduledAt: string;
  sentAt: string | null;
  status: "PENDING" | "QUEUED" | "PROCESSING" | "SENT" | "FAILED";
  previewUrl: string | null;
  failureReason: string | null;
}

export interface PaginatedEmails {
  items: EmailItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Sender {
  id: string;
  email: string;
  displayName: string | null;
}

export interface ScheduleResponse {
  campaign: {
    id: string;
    subject: string;
    startAt: string;
    delayMs: number;
    hourlyLimit: number;
    status: string;
    totalEmails: number;
    createdAt: string;
  };
  recipients: {
    detected: number;
    accepted: number;
    rejected: number;
    duplicates: number;
    rejectedItems: Array<{ value: string; reason: string }>;
  };
  queue: { status: "queued" | "pending_insertion"; enqueued?: number };
}

interface SessionResponse {
  authenticated: boolean;
  user: SessionUser | null;
}

const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000";

const request = async (path: string, init?: RequestInit): Promise<Response> =>
  fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

const parseError = async (response: Response): Promise<Error> => {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return new Error(body.error?.message ?? "Something went wrong.");
  } catch {
    return new Error("Something went wrong. Please try again.");
  }
};

export const getSession = async (): Promise<SessionResponse> => {
  const response = await request("/auth/me");
  if (!response.ok) throw new Error("Unable to load your session.");
  return response.json() as Promise<SessionResponse>;
};

export const logout = async (): Promise<void> => {
  const response = await request("/auth/logout", { method: "POST" });
  if (!response.ok) throw new Error("Unable to sign out.");
};

export const googleLoginUrl = `${apiUrl}/auth/google`;
export const slackConnectUrl = `${apiUrl}/integrations/slack/connect`;

export const getSlackStatus = async (): Promise<SlackStatus> => {
  const response = await request("/integrations/slack/status");
  if (!response.ok) throw new Error("Unable to load Slack status.");
  return response.json() as Promise<SlackStatus>;
};

export const disconnectSlack = async (): Promise<void> => {
  const response = await request("/integrations/slack/disconnect", { method: "POST" });
  if (!response.ok) throw new Error("Unable to disconnect Slack.");
};

export const getEmails = async (
  view: "scheduled" | "sent",
  params: { search?: string; page?: number; pageSize?: number; status?: EmailItem["status"] } = {},
): Promise<PaginatedEmails> => {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 25),
  });
  if (params.search?.trim()) query.set("search", params.search.trim());
  if (params.status) query.set("status", params.status);
  const response = await request(`/api/emails/${view}?${query.toString()}`);
  if (!response.ok) throw await parseError(response);
  return response.json() as Promise<PaginatedEmails>;
};

export const searchEmails = async (
  view: "scheduled" | "sent",
  params: { search: string; page?: number; pageSize?: number; status?: EmailItem["status"] },
): Promise<PaginatedEmails> => {
  const query = new URLSearchParams({
    search: params.search,
    dateField: view === "sent" ? "sentAt" : "scheduledAt",
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 25),
  });
  if (params.status) query.set("status", params.status);
  const response = await request(`/api/search/emails?${query.toString()}`);
  if (!response.ok) throw await parseError(response);
  return response.json() as Promise<PaginatedEmails>;
};

export const getSenders = async (): Promise<Sender[]> => {
  const response = await request("/api/campaigns/senders");
  if (!response.ok) throw await parseError(response);
  const result = (await response.json()) as { items: Sender[] };
  return result.items;
};

export const scheduleCampaign = async (input: {
  subject: string;
  body: string;
  recipientContent: string;
  startAt: string;
  delayMs: number;
  hourlyLimit: number;
  senderId?: string;
}): Promise<ScheduleResponse> => {
  const response = await request("/api/campaigns", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!response.ok) throw await parseError(response);
  return response.json() as Promise<ScheduleResponse>;
};
