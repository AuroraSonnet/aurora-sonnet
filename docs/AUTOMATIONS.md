# Automations (§9)

## 9.1 Triggers & actions in scope

**Events in scope (no server execution):**

| Trigger             | In-scope meaning                    | Dashboard suggestion              |
|---------------------|-------------------------------------|-----------------------------------|
| `inquiry_received`  | Project stage = inquiry, no proposal | “Create proposal” (one per project) |
| `proposal_sent`     | Proposal sent 5+ days ago, no contract | “Send contract” (one per proposal) |
| Contract signed     | Built-in only: create deposit invoice when you mark signed | N/A (done in Contracts UI) |
| Overdue invoice     | Invoice status = sent, due date past | “View / send link” (one per invoice) |
| `wedding_week`      | Booked, wedding in 0–7 days         | “View booking” (one per project)  |

**Workflow toggles (Automations page):** The list (e.g. “Send proposal after inquiry”, “Contract reminder”) is **suggestion-only**. Turning a workflow on or off only affects which reminders the Dashboard can show; nothing runs automatically.

## Trigger once per event

- **Dashboard suggestions:** `getAutomationSuggestions()` returns **at most one suggestion per entity** (one per inquiry-without-proposal project, one per sent-proposal-without-contract, one per overdue invoice, one per upcoming-wedding project). No duplicate cards for the same project/proposal/invoice.
- **No server-side triggers:** Nothing on the server listens for “inquiry_received” or “proposal_sent”. So there is no risk of double-firing; the only “trigger” is the user opening the Dashboard and seeing the card.

## Don’t fight manual actions

- Suggestions are **read-only**: they link to Proposals, Contracts, Invoices, or Bookings. The user chooses when to send, sign, or nudge.
- Built-in automations can create records in two cases:
  - `contract signed -> create deposit invoice`
  - `30 days before wedding -> create final invoice draft` for secured booked projects
- Built-in automations also add calendar reminders when a booking is fully secured (`contract signed + retainer paid`):
  - wedding day
  - final-invoice reminder 30 days before the wedding (or today if that date has already passed)
- Those built-in calendar reminders also get `reminderAt` set automatically, so if SMTP is configured the app emails you on the day of each reminder.
- Dashboard suggestions are still read-only for the other workflow toggles.
- Manual actions (e.g. sending a proposal, marking a contract sent) are the source of truth; suggestions only surface “it’s time to do X” and disappear once the state no longer matches (e.g. once a proposal exists for that project).
