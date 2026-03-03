# Get music selection working on Render

Your Render app is still running **old code** (no `POST /api/music-selection`). Push the latest code and redeploy.

## Option A: Render is connected to GitHub

1. **Push this project to GitHub**
   - In Terminal (in your project folder):
   ```bash
   cd /Volumes/G-Video/AuroraSonnet
   git add -A
   git commit -m "Add /api/music-selection and CORS for song form"
   git push origin main
   ```
   - Use the repo Render is already connected to. If you’re not sure, open [Render Dashboard](https://dashboard.render.com) → your **aurora-sonnet** service → **Settings** → see which repo/branch is set.

2. **Redeploy on Render**
   - Dashboard → **aurora-sonnet** → **Manual Deploy** → **Deploy latest commit**.

3. **Check**
   - After deploy, open:  
     `https://aurora-sonnet-1.onrender.com/api/state`  
   - Then submit the song form on aurorasonnet.com again.

## Option B: You don’t use GitHub with Render

- In Render Dashboard → your service → **Settings** → **Build & Deploy**.
- Connect the service to a GitHub repo that contains this project (e.g. create a repo, push this code, then connect it in Render).
- Trigger a deploy (e.g. **Manual Deploy** → **Deploy latest commit**).

---

The code in this folder already has the `POST /api/music-selection` route. Once Render runs a build from this code, the song form will work.
