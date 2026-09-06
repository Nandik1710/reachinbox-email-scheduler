# ReachInbox Email Scheduler

A production-minded full-stack email scheduling application for creating, scheduling, sending, and monitoring outreach emails.

The application supports Google authentication, CSV/text recipient uploads, delayed email delivery, sender-level throttling, Ethereal SMTP delivery, Slack notifications, Elasticsearch search, and BullMQ queue monitoring.

## Features

### Backend

- TypeScript and Express.js API
- Real Google OAuth authentication
- HTTP-only authenticated sessions
- MySQL persistence using Prisma ORM
- Campaign and individual email records
- CSV and plain-text recipient parsing
- Email normalization, validation, and deduplication
- Transactional campaign creation
- BullMQ delayed jobs backed by Redis
- Separate API and worker processes
- Configurable worker concurrency
- Configurable delay between sends
- Configurable hourly sender limits
- Atomic Redis-backed rate limiting
- Rate-limited jobs are rescheduled instead of dropped
- Ethereal SMTP delivery through Nodemailer
- Ethereal preview URLs and provider message IDs
- Email delivery attempts and failure details
- Idempotent email processing
- Elasticsearch indexing and authenticated search
- Protected Bull Board queue dashboard
- Slack OAuth connection and disconnection
- Slack alerts when a sender reaches its hourly limit
- Health and readiness endpoints
- Structured logs with sensitive fields redacted

### Frontend

- React and TypeScript dashboard
- Google login flow
- User name, email, and avatar display
- Logout
- Compose email screen
- Sender selection
- CSV/text recipient upload
- Detected recipient count
- Subject and message body fields
- Scheduled Emails view
- Sent Emails view
- Pagination
- Search and status filtering
- Loading, empty, success, and error states
- Slack integration settings
- Responsive layout
- White email-client visual system based on the provided design reference

## Technology Stack

- React
- TypeScript
- Vite
- Express.js
- Prisma
- MySQL
- Redis
- BullMQ
- Nodemailer
- Ethereal Email
- Elasticsearch
- Bull Board
- Docker Compose

## Architecture

```text
React Dashboard
       |
       | HTTP requests with session cookies
       v
Express API
       |
       +---- MySQL through Prisma
       |       |
       |       +---- Users
       |       +---- Senders
       |       +---- Campaigns
       |       +---- Emails
       |       +---- Delivery Attempts
       |
       +---- Redis + BullMQ
       |       |
       |       v
       |    Email Worker
       |       |
       |       +---- Redis throttling
       |       +---- Ethereal SMTP
       |       +---- Slack notifications
       |       +---- Elasticsearch indexing
       |
       +---- Bull Board
```

MySQL is the source of truth for application and delivery state. Redis and BullMQ provide persistent delayed-job scheduling. Elasticsearch is an auxiliary search index and is not required for MySQL scheduling or delivery.

## Scheduling Flow

1. The user signs in with Google.
2. The user opens Compose and enters the subject and message.
3. The user enters recipients or uploads a CSV/text file.
4. The application detects, normalizes, validates, and deduplicates email addresses.
5. The API validates the scheduling request.
6. A database transaction creates the campaign and individual email records.
7. After the database records are created, one deterministic BullMQ job is added per email.
8. Each job contains the email ID, campaign ID, and scheduled time.
9. BullMQ stores the delayed jobs in Redis.
10. The worker receives jobs when they become available.
11. The worker claims the email in the database before sending.
12. Redis-backed throttling checks delay and hourly sender limits.
13. If allowed, the worker sends the email through Ethereal SMTP.
14. The database record changes to `SENT` or `FAILED`.
15. The email is indexed in Elasticsearch.
16. If the hourly limit is reached, the job is rescheduled for the next available time.
17. Slack receives a notification when a sender reaches its hourly limit.

No cron jobs, polling loops, or in-memory-only scheduling are used.

## Restart Persistence and Idempotency

Future jobs survive API and worker restarts because:

- Campaign and email records are stored in MySQL.
- Delayed BullMQ jobs are stored in Redis.
- Each email has a deterministic database ID.
- Each email has a deterministic queue job ID.
- The worker claims an email before attempting delivery.
- Already-sent emails are skipped during normal duplicate processing.
- Restarting the worker does not recreate the campaign from the beginning.

There is an unavoidable SMTP crash window. If Ethereal accepts a message immediately before the worker crashes and before MySQL is updated to `SENT`, a retry could potentially send a duplicate. The normal path uses database claims and idempotent state transitions to prevent ordinary duplicate processing.

