const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('path')
const net = require('net')
const { spawn } = require('child_process')
const fs = require('fs')

const BACKUPS_DIR_NAME = 'backups'
const BACKUPS_RETAIN_DAYS = 30

const DEFAULT_PORT = 3001
let serverProcess = null
let chosenPort = DEFAULT_PORT

function getAppPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath)
  }
  return path.join(__dirname, '..')
}

function getNodePath() {
  if (!app.isPackaged) return process.platform === 'win32' ? 'node.exe' : 'node'
  const resources = process.resourcesPath
  const runtime = path.join(resources, 'node', 'runtime')
  if (process.platform === 'win32') {
    return path.join(runtime, 'node.exe')
  }
  return path.join(runtime, 'bin', 'node')
}

function getAvailablePort(startPort) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(getAvailablePort(startPort + 1)))
    server.once('listening', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
    server.listen(startPort)
  })
}

function startServer(port) {
  return new Promise((resolve, reject) => {
    const appPath = getAppPath()
    const userData = app.getPath('userData')
    const serverPath = path.join(appPath, 'server', 'index.js')
    let serverStderr = ''

    const env = {
      ...process.env,
      PORT: String(port),
      DATA_DIR: userData,
    }

    const nodeCmd = getNodePath()
    if (app.isPackaged && !fs.existsSync(nodeCmd)) {
      reject(new Error('Bundled Node.js not found. Rebuild the app with npm run build:mac.'))
      return
    }
    const serverNodeModules = path.join(appPath, 'server', 'node_modules')
    if (app.isPackaged && !fs.existsSync(serverNodeModules)) {
      reject(new Error('App is missing server/node_modules. Reinstall from the DMG or run npm run build:mac again.'))
      return
    }
    serverProcess = spawn(nodeCmd, [serverPath], {
      cwd: appPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    serverProcess.stdout.on('data', (d) => process.stdout.write(d.toString()))
    serverProcess.stderr.on('data', (d) => {
      const s = d.toString()
      serverStderr += s
      process.stderr.write(s)
    })
    serverProcess.on('error', reject)
    serverProcess.on('exit', (code) => {
      if (code !== null && code !== 0) {
        const detail = serverStderr.trim().slice(-800) || 'No error output captured.'
        reject(new Error(`Server exited with code ${code}\n\nDetails:\n${detail}`))
      }
    })

    const url = `http://127.0.0.1:${port}/api/state`
    const deadline = Date.now() + 15000
    function tryFetch() {
      fetch(url).then(() => resolve()).catch(() => {
        if (Date.now() > deadline) reject(new Error('Server did not start in time'))
        else setTimeout(tryFetch, 200)
      })
    }
    setTimeout(tryFetch, 500)
  })
}

function setupBackupHandlers() {
  const userData = app.getPath('userData')
  const backupsDir = path.join(userData, BACKUPS_DIR_NAME)

  ipcMain.handle('get-backups-dir', () => backupsDir)

  ipcMain.handle('save-backup', (_event, data) => {
    if (data == null || (typeof data === 'string' && data.trim() === '')) {
      return { ok: false, error: 'No data to save' }
    }
    if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true })
    const date = new Date().toISOString().slice(0, 10)
    const name = `aurora-backup-${date}.json`
    const filePath = path.join(backupsDir, name)
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    fs.writeFileSync(filePath, content, 'utf8')
    // Prune backups older than BACKUPS_RETAIN_DAYS
    try {
      const files = fs.readdirSync(backupsDir)
      const cutoff = Date.now() - BACKUPS_RETAIN_DAYS * 24 * 60 * 60 * 1000
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        const full = path.join(backupsDir, f)
        const stat = fs.statSync(full)
        if (stat.mtimeMs < cutoff) fs.unlinkSync(full)
      }
    } catch {
      // ignore prune errors
    }
    return { ok: true, path: filePath }
  })
}

function createWindow(port) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Aurora Sonnet',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  win.loadURL(`http://127.0.0.1:${port}`)
  win.on('closed', () => {
    if (serverProcess && !isDev) {
      serverProcess.kill()
      serverProcess = null
    }
    app.quit()
  })
}

const isDev = process.env.ELECTRON_DEV === '1'

app.whenReady().then(() => {
  setupBackupHandlers()
  if (isDev) {
    // Dev mode: load Vite dev server (hot reload). API server must be running separately.
    createWindow(5173)
    return
  }
  getAvailablePort(process.env.PORT ? parseInt(process.env.PORT, 10) : DEFAULT_PORT)
    .then((port) => {
      chosenPort = port
      return startServer(port)
    })
    .then(() => createWindow(chosenPort))
    .catch((err) => {
      console.error(err)
      dialog.showErrorBox('Aurora Sonnet', err.message || 'The app could not start.')
      app.quit(1)
    })
})

app.on('window-all-closed', () => {
  if (serverProcess && !isDev) serverProcess.kill()
  app.quit()
})
