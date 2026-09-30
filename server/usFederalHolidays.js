/**
 * U.S. federal holidays as observed nationwide (including New York).
 * Used for referral-decision Business Day calculations.
 */

function pad(n) {
  return String(n).padStart(2, '0')
}

function dateKey(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`
}

/** Monday-based nth weekday of month (n=1 first, -1 last). */
function nthWeekdayOfMonth(year, month, weekday, n) {
  if (n > 0) {
    let count = 0
    for (let day = 1; day <= 31; day++) {
      const d = new Date(Date.UTC(year, month - 1, day))
      if (d.getUTCMonth() !== month - 1) break
      if (d.getUTCDay() === weekday) {
        count += 1
        if (count === n) return dateKey(year, month, day)
      }
    }
    return null
  }
  if (n === -1) {
    let last = null
    for (let day = 1; day <= 31; day++) {
      const d = new Date(Date.UTC(year, month - 1, day))
      if (d.getUTCMonth() !== month - 1) break
      if (d.getUTCDay() === weekday) last = dateKey(year, month, day)
    }
    return last
  }
  return null
}

/** Saturday → Friday; Sunday → Monday. */
function observeFixedHoliday(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day))
  const wd = d.getUTCDay()
  if (wd === 6) {
    const prev = new Date(Date.UTC(year, month - 1, day - 1))
    return dateKey(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate())
  }
  if (wd === 0) {
    const next = new Date(Date.UTC(year, month - 1, day + 1))
    return dateKey(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate())
  }
  return dateKey(year, month, day)
}

/** @returns {Set<string>} YYYY-MM-DD observed federal holiday dates */
export function usFederalHolidayDatesForYear(year) {
  const holidays = new Set()
  const add = (d) => {
    if (d) holidays.add(d)
  }
  add(observeFixedHoliday(year, 1, 1))
  add(nthWeekdayOfMonth(year, 1, 1, 3))
  add(nthWeekdayOfMonth(year, 2, 1, 3))
  add(nthWeekdayOfMonth(year, 5, 1, -1))
  add(observeFixedHoliday(year, 6, 19))
  add(observeFixedHoliday(year, 7, 4))
  add(nthWeekdayOfMonth(year, 9, 1, 1))
  add(nthWeekdayOfMonth(year, 10, 1, 2))
  add(observeFixedHoliday(year, 11, 11))
  add(nthWeekdayOfMonth(year, 11, 4, 4))
  add(observeFixedHoliday(year, 12, 25))
  return holidays
}

const cache = new Map()

function holidaysForYear(year) {
  if (!cache.has(year)) cache.set(year, usFederalHolidayDatesForYear(year))
  return cache.get(year)
}

/** True when dateStr (YYYY-MM-DD) is an observed U.S. federal holiday. */
export function isUsFederalHoliday(dateStr) {
  const raw = String(dateStr || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false
  const year = Number(raw.slice(0, 4))
  return holidaysForYear(year).has(raw)
}
