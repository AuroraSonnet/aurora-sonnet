# Verification checklist

Use this after pulling changes or before releasing to confirm core flows work.

## Before you start

- [ ] Server runs: `npm run server` (if you see a better-sqlite3 Node version error, run `npm rebuild better-sqlite3` first)
- [ ] App opens: dev (`npm run dev`) or built app (e.g. open `release/mac/Aurora Sonnet.app` or visit the dev URL)

---

## 1. Inquiry forms

- [ ] **Lead form (Solo)** — Submit with name, email, wedding date, venue, pick a solo package (e.g. Signature Aria). Expect: success, then thank-you redirect or list refresh. In **Bookings**, a new project appears in Inquiry with the correct **value** (e.g. $2,750).
- [ ] **Lead form (Duo)** — Submit with a duo package (e.g. Aria + Duo). In **Bookings**, new project shows with correct value (e.g. $6,950).
- [ ] **Lead form (Solo + Duo)** — Pick an artist or duo from the dropdown, pick any of the 6 packages. Submit. New booking appears with correct package and value.
- [ ] **Lead form (General)** — Name, email, message only. Submit. In **Bookings**, a new project appears as **General inquiry** (no package/venue). To embed on your contact page, use URL path: **/embed/inquire-general** (no sidebar).

## 2. Bookings page

- [ ] **Open edit** — Click a pipeline card. Edit modal opens (centered overlay).
- [ ] **Save** — Change client name, stage, value, or package. Click Save. Modal closes; card updates after refresh.
- [ ] **Delete** — Open a booking, click Delete, confirm. Booking disappears from the pipeline.
- [ ] **Close** — Open modal, click Close or click the backdrop. Modal closes without saving.

## 3. Pipeline stages

- [ ] **Manage pipelines** — Click “Manage pipelines”. Section expands with list of stages.
- [ ] **Add stage** — Type a name (e.g. “Deposit sent”), click “Add stage”. New column appears in the pipeline.
- [ ] **Edit stage** — Click Edit next to a stage, change the name, Save. Column header updates.
- [ ] **Delete stage** — Delete a stage that has no bookings (or one that has some; they move to another stage). Cannot delete the last remaining stage.

## 4. New inquiry from Bookings (manual)

- [ ] **New inquiry** — Click “New inquiry”, choose a client and package, submit. New project appears in the first pipeline column (e.g. Inquiry). Package dropdown shows both solo and duo options.

---

## Quick commands

```bash
# Rebuild native module if server won’t start
npm rebuild better-sqlite3

# Run API server (default port 3001)
npm run server

# Run frontend dev server (default port 5173)
npm run dev

# Build frontend for production
npm run build

# Build Mac app (after npm run build)
npm run build:mac
```

---

*Last updated: Feb 2025*
