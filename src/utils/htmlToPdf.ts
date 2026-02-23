/**
 * Render HTML to a PDF and return the file as base64.
 * Uses html2canvas to capture the content and jspdf to build the PDF (single or multiple pages).
 */
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

const MARGIN = 40

export async function htmlToPdfBase64(html: string): Promise<string> {
  const container = document.createElement('div')
  container.style.position = 'absolute'
  container.style.left = '-9999px'
  container.style.top = '0'
  container.style.width = '210mm'
  container.style.padding = '20mm'
  container.style.background = '#fff'
  container.style.fontFamily = 'Georgia, serif'
  container.style.fontSize = '12px'
  container.style.lineHeight = '1.5'
  container.style.color = '#000'
  container.innerHTML = html
  document.body.appendChild(container)

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
    })
    const imgData = canvas.toDataURL('image/png', 1.0)
    const imgW = canvas.width
    const imgH = canvas.height
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'px',
      format: [595, 842],
    })
    const pdfW = pdf.internal.pageSize.getWidth()
    const pdfH = pdf.internal.pageSize.getHeight()
    const ratio = Math.min((pdfW - MARGIN * 2) / imgW, (pdfH - MARGIN * 2) / imgH)
    const w = imgW * ratio
    const h = imgH * ratio
    if (h <= pdfH - MARGIN * 2) {
      pdf.addImage(imgData, 'PNG', MARGIN, MARGIN, w, h)
    } else {
      let heightLeft = h
      let position = 0
      let page = 0
      while (heightLeft > 0) {
        if (page > 0) pdf.addPage()
        const sliceH = (canvas.height * (pdfH - MARGIN * 2)) / h
        const sourceY = position * sliceH
        const sourceH = Math.min(sliceH, canvas.height - sourceY)
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = canvas.width
        tempCanvas.height = sourceH
        const ctx = tempCanvas.getContext('2d')
        if (ctx) {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height)
          ctx.drawImage(canvas, 0, sourceY, canvas.width, sourceH, 0, 0, canvas.width, sourceH)
        }
        const pageImg = tempCanvas.toDataURL('image/png', 1.0)
        const pageImgH = (sourceH / canvas.height) * h
        pdf.addImage(pageImg, 'PNG', MARGIN, MARGIN, w, pageImgH)
        heightLeft -= pdfH - MARGIN * 2
        position += pdfH - MARGIN * 2
        page++
      }
    }
    const pdfBlob = pdf.output('arraybuffer')
    const bytes = new Uint8Array(pdfBlob)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    const base64 = btoa(binary)
    return base64
  } finally {
    document.body.removeChild(container)
  }
}
