# Aurora Sonnet — How to tackle issues step by step

Use this order so each layer is solid before building on it. Add your specific issues under each section as you go.

---

## Suggested order (foundation → flows → extras)

### 1. **Data storage & API** (start here)

If data is wrong or gets lost, everything else will be frustrating. Fix this first.

- [ ] **Persistence** — Is the app using the server (real DB) or only in-memory/mock? Confirm in Settings or on first load.
- [ ] **Backup / export** — Can you export or backup your data? If not, add a simple export (e.g. JSON or CSV).
- [ ] **Sync / refresh** — Does the app always show the latest data after you add/edit elsewhere? If not, fix refresh or error handling.
- [ ] **Your issues:**  
  *(list what’s going wrong with data: e.g. “data resets”, “wrong client on invoice”, “duplicates”)*

---

### 2. **Clients**

Clients are the base for projects, proposals, contracts, and invoices. Get this right before the rest.

- [ ] **CRUD** — Create, edit, delete clients; names and contact info save correctly.
- [ ] **Your issues:**  
  *(e.g. “can’t edit email”, “deleting client breaks proposals”)*

---

### 3. **Projects / Bookings**

Projects link clients to proposals, contracts, and invoices. Fix any wrong links or missing fields here.

- [ ] **Stages** — Inquiry → Proposal → Booked → Completed (or your pipeline) work and persist.
- [ ] **Linking** — Each project has the correct client; client name stays in sync.
- [ ] **Your issues:**  
  *(e.g. “project shows wrong client”, “stage doesn’t update”)*

---

### 4. **Proposals**

Proposals depend on clients and projects. By now, data and links should be reliable.

- [ ] **Create / edit** — Title, value, custom package, email body save and load correctly.
- [ ] **Send email** — To, subject, body, and “include invoice(s)” work; correct invoices show in the list.
- [ ] **Create invoice from modal** — New invoice saves, appears on Invoices page, and can be attached to the email.
- [ ] **Mark as sent** — Status and “Mark as sent when I send” behave as expected.
- [ ] **Your issues:**  
  *(e.g. “invoice list empty”, “email opens with wrong body”)*

---

### 5. **Invoices**

Invoices depend on clients/projects and often proposals. Fix storage and clients first so amounts and links are correct.

- [ ] **List & filter** — You see the right invoices (by client, project, status).
- [ ] **Create / edit** — Amount, due date, client, project title save and don’t get lost.
- [ ] **Status** — Draft → Sent → Paid (and overdue) update and persist.
- [ ] **Templates / PDF** — If you use them, generation and download work.
- [ ] **Your issues:**  
  *(e.g. “invoice doesn’t show for proposal”, “paid status resets”)*

---

### 6. **Contracts**

Contracts sit on top of projects and clients. Same idea: fix links and persistence.

- [ ] **Create / edit** — Fields save; contract is tied to the right project and client.
- [ ] **Signing flow** — Send link, client signs, status updates (if you use e-sign).
- [ ] **Templates** — If you use contract templates, they load and save correctly.
- [ ] **Your issues:**  
  *(e.g. “wrong template”, “signed status not saving”)*

---

### 7. **Automations**

Automations usually depend on stable data and stable flows. Tackle these after the above.

- [ ] **Triggers** — e.g. “When proposal marked sent”, “When contract signed” fire when they should.
- [ ] **Actions** — e.g. create invoice, send email, update stage actually run and don’t duplicate.
- [ ] **Your issues:**  
  *(e.g. “automation doesn’t run”, “runs twice”)*

---

### 8. **Other (expenses, newsletter, inquiries, UI)**

Once core data and flows are solid, clean up the rest.

- [ ] **Expenses** — Add/edit/delete; totals and filters correct.
- [ ] **Newsletter** — If you use it: templates, send, tracking.
- [ ] **Inquiries** — Incoming inquiries show up and link to clients/projects as expected.
- [ ] **UI/UX** — Loading states, toasts, menus, mobile layout.
- [ ] **Your issues:**  
  *(list anything else)*

---

## How to use this

1. **Pick the section that matches your worst pain** — If “invoices are wrong” is the main problem, still start with **1. Data storage** and **2. Clients** (quick check), then go to **5. Invoices**.
2. **Under “Your issues”** — Write 1–3 concrete problems per section (e.g. “When I create an invoice from the proposal modal, it doesn’t show on the Invoices page”).
3. **Fix in order** — We fix section 1, then 2, then the section you care about most. That way we don’t break the base when fixing invoices or proposals.
4. **One section at a time** — Finish (or get to a good stopping point) in one area before moving to the next.

---

## Quick reference — where things live in the app

| Area        | Main files / entry points |
|------------|---------------------------|
| Data/API    | `src/context/AppContext.tsx`, `src/api/db.ts`, `server/` |
| Clients     | `src/pages/Clients.tsx`, `src/pages/ClientDetail.tsx` |
| Projects    | `src/pages/Projects.tsx` (bookings pipeline) |
| Proposals   | `src/pages/Proposals.tsx` |
| Invoices    | `src/pages/Invoices.tsx` |
| Contracts   | `src/pages/Contracts.tsx` |
| Automations | Automation-related components + `AppContext` |

If you tell me your top 3 issues and where they happen (e.g. “Invoices page”, “Send proposal modal”), we can map them to the sections above and tackle them in this order.
