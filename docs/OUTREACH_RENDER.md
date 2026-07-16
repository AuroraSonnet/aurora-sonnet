# Outreach Automation — Render Production Setup

Partnership Outreach automated follow-ups, reply detection, and bounce handling. **Nothing runs until you explicitly enable flags in Render.**

## Architecture

- **No in-process `setInterval`** for outreach — scheduling relies on an **external cron** hitting the tick endpoint.
- **SQLite on `/data`** (Render persistent disk) stores sequences, quota, send logs, and IMAP sync state across restarts/redeploys.
- **Stale-claim recovery** runs at the start of every scheduler tick (claimed sends older than 15 minutes are released or finalized from `outreach_send_log`).
- **Idempotency** — a scheduled step cannot send twice; double cron ticks and redeploys are safe.

## External cron (required for production)

Use [cron-job.org](https://cron-job.org), Render Cron Jobs, or similar to call the tick endpoint while the app may be asleep.

| Setting | Value |
|---|---|
| **URL** | `https://aurora-sonnet-1.onrender.com/api/outreach-sequence/tick` |
| **Method** | `POST` or `GET` (both supported) |
| **Schedule** | Every **10 minutes**, 24/7 (scheduler enforces Mon–Fri 9:30–15:30 ET send window) |
| **Header** | `x-outreach-cron-secret: <your-secret>` (required when `OUTREACH_CRON_SECRET` is set) |

Example `curl`:

```bash
curl -X POST "https://aurora-sonnet-1.onrender.com/api/outreach-sequence/tick" \
  -H "x-outreach-cron-secret: YOUR_SECRET_HERE"
```

The cron job also keeps the Render web service warm between outreach windows.

## Required environment variables

### Core (already used by CRM email)

| Variable | Required | Description |
|---|---|---|
| `DATA_DIR` | Yes (Render) | `/data` — persistent SQLite path |
| `SMTP_HOST` | Yes | e.g. `smtp.hostinger.com` |
| `SMTP_PORT` | Yes | e.g. `587` |
| `SMTP_USER` | Yes | Sending mailbox user |
| `SMTP_PASS` | Yes | Mailbox app password |
| `SMTP_FROM` | Recommended | From address (falls back to `SMTP_USER`) |

### Outreach automation flags

| Variable | Required | Default | Description |
|---|---|---|---|
| `OUTREACH_SCHEDULER_ENABLED` | For auto-send | `false` | `true` enables SMTP scheduler on tick |
| `OUTREACH_IMAP_ENABLED` | For reply/bounce | `false` | `true` enables read-only IMAP poll on tick |
| `OUTREACH_CRON_SECRET` | **Strongly recommended** | unset | Protects `/api/outreach-sequence/tick` |

### Safe test mode (use before production)

| Variable | Required | Description |
|---|---|---|
| `OUTREACH_TEST_EMAIL` | **Yes for testing** | All automated sends go here instead of venue addresses |
| `OUTREACH_ALLOW_PRODUCTION_SENDS` | No | Must be `true` to send to real venue emails. **Leave unset/false until go-live.** |

### IMAP (only when `OUTREACH_IMAP_ENABLED=true`)

| Variable | Required | Description |
|---|---|---|
| `IMAP_HOST` | No | Default `imap.hostinger.com` |
| `IMAP_PORT` | No | Default `993` |
| `IMAP_USER` | Yes | Usually same as sending mailbox |
| `IMAP_PASS` | Yes | Mailbox app password |
| `IMAP_MAILBOX` | No | Default `INBOX` |
| `IMAP_TLS` | No | Default `true` |

## Rollout checklist (do not skip)

1. Set `OUTREACH_TEST_EMAIL` to your approved test inbox.
2. Set `OUTREACH_CRON_SECRET` and configure external cron.
3. Enable `OUTREACH_SCHEDULER_ENABLED=true` — verify test emails arrive at `OUTREACH_TEST_EMAIL` only.
4. Enable `OUTREACH_IMAP_ENABLED=true` + IMAP vars — verify reply/bounce detection in dashboard.
5. Only when ready: set `OUTREACH_ALLOW_PRODUCTION_SENDS=true` (removes test routing).

## Structured logs (Render Logs tab)

All outreach events emit single-line JSON, e.g.:

| Event | Meaning |
|---|---|
| `tick_start` / `tick_end` | External cron invocation |
| `scheduler_tick` / `scheduler_tick_complete` | Due-send processing |
| `claim_released` / `claim_recovered` | Stale-claim recovery |
| `send_attempt` / `send_succeeded` / `send_failed` / `send_retry_scheduled` / `send_deferred` | SMTP lifecycle |
| `imap_poll_start` / `imap_poll_end` | IMAP poll |
| `reply_detected` / `bounce_detected` | Inbound automation |

Secrets are never logged.

## Daily quota

- Cap: **30 successful sends per NY business day** (`outreach_daily_quota` table).
- Excess due sends are **deferred** to the next business day (FIFO order preserved).
- Quota survives redeploys via persistent disk.

## Stale-claim recovery

If a send is `claimed` and the process dies mid-SMTP:

1. After **15 minutes**, the next tick releases the claim back to `pending` (no duplicate send).
2. If `outreach_send_log` already recorded `result=sent`, the tick **finalizes** bookkeeping without resending.

## What stays disabled by default

- `OUTREACH_SCHEDULER_ENABLED` — no automated SMTP
- `OUTREACH_IMAP_ENABLED` — no inbox polling
- `OUTREACH_ALLOW_PRODUCTION_SENDS` — no venue-address delivery
