# Get a URL for your app

Your app needs to be **on the internet** so the Hostinger inquiry forms can send submissions to it. Render gives you a free URL (e.g. `https://aurora-sonnet-abc123.onrender.com`) in a few minutes.

---

## 1. Put the project on GitHub

1. Go to **https://github.com** and sign in.
2. Click **+** (top right) → **New repository**.
3. Name it (e.g. `aurora-sonnet`). Leave the rest default → **Create repository**.
4. On your Mac, open **Terminal** and run:

```bash
cd "/Volumes/G-Video ArmorATD/Aurora Sonnet Cursor/Website"
git init
git add .
git commit -m "Deploy"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username and `YOUR_REPO` with the repo name (e.g. `aurora-sonnet`).  
If it asks for a password, use a **Personal Access Token**: GitHub → Settings → Developer settings → Personal access tokens → Generate (with `repo` scope).

---

## 2. Create the app on Render

1. Go to **https://render.com** → **Get started** (or **Sign in**).
2. Sign in with **GitHub** so Render can see your repos.
3. Click **New +** → **Web Service**.
4. Find your repo (e.g. `aurora-sonnet`) and click **Connect**.
   - If it’s missing, use **Configure account** to grant Render access to that repo.
5. **Name:** e.g. `aurora-sonnet` (this becomes part of your URL).  
   **Region:** e.g. Oregon.  
   **Branch:** leave as `main`.
6. **Build Command:** `npm install && npm run build`  
   **Start Command:** `npm start`  
   (These may already be filled from `render.yaml`.)
7. **Environment** (optional for just getting a URL):  
   - `STRIPE_SECRET_KEY` = your Stripe secret key (from Stripe Dashboard → API keys).  
   - `STRIPE_WEBHOOK_SECRET` = leave blank for now.
8. Click **Create Web Service**.

---

## 3. Copy your URL

- Wait a few minutes for the first deploy to finish.
- When the log shows “Your service is live”, your URL appears at the top, e.g.  
  **https://aurora-sonnet-xxxx.onrender.com**
- Copy that full URL (no trailing slash).

---

## 4. Use the URL in your embed forms

- In **EMBED_SOLO_INQUIRY_APP.html** and **EMBED_GENERAL_INQUIRY_APP.html**, find:
  ```js
  var YOUR_APP_URL = 'https://YOUR-APP-URL';
  ```
- Replace `https://YOUR-APP-URL` with your real Render URL, e.g.:
  ```js
  var YOUR_APP_URL = 'https://aurora-sonnet-xxxx.onrender.com';
  ```
- Paste the updated embed code into your Hostinger page. Submissions will go only to your app.

---

**Note:** On the free tier, Render may spin down the service after 15 minutes of no traffic. The first request after that can take 30–60 seconds to wake it up. Paid plans keep it always on.
