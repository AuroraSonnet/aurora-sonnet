import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import styles from './PdfViewer.module.css'

let workerInit = false
function initWorker() {
  if (workerInit || typeof window === 'undefined') return
  workerInit = true
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker
}

interface PdfViewerProps {
  blob: Blob | null
  className?: string
}

export default function PdfViewer({ blob, className }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!blob || !containerRef.current) return
    setError(null)
    const container = containerRef.current
    container.innerHTML = ''

    initWorker()
    blob.arrayBuffer().then((data) => {
      return pdfjsLib.getDocument({ data }).promise
    }).then((pdf) => {
      const renderPage = (pageNum: number) => {
        return pdf.getPage(pageNum).then((page) => {
          const scale = 2.2
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          canvas.height = viewport.height
          canvas.width = viewport.width
          canvas.className = styles.pageCanvas
          container.appendChild(canvas)
          return page.render({ canvasContext: ctx, canvas, viewport }).promise
        })
      }
      return Promise.all(
        Array.from({ length: pdf.numPages }, (_, i) => renderPage(i + 1))
      )
    }).catch(() => setError('Could not display PDF'))
  }, [blob])

  if (!blob) return null
  if (error) return <p className={styles.error}>{error}</p>
  return <div ref={containerRef} className={className || styles.viewer} />
}
