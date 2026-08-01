/**
 * Computed Outreach Scoreboard — pure aggregation over visits/debriefs/emails/referrals for a date
 * range. No new source-of-truth tables: every number here is derived, so it can never drift from
 * the underlying visit/email/referral records.
 */
import {
  getDailyVisitTarget,
  listSentPostVisitSendsInRange,
  listVenueReferralsInRange,
  listVenues,
  listVisitDebriefsForVisitIds,
  listVisitsInRange,
} from './db.js'
import { isBusinessDay } from './businessDays.js'
import { VISIT_OUTCOMES, VENUE_STAGES } from './venuePipeline.js'
import { referralStatusEligibleForBookingPayout } from './partnerReferralPayout.js'

function countBusinessDaysInRange(startDate, endDate) {
  let count = 0
  let cursor = new Date(`${startDate}T12:00:00Z`)
  const end = new Date(`${endDate}T12:00:00Z`)
  while (cursor <= end) {
    if (isBusinessDay(cursor)) count += 1
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
  }
  return count
}

/** Pure function — takes already-fetched rows so it stays trivially unit-testable. */
export function computeOutreachScoreboard({
  startDate,
  endDate,
  dailyVisitTarget,
  visits,
  debriefsByVisitId,
  venues,
  sentPostVisitSends,
  referrals,
}) {
  const businessDays = countBusinessDaysInRange(startDate, endDate)
  const targetTotal = businessDays * dailyVisitTarget

  const planned = visits.length
  const completed = visits.filter((v) => v.status === 'completed').length
  const skipped = visits.filter((v) => v.status === 'skipped' || v.status === 'cancelled').length

  const outcomeCounts = {}
  for (const outcome of VISIT_OUTCOMES) outcomeCounts[outcome] = 0
  let confidenceSum = 0
  let confidenceCount = 0
  let sameDayEmailsSent = 0
  let sequencesStarted = 0
  for (const visit of visits) {
    if (visit.sameDayEmailSentAt) sameDayEmailsSent += 1
    if (visit.sequenceStartedAt) sequencesStarted += 1
    const debrief = debriefsByVisitId[visit.id]
    if (!debrief) continue
    for (const outcome of debrief.outcomes || []) {
      if (outcome in outcomeCounts) outcomeCounts[outcome] += 1
    }
    if (typeof debrief.partnershipConfidenceScore === 'number') {
      confidenceSum += debrief.partnershipConfidenceScore
      confidenceCount += 1
    }
  }

  const followUpsSent = sentPostVisitSends.length
  const followUpsByStep = { follow_up_1: 0, follow_up_2: 0, follow_up_3: 0 }
  for (const send of sentPostVisitSends) {
    if (send.step in followUpsByStep) followUpsByStep[send.step] += 1
  }

  const stageCounts = {}
  for (const stage of VENUE_STAGES) stageCounts[stage] = 0
  for (const venue of venues) {
    if (venue.stage in stageCounts) stageCounts[venue.stage] += 1
  }
  const strongVenueCount = stageCounts.referral_partner + stageCounts.preferred_partner
  const meetingsOrShowcases = stageCounts.meeting_scheduled + stageCounts.showcase_scheduled

  const referralsReceived = referrals.length
  const referralsBooked = referrals.filter((r) => referralStatusEligibleForBookingPayout(r.referralStatus)).length
  const referralBookingAmountTotal = referrals.reduce((sum, r) => sum + (r.bookingAmount || 0), 0)

  const rate = (num, denom) => (denom > 0 ? Math.round((num / denom) * 1000) / 10 : 0)

  return {
    range: { startDate, endDate, businessDays },
    dailyVisitTarget,
    visits: {
      planned,
      completed,
      skipped,
      targetTotal,
      completionRate: rate(completed, targetTotal),
      dailyAverage: businessDays > 0 ? Math.round((completed / businessDays) * 10) / 10 : 0,
    },
    outcomes: outcomeCounts,
    confidence: {
      average: confidenceCount > 0 ? Math.round((confidenceSum / confidenceCount) * 10) / 10 : null,
      count: confidenceCount,
    },
    emails: {
      sameDayEmailsSent,
      sequencesStarted,
      automaticFollowUpsSent: followUpsSent,
      followUpsByStep,
    },
    pipeline: {
      byStage: stageCounts,
      strongVenueCount,
      meetingsOrShowcases,
      progressTowardTenGoal: strongVenueCount,
    },
    referrals: {
      received: referralsReceived,
      booked: referralsBooked,
      conversionRate: rate(referralsBooked, referralsReceived),
      bookingAmountTotal: referralBookingAmountTotal,
    },
    funnel: {
      visits: completed,
      replied: outcomeCounts.met_decision_maker,
      meetingsOrShowcases,
      strongVenues: strongVenueCount,
      referrals: referralsReceived,
      bookings: referralsBooked,
    },
  }
}

/** Fetches the underlying rows and delegates to computeOutreachScoreboard. */
export function getOutreachScoreboard({ startDate, endDate }) {
  const visits = listVisitsInRange(startDate, endDate)
  const debriefs = listVisitDebriefsForVisitIds(visits.map((v) => v.id))
  const debriefsByVisitId = {}
  for (const d of debriefs) debriefsByVisitId[d.visitId] = d

  return computeOutreachScoreboard({
    startDate,
    endDate,
    dailyVisitTarget: getDailyVisitTarget(),
    visits,
    debriefsByVisitId,
    venues: listVenues(),
    sentPostVisitSends: listSentPostVisitSendsInRange(`${startDate}T00:00:00.000Z`, `${endDate}T23:59:59.999Z`),
    referrals: listVenueReferralsInRange(startDate, endDate),
  })
}
