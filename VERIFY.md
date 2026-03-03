# Verification checklist

Use this after pulling changes or before releasing to confirm core flows work.

## Before you start

- [ ] Server runs: `npm run server` (if you see a better-sqlite3 Node version error, run `npm rebuild better-sqlite3` first)
- [ ] App opens: dev (`npm run dev`) or built app (e.g. open `release/mac/Aurora Sonnet.app` or visit the dev URL)

## 1.2 Persistence & file paths (verified)

- **Mac app:** Electron sets `DATA_DIR` to `~/Library/Application Support/Aurora Sonnet`. DB, payments, templates, and contracts all use that dir.
- **Render:** If `DATA_DIR` is not set, server and db both use `/tmp/aurora-sonnet-data`. Set `DATA_DIR` to a volume path for persistence.
- **Local dev:** No `DATA_DIR` → uses `server/` dir; templates/contracts under `server/templates/` and `server/contracts/`.
- **App and server:** All template/contract/invoice PDFs are read and written only via the API; paths are server-controlled and consistent.

## 1.3 Error handling & logging (verified)

- All `/api/*` routes use try/catch and return `res.status(500).json({ error: message })` (or 400/403/404) on failure.
- Errors are logged with `logError(tag, message, err)` so you can grep logs:
  - **\[DB]** — SQLite / getState / create/update/delete (clients, projects, proposals, contracts, invoices, expenses, calendar, pipeline, seed).
  - **\[SMTP]** — Inquiry notification, calendar reminder send, test email.
  - **\[Stripe]** — Checkout session, confirm-payment, webhook (signature + handler).
  - **\[API]** — File/template read-write, payment-status file, Stripe settings write.

## 2.2 Client editing & deletion (verified)

- **Delete:** Only the client with the given id is soft-deleted; only projects with `clientId = id` are soft-deleted (single transaction). Server returns 404 if client not found, 400 if already deleted.
- **Restore:** Only that client and their projects (`clientId = id`) have `deletedAt` cleared. Server returns 404 if client not found, 400 if not deleted. Frontend only updates local state when restore API succeeds; otherwise shows an alert.
- **Linked data:** Proposals, invoices, contracts are not modified by client delete/restore; they remain linked by projectId/client name. Bookings (projects) are soft-deleted and restored with the client.

---

## 1. Inquiry forms

- [ ] **Lead form (Solo)** — Submit with name, email, wedding date, venue, pick a solo package (e.g. Signature Aria). Expect: success, then thank-you redirect or list refresh. In **Bookings**, a new project appears in Inquiry with the correct **value** (e.g. $2,750).
- [ ] **Lead form (Duo)** — Submit with a duo package (e.g. Aria + Duo). In **Bookings**, new project shows with correct value (e.g. $6,950).
- [ ] **Lead form (Solo + Duo)** — Pick an artist or duo from the dropdown, pick any of the 6 packages. Submit. New booking appears with correct package and value.
- [ ] **Lead form (General)** — Name, email, message only. Submit. In **Bookings**, a new project appears as **General inquiry** (no package/venue). To embed on your contact page, use URL path: **/embed/inquire-general** (no sidebar).

## 2. Bookings page

### 3.1 Project/booking data from API (verified)

- **Data source:** The Bookings page uses `state.projects` and `state.pipelineStages` from AppContext. State is loaded from `/api/state`, which returns `getState()` from the server.
- **Server:** `getState()` in `server/db.js` returns only active projects (`WHERE deletedAt IS NULL`) and pipeline stages from the `pipeline_stages` table (or default stages if the table is empty). So the list is DB-backed; no phantom projects.
- **Flow:** Initial load and `refreshState()` replace/merge state from the API. Sync pulls new inquiries from the website and adds them via API; new items appear immediately and `refreshState()` runs in the background.

### 3.2 Stage transitions (verified)

- **Edit modal:** Open a booking card → Stage dropdown shows all pipeline stages. Changing stage and clicking Save calls `PATCH /api/projects/:id` with `stage`; server updates the project and returns 200.
- **Server:** `updateProject(id, updates)` in `db.js` writes `stage` to the DB. `PATCH /api/projects/:id` validates that `stage` (if present) is one of `getState().pipelineStages` ids; otherwise returns 400 Invalid stage.
- **Delete stage:** When a pipeline stage is deleted (`deletePipelineStage`), all projects in that stage are moved to another stage in the DB, then the stage is removed. UI refreshes via `refreshState()`.

### 3.3 Bookings UI (verified)

- **Sorting:** Toolbar "Sort by" includes: Most recent first (createdAt), Name A–Z / Z–A, Wedding date (earliest / latest), Value (low → high / high → low). Sort is applied per column; stable secondary sort by id.
- **Stage labels:** Column headers use `stage.label` from `stages` (DB `pipeline_stages` or defaultStages). No hardcoded labels.
- **Linked navigation:** In the edit booking modal, "Quick links" nav: View client (→ `/clients/:id`), Proposals, Invoices, Contracts. Links close the modal and navigate in-app.

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
