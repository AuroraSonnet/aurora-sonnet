import { useUndo } from '../context/UndoContext'
import styles from './UndoBar.module.css'

export default function UndoBar() {
  const { stack, performUndo, dismiss } = useUndo()
  const entry = stack[0]
  if (!entry) return null

  return (
    <div className={styles.bar} role="status" aria-live="polite">
      <span className={styles.label}>{entry.label}</span>
      <div className={styles.actions}>
        <button type="button" onClick={() => performUndo()} className={styles.undoBtn}>
          Undo
        </button>
        <button type="button" onClick={dismiss} className={styles.dismissBtn} aria-label="Dismiss">
          ✕
        </button>
      </div>
    </div>
  )
}
