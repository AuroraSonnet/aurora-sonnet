# Keep inquiry data on Render (fix "nothing shows after sync")

On Render’s **free tier**, the filesystem is **ephemeral**: when the service sleeps (after ~15 min of no traffic) or restarts, all data in `/tmp` is lost. So inquiries created by your form can disappear before you sync, or the server can report 0 clients/0 projects.

**Free alternative (no Render disk):** See **FREE_PERSISTENCE_OPTIONS.md** for running on Railway (free credit + volume) or using a free external DB so data never depends on Render’s disk.

---

## You’re on Starter — make sure data is never lost

Do this **once** so all data (clients, projects, invoices, contracts, payments, templates) is stored on a persistent disk:

1. **Render Dashboard** → your **Web Service** (e.g. Aurora Sonnet).
2. **Disks** (in the left sidebar):  
   - Click **Add Disk**.  
   - **Mount Path:** `/data`  
   - **Size:** 1 GB (or more if you prefer).  
   - Save. Render will redeploy.
3. **Environment**:  
   - Ensure there is a variable **`DATA_DIR`** = **`/data`** (same as the mount path).  
   - If you deploy from the repo’s `render.yaml`, this may already be set; if not, add it manually.
4. **Redeploy** once (if you added the disk or env manually).

After that, the app uses `/data` for the SQLite DB, payments file, and all uploaded templates/contracts. Data survives restarts and redeploys.

---

## Fix on Render (generic steps)

1. In the **Render Dashboard**, open your **Web Service** (e.g. Aurora Sonnet).
2. Go to **Environment** (or **Settings**).
3. Add a **Persistent Disk**:
   - **Mount Path**: e.g. `/data`
   - Create the disk and attach it.
4. Set an **environment variable**:
   - Key: `DATA_DIR`
   - Value: `/data` (same as the mount path)
5. **Redeploy** the service.

After that, the app will store the SQLite database on the persistent disk, so clients and projects survive sleep and restarts. New form submissions will still be there when you sync.

**Check that the form posts to the right place**

Your general inquiry form must POST to:

`https://aurora-sonnet-1.onrender.com/api/inquiry`

(with `Content-Type: application/json` and body `{ name, email, message }`). If the form posts elsewhere or fails (e.g. timeout), nothing will be saved.

**Quick test**

1. Submit the form on your site.
2. Open in a browser: `https://aurora-sonnet-1.onrender.com/api/state`
3. You should see JSON with `clients` and `projects` arrays. If they are empty right after submitting, the form isn’t reaching the server or the server isn’t persisting (use a Persistent Disk as above).
