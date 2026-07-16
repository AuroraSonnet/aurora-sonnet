const SECRET_KEY_RE = /pass|secret|token|authorization/i

function scrubValue(key, value) {
  if (value == null) return value
  if (SECRET_KEY_RE.test(String(key))) return '[redacted]'
  if (typeof value === 'string' && value.length > 500) return `${value.slice(0, 500)}…`
  return value
}

function scrubFields(fields) {
  const out = {}
  for (const [key, value] of Object.entries(fields || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = scrubFields(value)
    } else {
      out[key] = scrubValue(key, value)
    }
  }
  return out
}

/** Structured JSON log line for outreach automation (Render-friendly). */
export function logOutreach(event, fields = {}, { level = 'info' } = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    subsystem: 'outreach',
    event,
    ...scrubFields(fields),
  }
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
  return entry
}

export function getOutreachSendMode() {
  if (process.env.OUTREACH_ALLOW_PRODUCTION_SENDS === 'true') return 'production'
  if (process.env.OUTREACH_TEST_EMAIL || process.env.OUTREACH_AUTOMATED_TO_OVERRIDE) return 'test'
  return 'blocked'
}
