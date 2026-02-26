# General inquiry → save in your app (not Formspree)

To have form submissions **saved in your Aurora Sonnet app** (new client + project in Bookings, message in notes), the form must submit to **your Node API**. Formspree does not write to your app.

## What you need

1. **Your Aurora Sonnet app deployed** so it has a public URL (e.g. `https://aurora-sonnet.onrender.com`).  
   → Follow **DEPLOY_NEXT_STEPS.md** in this repo (Render in 8 steps).

2. **This embed code** on your Hostinger contact page, with **one change**: set `YOUR_APP_URL` to that deployed URL (no trailing slash).

Then when someone submits the form:
- The request goes to your app’s `/api/inquiry`.
- The app creates a **client** and a **project** (title “General inquiry”) and saves the **message** in the project notes.
- The visitor is redirected to **https://aurorasonnet.com/general-inquiry-thank-you**.
- You see the inquiry in **Bookings** and **Clients** in your app.

No Formspree needed for this flow.
