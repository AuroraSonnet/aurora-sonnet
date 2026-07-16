const { app, BrowserWindow } = require('electron')

const PRODUCTION_URL = 'https://aurora-sonnet-1.onrender.com'
const DEV_URL = 'http://127.0.0.1:5173'

const isDev = process.env.ELECTRON_DEV === '1'

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Aurora Sonnet',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  win.loadURL(url)
  win.on('closed', () => {
    app.quit()
  })
}

app.whenReady().then(() => {
  // Dev mode: load Vite dev server (hot reload). API server must be running separately.
  createWindow(isDev ? DEV_URL : PRODUCTION_URL)
})

app.on('window-all-closed', () => {
  app.quit()
})
