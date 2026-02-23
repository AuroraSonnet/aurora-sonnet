import { useRef, useState, useCallback } from 'react'
import styles from './SignaturePad.module.css'

export interface SignaturePadProps {
  onCapture: (dataUrl: string) => void
  onCancel?: () => void
  label?: string
}

/** Canvas-based signature pad with typed-name fallback */
export default function SignaturePad({ onCapture, onCancel, label = 'Sign here' }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [typedName, setTypedName] = useState('')
  const [mode, setMode] = useState<'draw' | 'type'>('draw')

  const getContext = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return null
    return canvas.getContext('2d')
  }, [])

  const startDrawing = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = getContext()
      if (!ctx) return
      setIsDrawing(true)
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left
      const y = ('touches' in e ? e.touches[0].clientY : e.clientY) - rect.top
      ctx.beginPath()
      ctx.moveTo(x * scaleX, y * scaleY)
    },
    [getContext]
  )

  const draw = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      if (!isDrawing) return
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = getContext()
      if (!ctx) return
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      const x = ('touches' in e ? e.touches[0].clientX : e.clientX) - rect.left
      const y = ('touches' in e ? e.touches[0].clientY : e.clientY) - rect.top
      ctx.lineTo(x * scaleX, y * scaleY)
      ctx.strokeStyle = '#1a1a1a'
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.stroke()
    },
    [isDrawing, getContext]
  )

  const stopDrawing = useCallback(() => setIsDrawing(false), [])

  const clear = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = getContext()
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setTypedName('')
  }, [getContext])

  const handleSubmit = useCallback(() => {
    if (mode === 'type') {
      if (!typedName.trim()) return
      // Create a simple canvas with the typed name
      const canvas = document.createElement('canvas')
      canvas.width = 300
      canvas.height = 80
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, 300, 80)
      ctx.strokeStyle = '#1a1a1a'
      ctx.strokeRect(0, 0, 299, 79)
      ctx.fillStyle = '#1a1a1a'
      ctx.font = 'italic 24px Georgia, serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(typedName.trim(), 150, 40)
      onCapture(canvas.toDataURL('image/png'))
    } else {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = getContext()
      if (!ctx) return
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = canvas.width
      tempCanvas.height = canvas.height
      const tempCtx = tempCanvas.getContext('2d')
      if (!tempCtx) return
      tempCtx.fillStyle = '#fff'
      tempCtx.fillRect(0, 0, canvas.width, canvas.height)
      tempCtx.drawImage(canvas, 0, 0)
      onCapture(tempCanvas.toDataURL('image/png'))
    }
  }, [mode, typedName, onCapture, getContext])

  return (
    <div className={styles.pad}>
      <p className={styles.label}>{label}</p>
      <div className={styles.tabs}>
        <button
          type="button"
          className={mode === 'draw' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => setMode('draw')}
        >
          Draw
        </button>
        <button
          type="button"
          className={mode === 'type' ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          onClick={() => setMode('type')}
        >
          Type
        </button>
      </div>
      {mode === 'draw' ? (
        <canvas
          ref={canvasRef}
          width={400}
          height={150}
          className={styles.canvas}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      ) : (
        <input
          type="text"
          className={styles.typeInput}
          placeholder="Type your full name"
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
        />
      )}
      <div className={styles.actions}>
        <button type="button" onClick={clear} className={styles.clearBtn}>
          Clear
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          className={styles.submitBtn}
          disabled={mode === 'draw' ? false : !typedName.trim()}
        >
          Sign
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={styles.cancelBtn}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}
