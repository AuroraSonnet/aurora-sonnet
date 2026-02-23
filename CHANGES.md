# Changes made to the app

Summary of edits so you can see what’s new when you swap the old app for this one.

---

## 1. General inquiry form (Formspree embed)

**File:** `EMBED_GENERAL_INQUIRY_FORMSPREE_ONLY.html`

- **Removed** from the thank-you message (after successful submit):
  - The line: *“Time-sensitive? Text us on WhatsApp or call +1-646-596-4747.”*
- **Still shown:**  
  *“Thank you — we've received your inquiry”* and *“Our team is reviewing your request now and will reach out in a few moments.”*

---

## 2. Backend: save inquiry message on projects

**Files:** `server/index.js`, `server/db.js`

- General inquiry submissions (e.g. from Formspree or your API) now **save the message** on the related project.
- **New DB column:** `projects.notes` (TEXT). Used to store the inquiry message (and any manual notes).
- When a general inquiry is processed, `notes` is set from the submitted message so you can see it in the app.

---

## 3. Bookings (Projects): show message and Reply in edit modal

**File:** `src/pages/Projects.tsx`

- **Edit booking modal** now:
  - Shows an **“Inquiry message”** section when the project has `notes` (the saved message from the form).
  - Includes a **“Reply via email”** button that opens the default mail client with a pre-filled email to the client (uses the client’s **first name** and includes their inquiry message when present).
- **Notes field** in the modal is labeled *“Notes / inquiry message”* so you can view or edit the stored message.

---

## 4. Combined inquiry form (Solo + Duo): filter experiences by artist type

**File:** `src/pages/InquireCombined.tsx`

- If a **solo artist** is selected, only **solo experiences** are selectable.
- If a **duo** is selected, only **duo experiences** are selectable.
- If no artist/duo is selected, the form prompts the user to pick one before choosing an experience.

---

## 5. Duo + Combined inquiry forms: removed experience prices

**Files:** `src/pages/InquireDuo.tsx`, `src/pages/InquireCombined.tsx`

- Removed “From $X,XXX” pricing text from the experience cards on:
  - Duo inquiry form
  - Solo + Duo (combined) inquiry form

---

## 6. Backend: save requested artist/duo from inquiry forms

**Files:** `server/index.js`, `server/db.js`

- Inquiry submissions now save `requestedArtist` onto the created project.
- **New DB column:** `projects.requestedArtist` (TEXT).

---

## 7. Clients: delete with Undo (soft delete + restore)

**Files:** `server/db.js`, `server/index.js`, `src/pages/Clients.tsx`, `src/pages/ClientDetail.tsx`, `src/api/db.ts`

- Deleting a client is now a **soft delete** (adds `deletedAt`).
- Deleted clients + their bookings are **hidden** from the app state.
- After delete, an **Undo bar** appears; clicking Undo restores the client and their bookings.
- **New API endpoint:** `POST /api/clients/:id/restore`
- **New DB columns:** `clients.deletedAt`, `projects.deletedAt`

---

## 8. Sidebar: lead forms grouped

**Files:** `src/components/Layout.tsx`, `src/components/Layout.module.css`

- The four lead forms are grouped under a single **Lead forms** section with a simple expand/collapse.

---

## 9. Build (new app)

- **`npm run build`** has been run. The current **“new”** app is in the **`dist/`** folder.
- To **swap the old app for this new one** on Render:
  1. Commit and push these changes to your GitHub repo.
  2. Render will rebuild from the repo (using `npm install && npm run build` and then `npm start`), so the live site will serve the new app.

---

*Last updated after bundling the latest desktop build + the items above.*
