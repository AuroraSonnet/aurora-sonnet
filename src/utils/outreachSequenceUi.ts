export function formatOutreachDateTime(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

export function formatOutreachDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function sequenceStatusTone(status: string): 'running' | 'paused' | 'stopped' | 'completed' | 'neutral' {
  if (status === 'running') return 'running'
  if (status === 'paused') return 'paused'
  if (status === 'stopped') return 'stopped'
  if (status === 'completed') return 'completed'
  return 'neutral'
}
