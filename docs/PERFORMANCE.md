# §10.2 Performance

## Initial load time
- **Client:** Renders from `localStorage` immediately; one `GET /api/state` in `AppContext` useEffect. If that fails or returns empty, an optional second fetch to the inquiry API URL. So **1–2 requests** on load; no extra parallel calls.
- **Server:** `GET /api/state` runs a single `getState()` (see below). No heavy work on cold start beyond DB reads.

## Query counts
- **`getState()`** (server): One call runs **12 SQLite SELECTs** (clients, projects, proposals, invoices, contracts, expenses, contractTemplates, invoiceTemplates, pipelineStages, calendarReminders, experiences, musicSelections). Used for the single full-state response.
- **Reduced redundant reads:** Handlers that used to call `getState()` many times per request (e.g. `POST /api/proposals/:id/accept`) now reuse one state snapshot per mutation batch. Contract file/sign routes pass existing state into `loadContractPdfBuffer()` to avoid a second full `getState()`.
- **Client:** No N+1 on load; `refreshState()` is a single `/api/state` (or fallback) and is only called after user actions (save, delete, sync), not on every navigation.

## Heavy operations (PDF / Word)
- **Server PDF:** Contract PDF load is sync file read; signing uses async `PDFDocument.load` and does not block the event loop. PDF generation on accept is a one-time file copy from template.
- **Client PDF/Word:** `pdfToDocx` and `pdfToHtml` run only on user action (e.g. “Download as Word”, “Convert to editor”) in `TemplatesSection`, with loading flags (`setConvertingToEditor`, `setDownloadingWord`) so the UI stays responsive. They are **not** run on initial load or in the critical path.

## Summary
| Area           | Status |
|----------------|--------|
| Initial load   | 1–2 requests; no redundant fetches. |
| Server queries | One `/api/state` = 12 SELECTs; heavy handlers reuse state per batch. |
| PDF/Word       | On-demand only; loading states in UI; server signing is async. |
