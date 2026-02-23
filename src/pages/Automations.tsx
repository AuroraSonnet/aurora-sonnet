import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import type { AutomationTrigger, AutomationAction } from '../data/mock'
import styles from './Automations.module.css'

const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  inquiry_received: 'New inquiry',
  proposal_sent: 'Proposal sent',
  contract_signed: 'Contract signed',
  deposit_paid: 'Deposit paid',
  wedding_week: '1 week before wedding',
}

const ACTION_LABELS: Record<AutomationAction, string> = {
  send_proposal_reminder: 'Send proposal reminder',
  send_contract_reminder: 'Send contract reminder',
  send_invoice: 'Send invoice',
  send_thank_you: 'Send thank-you',
  add_to_calendar: 'Add to calendar & details',
}

export default function Automations() {
  const { state, actions } = useApp()
  const workflows = state.automations

  const onCount = useMemo(() => workflows.filter((a) => a.enabled).length, [workflows])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Automations</h1>
        <p className={styles.subtitle}>
          Set it once. When something happens in a booking, Aurora Sonnet can remind you or run the next step—so you spend less time chasing and more time singing.
        </p>
        <div className={styles.stats}>
          <span className={styles.statsValue}>{onCount}</span>
          <span className={styles.statsLabel}>workflows on</span>
        </div>
      </header>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Built-in (always on)</h2>
        <p className={styles.sectionDesc}>
          These run inside the app with no setup.
        </p>
        <div className={styles.builtInCard}>
          <div className={styles.builtInFlow}>
            <span className={styles.pill}>Contract signed</span>
            <span className={styles.arrow} aria-hidden>→</span>
            <span className={styles.pill}>Create deposit invoice</span>
          </div>
          <p className={styles.builtInNote}>
            When you mark a contract as signed in Contracts, a 50% deposit invoice is created for that booking if one doesn’t exist.
          </p>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Smart reminders</h2>
        <p className={styles.sectionDesc}>
          Your Dashboard shows the right next step at the right time—send a proposal, nudge for a contract, or chase a payment.
        </p>
        <div className={styles.smartCard}>
          <ul className={styles.smartList}>
            <li>Inquiry with no proposal → Create proposal</li>
            <li>Proposal sent 5+ days, no contract → Send contract</li>
            <li>Overdue invoice → Send payment link</li>
            <li>Wedding in 7 days → View booking</li>
          </ul>
          <Link to="/" className={styles.smartLink}>View Dashboard →</Link>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Your workflows</h2>
        <p className={styles.sectionDesc}>
          Turn on workflows to get reminders or trigger actions when events happen. You still choose when to send—we just tell you when it’s time.
        </p>
        <ul className={styles.workflowList}>
          {workflows.map((a) => (
            <li
              key={a.id}
              className={styles.workflowCard}
              data-enabled={a.enabled}
            >
              <div className={styles.workflowSwitchWrap}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={a.enabled}
                  aria-label={`${a.name}: ${a.enabled ? 'on' : 'off'}`}
                  className={styles.switch}
                  onClick={() => actions.setAutomationEnabled(a.id, !a.enabled)}
                >
                  <span className={styles.switchKnob} />
                </button>
              </div>
              <div className={styles.workflowMain}>
                <h3 className={styles.workflowName}>{a.name}</h3>
                <p className={styles.workflowDesc}>{a.description}</p>
                <div className={styles.flow}>
                  <span className={styles.flowPill}>{TRIGGER_LABELS[a.trigger]}</span>
                  {a.delayDays != null && (
                    <>
                      <span className={styles.flowWait}>wait {a.delayDays} day{a.delayDays === 1 ? '' : 's'}</span>
                      <span className={styles.flowArrow} aria-hidden>→</span>
                    </>
                  )}
                  {a.delayDays == null && <span className={styles.flowArrow} aria-hidden>→</span>}
                  <span className={styles.flowPill}>{ACTION_LABELS[a.action]}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className={styles.footerNote}>
        Workflow toggles are saved for this session. Email and calendar actions are coming soon—for now, use Dashboard suggestions to know when to act.
      </p>
    </div>
  )
}
