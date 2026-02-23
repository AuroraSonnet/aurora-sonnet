import { createContext, useContext, useCallback, useMemo, useState, type ReactNode } from 'react'

export interface UndoEntry {
  id: string
  label: string
  undo: () => Promise<void>
}

type UndoContextValue = {
  stack: UndoEntry[]
  pushUndo: (entry: UndoEntry) => void
  performUndo: () => Promise<void>
  dismiss: () => void
}

const UndoContext = createContext<UndoContextValue | null>(null)

const MAX_STACK = 10

export function UndoProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<UndoEntry[]>([])

  const pushUndo = useCallback((entry: UndoEntry) => {
    setStack((prev) => [entry, ...prev].slice(0, MAX_STACK))
  }, [])

  const performUndo = useCallback(async () => {
    const entry = stack[0]
    if (!entry) return
    try {
      await entry.undo()
    } catch (_) {
      // undo failed, still remove from stack
    }
    setStack((prev) => prev.slice(1))
  }, [stack])

  const dismiss = useCallback(() => {
    setStack((prev) => prev.slice(1))
  }, [])

  const value = useMemo(
    () => ({ stack, pushUndo, performUndo, dismiss }),
    [stack, pushUndo, performUndo, dismiss]
  )

  return <UndoContext.Provider value={value}>{children}</UndoContext.Provider>
}

export function useUndo() {
  const ctx = useContext(UndoContext)
  if (!ctx) throw new Error('useUndo must be used within UndoProvider')
  return ctx
}
