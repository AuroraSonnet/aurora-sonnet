import { getOutreachSendMode, logOutreach } from './outreachLogger.js'
import { runOutreachImapPoll } from './outreachImap.js'
import { runOutreachSchedulerTick } from './outreachScheduler.js'

function isOutreachCronProduction() {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.RENDER === 'true' ||
    Boolean((process.env.RENDER_EXTERNAL_URL || '').includes('onrender.com'))
  )
}

export function verifyOutreachCronSecret(req) {
  const secret = process.env.OUTREACH_CRON_SECRET
  if (!secret) {
    if (isOutreachCronProduction()) {
      return { ok: false, required: true, reason: 'secret_not_configured' }
    }
    return { ok: true, required: false }
  }
  const provided =
    req.get('x-outreach-cron-secret') ||
    req.get('x-cron-secret') ||
    req.query?.secret ||
    req.body?.secret
  if (String(provided || '') !== String(secret)) {
    return { ok: false, required: true, reason: 'invalid_secret' }
  }
  return { ok: true, required: true }
}

/**
 * External cron / manual tick entrypoint.
 * Does not use setInterval — intended for Render + cron-job.org backup.
 */
export async function runOutreachAutomationTick({
  force = false,
  now = new Date(),
  transporter,
  mailFrom,
} = {}) {
  const startedAt = now.toISOString()
  const schedulerEnabled = process.env.OUTREACH_SCHEDULER_ENABLED === 'true'
  const imapEnabled = process.env.OUTREACH_IMAP_ENABLED === 'true'
  const sendMode = getOutreachSendMode()

  logOutreach('tick_start', {
    component: 'cron',
    schedulerEnabled,
    imapEnabled,
    sendMode,
    force: Boolean(force),
    startedAt,
  })

  if (!schedulerEnabled && !imapEnabled) {
    const result = {
      ok: true,
      disabled: true,
      sent: 0,
      schedulerEnabled,
      imapEnabled,
      sendMode,
      message: 'Outreach automation flags are disabled',
    }
    logOutreach('tick_end', { component: 'cron', ...result })
    return result
  }

  let imap = null
  let scheduler = null

  if (imapEnabled) {
    imap = await runOutreachImapPoll({ now })
    if (!imap.ok && imap.error) {
      logOutreach('imap_poll_error', { component: 'imap', error: imap.error }, { level: 'error' })
    }
  }

  if (schedulerEnabled) {
    if (!transporter || !mailFrom) {
      const result = {
        ok: false,
        sent: 0,
        imap,
        schedulerEnabled,
        imapEnabled,
        sendMode,
        error: 'smtp_not_configured',
      }
      logOutreach('tick_end', { component: 'cron', ...result }, { level: 'error' })
      return result
    }
    if (sendMode === 'blocked') {
      const result = {
        ok: false,
        sent: 0,
        imap,
        schedulerEnabled,
        imapEnabled,
        sendMode,
        error: 'outreach_send_blocked',
        message: 'Set OUTREACH_TEST_EMAIL for safe test mode or OUTREACH_ALLOW_PRODUCTION_SENDS=true',
      }
      logOutreach('tick_end', { component: 'cron', ...result }, { level: 'warn' })
      return result
    }

    scheduler = await runOutreachSchedulerTick({
      now,
      transporter,
      mailFrom,
      force,
    })
  }

  const result = {
    ok: true,
    sent: scheduler?.sent ?? 0,
    deferred: scheduler?.deferred ?? 0,
    skipped: scheduler?.skipped ?? 0,
    failed: scheduler?.failed ?? 0,
    recovered: scheduler?.recovered ?? 0,
    released: scheduler?.released ?? 0,
    outsideWindow: scheduler?.outsideWindow ?? false,
    businessDate: scheduler?.businessDate,
    quotaAfter: scheduler?.quotaAfter,
    scheduler,
    imap,
    schedulerEnabled,
    imapEnabled,
    sendMode,
    completedAt: new Date().toISOString(),
  }

  logOutreach('tick_end', {
    component: 'cron',
    sent: result.sent,
    deferred: result.deferred,
    skipped: result.skipped,
    failed: result.failed,
    recovered: result.recovered,
    released: result.released,
    outsideWindow: result.outsideWindow,
    imapProcessed: imap?.processed ?? 0,
    imapMatched: imap?.matched ?? 0,
    imapBounces: imap?.bounces ?? 0,
    sendMode,
  })

  return result
}
