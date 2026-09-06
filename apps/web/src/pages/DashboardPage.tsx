import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from "react";

import { useAuth } from "../auth/AuthProvider.js";
import { Icon, type IconName } from "../components/Icon.js";
import {
  disconnectSlack,
  getEmails,
  getSenders,
  getSlackStatus,
  searchEmails,
  scheduleCampaign,
  slackConnectUrl,
  type EmailItem,
  type Sender,
  type SlackStatus,
} from "../lib/api.js";

const initials = (name: string): string =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const formatDate = (date: string | null, fallback = "—"): string => {
  if (!date) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
};

const futureDateTime = (hours = 1): string => {
  const date = new Date(Date.now() + hours * 60 * 60 * 1000);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60 * 1000).toISOString().slice(0, 16);
};

const detectEmails = (value: string): string[] => {
  const found = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return Array.from(new Set(found.map((email) => email.trim().toLowerCase())));
};

export function DashboardPage() {
  const { user, logout } = useAuth();
  const [activeMailbox, setActiveMailbox] = useState<"scheduled" | "sent">("scheduled");
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [counts, setCounts] = useState({ scheduled: 0, sent: 0 });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<EmailItem["status"] | "">("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slack, setSlack] = useState<SlackStatus | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadMailbox = async (
    view: "scheduled" | "sent",
    query = "",
    requestedPage = page,
  ): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = query
        ? await searchEmails(view, {
            search: query,
            page: requestedPage,
            status: statusFilter || undefined,
          })
        : await getEmails(view, {
            page: requestedPage,
            status: statusFilter || undefined,
          });
      setEmails(result.items);
      setTotalPages(result.totalPages);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load your mailbox.");
      setEmails([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMailbox(activeMailbox, search, page);
  }, [activeMailbox, page, search, statusFilter]);

  useEffect(() => {
    void getSlackStatus()
      .then(setSlack)
      .catch(() => setSlack(null));
  }, []);

  const refreshCounts = async (): Promise<void> => {
    try {
      const [scheduled, sent] = await Promise.all([getEmails("scheduled"), getEmails("sent")]);
      setCounts({ scheduled: scheduled.total, sent: sent.total });
    } catch {
      // The active list already shows the actionable error state.
    }
  };

  useEffect(() => {
    void refreshCounts();
  }, []);

  const handleSlackDisconnect = async (): Promise<void> => {
    try {
      await disconnectSlack();
      setSlack({ connected: false, teamName: null, channelName: null, channelId: null });
      setToast("Slack disconnected.");
    } catch (disconnectError: unknown) {
      setToast(
        disconnectError instanceof Error ? disconnectError.message : "Unable to disconnect Slack.",
      );
    }
  };

  if (!user) return null;

  return (
    <main className="mailbox-shell">
      <MailboxSidebar
        user={user}
        activeMailbox={activeMailbox}
        counts={counts}
        slack={slack}
        onMailboxChange={(view) => {
          setSearch("");
          setStatusFilter("");
          setPage(1);
          setActiveMailbox(view);
        }}
        onCompose={() => setComposeOpen(true)}
        settingsOpen={settingsOpen}
        onSettings={() => setSettingsOpen((current) => !current)}
        onSlackDisconnect={() => void handleSlackDisconnect()}
        onLogout={() => void logout()}
      />
      {composeOpen ? (
        <ComposeView
          onClose={() => setComposeOpen(false)}
          onScheduled={async (message) => {
            setComposeOpen(false);
            setToast(message);
            await Promise.all([loadMailbox(activeMailbox, search, page), refreshCounts()]);
          }}
        />
      ) : settingsOpen ? (
        <SettingsView
          slack={slack}
          onSlackDisconnect={() => void handleSlackDisconnect()}
          onClose={() => setSettingsOpen(false)}
        />
      ) : (
        <section className="mailbox-content">
          <header className="mailbox-toolbar">
            <label className="search-box">
              <Icon name="search" size={22} />
              <input
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search"
                aria-label="Search mailbox"
              />
            </label>
            <div className="toolbar-actions">
              <div className="filter-control">
                <button
                  type="button"
                  aria-label="Filter"
                  aria-expanded={filterOpen}
                  title="Filter"
                  onClick={() => setFilterOpen((current) => !current)}
                >
                  <Icon name="filter" size={21} />
                </button>
                {filterOpen ? (
                  <label className="filter-popover">
                    <span>Status</span>
                    <select
                      value={statusFilter}
                      onChange={(event) => {
                        setStatusFilter(event.target.value as EmailItem["status"] | "");
                        setPage(1);
                      }}
                    >
                      <option value="">All statuses</option>
                      {activeMailbox === "scheduled" ? (
                        <>
                          <option value="PENDING">Pending</option>
                          <option value="QUEUED">Queued</option>
                          <option value="PROCESSING">Processing</option>
                        </>
                      ) : (
                        <>
                          <option value="SENT">Sent</option>
                          <option value="FAILED">Failed</option>
                        </>
                      )}
                    </select>
                  </label>
                ) : null}
              </div>
              <button
                type="button"
                aria-label="Refresh"
                title="Refresh"
                onClick={() => void loadMailbox(activeMailbox, search, page)}
              >
                <Icon name="refresh" size={21} />
              </button>
            </div>
          </header>
          <div className="mailbox-list" aria-live="polite">
            {loading ? <EmailSkeletonList /> : null}
            {!loading && error ? <p className="mailbox-state mailbox-error">{error}</p> : null}
            {!loading && !error && emails.length === 0 ? (
              <div className="mailbox-state">
                <strong>No {activeMailbox} emails yet.</strong>
                <span>{search ? "Try another search." : "Compose a message to get started."}</span>
              </div>
            ) : null}
            {!loading && !error && emails.length > 0
              ? emails.map((email) => (
                  <EmailRow key={email.id} email={email} view={activeMailbox} />
                ))
              : null}
          </div>
          {!loading && !error && totalPages > 1 ? (
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          ) : null}
        </section>
      )}
      {toast ? (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ) : null}
    </main>
  );
}

