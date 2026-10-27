import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  fetchPartnerAccount,
  fetchPartnerAccounts,
  type PartnerAccountDetail,
  type PartnerAccountSummary,
} from '../api/db'
import styles from './PartnerAccounts.module.css'

function copyWithSelection(value: string) {
  const input = document.createElement('textarea')
  input.value = value
  input.setAttribute('readonly', '')
  input.style.position = 'fixed'
  input.style.left = '-9999px'
  document.body.appendChild(input)
  input.select()
  const ok = document.execCommand('copy')
  input.remove()
  if (!ok) throw new Error('Could not copy')
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await Promise.race([
        navigator.clipboard.writeText(value),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error('clipboard timeout')), 400)
        }),
      ])
      return
    } catch {
      /* fall through */
    }
  }
  copyWithSelection(value)
}

function ReferralLink({ id, link }: { id: string; link: string }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  return (
    <div>
      <div className={styles.linkRow}>
        <input id={id} readOnly value={link} aria-label="Referral link" onFocus={(e) => e.currentTarget.select()} />
        <button
          type="button"
          onClick={() => {
            setCopyError('')
            void copyText(link).then(
              () => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1600)
              },
              () => {
                setCopied(false)
                setCopyError('Could not copy. Select the link and copy it manually.')
              }
            )
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {copyError ? (
        <p className={styles.copyError} role="status">
          {copyError}
        </p>
      ) : null}
    </div>
  )
}

export function PartnerAccountsList() {
  const [accounts, setAccounts] = useState<PartnerAccountSummary[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetchPartnerAccounts()
      .then((rows) => {
        if (!cancelled) setAccounts(rows)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || 'Could not load partner accounts.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Partner Accounts</h1>
        <p className={styles.sub}>Signed referral partners from Refer a Couple and Become a Partner.</p>
      </header>
      {error ? <p className={styles.error}>{error}</p> : null}
      {accounts && accounts.length === 0 ? <p className={styles.empty}>No signed partner accounts yet.</p> : null}
      {accounts && accounts.length > 0 ? (
        <ul className={styles.list}>
          {accounts.map((account) => (
            <li key={account.id}>
              <div className={styles.row}>
                <Link className={styles.name} to={`/partners/accounts/${account.id}`}>
                  {account.partnerName || 'Unnamed partner'}
                </Link>
                <span className={styles.meta}>{account.companyName || '—'}</span>
                <span className={styles.meta}>{account.partnerEmail}</span>
                <span className={styles.status}>
                  {account.accountStatus}
                  <span className={styles.agreement}> · {account.agreementStatus}</span>
                </span>
              </div>
              {account.referralLink ? (
                <ReferralLink id={`link-${account.id}`} link={account.referralLink} />
              ) : (
                <p className={styles.meta}>No referral link</p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function PartnerAccountDetail() {
  const { id = '' } = useParams()
  const [account, setAccount] = useState<PartnerAccountDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setAccount(null)
    setError('')
    fetchPartnerAccount(id)
      .then((row) => {
        if (!cancelled) setAccount(row)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || 'Could not load this account.')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <div className={styles.page}>
      <Link className={styles.back} to="/partners/accounts">
        Back to partner accounts
      </Link>
      {error ? <p className={styles.error}>{error}</p> : null}
      {account ? (
        <>
          <header className={styles.header}>
            <h1>{account.partnerName || 'Partner account'}</h1>
            <p className={styles.sub}>{account.companyName || 'No company on file'}</p>
          </header>
          <dl className={styles.facts}>
            <div>
              <dt>Email</dt>
              <dd>{account.partnerEmail || '—'}</dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>{account.accountStatus}</dd>
            </div>
            <div>
              <dt>Agreement</dt>
              <dd>{account.agreementStatus}</dd>
            </div>
          </dl>
          <section className={styles.section}>
            <h2>Referral link</h2>
            {account.referralLink ? (
              <ReferralLink id="partner-referral-link" link={account.referralLink} />
            ) : (
              <p className={styles.empty}>No referral link on this account.</p>
            )}
          </section>
          <section className={styles.section}>
            <h2>Couple referrals</h2>
            {account.couples.length === 0 ? (
              <p className={styles.empty}>No couple referrals yet.</p>
            ) : (
              <ul className={styles.couples}>
                {account.couples.map((couple) => (
                  <li key={`${couple.reference || couple.couple}`}>
                    <span className={styles.ref}>{couple.reference || '—'}</span>
                    <span>{couple.couple || '—'}</span>
                    <span className={styles.status}>
                      <span>
                        <span>Record</span> {couple.recordStatus}
                      </span>
                      <span>
                        <span>Booking</span> {couple.status}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  )
}
