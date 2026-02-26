# Deploy in 8 steps (copy-paste only)

Do these in order. When you're done, your general inquiry form will save contacts in your app.

---

## Step 1 — Put the project on GitHub

1. Go to **https://github.com** and sign in.
2. Click the **+** (top right) → **New repository**.
3. Name it (e.g. `aurora-sonnet`). Leave everything else default. Click **Create repository**.
4. Open **Terminal** on your Mac. Go to your project folder:
   ```bash
   cd "/Volumes/G-Video ArmorATD/Aurora Sonnet Cursor/Website"
   ```
5. Run these one at a time (replace `YOUR_USERNAME` and `YOUR_REPO` with your GitHub username and repo name):
   ```bash
   git init
   git add .
   git commit -m "Deploy"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
   git push -u origin main
   ```
   If it asks for login, use your GitHub username and a **Personal Access Token** (GitHub → Settings → Developer settings → Personal access tokens) as the password.

---

## Step 2 — Open Render

1. Go to **https://render.com**.
2. Click **Get started** (or **Sign in** if you have an account).
3. Sign up with **GitHub** so Render can see your repos.

---

## Step 3 — Create the app

1. Click **New +** → **Web Service**.
2. Under **Connect a repository**, find your repo (e.g. `aurora-sonnet`) and click **Connect** next to it.
   - If you don’t see it, click **Configure account** and give Render access to the right GitHub account/repos.

---

## Step 4 — Name and region

1. **Name:** leave as is (e.g. `aurora-sonnet`) or type something like `aurora-sonnet`.
2. **Region:** pick one close to you (e.g. **Oregon**).
3. Don’t change **Branch** (main is fine).

---

## Step 5 — Build and start (already set)

The repo has a `render.yaml` that sets this. Just confirm you see:

- **Build Command:** `npm install && npm run build`
- **Start Command:** `npm start`

If either is empty, paste the value in.

---

## Step 6 — Add your Stripe key

1. In the same page, scroll to **Environment Variables**.
2. Click **Add Environment Variable**.
3. **Key:** `STRIPE_SECRET_KEY`  
   **Value:** paste your Stripe secret key (from https://dashboard.stripe.com/apikeys — the one that starts with `sk_test_` or `sk_live_`).
4. Click **Add Environment Variable** again.
5. **Key:** `STRIPE_WEBHOOK_SECRET`  
   **Value:** leave blank for now (you can add it later after setting up the webhook).

---

## Step 7 — Deploy

1. Click **Create Web Service** at the bottom.
2. Wait a few minutes. The log will show “Build successful” and “Your service is live”.
3. At the top you’ll see a URL like **https://aurora-sonnet.onrender.com**. Copy that URL.

---

## Step 8 — Use the URL on your site

**If you want a link (easiest):**  
On Hostinger, make your “General inquiry” or “Contact” button link to:

```
https://aurora-sonnet.onrender.com/inquire-general
```

**If you want the form embedded on Hostinger:**  
In the form embed code, find this line:

```js
var API_BASE_URL = 'https://aurora-sonnet.onrender.com';
```

---

Done. When someone submits the general inquiry, they’ll be saved in your app and sent to **https://aurorasonnet.com/general-inquiry-thank-you**.
