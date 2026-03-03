# Delete old app and reinstall (Mac)

## Use the updated app (from this project — no spaces in path)

This project is the **single source** for the Mac app. All data comes from SQLite via the Node server (1.1 done). Replacing the old app with a build from here ensures you’re on the correct stack.

- **If you use the desktop app (Aurora Sonnet.app):**  
  Run **Step 3 (optional)** and **Step 4** below, then install from the new DMG (Step 5).

- **If you run in the browser:**  
  ```bash
  cd /Volumes/G-Video/AuroraSonnet/Website
  npm start
  ```
  Then open **http://localhost:3001**. The server serves the build from **dist/**.

---

## 1. Quit the app
If Aurora Sonnet is open: **Aurora Sonnet → Quit** (or press **Cmd+Q**).

## 2. Delete the old app
- Open **Finder** → **Applications**.
- Find **Aurora Sonnet**.
- Drag it to the **Trash** (or right‑click → **Move to Trash**).
- Optional: **Finder → Empty Trash**.

## 3. (Optional) Remove old build folder
In **Terminal**:
```bash
cd /Volumes/G-Video/AuroraSonnet/Website
rm -rf release
```
This deletes the previous Mac build so the next one is completely fresh.

## 4. Build a new Mac app
In **Terminal** (same folder):
```bash
npm run build:mac
```
Wait for it to finish (can take a few minutes). When done, look in **release** for a folder named **mac** or **mac-arm64** (Apple Silicon). Inside it you’ll have:
- **Aurora Sonnet.app** — the app (open this from here first to verify version)
- **Aurora Sonnet-X.X.X.dmg** (or similar) — installer you can double‑click

## 5. Confirm you have the new build (important)
- In Finder, go to **Website/release**. You may see **mac** or **mac-arm64** (Apple Silicon).
- Open **Aurora Sonnet.app** directly from that folder (do not use the one in Applications yet).
- In the app, go to **Settings** and scroll to the bottom. You should see **App version 1.0.2** (or the current version from package.json).
- If you still see an old version or no version, you’re still running the old app — close it and open the .app from the **release** folder again.

## 6. Install the new app
- Once the version in Settings is correct, double‑click the **.dmg** in **release/mac** (or **release/mac-arm64**) and drag **Aurora Sonnet** into **Applications**, or copy the **Aurora Sonnet.app** from the release folder into **Applications** (replacing the old one).

You’ve now deleted the old app and reinstalled the new version from this project.
