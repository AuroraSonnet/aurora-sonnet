# How to run Aurora Sonnet

## First time or after changing Node version

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Rebuild the database module** (needed if you see "NODE_MODULE_VERSION" or "Could not locate the bindings file")
   ```bash
   npm rebuild better-sqlite3
   ```

3. **Build the frontend**
   ```bash
   npm run build
   ```

## Run the app

**Option A – Dev (with hot reload)**  
- Terminal 1: `npm run server`  
- Terminal 2: `npm run dev`  
- Open http://localhost:5173 in your browser  

**Option B – Production (served from build)**  
- `npm run server`  
- Open http://localhost:3001 in your browser  

The API runs on port **3001**. The dev frontend (Option A) proxies `/api` to the server.
