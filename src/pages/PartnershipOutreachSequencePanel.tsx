import { useCallback, useEffect, useState } from 'react'
import {
  apiGetOutreachSequenceState,
  apiPauseOutreachSequence,
  apiResumeOutreachSequence,
  apiSkipNextOutreachEmail,
  apiStopOutreachSequence,
  type OutreachSequenceState,
} from '../api/db'
import { formatOutreachDateTime, sequenceStatusTone } from '../utils/outreachSequenceUi'
import styles from './PartnershipOutreach.module.css'

type Props = {
  contactId: string
  companyName: string
  isVenueEmailContact: boolean
  onRefreshAppState: () => Promise<void>
  onToast: (message: string) => void
}

export default function PartnershipOutreachSequencePanel({
  contactId,
  companyName,
  isVenueEmailContact,
  onRefreshAppState,
  onToast,
}: Props) {
  const [state, setState] = useState<OutreachSequenceState | null>(null)
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState<string | null>(null)

  const loadState = useCallback(async () => {
    if (!isVenueEmailContact) {
      setState(null)
      setMissing(true)
      return
    }
    setLoading(true)
    setError(null)
    const result = await apiGetOutreachSequenceState(contactId)
    if (result.ok) {
      setState(result.state)
      setMissing(false)
    } else if (result.missing) {
      setState(null)
      setMissing(true)
    } else {
      setError(result.error)
    }
    setLoading(false)
  }, [contactId, isVenueEmailContact])

  useEffect(() => {
    void loadState()
  }, [loadState])

  const runAction = async (
    label: string,
    fn: () => Promise<{ ok: true; state: OutreachSequenceState } | { ok: false; error: string }>
  ) => {
    setActionBusy(label)
    setError(null)
    try {
      const result = await fn()
      if (!result.ok) {
        setError(result.error)
        return
      }
      setState(result.state)
      await onRefreshAppState()
      onToast(`${label} for ${companyName}.`)
    } finally {
      setActionBusy(null)
    }
  }

  if (!isVenueEmailContact) return null

  if (loading && !state) {
    return (
      <section className={styles.sequenceSection}>
        <h3>Outreach sequence</h3>
        <p className={styles.hint}>Loading sequence…</p>
      </section>
    )
  }

  if (missing) {
    return (
      <section className={styles.sequenceSection}>
        <h3>Outreach sequence</h3>
        <p className={styles.hint}>No automated sequence for this contact yet. Sequences start after a successful Venue First Outreach send.</p>
      </section>
    )
  }

  if (!state) return null

  const { panel } = state
  const tone = sequenceStatusTone(panel.status)
  const canPause = panel.status === 'running'
  const canResume = panel.status === 'paused'
  const canStop = panel.status === 'running' || panel.status === 'paused'
  const canSkip = panel.status === 'running' || panel.status === 'paused'

  return (
    <section className={styles.sequenceSection}>
      <div className={styles.sequenceHeaderRow}>
        <h3>Outreach sequence</h3>
        <span className={styles.sequenceStatusBadge} data-tone={tone}>
          {panel.statusLabel}
        </span>
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}

      <dl className={styles.sequenceMeta}>
        <div>
          <dt>Current step</dt>
          <dd>{panel.currentStepLabel}</dd>
        </div>
        <div>
          <dt>Next scheduled email</dt>
          <dd>
            {panel.nextScheduled ? (
              <>
                <strong>{panel.nextScheduled.templateName}</strong>
                <span className={styles.sequenceMetaSub}>
                  {panel.nextScheduled.stepLabel} · {formatOutreachDateTime(panel.nextScheduled.scheduledAt)}
                </span>
              </>
            ) : (
              'None queued'
            )}
          </dd>
        </div>
        <div>
          <dt>Remaining scheduled emails</dt>
          <dd>{panel.remainingCount}</dd>
        </div>
        <div>
          <dt>Last reply detected</dt>
          <dd>
            {panel.lastReply ? (
              <>
                {formatOutreachDateTime(panel.lastReply.at)}
                {panel.lastReply.subject ? (
                  <span className={styles.sequenceMetaSub}>{panel.lastReply.subject}</span>
                ) : panel.lastReply.snippet ? (
                  <span className={styles.sequenceMetaSub}>{panel.lastReply.snippet}</span>
                ) : null}
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
        <div>
          <dt>Last delivery failure</dt>
          <dd>
            {panel.lastFailure ? (
              <>
                {formatOutreachDateTime(panel.lastFailure.at)}
                <span className={styles.sequenceMetaSub}>{panel.lastFailure.reason}</span>
              </>
            ) : (
              '—'
            )}
          </dd>
        </div>
        {panel.stopReason && (
          <div>
            <dt>Stop reason</dt>
            <dd>{panel.stopReason}</dd>
          </div>
        )}
      </dl>

      {panel.remaining.length > 0 && (
        <details className={styles.sequenceRemainingDetails}>
          <summary>View remaining queue ({panel.remaining.length})</summary>
          <ul className={styles.sequenceRemainingList}>
            {panel.remaining.map((item) => (
              <li key={`${item.step}-${item.scheduledAt}`}>
                <strong>{item.stepLabel}</strong> — {item.templateName}
                <span>{formatOutreachDateTime(item.scheduledAt)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className={styles.sequenceActions}>
        <button
          type="button"
          className={styles.sequenceActionBtn}
          disabled={!canPause || !!actionBusy}
          onClick={() => runAction('Sequence paused', () => apiPauseOutreachSequence(contactId))}
        >
          {actionBusy === 'Sequence paused' ? 'Pausing…' : 'Pause'}
        </button>
        <button
          type="button"
          className={styles.sequenceActionBtn}
          disabled={!canResume || !!actionBusy}
          onClick={() => runAction('Sequence resumed', () => apiResumeOutreachSequence(contactId))}
        >
          {actionBusy === 'Sequence resumed' ? 'Resuming…' : 'Resume'}
        </button>
        <button
          type="button"
          className={styles.sequenceActionBtn}
          disabled={!canStop || !!actionBusy}
          onClick={() => runAction('Sequence stopped', () => apiStopOutreachSequence(contactId, 'manual_stop_ui'))}
        >
          {actionBusy === 'Sequence stopped' ? 'Stopping…' : 'Stop'}
        </button>
        <button
          type="button"
          className={styles.sequenceActionBtn}
          disabled={!canSkip || !!actionBusy}
          onClick={() => runAction('Next email skipped', () => apiSkipNextOutreachEmail(contactId))}
        >
          {actionBusy === 'Next email skipped' ? 'Skipping…' : 'Skip next email'}
        </button>
      </div>
    </section>
  )
}