function MailboxSidebar({
  user,
  activeMailbox,
  counts,
  slack,
  onMailboxChange,
  onCompose,
  settingsOpen,
  onSettings,
  onSlackDisconnect,
  onLogout,
}: {
  user: { name: string; email: string; avatarUrl: string | null };
  activeMailbox: "scheduled" | "sent";
  counts: { scheduled: number; sent: number };
  slack: SlackStatus | null;
  onMailboxChange: (view: "scheduled" | "sent") => void;
  onCompose: () => void;
  settingsOpen: boolean;
  onSettings: () => void;
  onSlackDisconnect: () => void;
  onLogout: () => void;
}) {
  return (
    <aside className="mailbox-sidebar">
      <div className="product-wordmark">ONB</div>
      <div className="profile-card">
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt="" className="profile-avatar" />
        ) : (
          <span className="profile-avatar profile-fallback">{initials(user.name)}</span>
        )}
        <div className="profile-details">
          <strong>{user.name}</strong>
          <span>{user.email}</span>
        </div>
        <Icon name="chevronDown" size={18} className="profile-chevron" />
      </div>
      <button type="button" className="compose-button" onClick={onCompose}>
        Compose
      </button>
      <p className="sidebar-label">CORE</p>
      <nav className="mailbox-nav" aria-label="Mailbox folders">
        <MailboxLink
          active={activeMailbox === "scheduled"}
          count={counts.scheduled}
          icon="clock"
          label="Scheduled"
          onClick={() => onMailboxChange("scheduled")}
        />
        <MailboxLink
          active={activeMailbox === "sent"}
          count={counts.sent}
          icon="send"
          label="Sent"
          onClick={() => onMailboxChange("sent")}
        />
      </nav>
      {slack?.connected ? (
        <button type="button" className="slack-button connected" onClick={onSlackDisconnect}>
          Slack connected · Disconnect
        </button>
      ) : (
        <a className="slack-button" href={slackConnectUrl}>
          Connect Slack
        </a>
      )}
      <button
        type="button"
        className={settingsOpen ? "slack-button connected" : "slack-button"}
        onClick={onSettings}
      >
        Settings &amp; integrations
      </button>
      <button type="button" className="logout-button" onClick={onLogout}>
        Log out
      </button>
    </aside>
  );
}

function MailboxLink({
  active,
  count,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "mailbox-link active" : "mailbox-link"}
      onClick={onClick}
    >
      <Icon name={icon} size={21} className="nav-icon" />
      <span>{label}</span>
      <span className="mail-count">{count}</span>
    </button>
  );
}

function EmailRow({ email, view }: { email: EmailItem; view: "scheduled" | "sent" }) {
  return (
    <article className="email-row">
      <div className="email-row-main">
        <span className="email-recipient">To: {email.recipient}</span>
        <span className={`status-badge ${email.status.toLowerCase()}`}>
          {view === "scheduled" ? formatDate(email.scheduledAt) : email.status.toLowerCase()}
        </span>
        <strong>{email.subject}</strong>
        {email.failureReason ? (
          <span className="email-preview">— {email.failureReason}</span>
        ) : null}
      </div>
      <span className="email-row-date">{view === "sent" ? formatDate(email.sentAt) : ""}</span>
      <button type="button" className="star-button" aria-label="Star email">
        ☆
      </button>
    </article>
  );
}

