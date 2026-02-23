import { useState, useEffect } from 'react'
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
  const [error, setError] = useState<string | null>(null)
  const [signed, setSigned] = useState(false)

  useEffect(() => {
    if (!contractId || !token) {
      setError('Invalid signing link')
      setLoading(false)
      return
    }
    fetch(`/api/contracts/${contractId}/sign-info?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error)
        setInfo(data)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [contractId, token])

  const handleSign = async (dataUrl: string) => {
    if (!contractId || !token) return
    setLoading(true)
    setError(null)
    try {
      await apiSignContractClient(contractId, token, dataUrl)
      setSigned(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign')
    } finally {
      setLoading(false)
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
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1>Thank you</h1>
          <p className={styles.success}>
            {signed
              ? 'You have signed the contract. Aurora Sonnet will sign and the contract will be complete shortly.'
              : 'You have already signed. Aurora Sonnet will add their signature to complete the contract.'}
          </p>
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
            src={getContractFileUrl(contractId!)}
            className={styles.pdfIframe}
          />
        </div>
        <SignaturePad label="Your signature" onCapture={handleSign} />
      </div>
    </div>
  )
}
