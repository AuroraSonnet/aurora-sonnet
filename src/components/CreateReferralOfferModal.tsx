import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  apiApproveReferralAgreementOwner,
  apiCreateReferralOffer,
  apiGetReferralOrganizationSettings,
  apiRecordReferralExternalCounselReview,
  apiRejectReferralAgreementLegal,
  apiUpdateReferralOrganizationSettings,
  apiUpdateReferralPartnershipAgreement,
  apiUploadReferralAgreementSignedPdf,
  referralAgreementPdfUrl,
  type AuroraOrganizationSettings,
  type ReferralPartnershipAgreement,
  type Venue,
  type VenueContact,
} from '../api/db'
import { useAuth } from '../context/AuthContext'
import { useApp } from '../context/AppContext'
import styles from './CreateReferralOfferModal.module.css'

const DEFAULT_TERMS_SUMMARY = [
  '10% of performance-service subtotal actually received and retained (no minimum payout)',
  'Example: $500 qualifying subtotal → $50 commission',
  'Excludes taxes, travel, lodging, rentals, gratuities, payment processing fees, refunded amounts',
  'Aurora Sonnet internal and performer costs do not reduce the commission base',
  'Same-event scope only · 12-month attribution · 5-business-day referral acceptance',
  'Payee: venue/business legal entity only — never an individual',
  'Tax documentation (W-9) required before commission is issued — not required to sign or activate',
]

const ECONOMICS_NOTE =
  'New agreements: exactly 10% with no minimum. Legacy referrals (pre-agreement): 5% with a $100 minimum. The new rule pays less below a $1,000 commissionable subtotal, the same at $1,000, and more above $1,000. Historical referrals are unchanged.'

type Props = {
  venue: Venue
  contacts: VenueContact[]
  primaryContactId?: string
  existingAgreement?: ReferralPartnershipAgreement | null
  onClose: () => void
  onSaved: () => void
  onToast: (msg: string) => void
}

