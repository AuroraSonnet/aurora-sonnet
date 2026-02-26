# Render deploy troubleshooting

## If a deploy shows "Failed"

1. **Check the logs**  
   In [Render Dashboard](https://dashboard.render.com) → your **aurora-sonnet** service → **Logs**.  
   - **Build logs**: look for errors during `npm install` or `npm run build` (e.g. `better-sqlite3` compile, Node version, out of memory).  
   - **Deploy logs**: look for errors when the app starts (e.g. port, missing env, crash on first request).

2. **Retry with a fresh deploy**  
   If you triggered "Manual Deploy" while another deploy was still building, one of them can end up failed or cancelled.  
   - Open the service → **Manual Deploy** → **Deploy latest commit**.  
   - Wait for the new build to finish; the previous failure doesn’t affect this one.

3. **Node version**  
   The repo has an `.nvmrc` (Node 20) and `engines` in `package.json` so Render uses a compatible Node version for `better-sqlite3`. If you still see Node-related errors, set **Environment** → **NODE_VERSION** = `20` in the Render dashboard.

4. **Build command**  
   Default is: `npm install && npm run build`  
   That runs `tsc -b && vite build` and must complete without errors.

5. **Start command**  
   Default is: `npm start` (runs `node server/index.js`).  
   Render sets `PORT`; the server listens on `process.env.PORT`.

## If Native Node builds keep failing (better-sqlite3 / prebuilds)

Switch the service to **Docker** so the build runs in a container with build tools:

1. In Render Dashboard → **aurora-sonnet** → **Settings**.
2. Under **Build & Deploy**, set **Runtime** to **Docker**.
3. Leave **Dockerfile Path** blank (uses `./Dockerfile` in the repo root).
4. Save and trigger **Manual Deploy**.

The Dockerfile uses Node 18, installs Python/make/g++ for native compile, then runs `npm ci` and `npm run build`. Render will inject `PORT` at runtime.

## After a failed deploy

- Fix any config or code issues suggested by the logs.  
- Commit and push, or trigger **Manual Deploy** again.  
- New deploys don’t depend on the previous failed one.
