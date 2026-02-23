# Embed the Lead Form on Your Website

You can put the Aurora Sonnet lead form on aurorasonnet.com in two main ways.

## Option 1: Formspree (easiest)

1. Sign up at formspree.io and create a new form. Copy your form URL (e.g. `https://formspree.io/f/xxxxxxxx`).
2. Open `docs/lead-form-embed.html` in this project. Find the line with `action="https://formspree.io/f/YOUR_FORM_ID"` and replace `YOUR_FORM_ID` with your Formspree form ID.
3. In Formspree, set the redirect after submit to `https://aurorasonnet.com/request-a-quote-thank-you`.
4. Copy the full HTML from `lead-form-embed.html` into your website page (e.g. Inquire or Contact), or host that file and embed it in an iframe.

You will get each submission by email. Add leads into Aurora Sonnet manually via the Lead form in the app.

## Option 2: Your own API (inquiries into app)

1. **Deploy the app's server** (e.g. Railway, Render, Fly.io) so it has a public base URL (e.g. `https://aurora-api.railway.app`).
2. **Point the form to your API:** In `lead-form-embed.html`, set the form `action` to `https://YOUR_DEPLOYED_URL/api/inquiry`. Keep the hidden `_next` field so submissions redirect to `https://aurorasonnet.com/request-a-quote-thank-you`.
3. **Sync into the desktop app:** In Aurora Sonnet, open **Settings → Website inquiries**. Set "Inquiry API URL" to your deployed base URL, click **Save URL**, then **Sync inquiries now**. New website submissions will appear as clients and projects in your app. You can run Sync again anytime to pull new inquiries.
4. The form field names in `lead-form-embed.html` match the app (name, email, phone, weddingDate, venue, requestedArtist, packageId, message).

## Form field names (for reference)

- Full Name: `name`
- Email: `email`
- Phone: `phone`
- Wedding Date: `weddingDate`
- Venue: `venue`
- Requested Artist: `requestedArtist`
- Experience: `packageId`
- Message: `message`
