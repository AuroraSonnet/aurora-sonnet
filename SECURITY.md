# Security — Aurora Sonnet

This document summarizes how the app is protected and what you can do to keep it secure.

## Server (API) protections

- **Security headers** — The server sends headers that help browsers block some attacks:
  - `X-Content-Type-Options: nosniff` — Reduces MIME sniffing.
  - `X-Frame-Options: DENY` — Helps prevent clickjacking.
  - `X-XSS-Protection: 1; mode=block` — Legacy XSS filter.
  - `Referrer-Policy: strict-origin-when-cross-origin` — Limits referrer leakage.

- **Rate limiting** — Public endpoints are limited to reduce abuse:
  - **POST /api/inquiry** — Up to 15 requests per minute per IP (stops form spam).
  - **GET /api/state** — Up to 60 requests per minute per IP (stops scraping).

- **Open redirect prevention** — After form submit, redirects only go to `https://aurorasonnet.com` or `https://www.aurorasonnet.com`. Arbitrary URLs are rejected.

- **CORS** — Only allowed origins (your site, localhost for dev) can call the API. GET /api/state is allowed from any origin so the desktop app can sync from Render.

- **Stripe webhooks** — The Stripe webhook verifies the request signature using your `STRIPE_WEBHOOK_SECRET` before processing.

- **Database** — All queries use parameterized statements (no raw string concatenation), which helps prevent SQL injection.

## Desktop app (Electron)

- **nodeIntegration: false** — Renderer cannot use Node.js directly.
- **contextIsolation: true** — Preload and page scripts run in separate contexts.
- **Local server only** — The app loads `http://127.0.0.1:PORT`; it does not load arbitrary remote pages in the main window.

## What you should do

1. **Secrets** — Never commit API keys or passwords. Use environment variables (e.g. on Render: Dashboard → Environment). Stripe keys and webhook secret belong in env, not in code.

2. **Render** — Keep your Render service and GitHub repo private if they contain business data. Use strong passwords and 2FA on your Render and GitHub accounts.

3. **Updates** — When we or npm report security updates for dependencies, run `npm update` and rebuild the app; redeploy the server if needed.

4. **Backups** — The desktop app stores data in your user data folder (e.g. macOS: `~/Library/Application Support/Aurora Sonnet/`). Back up that folder (or the `aurora.db` file) if you want a local backup.

No app can be 100% “hacker-proof,” but these measures reduce common risks (spam, open redirects, injection, and some XSS/clickjacking). For high-sensitivity data, consider extra measures (e.g. authentication for the API, HTTPS only, and a security review).