export default function CreateReferralOfferModal({
  venue,
  contacts,
  primaryContactId,
  existingAgreement,
  onClose,
  onSaved,
  onToast,
}: Props) {
  const { canRecordReferralOwnerApproval } = useAuth()
  const { state } = useApp()

  const primary =
    contacts.find((c) => c.id === primaryContactId) ||
    contacts.find((c) => c.isDecisionMaker) ||
    contacts[0] ||
    null

  const [signatoryContactId, setSignatoryContactId] = useState(primary?.id || '')
  const [signatoryName, setSignatoryName] = useState(primary?.name || '')
  const [signatoryTitle, setSignatoryTitle] = useState(primary?.jobTitle || '')
  const [contentHtml, setContentHtml] = useState('')
  const [agreement, setAgreement] = useState<ReferralPartnershipAgreement | null>(existingAgreement ?? null)
  const [status, setStatus] = useState(existingAgreement?.status || 'draft')
  const [partnerSignerName, setPartnerSignerName] = useState(existingAgreement?.partnerSignerName || '')
  const [partnerSignerTitle, setPartnerSignerTitle] = useState(existingAgreement?.partnerSignerTitle || '')
  const [partnerSignedDate, setPartnerSignedDate] = useState(existingAgreement?.partnerSignedDate || '')
  const [agencySignerName, setAgencySignerName] = useState(existingAgreement?.agencySignerName || '')
  const [agencySignedDate, setAgencySignedDate] = useState(existingAgreement?.agencySignedDate || '')
  const [ownerApprovalNotes, setOwnerApprovalNotes] = useState('')
  const [externalCounselName, setExternalCounselName] = useState('')
  const [externalCounselNotes, setExternalCounselNotes] = useState('')
  const [rejectionNotes, setRejectionNotes] = useState('')
  const [org, setOrg] = useState<AuroraOrganizationSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ownerApproved =
    agreement?.legalApprovalStatus === 'owner_approved' || agreement?.legalApprovalStatus === 'approved'
  const legalRejected = agreement?.legalApprovalStatus === 'rejected'
  const readOnly = legalRejected

  const partnership = useMemo(
    () => (state.referralPartnerships ?? []).find((p) => p.venueId === venue.id) ?? null,
    [state.referralPartnerships, venue.id]
  )

  const agreementHistory = useMemo(() => {
    if (!partnership) return []
    return [...(state.referralPartnershipAgreements ?? [])]
      .filter((a) => a.partnershipId === partnership.id)
      .sort((a, b) => (b.version || 0) - (a.version || 0))
  }, [partnership, state.referralPartnershipAgreements])

  useEffect(() => {
    void apiGetReferralOrganizationSettings().then((r) => {
      if (r.ok) setOrg(r.data.organization)
    })
  }, [])

  useEffect(() => {
    const c = contacts.find((x) => x.id === signatoryContactId)
    if (c) {
      setSignatoryName(c.name || '')
      setSignatoryTitle(c.jobTitle || '')
    }
  }, [signatoryContactId, contacts])

  useEffect(() => {
    if (org && !agencySignerName) {
      setAgencySignerName(org.signatoryName || '')
    }
  }, [org, agencySignerName])

  const pdfUrl = useMemo(
    () => (agreement?.id ? referralAgreementPdfUrl(agreement.id, 'generated') : null),
    [agreement?.id]
  )

  const handleSaveOrg = useCallback(async () => {
    if (!org) return
    setBusy(true)
    setError(null)
    try {
      const result = await apiUpdateReferralOrganizationSettings(org)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOrg(result.data.organization)
      onToast('Aurora Sonnet organization settings saved.')
    } finally {
      setBusy(false)
    }
  }, [org, onToast])

  const handleCreate = useCallback(async () => {
    setError(null)
    setBusy(true)
    try {
      const result = await apiCreateReferralOffer({
        venueId: venue.id,
        primaryContactId: primary?.id,
        authorizedSignatoryContactId: signatoryContactId || primary?.id,
        signatoryName,
        signatoryTitle,
        contentHtml: contentHtml.trim() || undefined,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setAgreement(result.data.agreement)
      setContentHtml(result.data.agreement.contentHtml || '')
      setStatus(result.data.agreement.status)
      onToast(result.data.reusedDraft ? 'Opened existing draft offer.' : 'Referral offer prepared (not sent).')
      onSaved()
    } finally {
      setBusy(false)
    }
  }, [venue.id, primary?.id, signatoryContactId, signatoryName, signatoryTitle, contentHtml, onSaved, onToast])

  const handleSave = useCallback(async () => {
    if (!agreement) {
      await handleCreate()
      return
    }
    if (readOnly) return
    setError(null)
    setBusy(true)
    try {
      const result = await apiUpdateReferralPartnershipAgreement(agreement.id, {
        status,
        contentHtml,
        signatoryName,
        signatoryTitle,
        authorizedSignatoryContactId: signatoryContactId || null,
        partnerSignerName,
        partnerSignerTitle,
        partnerSignedDate: partnerSignedDate || null,
        agencySignerName,
        agencySignedDate: agencySignedDate || null,
        regeneratePdf: true,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setAgreement(result.data)
      onToast('Offer saved.')
      onSaved()
    } finally {
      setBusy(false)
    }
  }, [
    agreement,
    handleCreate,
    readOnly,
    status,
    contentHtml,
    signatoryName,
    signatoryTitle,
    signatoryContactId,
    partnerSignerName,
    partnerSignerTitle,
    partnerSignedDate,
    agencySignerName,
    agencySignedDate,
    onSaved,
    onToast,
  ])

  const handleOwnerApproval = useCallback(async () => {
    if (!agreement || !canRecordReferralOwnerApproval) return
    setBusy(true)
    setError(null)
    try {
      const result = await apiApproveReferralAgreementOwner(agreement.id, {
        notes: ownerApprovalNotes.trim() || undefined,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setAgreement(result.data)
      onToast(`Owner Approval recorded for ${result.data.agreementVersionIdentifier || `v${result.data.version}`}.`)
      onSaved()
    } finally {
      setBusy(false)
    }
  }, [agreement, canRecordReferralOwnerApproval, ownerApprovalNotes, onSaved, onToast])

  const handleExternalCounselReview = useCallback(async () => {
    if (!agreement || !canRecordReferralOwnerApproval) return
    if (!externalCounselName.trim()) {
      setError('External counsel / reviewer name is required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await apiRecordReferralExternalCounselReview(agreement.id, {
        reviewerName: externalCounselName.trim(),
        notes: externalCounselNotes.trim() || undefined,
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setAgreement(result.data)
      onToast(`External counsel review recorded for ${result.data.agreementVersionIdentifier || `v${result.data.version}`}.`)
      onSaved()
    } finally {
      setBusy(false)
    }
  }, [agreement, canRecordReferralOwnerApproval, externalCounselName, externalCounselNotes, onSaved, onToast])

  const handleLegalRejection = useCallback(async () => {
    if (!agreement || !canRecordReferralOwnerApproval) return
    if (!rejectionNotes.trim()) {
      setError('Rejection notes are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await apiRejectReferralAgreementLegal(agreement.id, rejectionNotes.trim())
      if (!result.ok) {
        setError(result.error)
        return
      }
      setAgreement(result.data)
      onToast(`Version ${result.data.agreementVersionIdentifier} rejected. Create a new version to revise.`)
      onSaved()
    } finally {
      setBusy(false)
    }
  }, [agreement, canRecordReferralOwnerApproval, rejectionNotes, onSaved, onToast])

  const handleUploadSigned = useCallback(
    async (file: File) => {
      if (!agreement || readOnly) return
      setBusy(true)
      setError(null)
      try {
        const buf = await file.arrayBuffer()
        const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)))
        const result = await apiUploadReferralAgreementSignedPdf(agreement.id, {
          pdfBase64,
          partnerSignerName,
          partnerSignerTitle,
          partnerSignedDate,
          agencySignerName,
          agencySignedDate,
          status: status === 'fully_executed' ? 'fully_executed' : 'under_review',
        })
        if (!result.ok) {
          setError(result.error)
          return
        }
        setAgreement(result.agreement)
        setStatus(result.agreement.status)
        onToast('Signed PDF uploaded.')
        onSaved()
      } finally {
        setBusy(false)
      }
    },
    [
      agreement,
      readOnly,
      partnerSignerName,
      partnerSignerTitle,
      partnerSignedDate,
      agencySignerName,
      agencySignedDate,
      status,
      onSaved,
      onToast,
    ]
  )

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Create referral offer">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <div>
            <h2>Create Referral Offer</h2>
            <p className={styles.sub}>{venue.companyName} · manual only — nothing is sent automatically</p>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        {agreement?.status === 'draft' ? (
          <p className={styles.legalBanner}>DRAFT — NOT FOR SIGNATURE</p>
        ) : null}

        <section className={styles.section}>
          <h3>Aurora Sonnet organization (legal entity on agreement)</h3>
          {org ? (
            <div className={styles.grid}>
              <label>
                Legal name
                <input className={styles.input} value={org.legalName} onChange={(e) => setOrg({ ...org, legalName: e.target.value })} />
              </label>
              <label>
                Business mailing address
                <input
                  className={styles.input}
                  value={org.legalAddress}
                  onChange={(e) => setOrg({ ...org, legalAddress: e.target.value })}
                  placeholder="Business mailing address (not a personal home address)"
                />
              </label>
              <label>
                Authorized signatory
                <input className={styles.input} value={org.signatoryName} onChange={(e) => setOrg({ ...org, signatoryName: e.target.value })} />
              </label>
              <label>
                Signatory title
                <input className={styles.input} value={org.signatoryTitle} onChange={(e) => setOrg({ ...org, signatoryTitle: e.target.value })} />
              </label>
              <label>
                Notice email
                <input className={styles.input} type="email" value={org.noticeEmail} onChange={(e) => setOrg({ ...org, noticeEmail: e.target.value })} />
              </label>
            </div>
          ) : (
            <p className={styles.hint}>Loading organization settings…</p>
          )}
          <button type="button" className={styles.secondaryBtn} disabled={busy || !org} onClick={() => void handleSaveOrg()}>
            Save organization settings
          </button>
          <p className={styles.hint}>
            Send, Fully Executed, and partnership activation are blocked while Aurora Sonnet or partner legal names, addresses, or signatories are blank or contain placeholders.
          </p>
        </section>

        <section className={styles.section}>
          <h3>Partner authorized signatory</h3>
          <div className={styles.grid}>
            <label>
              Contact
              <select
                className={styles.input}
                value={signatoryContactId}
                onChange={(e) => setSignatoryContactId(e.target.value)}
                disabled={readOnly}
              >
                <option value="">Select contact…</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.email || c.id}
                    {c.jobTitle ? ` · ${c.jobTitle}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Signatory name
              <input className={styles.input} value={signatoryName} onChange={(e) => setSignatoryName(e.target.value)} disabled={readOnly} />
            </label>
            <label>
              Title
              <input className={styles.input} value={signatoryTitle} onChange={(e) => setSignatoryTitle(e.target.value)} disabled={readOnly} />
            </label>
          </div>
        </section>

        <section className={styles.section}>
          <h3>Default commercial terms</h3>
          <ul className={styles.termsList}>
            {DEFAULT_TERMS_SUMMARY.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <p className={styles.hint}>{ECONOMICS_NOTE}</p>
        </section>

        <section className={styles.section}>
          <h3>Offer document (editable)</h3>
          <textarea
            className={styles.textarea}
            rows={12}
            value={contentHtml}
            onChange={(e) => setContentHtml(e.target.value)}
            disabled={readOnly}
            placeholder="Prepare offer text here. Leave blank to use the default draft template on create."
          />
        </section>

        {agreementHistory.length > 0 ? (
          <section className={styles.section}>
            <h3>Agreement version history</h3>
            <ul className={styles.termsList}>
              {agreementHistory.map((a) => (
                <li key={a.id}>
                  {a.agreementVersionIdentifier || `v${a.version}`} · {a.status.replace(/_/g, ' ')} · owner:{' '}
                  {a.legalApprovalStatus || 'pending'}
                  {a.id === agreement?.id ? ' (current)' : ''}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {agreement ? (
          <section className={styles.section}>
            <h3>
              Agreement {agreement.agreementVersionIdentifier || `v${agreement.version}`} · {agreement.status.replace(/_/g, ' ')}
            </h3>
            <p className={styles.legalStatus}>
              Owner Approval: <strong>{ownerApproved ? 'owner_approved' : agreement.legalApprovalStatus || 'pending'}</strong>
              {agreement.legalApprovedAt ? ` · ${agreement.legalApprovedAt.slice(0, 10)}` : ''}
              {agreement.legalRejectedAt ? ` · rejected ${agreement.legalRejectedAt.slice(0, 10)}` : ''}
              {agreement.legalRecordedByUsername ? ` · recorded by ${agreement.legalRecordedByUsername}` : ''}
              {agreement.externalCounselReviewerName
                ? ` · external counsel: ${agreement.externalCounselReviewerName}${agreement.externalCounselReviewedAt ? ` (${agreement.externalCounselReviewedAt.slice(0, 10)})` : ''}`
                : ''}
            </p>
            {legalRejected && agreement.legalRejectionNotes ? (
              <p className={styles.hint}>Rejection notes: {agreement.legalRejectionNotes}</p>
            ) : null}

            {!ownerApproved && !legalRejected && canRecordReferralOwnerApproval ? (
              <div className={styles.legalBlock}>
                <label>
                  Owner Approval notes (optional)
                  <input className={styles.input} value={ownerApprovalNotes} onChange={(e) => setOwnerApprovalNotes(e.target.value)} />
                </label>
                <button type="button" className={styles.secondaryBtn} disabled={busy} onClick={() => void handleOwnerApproval()}>
                  Record Owner Approval
                </button>
                <label>
                  External counsel / reviewer name (optional)
                  <input className={styles.input} value={externalCounselName} onChange={(e) => setExternalCounselName(e.target.value)} />
                </label>
                <label>
                  External counsel notes (optional)
                  <input className={styles.input} value={externalCounselNotes} onChange={(e) => setExternalCounselNotes(e.target.value)} />
                </label>
                <button type="button" className={styles.secondaryBtn} disabled={busy} onClick={() => void handleExternalCounselReview()}>
                  Record external counsel review
                </button>
                <label>
                  Rejection notes (required to reject)
                  <input className={styles.input} value={rejectionNotes} onChange={(e) => setRejectionNotes(e.target.value)} />
                </label>
                <button type="button" className={styles.secondaryBtn} disabled={busy} onClick={() => void handleLegalRejection()}>
                  Reject version
                </button>
                <p className={styles.hint}>
                  Owner Approval is required before send, execution, or activation. External counsel review is optional and does not gate those steps.
                </p>
              </div>
            ) : null}

            {!canRecordReferralOwnerApproval && !ownerApproved && !legalRejected ? (
              <p className={styles.hint}>Owner Approval must be recorded by an authorized owner/admin before this version can be sent or executed.</p>
            ) : null}

            <div className={styles.grid}>
              <label>
                Status
                <select
                  className={styles.input}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                  disabled={readOnly}
                >
                  <option value="draft">Draft</option>
                  <option value="sent" disabled={!ownerApproved}>
                    Sent{!ownerApproved ? ' (Owner Approval + complete party info required)' : ''}
                  </option>
                  <option value="under_review">Under Review</option>
                  <option value="fully_executed" disabled={!ownerApproved}>
                    Fully Executed{!ownerApproved ? ' (Owner Approval + complete party info required)' : ''}
                  </option>
                </select>
              </label>
            </div>
            {pdfUrl ? (
              <p>
                <a className={styles.link} href={pdfUrl} target="_blank" rel="noreferrer">
                  Download generated PDF{agreement.status === 'draft' ? ' (draft)' : ''}
                </a>
              </p>
            ) : null}
            {!readOnly ? (
              <>
                <h4>External signatures (record after off-line signing)</h4>
                <div className={styles.grid}>
                  <label>
                    Partner signer
                    <input className={styles.input} value={partnerSignerName} onChange={(e) => setPartnerSignerName(e.target.value)} />
                  </label>
                  <label>
                    Partner title
                    <input className={styles.input} value={partnerSignerTitle} onChange={(e) => setPartnerSignerTitle(e.target.value)} />
                  </label>
                  <label>
                    Partner signed date
                    <input className={styles.input} type="date" value={partnerSignedDate} onChange={(e) => setPartnerSignedDate(e.target.value)} />
                  </label>
                  <label>
                    Agency signer
                    <input className={styles.input} value={agencySignerName} onChange={(e) => setAgencySignerName(e.target.value)} />
                  </label>
                  <label>
                    Agency signed date
                    <input className={styles.input} type="date" value={agencySignedDate} onChange={(e) => setAgencySignedDate(e.target.value)} />
                  </label>
                </div>
                <label className={styles.fileLabel}>
                  Upload externally signed PDF
                  <input
                    type="file"
                    accept="application/pdf"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void handleUploadSigned(f)
                    }}
                  />
                </label>
              </>
            ) : null}
          </section>
        ) : null}

        <footer className={styles.footer}>
          <button type="button" className={styles.secondaryBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {!agreement ? (
            <button type="button" className={styles.primaryBtn} onClick={() => void handleCreate()} disabled={busy}>
              {busy ? 'Preparing…' : 'Prepare offer'}
            </button>
          ) : (
            <button type="button" className={styles.primaryBtn} onClick={() => void handleSave()} disabled={busy || readOnly}>
              {busy ? 'Saving…' : 'Save offer'}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
