import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8'))

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-router-dom')) {
            return 'react-vendor'
          }
          if (id.includes('node_modules/html2canvas')) {
            return 'html2canvas'
          }
          if (id.includes('node_modules/jspdf')) {
            return 'jspdf'
          }
          if (id.includes('node_modules/pdf-lib')) {
            return 'pdf-lib'
          }
          if (id.includes('node_modules/pdfjs-dist')) {
            return 'pdfjs'
          }
          if (id.includes('node_modules/tesseract.js')) {
            return 'tesseract'
          }
          if (id.includes('node_modules/docx')) {
            return 'docx'
          }
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
