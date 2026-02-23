# Aurora Sonnet – Recent changes

This file summarizes the changes made to the app so you can compare the old vs new version.

---

## 1. Contracts & Templates combined

- **Before:** Separate sidebar items: "Contracts" and "Templates".
- **After:** Single **Contracts** page. At the top there is a **Create new template** section (contract + invoice templates); below that, Create from booking and All contracts.
- **Removed:** Standalone Templates nav item and `/templates` route (redirects to `/contracts`).
- **Files:** `Layout.tsx` (nav), `App.tsx` (routes), `Contracts.tsx` (includes `TemplatesSection`), new `TemplatesSection.tsx` in `src/components/`, `Templates.tsx` removed.

---

## 2. Template editing after upload

- **Before:** Upload PDF → had to open View → then click "Edit template" to edit form fields / add text.
- **After:** Right after uploading a template, it opens in **edit mode** so you can immediately fill form fields and add text.
- **Files:** `TemplatesSection.tsx` (upload handlers open viewer and call `loadPdfForEditing`).

---

## 3. Download as Word

- **Before:** No way to get an editable Word document from a PDF template.
- **After:** In the template viewer, **Download as Word** extracts text from the PDF and creates a `.docx`. You edit in Word, export to PDF, then use **Replace PDF** to update the template.
- **Files:** New `src/utils/pdfToDocx.ts`, `TemplatesSection.tsx` (button + `handleDownloadAsWord`), added deps: `docx`, `pdfjs-dist`.

---

## 4. Contract signatures (client then you)

- **Before:** "Mark sent" and "Mark signed" were status toggles only; no real signatures.
- **After:**
  - **Mark sent** generates a **signing link** (with token). You copy it and send it to the client.
  - **Client** opens the link (`/sign/:contractId?token=...`), sees the contract PDF, and signs (draw or type).
  - After the client signs, a **Sign** button appears for you; you sign and your signature is stamped on the PDF.
  - Contract is **Signed** only after both have signed. Signed PDFs are stored under `data/contracts/`.
- **New:** `SignaturePad` component (draw/type), `SignContract` page for clients, server endpoints for client/vendor signing and PDF stamping.
- **Files:** `Contracts.tsx`, `SignContract.tsx`, `SignaturePad.tsx` + CSS, `server/index.js` (sign endpoints, `loadContractPdfBuffer`, `stampSignature`), `server/db.js` (signToken, clientSignedAt), `api/db.ts` (sign APIs, `getContractFileUrl`), `App.tsx` (route `/sign/:contractId`).

---

## 5. Website inquiries → app database

- **Before:** Lead form could post to Formspree or your API; inquiries on your API were not pulled into the app.
- **After:** In **Settings → Website inquiries** you set **Inquiry API URL**, click **Save URL** (stored in localStorage), then **Sync inquiries now**. The app fetches `/api/state` from that URL and creates any new clients and projects locally.
- **Files:** `Settings.tsx` (save URL, load URL on mount, `syncInquiries`), `server/index.js` (CORS allows GET `/api/state` from app origin).

---

## 6. Settings build fix

- **Before:** Settings had missing/incomplete handlers (`saveInquiryApiUrl`, `syncInquiries`) and unused vars, so the build failed.
- **After:** Save URL, sync logic, and localStorage load are implemented; build passes.
- **Files:** `Settings.tsx`.

---

## 7. Other small tweaks

- **Lead form:** Moved under "Clients" in sidebar; "Send Inquiry" button style; Wedding Date cannot be in the past; thank-you redirect to `request-a-quote-thank-you`.
- **Embed:** `docs/lead-form-embed.html` and `docs/embed-lead-form.md` updated (no prices on experiences, Option 2 = your API + sync).
- **Contracts tip:** Text updated to describe the new signing flow (send link → client signs → you sign).

---

## How to “swap” old for new

- **You’re already in the new app:** This repo is the updated version.
- **To run it:**  
  `npm run server` (in one terminal)  
  `npm run dev` (in another), then open the URL shown (e.g. http://localhost:5173).
- **If you have an old copy elsewhere:** Replace that folder with this one (or copy this folder over it), then run `npm install` and the commands above. That “swaps” the old app for the new one so you can see and use all the changes above.