function EmailSkeletonList() {
  return (
    <div className="skeleton-list" aria-label="Loading emails">
      {[0, 1, 2, 3].map((item) => (
        <div className="email-skeleton" key={item}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  return (
    <nav className="pagination" aria-label="Email pagination">
      <button
        type="button"
        aria-label="Previous page"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
      >
        <Icon name="chevronLeft" size={18} />
      </button>
      <span>
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        aria-label="Next page"
        disabled={page === totalPages}
        onClick={() => onChange(page + 1)}
      >
        <Icon name="chevronRight" size={18} />
      </button>
    </nav>
  );
}

function SettingsView({
  slack,
  onSlackDisconnect,
  onClose,
}: {
  slack: SlackStatus | null;
  onSlackDisconnect: () => void;
  onClose: () => void;
}) {
  return (
    <section className="settings-content">
      <div className="settings-heading">
        <div>
          <p className="eyebrow">SETTINGS</p>
          <h1>Integrations</h1>
        </div>
        <button type="button" className="icon-button" aria-label="Close settings" onClick={onClose}>
          <Icon name="close" size={24} />
        </button>
      </div>
      <article className="integration-card">
        <div className="integration-icon">S</div>
        <div className="integration-copy">
          <h2>Slack</h2>
          <p>Get notified when a sender reaches its hourly limit.</p>
          {slack?.connected ? (
            <span className="connection-status">
              Connected{slack.teamName ? ` to ${slack.teamName}` : ""}
            </span>
          ) : (
            <span className="connection-status disconnected">Not connected</span>
          )}
        </div>
        {slack?.connected ? (
          <button type="button" className="outline-green-button" onClick={onSlackDisconnect}>
            Disconnect
          </button>
        ) : (
          <a className="outline-green-button settings-connect" href={slackConnectUrl}>
            Connect Slack
          </a>
        )}
      </article>
      <div className="resource-links">
        <h2>Resources</h2>
        <a href="https://nandik-dawar.netlify.app/" target="_blank" rel="noreferrer">
          Portfolio <span>↗</span>
        </a>
      </div>
    </section>
  );
}

function ComposeView({
  onClose,
  onScheduled,
}: {
  onClose: () => void;
  onScheduled: (message: string) => Promise<void>;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipientSource, setRecipientSource] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientInput, setRecipientInput] = useState("");
  const [startAt, setStartAt] = useState(futureDateTime());
  const [delayMs, setDelayMs] = useState("2000");
  const [hourlyLimit, setHourlyLimit] = useState("200");
  const [senders, setSenders] = useState<Sender[]>([]);
  const [senderId, setSenderId] = useState("");
  const [showSchedule, setShowSchedule] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void getSenders()
      .then((items) => {
        setSenders(items);
        setSenderId(items[0]?.id ?? "");
      })
      .catch((error: unknown) =>
        setMessage(error instanceof Error ? error.message : "Unable to load senders."),
      );
  }, []);

  const visibleRecipients = recipients.slice(0, 3);
  const hiddenRecipientCount = Math.max(0, recipients.length - visibleRecipients.length);
  const source = recipientSource || recipients.join("\n");
  const sender = useMemo(() => senders.find((item) => item.id === senderId), [senderId, senders]);

  const addRecipient = (value: string): void => {
    const emails = detectEmails(value);
    if (emails.length === 0) return;
    setRecipients((current) => Array.from(new Set([...current, ...emails])));
    setRecipientSource("");
    setRecipientInput("");
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    const detected = detectEmails(content);
    setRecipientSource(content);
    setRecipients(detected);
    setMessage(`${detected.length} email addresses detected from ${file.name}.`);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setMessage(null);
    if (!subject.trim() || !body.trim()) {
      setMessage("Add a subject and message before scheduling.");
      return;
    }
    if (detectEmails(source).length === 0) {
      setMessage("Add at least one valid recipient or upload a recipient list.");
      return;
    }
    if (!showSchedule) {
      setShowSchedule(true);
      return;
    }
    setSubmitting(true);
    try {
      const result = await scheduleCampaign({
        subject: subject.trim(),
        body: body.trim(),
        recipientContent: source,
        startAt: new Date(startAt).toISOString(),
        delayMs: Number(delayMs),
        hourlyLimit: Number(hourlyLimit),
        ...(senderId ? { senderId } : {}),
      });
      await onScheduled(
        `${result.recipients.accepted} email${result.recipients.accepted === 1 ? "" : "s"} scheduled.`,
      );
    } catch (submitError: unknown) {
      setMessage(
        submitError instanceof Error ? submitError.message : "Unable to schedule campaign.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="compose-content">
      <form className="compose-form" onSubmit={(event) => void handleSubmit(event)}>
        <div className="compose-heading">
          <h1>New message</h1>
          <button
            type="button"
            className="icon-button"
            aria-label="Close compose"
            onClick={onClose}
          >
            <Icon name="close" size={24} />
          </button>
        </div>
        <div className="compose-field compose-from">
          <label htmlFor="sender">From</label>
          <select
            id="sender"
            value={senderId}
            onChange={(event) => setSenderId(event.target.value)}
          >
            {senders.length === 0 ? <option value="">No active sender configured</option> : null}
            {senders.map((item) => (
              <option key={item.id} value={item.id}>
                {item.displayName ? `${item.displayName} · ` : ""}
                {item.email}
              </option>
            ))}
          </select>
          <Icon name="chevronDown" size={17} />
          {sender ? <span className="compose-helper">Sender selected</span> : null}
        </div>
        <div className="compose-field compose-to">
          <label htmlFor="recipient-input">To</label>
          <div className="recipient-area">
            {visibleRecipients.map((recipient) => (
              <button
                type="button"
                className="recipient-pill"
                key={recipient}
                onClick={() =>
                  setRecipients((current) => current.filter((item) => item !== recipient))
                }
                title="Remove recipient"
              >
                {recipient} <span>×</span>
              </button>
            ))}
            {hiddenRecipientCount > 0 ? (
              <span className="recipient-pill">+{hiddenRecipientCount}</span>
            ) : null}
            <input
              id="recipient-input"
              value={recipientInput}
              onChange={(event) => setRecipientInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  addRecipient(recipientInput);
                }
              }}
              placeholder={recipients.length ? "Add another recipient" : "recipient@example.com"}
              aria-label="Recipient email"
            />
          </div>
          <label className="upload-action">
            <Icon name="upload" size={18} />
            Upload List
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              onChange={(event) => void handleFile(event)}
            />
          </label>
        </div>
        <div className="compose-field compose-subject">
          <label htmlFor="subject">Subject</label>
          <input
            id="subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Subject"
          />
        </div>
        <div className="compose-options">
          <label>
            <span>Delay between 2 emails</span>
            <input
              type="number"
              min="2"
              step="1"
              value={Number(delayMs) / 1000}
              onChange={(event) => setDelayMs(String(Number(event.target.value) * 1000))}
              aria-label="Delay between emails in seconds"
            />
            <small>sec</small>
          </label>
          <label>
            <span>Hourly Limit</span>
            <input
              type="number"
              min="1"
              value={hourlyLimit}
              onChange={(event) => setHourlyLimit(event.target.value)}
              aria-label="Hourly limit"
            />
          </label>
        </div>
        <div className="editor-card">
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Type Your Reply..."
            aria-label="Message body"
          />
          <EditorToolbar />
        </div>
        {message ? (
          <p className="compose-message" role="status">
            {message}
          </p>
        ) : null}
        <div className="compose-footer">
          <button type="button" className="text-button" onClick={onClose}>
            Discard
          </button>
          <div className="send-later-wrap">
            {showSchedule ? (
              <div className="send-later-popover">
                <div className="popover-title">Send Later</div>
                <label className="date-picker">
                  <span>Pick date &amp; time</span>
                  <Icon name="calendar" size={18} />
                  <input
                    type="datetime-local"
                    value={startAt}
                    min={futureDateTime(0)}
                    onChange={(event) => setStartAt(event.target.value)}
                  />
                </label>
                <button type="button" onClick={() => setStartAt(futureDateTime(24))}>
                  Tomorrow
                </button>
                <button type="button" onClick={() => setStartAt(futureDateTime(24))}>
                  Tomorrow, 10:00 AM
                </button>
                <button type="button" onClick={() => setStartAt(futureDateTime(24))}>
                  Tomorrow, 3:00 PM
                </button>
                <div className="popover-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setShowSchedule(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="outline-green-button" disabled={submitting}>
                    {submitting ? "Scheduling…" : "Done"}
                  </button>
                </div>
              </div>
            ) : null}
            <button type="submit" className="green-button" disabled={senders.length === 0}>
              {showSchedule ? "Schedule" : "Send Later"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

function EditorToolbar() {
  const tools: Array<{ name: IconName; label: string }> = [
    { name: "bold", label: "Bold" },
    { name: "italic", label: "Italic" },
    { name: "underline", label: "Underline" },
    { name: "align", label: "Align" },
    { name: "list", label: "List" },
    { name: "quote", label: "Quote" },
    { name: "link", label: "Link" },
    { name: "strikethrough", label: "Strikethrough" },
  ];
  return (
    <div className="editor-toolbar" aria-label="Message formatting toolbar">
      <button type="button" aria-label="Undo">
        ↶
      </button>
      <button type="button" aria-label="Redo">
        ↷
      </button>
      <span className="toolbar-divider" />
      {tools.map((tool) => (
        <button type="button" key={tool.name} aria-label={tool.label} title={tool.label}>
          <Icon name={tool.name} size={18} />
        </button>
      ))}
    </div>
  );
}