## Rate Limiting and Concurrency

The worker concurrency is configurable through:

```env
WORKER_CONCURRENCY=5
```

The minimum delay is configured through:

```env
MIN_DELAY_BETWEEN_EMAILS_MS=2000
```

The global maximum sender limit is configured through:

```env
MAX_EMAILS_PER_HOUR_PER_SENDER=200
```

Each campaign may use a lower delay or hourly limit.

Rate-limit state is stored in Redis. A Lua script atomically updates:

- The sender’s current UTC-hour count
- The sender’s last reservation time
- The next available time
- Whether the hourly limit was reached

When a job cannot run immediately, the worker releases its database claim and reschedules the same BullMQ job using the same job identity.

Redis state is shared across workers and application instances.

## Slack Notifications

Slack uses OAuth authorization and stores the user’s connection in MySQL.

The Slack connection stores:

- Workspace information
- Channel information
- Encrypted access token
- Connection status

A Redis deduplication key prevents multiple notifications for the same sender and UTC hour.

If Slack is disconnected or unavailable:

- Emails continue to be rate-limited
- Jobs continue to be rescheduled
- Email delivery does not crash

The Slack application must be invited to the selected channel before it can post messages.

## Elasticsearch

Elasticsearch stores searchable email documents containing fields such as:

- Recipient
- Subject
- Body
- Status
- Campaign ID
- Sender ID
- Scheduled time
- Sent time
- Failure reason

The index is initialized safely at API and worker startup. Indexing is retryable and failures are logged and recorded without failing the primary MySQL operation.

MySQL remains the source of truth.

## Project Structure

```text
apps/
  api/
    prisma/
    src/
      config/
      contracts/
      db/
      integrations/
      middleware/
      modules/
        auth/
        campaigns/
        emails/
        search/
        slack/
      queue/
      health.ts
      server.ts
      worker.ts

  web/
    src/
      auth/
      components/
      lib/
      pages/
      App.tsx
      index.css

docker-compose.yml
.env.example
package.json
pnpm-workspace.yaml
```

## Requirements

Install the following:

- Node.js 22 or later
- pnpm 10
- Docker Desktop

MySQL, Redis, and Elasticsearch are provided through Docker Compose.

## Environment Setup

Create a local environment file:

```powershell
Copy-Item .env.example .env
```

Configure the following variables in `.env`:

```env
NODE_ENV=development
PORT=4000
WEB_URL=http://localhost:5173
API_URL=http://localhost:4000
VITE_API_URL=http://localhost:4000

DATABASE_URL=mysql://app:app@localhost:3306/email_scheduler
REDIS_URL=redis://localhost:6379
ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_INDEX=scheduled-emails

SEARCH_INDEX_MAX_ATTEMPTS=3
SEARCH_INDEX_RETRY_DELAY_MS=250

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:4000/auth/google/callback
SESSION_SECRET=

ETHEREAL_HOST=smtp.ethereal.email
ETHEREAL_PORT=587
ETHEREAL_USER=
ETHEREAL_PASSWORD=

SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_REDIRECT_URI=http://localhost:4000/integrations/slack/callback
SLACK_TOKEN_ENCRYPTION_KEY=

WORKER_CONCURRENCY=5
MIN_DELAY_BETWEEN_EMAILS_MS=2000
MAX_EMAILS_PER_HOUR_PER_SENDER=200
EMAIL_QUEUE_NAME=email-sends
EMAIL_MAX_ATTEMPTS=3
PROCESSING_TIMEOUT_MS=300000
```

### Google OAuth

Create a Google OAuth Web application and configure:

```text
Authorized JavaScript origin:
http://localhost:5173

Authorized redirect URI:
http://localhost:4000/auth/google/callback
```

### Ethereal Email

Create a test mailbox at:

```text
https://ethereal.email
```

Copy its SMTP username and password into:

```env
ETHEREAL_USER=
ETHEREAL_PASSWORD=
```

Ethereal captures messages for testing and provides preview URLs. It does not deliver messages to real recipient inboxes.

### Slack

Create a Slack application and configure its OAuth redirect URL:

```text
http://localhost:4000/integrations/slack/callback
```

The encryption key must be a private 64-character hexadecimal value.

Never commit `.env` or any credentials.

## Installation and Database Setup

From the project root:

```powershell
pnpm install
```

Start the infrastructure:

```powershell
docker compose up -d
```

Check the services:

```powershell
docker compose ps
```

Generate Prisma Client:

```powershell
pnpm --filter @reachinbox/api db:generate
```

