# Deploying Aurora Sonnet

The app runs as a **single service**: the Node server serves both the API and the built React frontend. Deploy once and you get the full app.

---

## Developing (preview changes without reinstalling)

To see changes instantly without rebuilding the Mac app every time:

**Option A – Browser (simplest)**  
```bash
npm run dev:app
```  
This starts the dev server and **opens your browser to http://localhost:5173/inquire** automatically. Edit any React/TypeScript/CSS — changes appear instantly.  

**Important:** Use **http://localhost:5173** for development. Port 3001 serves the old built version; 5173 serves your live changes.

**Option B – Electron window (desktop-style preview)**  
```bash
npm install
npm run dev:electron
```  
Runs the API server, Vite dev server, and Electron in one command. The Electron window loads the dev server, so edits hot-reload.

Use the browser or dev:electron while developing. Only run `npm run build:mac` and reinstall when you want a final packaged app.

**If you get `ERR_DLOPEN_FAILED` or "Could not locate the bindings file"** (better-sqlite3):
```bash
rm -rf node_modules/better-sqlite3 && npm install better-sqlite3
```
Then run `npm run dev:app` or `npm run dev:electron` again.

## Prerequisites

- Code in a **Git repository** (GitHub, GitLab, or Bitbucket).
- **Stripe** keys (test or live) from [Stripe Dashboard](https://dashboard.stripe.com/apikeys).
- A **Stripe webhook** for `checkout.session.completed` pointing to `https://your-app-url/api/stripe-webhook` (you can add this after the first deploy).

---

## Option 1: Railway (recommended — persistent data)

1. **Sign up** at [railway.app](https://railway.app) and connect your GitHub (or GitLab/Bitbucket).

2. **New Project → Deploy from GitHub** and select the repo that contains this project.

3. **Configure the service** (click the service → **Settings** or **Variables**):
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`
   - **Root directory:** leave blank (repo root).
   - Railway sets `PORT` automatically; no need to add it.

4. **Environment variables** (service → **Variables** tab):
   - `STRIPE_SECRET_KEY` — from [Stripe Dashboard](https://dashboard.stripe.com/apikeys) (e.g. `sk_test_...` or `sk_live_...`).
   - `STRIPE_WEBHOOK_SECRET` — after first deploy, create a webhook in [Stripe Webhooks](https://dashboard.stripe.com/webhooks) with URL `https://<your-railway-url>/api/stripe-webhook` and event `checkout.session.completed`, then paste the signing secret (`whsec_...`).

5. **Add a volume (so data survives redeploys):**
   - In your Railway project, click your service → **Variables** (or **Settings**).
   - Open the **Volumes** tab (or **+ New** → **Volume**).
   - Create a volume and set the **mount path** to `/data` (or another path you prefer).
   - In **Variables**, add:
     - `DATA_DIR=/data`  
     (use the same path as the volume mount path.)

   The app will store `aurora.db` and `payments.json` on the volume, so clients, bookings, invoices, and payment records persist across deploys.

6. **Deploy.** Railway builds and runs the app, then assigns a URL (e.g. `https://your-app.up.railway.app`). You can add a **custom domain** (e.g. `app.aurorasonnet.com`) in the service settings.

### Railway notes

- **Cost:** Usage-based; a small agency app typically stays in the low end (a few dollars/month). No long-term free tier, but pricing is predictable.
- **Volume:** Without a volume and `DATA_DIR`, the app still runs but SQLite and payment data are ephemeral (can be lost on redeploy). Adding the volume + `DATA_DIR` is recommended for real use.

---

## Option 2: Render

1. **Sign up** at [render.com](https://render.com) and connect your Git provider.

2. **New → Web Service**. Connect the repo that contains this project. Use:
   - **Root directory:** leave blank (repo root).
   - **Runtime:** Node.
   - **Build command:** `npm install && npm run build`
   - **Start command:** `npm start`

3. **Environment variables** (in Render dashboard → Environment):
   - `STRIPE_SECRET_KEY` — from Stripe (e.g. `sk_test_...` or `sk_live_...`).
   - `STRIPE_WEBHOOK_SECRET` — create a webhook in [Stripe Webhooks](https://dashboard.stripe.com/webhooks) with URL `https://<your-render-url>/api/stripe-webhook` and event `checkout.session.completed`, then paste the signing secret (`whsec_...`).

4. **Deploy.** Render runs `npm run build` (builds the React app into `dist/`), then `npm start` (starts the server). The server serves the API at `/api/*` and the frontend from `dist/` for all other routes.

5. **Optional – custom domain:** In Render, add a custom domain (e.g. `app.aurorasonnet.com`) and point DNS as instructed.

### Render notes

- **Disk:** The server uses SQLite and a `payments.json` file. On Render, the filesystem is **ephemeral** (resets on redeploy). For a permanent database you’d need a separate DB or a host with persistent disk (e.g. Railway with a volume). Fine for trying things out.
- **Free tier:** Render’s free web service tier may no longer be available; the lowest tier is paid. Check [Render pricing](https://render.com/pricing).

---

## After deploy

1. **Stripe webhook:** Ensure the webhook URL is `https://<your-deployed-url>/api/stripe-webhook` and the event is `checkout.session.completed`. Use the signing secret as `STRIPE_WEBHOOK_SECRET`.

2. **Test the flow:** Open the app URL, add a client and booking, create a proposal/contract/invoice, and use “Pay with card” to confirm Stripe Checkout and webhook (invoice marked paid).

3. **Link from your site:** Point aurorasonnet.com’s “Inquire” or “Book” link to your deployed app URL (e.g. `https://your-app.up.railway.app/inquire` or your custom domain).

---

## Local production check

To simulate production locally:

```bash
npm run build
npm start
```

Then open `http://localhost:3001`. The same server serves the API and the built frontend.
