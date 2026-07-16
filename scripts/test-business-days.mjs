import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  OUTREACH_FOLLOW_UP_INTERVALS,
  OUTREACH_SEND_WINDOW_END,
  OUTREACH_SEND_WINDOW_START,
  OUTREACH_TIMEZONE,
  addBusinessDays,
  instantAtNyLocal,
  isBusinessDay,
  isWithinSendWindow,
  minutesSinceMidnight,
  nyBusinessDateString,
  nyDateTimeParts,
  randomSendInstantOnBusinessDay,
  scheduleFollowUpAt,
} from '../server/businessDays.js'

/** Monday 2025-01-06 10:00 America/New_York (EST, UTC-5). */
const MON_JAN_6_10AM_NY = instantAtNyLocal(2025, 1, 6, 10, 0)

/** Friday 2025-01-10 14:00 America/New_York. */
const FRI_JAN_10_2PM_NY = instantAtNyLocal(2025, 1, 10, 14, 0)

/** Saturday 2025-01-11 noon America/New_York. */
const SAT_JAN_11_NOON_NY = instantAtNyLocal(2025, 1, 11, 12, 0)

test('constants match approved outreach architecture', () => {
  assert.equal(OUTREACH_TIMEZONE, 'America/New_York')
  assert.deepEqual(OUTREACH_SEND_WINDOW_START, { hour: 9, minute: 30 })
  assert.deepEqual(OUTREACH_SEND_WINDOW_END, { hour: 15, minute: 30 })
  assert.deepEqual(OUTREACH_FOLLOW_UP_INTERVALS, {
    follow_up_1: 5,
    follow_up_2: 7,
    follow_up_3: 10,
  })
})

test('nyDateTimeParts resolves America/New_York local time', () => {
  const p = nyDateTimeParts(MON_JAN_6_10AM_NY)
  assert.equal(p.year, 2025)
  assert.equal(p.month, 1)
  assert.equal(p.day, 6)
  assert.equal(p.hour, 10)
  assert.equal(p.minute, 0)
})

test('isBusinessDay skips weekends in America/New_York', () => {
  assert.equal(isBusinessDay(MON_JAN_6_10AM_NY), true)
  assert.equal(isBusinessDay(FRI_JAN_10_2PM_NY), true)
  assert.equal(isBusinessDay(SAT_JAN_11_NOON_NY), false)
})

test('addBusinessDays(Mon, 5) lands on the following Monday', () => {
  const result = addBusinessDays(MON_JAN_6_10AM_NY, 5)
  assert.equal(nyBusinessDateString(result), '2025-01-13')
  assert.equal(isBusinessDay(result), true)
})

test('addBusinessDays(Fri, 1) skips the weekend', () => {
  const result = addBusinessDays(FRI_JAN_10_2PM_NY, 1)
  assert.equal(nyBusinessDateString(result), '2025-01-13')
})

test('addBusinessDays(Fri, 5) counts only weekdays', () => {
  const result = addBusinessDays(FRI_JAN_10_2PM_NY, 5)
  assert.equal(nyBusinessDateString(result), '2025-01-17')
})

test('addBusinessDays(anchor, 0) returns the same instant', () => {
  const copy = addBusinessDays(MON_JAN_6_10AM_NY, 0)
  assert.equal(copy.getTime(), MON_JAN_6_10AM_NY.getTime())
})

test('isWithinSendWindow accepts Mon–Fri 09:30–15:30 America/New_York', () => {
  const at930 = instantAtNyLocal(2025, 1, 6, 9, 30)
  const at1530 = instantAtNyLocal(2025, 1, 6, 15, 30)
  const at929 = instantAtNyLocal(2025, 1, 6, 9, 29)
  const at1531 = instantAtNyLocal(2025, 1, 6, 15, 31)
  const satNoon = SAT_JAN_11_NOON_NY

  assert.equal(isWithinSendWindow(at930), true)
  assert.equal(isWithinSendWindow(at1530), true)
  assert.equal(isWithinSendWindow(at929), false)
  assert.equal(isWithinSendWindow(at1531), false)
  assert.equal(isWithinSendWindow(satNoon), false)
})

test('randomSendInstantOnBusinessDay stays inside the NY send window', () => {
  const rng = () => 0
  const earliest = randomSendInstantOnBusinessDay(MON_JAN_6_10AM_NY, rng)
  const p = nyDateTimeParts(earliest)
  assert.equal(p.hour, 9)
  assert.equal(p.minute, 30)

  const rngLate = () => 0.999
  const latest = randomSendInstantOnBusinessDay(MON_JAN_6_10AM_NY, rngLate)
  const lp = nyDateTimeParts(latest)
  assert.equal(
    minutesSinceMidnight(lp.hour, lp.minute),
    minutesSinceMidnight(OUTREACH_SEND_WINDOW_END.hour, OUTREACH_SEND_WINDOW_END.minute)
  )
})

test('randomSendInstantOnBusinessDay rejects weekends', () => {
  assert.throws(
    () => randomSendInstantOnBusinessDay(SAT_JAN_11_NOON_NY, () => 0.5),
    /business day/
  )
})

test('scheduleFollowUpAt returns ISO UTC within window after business days', () => {
  const iso = scheduleFollowUpAt(MON_JAN_6_10AM_NY, OUTREACH_FOLLOW_UP_INTERVALS.follow_up_1, () => 0.5)
  const instant = new Date(iso)
  assert.equal(nyBusinessDateString(instant), '2025-01-13')
  assert.equal(isWithinSendWindow(instant), true)
  assert.match(iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
})

test('instantAtNyLocal handles DST spring-forward day', () => {
  // 2025-03-10 is Monday after US spring forward (2am → 3am)
  const morning = instantAtNyLocal(2025, 3, 10, 10, 0)
  const p = nyDateTimeParts(morning)
  assert.equal(p.hour, 10)
  assert.equal(isWithinSendWindow(morning), true)
})
