import type {
  EmailListQuery,
  EmailListItem,
  PaginatedEmailResponse,
} from "../../contracts/emails.js";
import type { EmailStatus } from "@prisma/client";
import { CampaignRequestError } from "../campaigns/service.js";
import type { CampaignRepository } from "../campaigns/repository.js";

const scheduledStatuses: EmailStatus[] = ["PENDING", "QUEUED", "PROCESSING"];
const sentStatuses: EmailStatus[] = ["SENT", "FAILED"];

const toEmailListItem = (item: {
  id: string;
  recipient: string;
  subject: string;
  scheduledAt: Date;
  sentAt: Date | null;
  status: EmailStatus;
  previewUrl: string | null;
  failureReason: string | null;
}): EmailListItem => item;

export class EmailListingService {
  constructor(private readonly repository: CampaignRepository) {}

  async list(
    userId: string,
    view: "scheduled" | "sent",
    query: EmailListQuery,
  ): Promise<PaginatedEmailResponse> {
    const allowedStatuses = view === "scheduled" ? scheduledStatuses : sentStatuses;
    if (query.status && !allowedStatuses.includes(query.status as EmailStatus)) {
      throw new CampaignRequestError(
        400,
        "INVALID_STATUS_FILTER",
        `Status ${query.status} is not available in the ${view} view.`,
      );
    }

    const statuses = query.status ? [query.status as EmailStatus] : allowedStatuses;
    const { items, total } = await this.repository.listEmails({
      userId,
      statuses,
      search: query.search,
      campaignId: query.campaignId,
      senderId: query.senderId,
      from: query.from,
      to: query.to,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      view,
    });

    return {
      items: items.map(toEmailListItem),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    };
  }
}
