import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { useUndo } from '../context/UndoContext'
import { apiUpdateProject } from '../api/db'
import styles from './ProposalView.module.css'

export default function ProposalView() {
  const { id } = useParams<{ id: string }>()
  const { state, actions } = useApp()
  const { pushUndo } = useUndo()
  const proposal = state.proposals.find((p) => p.id === id)
  const project = proposal ? state.projects.find((p) => p.id === proposal.projectId) : null
  const [accepted, setAccepted] = useState(false)

  if (!proposal) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.card}>
          <h1>Proposal not found</h1>
          <p>This link may be invalid or expired.</p>
        </div>
      </div>
    )
  }

  const handleAccept = () => {
    if (project) {
      const previousStage = project.stage
      actions.updateProject(project.id, { stage: 'booked' })
      pushUndo({
        id: `proposal-accept-${project.id}`,
        label: 'Proposal accepted (booking created)',
        undo: async () => {
          await apiUpdateProject(project.id, { stage: previousStage })
          await actions.refreshState()
        },
      })
      setAccepted(true)
    }
  }

  if (accepted) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.card}>
          <h1>Thank you!</h1>
          <p>You&apos;ve accepted the proposal. We&apos;ll send the contract and next steps shortly.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.card}>
        <div className={styles.brand}>Aurora Sonnet</div>
        <h1>Wedding singing — proposal</h1>
        <p className={styles.client}>{proposal.clientName}</p>
        <p className={styles.title}>{proposal.title}</p>
        <div className={styles.price}>${proposal.value.toLocaleString()}</div>
        <p className={styles.note}>
          Includes performance as discussed (ceremony and/or reception). Contract and deposit details will follow.
        </p>
        <button type="button" className={styles.acceptBtn} onClick={handleAccept}>
          Accept proposal
        </button>
      </div>
    </div>
  )
}
