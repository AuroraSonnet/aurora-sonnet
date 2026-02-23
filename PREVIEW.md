# How to preview the app

You need **Node.js** on your Mac first (one-time). Then you can run the app as a **standalone desktop app** (one window, no browser).

---

## Step 1: Install Node.js (one-time)

1. Go to **https://nodejs.org**
2. Download the **LTS** version (green button).
3. Run the installer and follow the steps.
4. Quit and reopen Cursor (or your computer) so it picks up Node.

---

## Step 2: Run the standalone app (easiest)

1. **Double-click** **`Start App.command`** in this project folder.  
   (In Cursor: file list on the left. In Finder: open the `Website` folder.)
2. A Terminal window will open and run install + build (first time may take a minute). Then **Aurora Sonnet** opens in its own app window.
3. Use the app; close the window when you’re done.

No browser, no copying links — just the app window.

---

## If “Start App.command” doesn’t run

- **Right-click** **Start App.command** → **Open** (first time; macOS may block it otherwise).
- Or in Terminal:  
  `cd "/Volumes/G-Video ArmorATD/Aurora Sonnet Cursor/Website" && npm install && npm run build && npm run electron`

---

## Build a Mac or Windows installer

See **STANDALONE.md** for building **Aurora Sonnet.dmg** (Mac) or **Aurora Sonnet Setup.exe** (Windows) so you can install the app like any other program.

---

## If something goes wrong

- **“npm: command not found”** → Install Node.js from nodejs.org, then try again.
- **“Cannot find module”** → Double-click **Start App.command** again (it runs `npm install` first).