Apply database migrations:

```powershell
pnpm --filter @reachinbox/api exec prisma migrate deploy --schema prisma/schema.prisma
```

Seed local demo data:

```powershell
pnpm --filter @reachinbox/api db:seed
```

The seed creates a demo user and demo sender records. If the logged-in Google user is different from the seeded user, an active sender may need to be created for the authenticated user.

## Running the Application

Run each process in a separate terminal.

### API

```powershell
pnpm dev:api
```

### Worker

```powershell
pnpm dev:worker
```

### Web Application

```powershell
pnpm dev:web
```

## Local URLs

```text
Web dashboard:
http://localhost:5173

API liveness:
http://localhost:4000/health

API readiness:
http://localhost:4000/health/ready

Bull Board:
http://localhost:4000/admin/queues

Prisma Studio:
http://localhost:5555
```

Prisma Studio can be started with:

```powershell
pnpm --filter @reachinbox/api exec prisma studio --schema prisma/schema.prisma
```

## Main API Routes

```text
GET  /auth/google
GET  /auth/me
POST /auth/logout

GET  /api/profile

GET  /api/campaigns/senders
POST /api/campaigns
POST /api/campaigns/:campaignId/enqueue

GET  /api/emails/scheduled
GET  /api/emails/sent

GET  /api/search/emails

GET  /integrations/slack/connect
GET  /integrations/slack/reconnect
GET  /integrations/slack/callback
GET  /integrations/slack/status
POST /integrations/slack/disconnect
POST /integrations/slack/channel
```

## Manual Verification

### Normal Scheduling Test

1. Sign in with Google.
2. Open Compose.
3. Upload a CSV or text file.
4. Confirm the detected recipient count.
5. Select an active sender.
6. Enter a subject and body.
7. Select a future start time.
8. Set a safe delay and hourly limit.
9. Schedule the campaign.
10. Confirm the jobs appear in Bull Board.
11. Wait for the worker to process the jobs.
12. Confirm the records appear in Sent Emails.
13. Open the Ethereal Messages page to view the captured messages.

Use `.csv` or `.txt` files. Excel `.xlsx` files are not supported.

### Restart Recovery Test

1. Schedule an email for a future time.
2. Confirm it appears in Bull Board under Delayed.
3. Stop the API and worker with `Ctrl+C`.
4. Leave Docker running.
5. Start the API and worker again.
6. Wait until the scheduled time.
7. Confirm the email sends once.
8. Confirm the email is not duplicated in the database.

### Rate Limit Test

1. Connect Slack and invite the application to the selected channel.
2. Create a campaign with two recipients.
3. Set the hourly limit to `1`.
4. Set a short delay.
5. Schedule the campaign.
6. Confirm the first email sends.
7. Confirm the second email is rescheduled.
8. Confirm Slack receives the hourly-limit notification.
9. Confirm the delayed job remains visible in Bull Board.

## Verification Commands

Run from the project root:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
```

Useful API package checks:

```powershell
pnpm --filter @reachinbox/api db:validate
pnpm --filter @reachinbox/api db:generate
pnpm --filter @reachinbox/api test
pnpm --filter @reachinbox/api build
```

## Assignment Requirement Mapping

### Backend

- Express API
- TypeScript
- Relational database persistence
- Campaign and email records
- BullMQ delayed jobs
- Redis-backed persistence
- Separate worker process
- Ethereal SMTP
- Multiple sender identities
- Retry and failure handling
- Idempotent delivery state
- Configurable concurrency
- Configurable delay
- Atomic sender rate limiting
- Rescheduling after rate limits
- Slack notifications
- Elasticsearch indexing and search
- Bull Board queue visibility

### Frontend

- Google login
- User dashboard
- Compose form
- CSV/text upload
- Recipient detection
- Sender selection
- Scheduled Emails view
- Sent Emails view
- Search and filters
- Pagination
- Loading states
- Empty states
- Error handling
- Slack integration settings
- Responsive layout

## Known Limitations

- Ethereal is a test SMTP service and does not deliver real email.
- One Ethereal SMTP credential set is used for the selected sender identities.
- The message formatting toolbar is a visual interface around the plain-text message body.
- Excel `.xlsx` uploads are not supported; use CSV or text files.
- Elasticsearch indexing is eventually consistent.
- MySQL remains available if Elasticsearch is unavailable.
- A small SMTP crash window can theoretically result in a duplicate after provider acceptance and before the database status update.
- Sender creation is primarily handled through existing sender records or database administration rather than a dedicated sender-management screen.
