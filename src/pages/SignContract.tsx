import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { apiSignContractClient, getContractFileUrl } from '../api/db'
import SignaturePad from '../components/SignaturePad'
import styles from './SignContract.module.css'

export default function SignContract() {
  const { contractId } = useParams<{ contractId: string }>()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [info, setInfo] = useState<{
    title: string
    clientName: string
    awaiting: 'client' | 'vendor'
    message: string
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [signed, setSigned] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const signatureSectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!contractId || !token) {
      setError('Invalid signing link')
      setLoading(false)
      return
    }
    fetch(`/api/contracts/${contractId}/sign-info?token=${encodeURIComponent(token)}`)
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || data.error) throw new Error(data?.error || 'Invalid or expired signing link')
        setInfo(data)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [contractId, token])

  useEffect(() => {
    if (info?.awaiting === 'client') signatureSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [info?.awaiting])

  const handleSign = async (dataUrl: string) => {
    if (!contractId || !token || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await apiSignContractClient(contractId, token, dataUrl)
      setSigned(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && !info) {
    return (
      <div className={styles.page}>
        <p>Loading…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1>Signing link invalid</h1>
          <p className={styles.error}>{error}</p>
        </div>
      </div>
    )
  }

  if (signed || (info && info.awaiting === 'vendor')) {
    const downloadUrl = contractId && token ? getContractFileUrl(contractId, token) : null
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1>Thank you</h1>
          <p className={styles.success}>
            {signed
              ? 'You have signed the contract. Aurora Sonnet will sign and the contract will be complete shortly.'
              : 'You have already signed. Aurora Sonnet will add their signature to complete the contract.'}
          </p>
          {downloadUrl && (
            <p className={styles.downloadWrap}>
              <a href={downloadUrl} download className={styles.downloadLink}>
                Download your copy
              </a>
            </p>
          )}
        </div>
      </div>
    )
  }

  if (!info || info.awaiting !== 'client') {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1>Signing link invalid</h1>
          <p className={styles.error}>This link may have expired or is not valid.</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <h1>Sign contract</h1>
        <p className={styles.subtitle}>{info.title}</p>
        <p className={styles.hint}>{info.clientName}, please sign below.</p>
        <div className={styles.pdfWrap}>
          <iframe
            title="Contract PDF"
            src={getContractFileUrl(contractId!, token ?? undefined)}
            className={styles.pdfIframe}
          />
        </div>
        <div ref={signatureSectionRef} className={styles.signatureSection}>
          <label className={styles.agreeLabel}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              aria-describedby="agree-desc"
            />
            <span id="agree-desc">I have read and agree to the contract.</span>
          </label>
          <SignaturePad label="Your signature" onCapture={handleSign} disabled={submitting || !agreed} />
        </div>
      </div>
    </div>
  )
}
