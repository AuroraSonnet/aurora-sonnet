# Speed up inquiry form submissions (avoid 20–30 second wait)

On **Render’s free tier**, your app “spins down” after about 15 minutes of no traffic. The **first request** after that (e.g. when someone clicks “Send Inquiry”) can take **20–60 seconds** while the server starts. After that, submissions are fast until the next spin-down.

## Option 1: Keep the server warm (free)

Use a **free uptime or cron service** to ping your Render URL every 10–14 minutes. Then the server stays awake and form submissions are usually fast.

### UptimeRobot (recommended)

1. Go to **https://uptimerobot.com** and create a free account.
2. Click **Add New Monitor**.
3. **Monitor Type:** HTTP(s).
4. **Friendly Name:** e.g. `Aurora Sonnet keep-alive`.
5. **URL:** your Render app URL, e.g. `https://aurora-sonnet.onrender.com` (you can use the root URL or `https://aurora-sonnet.onrender.com/api/state`).
6. **Monitoring Interval:** 5 minutes (free tier allows this).
7. Save. UptimeRobot will request that URL every 5 minutes, so Render won’t spin down.

### cron-job.org (alternative)

1. Go to **https://cron-job.org** and sign up.
2. Create a new cron job that runs every **10** or **15** minutes.
3. Set the URL to your Render app (e.g. `https://aurora-sonnet.onrender.com`).
4. Save. The job will ping your app so it stays warm.

After this is in place, the first form submission after a long idle may still be slow once in a while, but most submissions should complete in a few seconds.

---

## Option 2: Upgrade Render

On a **paid** Render plan, the service does not spin down (or wakes much faster). Form submissions will then be consistently fast without a keep-alive ping.

---

## Form messaging

The Solo, Duo, Combined, and General inquiry embeds now show a short line under the button when the user clicks “Send Inquiry”:

**“This may take up to a minute when our server is waking up.”**

That sets expectations so visitors know the wait is normal and not a broken form.
