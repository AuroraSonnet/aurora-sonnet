# Aurora Sonnet — Standalone desktop app (Mac & Windows)

The app can run as a **standalone desktop application**: one window, no browser, no terminal. Data (clients, invoices, SQLite) is stored on your computer.

---

## Run the standalone app on your Mac (now)

**Easiest:** Double-click **`Start App.command`** in this folder.  
It will install dependencies (first time), build the app, then open **Aurora Sonnet** in its own window.

**Or in Terminal:**
```bash
cd "/Volumes/G-Video ArmorATD/Aurora Sonnet Cursor/Website"
npm install
npm run build
npm run electron
```
An app window will open. Close the window to quit.

---

## Build installers for Mac and Windows

You need **Node.js** installed (you already have it).

### Mac (on your Mac)
```bash
npm install
npm run build:mac
```
When it finishes, open the **`release`** folder. You’ll see:
- **Aurora Sonnet.dmg** — double-click to install, then drag the app to Applications.
- **Aurora Sonnet.app** — the app itself (inside the .dmg or in `release/mac/`).

### Windows (on a Windows PC)
On a Windows computer, in this project folder:
```bash
npm install
npm run build:win
```
In the **`release`** folder you’ll get an installer (e.g. **Aurora Sonnet Setup.exe**). Run it to install the app.

To build the Windows version from a Mac you’d need a Windows VM or CI (e.g. GitHub Actions); the normal way is to run `build:win` on a Windows machine.

---

## Where is my data stored?

When you run the standalone app, data is stored in your user data folder:
- **Mac:** `~/Library/Application Support/aurora-crm/` (SQLite database and payment records)
- **Windows:** `%AppData%\aurora-crm\`

So your data stays on your computer and survives app updates.

---

## Stripe (payments) in the standalone app

The app works without Stripe; “Pay with card” will show a message that Stripe isn’t configured.

To enable payments when running **from the project** (e.g. `Start App.command` or `npm run electron`), create **`server/.env`** with:
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```
For the **packaged** app (.app or .exe), you’d need to add a way to configure keys in the UI or in a config file in the app’s data folder; that can be added later if you need it.
