/** Business-day and America/New_York send-window helpers for outreach scheduling. */

export const OUTREACH_TIMEZONE = 'America/New_York'

export const OUTREACH_SEND_WINDOW_START = { hour: 9, minute: 30 }
export const OUTREACH_SEND_WINDOW_END = { hour: 15, minute: 30 }

/** Business days after anchor for each automated follow-up step. */
export const OUTREACH_FOLLOW_UP_INTERVALS = {
  follow_up_1: 5,
  follow_up_2: 7,
  follow_up_3: 10,
}

const NY_WEEKDAY = new Intl.DateTimeFormat('en-US', {
  timeZone: OUTREACH_TIMEZONE,
  weekday: 'short',
})

const NY_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: OUTREACH_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function partValue(parts, type) {
  const p = parts.find((x) => x.type === type)
  return p ? Number(p.value) : 0
}

/** Calendar + clock in America/New_York for a UTC instant. */
export function nyDateTimeParts(instant) {
  const parts = NY_DATE_PARTS.formatToParts(instant)
  return {
    year: partValue(parts, 'year'),
    month: partValue(parts, 'month'),
    day: partValue(parts, 'day'),
    hour: partValue(parts, 'hour') % 24,
    minute: partValue(parts, 'minute'),
  }
}

/** YYYY-MM-DD for the given instant in America/New_York. */
export function nyBusinessDateString(instant) {
  const { year, month, day } = nyDateTimeParts(instant)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** True when the instant falls on Mon–Fri in America/New_York. */
export function isBusinessDay(instant) {
  const wd = NY_WEEKDAY.format(instant)
  return wd !== 'Sat' && wd !== 'Sun'
}

/** Minutes since midnight for an NY-local hour/minute pair. */
export function minutesSinceMidnight(hour, minute) {
  return hour * 60 + minute
}

const WINDOW_START_MIN = minutesSinceMidnight(
  OUTREACH_SEND_WINDOW_START.hour,
  OUTREACH_SEND_WINDOW_START.minute
)
const WINDOW_END_MIN = minutesSinceMidnight(
  OUTREACH_SEND_WINDOW_END.hour,
  OUTREACH_SEND_WINDOW_END.minute
)

/** True when instant is Mon–Fri and within the configured NY send window (inclusive). */
export function isWithinSendWindow(instant) {
  if (!isBusinessDay(instant)) return false
  const { hour, minute } = nyDateTimeParts(instant)
  const mins = minutesSinceMidnight(hour, minute)
  return mins >= WINDOW_START_MIN && mins <= WINDOW_END_MIN
}

/**
 * Add N business days (Mon–Fri, America/New_York) to a UTC anchor instant.
 * Returns a UTC instant at the same NY-local clock time as the anchor (or midnight if anchor is invalid).
 */
export function addBusinessDays(anchor, days) {
  if (!Number.isFinite(days) || days < 0) {
    throw new RangeError('days must be a non-negative number')
  }
  if (days === 0) return new Date(anchor)

  let cursor = new Date(anchor)
  let remaining = days
  while (remaining > 0) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
    if (isBusinessDay(cursor)) remaining -= 1
  }
  return cursor
}

/** Resolve a UTC instant for a specific NY-local calendar date and clock time (handles DST). */
export function instantAtNyLocal(year, month, day, hour, minute) {
  const base = Date.UTC(year, month - 1, day, 5, 0, 0)
  for (let offsetMin = -12 * 60; offsetMin <= 36 * 60; offsetMin += 1) {
    const candidate = new Date(base + offsetMin * 60_000)
    const p = nyDateTimeParts(candidate)
    if (
      p.year === year &&
      p.month === month &&
      p.day === day &&
      p.hour === hour &&
      p.minute === minute
    ) {
      return candidate
    }
  }
  throw new RangeError(
    `Could not resolve America/New_York instant for ${year}-${month}-${day} ${hour}:${minute}`
  )
}

/**
 * Pick a pseudo-random send time on the NY business date of `businessDayInstant`,
 * between OUTREACH_SEND_WINDOW_START and OUTREACH_SEND_WINDOW_END (inclusive).
 * `rng` must return a float in [0, 1).
 */
export function randomSendInstantOnBusinessDay(businessDayInstant, rng = Math.random) {
  if (!isBusinessDay(businessDayInstant)) {
    throw new RangeError('businessDayInstant must fall on a business day in America/New_York')
  }
  const { year, month, day } = nyDateTimeParts(businessDayInstant)
  const span = WINDOW_END_MIN - WINDOW_START_MIN
  const offset = Math.floor(rng() * (span + 1))
  const pick = WINDOW_START_MIN + offset
  const hour = Math.floor(pick / 60)
  const minute = pick % 60
  return instantAtNyLocal(year, month, day, hour, minute)
}

/**
 * Schedule a follow-up send: anchor + N business days, then random slot in the NY send window.
 * Returns ISO-8601 UTC string suitable for `outreach_scheduled_sends.scheduledAt`.
 */
export function scheduleFollowUpAt(anchor, businessDays, rng = Math.random) {
  const day = addBusinessDays(anchor, businessDays)
  const sendAt = randomSendInstantOnBusinessDay(day, rng)
  return sendAt.toISOString()
}

/** Defer a send to the next NY business day with a random slot in the send window. */
export function deferSendToNextBusinessDay(fromInstant, rng = Math.random) {
  const nextDay = addBusinessDays(fromInstant, 1)
  return randomSendInstantOnBusinessDay(nextDay, rng).toISOString()
}

/** Next valid send instant at or after `instant` (rolls to next business day if needed). */
export function nextValidSendInstant(instant, rng = Math.random) {
  let cursor = new Date(instant)
  for (let i = 0; i < 14; i += 1) {
    if (isBusinessDay(cursor)) {
      const { year, month, day, hour, minute } = nyDateTimeParts(cursor)
      const mins = minutesSinceMidnight(hour, minute)
      if (mins <= WINDOW_END_MIN) {
        if (mins < WINDOW_START_MIN) {
          return instantAtNyLocal(year, month, day, OUTREACH_SEND_WINDOW_START.hour, OUTREACH_SEND_WINDOW_START.minute)
        }
        if (mins <= WINDOW_END_MIN) return new Date(cursor)
        return randomSendInstantOnBusinessDay(cursor, rng)
      }
    }
    const { year, month, day } = nyDateTimeParts(cursor)
    const nextDay = instantAtNyLocal(year, month, day, 12, 0)
    cursor = new Date(nextDay.getTime() + 24 * 60 * 60 * 1000)
  }
  throw new RangeError('Could not find next valid send instant within 14 days')
}
