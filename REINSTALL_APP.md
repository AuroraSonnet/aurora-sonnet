# Delete old app and reinstall (Mac)

## Refresh the app so new features show up

A **clean rebuild** was just run. The latest code (inquiry message saved on projects, “Inquiry message” and “Reply via email” in Bookings) is now in the **dist/** folder.

- **If you use the desktop app (Aurora Sonnet.app):**  
  Rebuild the Mac app so it bundles this new frontend: run **Step 3 (optional)** and **Step 4** below, then install from the new DMG (Step 5).

- **If you run the app in the browser (Node server):**  
  Start the server and open the app:
  ```bash
  cd "/Volumes/G-Video ArmorATD/Aurora Sonnet Cursor/Website"
  npm start
  ```
  Then open **http://localhost:3001** in your browser. The server serves the new build from **dist/**.

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
cd "/Volumes/G-Video ArmorATD/Aurora Sonnet Cursor/Website"
rm -rf release
```
This deletes the previous Mac build so the next one is completely fresh.

## 4. Build a new Mac app
In **Terminal** (same folder):
```bash
npm run build:mac
```
Wait for it to finish (can take a few minutes). When done, you’ll have:
- **release/mac/Aurora Sonnet.app** — the app
- **release/mac/Aurora Sonnet-X.X.X.dmg** (or similar) — installer you can double‑click

## 5. Install the new app
- Open the **release/mac** folder in Finder.
- Double‑click the **.dmg** file.
- Drag **Aurora Sonnet** into **Applications** (or open it from the DMG).

You’ve now deleted the old app and reinstalled the new version from this project.
