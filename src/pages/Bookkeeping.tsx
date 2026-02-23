import { useState } from 'react'
import { useApp } from '../context/AppContext'
import { useUndo } from '../context/UndoContext'
import { apiDeleteExpense, apiCreateExpense } from '../api/db'
import styles from './Bookkeeping.module.css'

export default function Bookkeeping() {
  const { state, actions } = useApp()
  const { pushUndo } = useUndo()
  const { invoices, expenses } = state
  const [showAddExpense, setShowAddExpense] = useState(false)
  const [newExpense, setNewExpense] = useState({ date: '', description: '', amount: 0, category: 'Materials' })

  const paidInvoices = invoices.filter((i) => i.status === 'paid')
  const totalIncome = paidInvoices.reduce((s, i) => s + i.amount, 0)
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0)
  const net = totalIncome - totalExpenses

  const handleAddExpense = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newExpense.date || !newExpense.description || newExpense.amount <= 0) return
    const expenseId = actions.addExpense({
      date: newExpense.date,
      description: newExpense.description,
      amount: newExpense.amount,
      category: newExpense.category,
    })
    pushUndo({
      id: `expense-${expenseId}`,
      label: `Expense "${newExpense.description}" added`,
      undo: async () => {
        await apiDeleteExpense(expenseId)
        await actions.refreshState()
      },
    })
    setNewExpense({ date: '', description: '', amount: 0, category: 'Materials' })
    setShowAddExpense(false)
  }

  const handleExportCSV = () => {
    const rows: string[][] = [
      ['Type', 'Date', 'Description', 'Amount', 'Client/Project'],
      ...paidInvoices.map((i) => ['Income', i.paidAt ?? i.dueDate, i.projectTitle, String(i.amount), i.clientName]),
      ...expenses.map((e) => ['Expense', e.date, e.description, String(-e.amount), e.category]),
    ]
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `aurora-sonnet-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Bookkeeping</h1>
        <p className={styles.subtitle}>
          Income from paid invoices, expenses, and export for taxes.
        </p>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.addBtn}
            onClick={() => setShowAddExpense(!showAddExpense)}
          >
            {showAddExpense ? 'Cancel' : 'Add expense'}
          </button>
          <button type="button" className={styles.exportBtn} onClick={handleExportCSV}>
            Export CSV
          </button>
        </div>
      </header>

      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Income (paid)</span>
          <span className={styles.metricValue}>${totalIncome.toLocaleString()}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Expenses</span>
          <span className={styles.metricValue}>${totalExpenses.toLocaleString()}</span>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>Net</span>
          <span className={styles.metricValue} data-negative={net < 0}>
            ${Math.abs(net).toLocaleString()}{net < 0 ? ' (loss)' : ''}
          </span>
        </div>
      </div>

      {showAddExpense && (
        <form className={styles.card} onSubmit={handleAddExpense}>
          <h2>Add expense</h2>
          <div className={styles.formRow}>
            <label>
              Date
              <input
                type="date"
                value={newExpense.date}
                onChange={(e) => setNewExpense((s) => ({ ...s, date: e.target.value }))}
                required
                className={styles.input}
              />
            </label>
            <label>
              Category
              <select
                value={newExpense.category}
                onChange={(e) => setNewExpense((s) => ({ ...s, category: e.target.value }))}
                className={styles.select}
              >
                <option value="Materials">Materials</option>
                <option value="Travel">Travel</option>
                <option value="Marketing">Marketing</option>
                <option value="Software">Software</option>
                <option value="Other">Other</option>
              </select>
            </label>
            <label>
              Amount ($)
              <input
                type="number"
                min="0"
                step="0.01"
                value={newExpense.amount || ''}
                onChange={(e) => setNewExpense((s) => ({ ...s, amount: Number(e.target.value) || 0 }))}
                required
                className={styles.input}
              />
            </label>
          </div>
          <label className={styles.fullWidth}>
            Description
            <input
              type="text"
              value={newExpense.description}
              onChange={(e) => setNewExpense((s) => ({ ...s, description: e.target.value }))}
              placeholder="e.g. Sheet music, mileage"
              required
              className={styles.input}
            />
          </label>
          <button type="submit" className={styles.primaryBtn}>
            Save expense
          </button>
        </form>
      )}

      <div className={styles.grid}>
        <section className={styles.card}>
          <h2>Income (paid invoices)</h2>
          <ul className={styles.list}>
            {paidInvoices.length === 0 ? (
              <li className={styles.empty}>No paid invoices yet.</li>
            ) : (
              paidInvoices.map((i) => (
                <li key={i.id} className={styles.row}>
                  <span className={styles.date}>{i.paidAt ?? i.dueDate}</span>
                  <span>{i.projectTitle}</span>
                  <span className={styles.amount}>+${i.amount.toLocaleString()}</span>
                </li>
              ))
            )}
          </ul>
        </section>
        <section className={styles.card}>
          <h2>Expenses</h2>
          <ul className={styles.list}>
            {expenses.map((e) => (
              <li key={e.id} className={styles.row}>
                <span className={styles.date}>{e.date}</span>
                <span>{e.description}</span>
                <span className={styles.amountNeg}>-${e.amount.toLocaleString()}</span>
                <button
                  type="button"
                  className={styles.deleteBtn}
                  onClick={() => {
                    pushUndo({
                      id: `expense-${e.id}`,
                      label: `Expense "${e.description}" deleted`,
                      undo: async () => {
                        await apiCreateExpense(e as unknown as Record<string, unknown>)
                        await actions.refreshState()
                      },
                    })
                    actions.deleteExpense(e.id)
                  }}
                  aria-label="Delete"
                >
                  ×
                </button>
              </li>
            ))}
            {expenses.length === 0 && <li className={styles.empty}>No expenses logged.</li>}
          </ul>
        </section>
      </div>
    </div>
  )
}
