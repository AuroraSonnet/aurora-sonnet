# Aurora Sonnet API (Node + SQLite + Stripe)

1. **Install dependencies** (from project root): `npm install`

2. **Database (SQLite)**  
   The first time you run the server, a file `server/aurora.db` is created. The app loads data from the API when the server is running; if the DB is empty, the app auto-seeds it with sample data. All clients, projects, proposals, invoices, contracts, and expenses are stored here (no cost, fully local).

3. **Configure Stripe**
   - Copy `server/.env.example` to `server/.env`
   - Add your [Stripe secret key](https://dashboard.stripe.com/apikeys) (use test key for development)

4. **Run the API** (from project root):
   ```bash
   npm run server
   ```
   Server runs on http://localhost:3001. The Vite dev server proxies `/api` to it when you run `npm run dev`.

5. **Webhook (optional but recommended)**  
   So invoices are marked paid automatically when the customer completes checkout:
   - **Local:** Use [Stripe CLI](https://stripe.com/docs/stripe-cli): `stripe listen --forward-to localhost:3001/api/stripe-webhook`
   - Copy the webhook signing secret (e.g. `whsec_...`) into `server/.env` as `STRIPE_WEBHOOK_SECRET`
   - **Production:** In [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks), add endpoint `https://your-domain.com/api/stripe-webhook`, event `checkout.session.completed`, and put the signing secret in `server/.env`

Payments are stored in `server/payments.json`. The Invoices page syncs this on load so paid invoices show as "Paid".
