import { useCallback, useEffect, useState } from 'react'
import {
  apiGetProjectReferral,
  apiLinkProjectToReferral,
  apiReferralProjectAction,
  apiUnlinkReferralProject,
  type ProjectReferralContext,
} from '../api/db'
import styles from './ReferralCommissionPanel.module.css'

function usd(n: number | null | undefined) {
  return `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`
}

function day(iso: string | null | undefined) {
  return iso ? iso.slice(0, 10) : ''
}

const COMMISSION_LABELS: Record<string, string> = {
  pending: 'Pending (waiting for event and final payment)',
  earned: 'Earned, ready to pay',
  paid: 'Paid',
}

export default function ReferralCommissionPanel({ projectId }: { projectId: string }) {
  const [ctx, setCtx] = useState<ProjectReferralContext | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [amountDraft, setAmountDraft] = useState('')
  const [payoutDraft, setPayoutDraft] = useState('none')

  const apply = useCallback((next: ProjectReferralContext) => {
    setCtx(next)
    setAmountDraft(next.link?.eligibleAmount != null ? String(next.link.eligibleAmount) : '')
    setPayoutDraft(next.link?.payoutStatus ?? 'none')
  }, [])

  useEffect(() => {
    let cancelled = false
    setCtx(null)
    setError('')
    void apiGetProjectReferral(projectId).then((res) => {
      if (cancelled) return
      if (res.ok) apply(res.data)
      else setError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, apply])

  const run = useCallback(
    async (fn: () => Promise<{ ok: true; data: ProjectReferralContext } | { ok: false; error: string }>) => {
      setBusy(true)
      setError('')
      const res = await fn()
      setBusy(false)
      if (res.ok) apply(res.data)
      else setError(res.error)
    },
    [apply]
  )

  if (!ctx) {
    return error ? (
      <section className={styles.panel}>
        <h3 className={styles.title}>Partner referral</h3>
        <p className={styles.error}>{error}</p>
      </section>
    ) : null
  }

  const ref = ctx.referral
  const refLabel = ref ? `${ref.referralReference || ref.id} · ${ref.companyName || ref.partnerName} · ${ref.clientName}` : ''

  if (ctx.kind === 'none') return null

  if (ctx.kind === 'review') {
    return (
      <section className={styles.panel}>
        <h3 className={styles.title}>Partner referral</h3>
        <p className={styles.muted}>
          This client’s email and phone point to different referral records. Review the referrals before linking; no link can be made from here.
        </p>
      </section>
    )
  }

  if (ctx.kind === 'suggestion' && ref) {
    return (
      <section className={styles.panel}>
        <h3 className={styles.title}>Partner referral</h3>
        <p className={styles.meta}>Possible referral: {refLabel}</p>
        <button
          type="button"
          className={styles.btn}
          disabled={busy}
          onClick={() => void run(() => apiLinkProjectToReferral(projectId, ref.id))}
        >
          Link project to this referral
        </button>
        <p className={styles.muted} style={{ marginTop: '0.5rem' }}>
          Linking only connects the project to the referral. It does not confirm a booking or create a commission.
        </p>
        {error ? <p className={styles.error}>{error}</p> : null}
      </section>
    )
  }

  const link = ctx.link
  if (!link || !ref) return null
  const locked = link.payoutStatus === 'completed'
  const finalConfirmed = Boolean(link.eventCompletedAt && link.clientPaidInFullAt)
  const hasAmount = link.eligibleAmount != null && link.eligibleAmount > 0
  const amountValue = amountDraft.trim() === '' ? null : Math.round(Number(amountDraft))
  const amountDirty = amountValue !== (link.eligibleAmount ?? null)
  const earned = link.commissionState === 'earned' || link.commissionState === 'paid' || link.payoutStatus === 'pending'

  return (
    <section className={styles.panel}>
      <h3 className={styles.title}>Partner referral commission</h3>
      <p className={styles.meta}>Linked to {refLabel}</p>
      {!ref.commissionEligible ? (
        <p className={styles.warn}>
          This venue referral has not been explicitly accepted ({ref.referralDecisionStatus || 'pending'}). No commission is earned until it is accepted.
        </p>
      ) : null}
      {ctx.context.legacyPaidProject ? (
        <p className={styles.warn}>
          A commission for this booking was already paid on the original referral record. This booking cannot earn a second commission.
        </p>
      ) : ref.legacyPaidPayout != null && !ref.legacyPaidProjectId ? (
        <p className={styles.warn}>
          The original referral record shows a paid commission of {usd(ref.legacyPaidPayout)} but does not say which booking it covered. Check this is a different event before confirming.
        </p>
      ) : null}

      <ol className={styles.steps}>
        <li className={styles.step}>
          <span className={styles.stepLabel}>1. Booked performance</span>
          {link.bookedConfirmedAt ? (
            <span className={styles.done}>Confirmed {day(link.bookedConfirmedAt)}</span>
          ) : (
            <>
              <button
                type="button"
                className={styles.btn}
                disabled={busy || locked || Boolean(ctx.context.legacyPaidProject)}
                onClick={() => {
                  if (!window.confirm('Confirm this project is a booked performance? An inquiry or pipeline stage alone is not a booking.')) return
                  void run(() => apiReferralProjectAction(link.id, 'confirm_booked'))
                }}
              >
                Confirm booked performance
              </button>
              <span className={styles.hint}>Only confirm once the performance is actually booked (signed and committed).</span>
            </>
          )}
        </li>

        <li className={styles.step}>
          <label className={styles.stepLabel} htmlFor={`elig-${link.id}`}>
            2. Eligible performance amount
          </label>
          <input
            id={`elig-${link.id}`}
            className={styles.amountInput}
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={amountDraft}
            disabled={busy || locked}
            onChange={(e) => setAmountDraft(e.target.value)}
            placeholder="USD"
          />
          <button
            type="button"
            className={styles.ghostBtn}
            disabled={busy || locked || !amountDirty || (amountValue != null && !(amountValue >= 0))}
            onClick={() => void run(() => apiReferralProjectAction(link.id, 'set_amount', { eligibleAmount: amountValue }))}
          >
            Save amount
          </button>
          <span className={styles.hint}>
            The performance-service amount used to calculate the commission. Entered by you; not taken from invoices or the booking value, and installments or add-ons do not change it. Reduce it before payout if a refund applies.
          </span>
        </li>

        <li className={styles.step}>
          <span className={styles.stepLabel}>3. Event complete and paid in full</span>
          {finalConfirmed ? (
            <span className={styles.done}>Confirmed {day(link.eventCompletedAt)}</span>
          ) : (
            <button
              type="button"
              className={styles.btn}
              disabled={busy || locked || !link.bookedConfirmedAt || !hasAmount}
              onClick={() => {
                if (!window.confirm('Confirm the event took place and the client has paid in full?')) return
                void run(() => apiReferralProjectAction(link.id, 'confirm_complete_paid'))
              }}
            >
              Confirm event complete and paid in full
            </button>
          )}
        </li>

        <li className={styles.step}>
          <span className={styles.stepLabel}>Payout</span>
          <select
            className={styles.select}
            value={payoutDraft}
            disabled={busy || locked || !earned}
            onChange={(e) => setPayoutDraft(e.target.value)}
          >
            <option value="none">Not paid</option>
            <option value="pending">Payment scheduled</option>
            <option value="completed">Paid</option>
          </select>
          <button
            type="button"
            className={styles.ghostBtn}
            disabled={busy || locked || payoutDraft === link.payoutStatus}
            onClick={() => {
              if (payoutDraft === 'completed' && !window.confirm(`Mark ${usd(link.commissionAmount)} as paid to the partner? This locks the commission.`)) return
              void run(() => apiReferralProjectAction(link.id, 'set_payout_status', { payoutStatus: payoutDraft }))
            }}
          >
            Save payout
          </button>
          {locked ? <span className={styles.hint}>Paid {day(link.payoutStatusUpdatedAt)}. Locked as history.</span> : null}
        </li>
      </ol>

      <p className={styles.commission}>
        Commission: <strong>{usd(link.commissionAmount)}</strong>
        {link.commissionState ? ` · ${COMMISSION_LABELS[link.commissionState]}` : ' · Not earned yet'}
      </p>

      <div className={styles.context}>
        <strong>Context only (does not confirm booking or payment)</strong>
        <div>Booking value: {ctx.context.projectValue != null ? usd(ctx.context.projectValue) : '—'}</div>
        {ctx.context.invoices.length ? (
          <ul>
            {ctx.context.invoices.map((inv) => (
              <li key={inv.id}>
                {inv.invoiceNumber || inv.id}
                {inv.type ? ` (${inv.type})` : ''}: {usd(inv.amount)}, {inv.status}
                {inv.paidAt ? ` ${day(inv.paidAt)}` : ''}
              </li>
            ))}
          </ul>
        ) : (
          <div>No invoices.</div>
        )}
      </div>

      {link.canUnlink ? (
        <button
          type="button"
          className={styles.ghostBtn}
          style={{ marginTop: '0.75rem' }}
          disabled={busy}
          onClick={() => {
            if (!window.confirm('Remove the link between this project and the referral?')) return
            void run(() => apiUnlinkReferralProject(link.id))
          }}
        >
          Remove link
        </button>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}
    </section>
  )
}
