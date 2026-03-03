# Free persistence (no Render paid disk)

Render’s free tier loses data when the service sleeps. These options give you persistent data without paying Render for a disk.

---

## Option A: Railway (easiest — same app, no code change)

**Cost:** Railway’s free plan gives **$1 of credit per month** (no rollover). That $1 pays for both compute *and* volume storage (e.g. volume is ~\$0.15/GB/month, so 0.5 GB is a few cents). A small Node app + a small volume can stay under $1/month; if you go over, you pay the overage. So it’s “free” only while total usage stays within the $1 credit.

**Idea:** Run the same Aurora Sonnet app on Railway instead of Render. Use a volume for persistence; its cost comes out of the $1 monthly credit.

1. Sign up at [railway.app](https://railway.app) and connect your repo.
2. **New Project → Deploy from GitHub** and select this repo.
3. Set **Root directory** to the folder that contains `package.json` (e.g. `Website` if the repo root is above it).
4. **Build:** `npm install && npm run build`  
   **Start:** `npm start`
5. Add a **Volume**: service → **Volumes** → Add volume, mount path `/data`.
6. In **Variables**, add: `DATA_DIR=/data`
7. Add your other env vars (Stripe, SMTP, etc.) as on Render.

After deploy, use the Railway URL (or a custom domain) in the Mac app’s “Inquiry API URL” and “Public app URL” instead of the Render URL. Data will persist across restarts.

---

## Option B: Turso (free DB, keep Render)

**Cost:** Free tier (e.g. 9 GB, generous limits). Your **data** lives in Turso; the app can still run on Render free tier.

**Catch:** The app currently uses SQLite on disk. To use Turso you’d need to switch the server to the Turso/libSQL client (code changes). If you want to go this route, we can outline the migration (same schema, different driver and async APIs).

---

## Option C: Neon (free Postgres, keep Render)

**Cost:** Free tier (e.g. 500 MB Postgres). App would talk to Neon instead of SQLite.

**Catch:** Bigger change: the whole DB layer would move from SQLite to Postgres (different driver and some SQL). Only worth it if you prefer Postgres or need more than Turso’s free tier.

---

**Recommendation:** For “no code changes” and data away from Render, **Railway** (Option A) is the simplest: attach a volume and set `DATA_DIR=/data`. It’s free only while your usage stays within the $1/month credit (small app + small volume often does). Beyond that you pay overage.
