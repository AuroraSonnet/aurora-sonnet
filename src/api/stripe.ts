const API_BASE = '/api'

export async function createCheckoutSession(params: {
  invoiceId: string
  amount: number
  clientEmail?: string
  description?: string
}): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE}/create-checkout-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      invoiceId: params.invoiceId,
      amount: params.amount,
      clientEmail: params.clientEmail || undefined,
      description: params.description || undefined,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to create payment session')
  return data
}

export async function getPaymentStatus(): Promise<Record<string, string>> {
  const res = await fetch(`${API_BASE}/payment-status`)
  if (!res.ok) return {}
  return res.json()
}

export async function getStripeSettings(): Promise<{ configured: boolean }> {
  const res = await fetch(`${API_BASE}/settings/stripe`)
  if (!res.ok) return { configured: false }
  return res.json()
}

export async function saveStripeSettings(params: {
  stripeSecretKey: string
  stripeWebhookSecret?: string
}): Promise<void> {
  const res = await fetch(`${API_BASE}/settings/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to save')
}

export async function confirmPayment(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/confirm-payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Failed to confirm payment')
}
