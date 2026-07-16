import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { instantAtNyLocal } from '../server/businessDays.js'

const ANCHOR = instantAtNyLocal(2025, 1, 6, 10, 0).toISOString()
const TICK_NOW = instantAtNyLocal(2025, 1, 13, 10, 0)
const FIXED_RNG = () => 0

let dataDir
let db
let outreach
let dashboard

test.before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'aurora-outreach-phase6-'))
  process.env.DATA_DIR = dataDir
  process.env.OUTREACH_TEST_EMAIL = 'phase6-test@aurorasonnet.com'
  delete process.env.OUTREACH_SCHEDULER_ENABLED
  delete process.env.OUTREACH_IMAP_ENABLED
  db = await import('../server/db.js')
  outreach = await import('../server/outreachSequence.js')
  dashboard = await import('../server/outreachDashboard.js')
})

test.after(() => {
  delete process.env.OUTREACH_TEST_EMAIL
  delete process.env.OUTREACH_SCHEDULER_ENABLED
  delete process.env.OUTREACH_IMAP_ENABLED
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

function seedSequence() {
  const email = `dashboard-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
  const id = db.createPartnershipContact({
    companyName: 'Dashboard Venue',
    email,
    partnerType: 'venue',
    stage: 'first_email_sent',
    outreachMethod: 'email',
  })
  outreach.enrollVenueOutreachSequence({
    partnershipContactId: id,
    anchorAt: ANCHOR,
    rng: FIXED_RNG,
  })
  return { contactId: id, email }
}

test('buildSequencePanelState returns status, next send, reply, and failure fields', () => {
  const { contactId } = seedSequence()
  const state = outreach.getSequenceState(contactId)
  const dueId = state.scheduledSends[0].id
  db.updateOutreachScheduledSend(dueId, { status: 'failed', lastError: '550 user unknown' })

  db.createOutreachInboundMessage({
    partnershipContactId: contactId,
    fromEmail: 'planner@venue.com',
    subject: 'Re: Live Music Referrals',
    receivedAt: TICK_NOW.toISOString(),
    matchMethod: 'thread_in_reply_to',
    snippet: 'Thanks, interested',
  })

  const panel = dashboard.buildSequencePanelState(contactId)
  assert.ok(panel)
  assert.equal(panel.panel.statusLabel, 'Running')
  assert.ok(panel.panel.nextScheduled)
  assert.equal(panel.panel.remainingCount, 2)
  assert.ok(panel.panel.lastReply)
  assert.ok(panel.panel.lastFailure)
})

test('pause, resume, stop, and skip-next update panel state', () => {
  const { contactId } = seedSequence()

  outreach.pauseSequence(contactId)
  let panel = dashboard.buildSequencePanelState(contactId)
  assert.equal(panel.panel.status, 'paused')

  outreach.resumeSequence(contactId)
  panel = dashboard.buildSequencePanelState(contactId)
  assert.equal(panel.panel.status, 'running')

  outreach.skipNextScheduledSend(contactId)
  panel = dashboard.buildSequencePanelState(contactId)
  assert.equal(panel.panel.currentStep, 'follow_up_2')

  outreach.stopSequence(contactId, 'manual_stop_ui')
  panel = dashboard.buildSequencePanelState(contactId)
  assert.equal(panel.panel.status, 'stopped')
  assert.equal(panel.panel.remainingCount, 0)
})

test('getOutreachDashboardStats reports quota and paused counts', () => {
  const { contactId } = seedSequence()
  outreach.pauseSequence(contactId)
  const businessDate = '2025-01-13'
  db.getOrCreateDailyQuota(businessDate)
  db.incrementDailyQuotaSent(businessDate)
  db.incrementDailyQuotaSent(businessDate)
  db.incrementDailyQuotaDeferred(businessDate)

  const stats = dashboard.getOutreachDashboardStats(TICK_NOW)
  assert.equal(stats.sentToday, 2)
  assert.equal(stats.deferredToday, 1)
  assert.equal(stats.remainingToday, 28)
  assert.ok(stats.pausedSequences >= 1)

  db.updatePartnershipContact(contactId, { stage: 'email_delivery_failed' })
  const statsAfterBounce = dashboard.getOutreachDashboardStats(TICK_NOW)
  assert.ok(statsAfterBounce.hardBounces >= 1)
})

test('getOutreachSystemStatus exposes warnings without credentials', () => {
  const status = dashboard.getOutreachSystemStatus({ smtpConfigured: true, now: TICK_NOW })
  assert.equal(status.automatedSendingEnabled, false)
  assert.equal(status.replyDetectionEnabled, false)
  assert.equal(status.smtpConfigured, true)
  assert.ok(status.warnings.some((w) => w.code === 'scheduler_disabled'))
  assert.ok(status.warnings.some((w) => w.code === 'imap_disabled'))
  assert.ok(!JSON.stringify(status).includes('SMTP_PASS'))
  assert.ok(!JSON.stringify(status).includes('IMAP_USER'))
})

test('system status marks stale IMAP when poll is old', () => {
  process.env.OUTREACH_IMAP_ENABLED = 'true'
  process.env.IMAP_USER = 'contact@aurorasonnet.com'
  process.env.IMAP_PASS = 'secret-not-exposed'
  db.upsertImapSyncState({
    mailbox: 'INBOX',
    lastUid: 10,
    lastPollAt: new Date(TICK_NOW.getTime() - 48 * 60 * 60 * 1000).toISOString(),
    uidValidity: 1,
  })

  const status = dashboard.getOutreachSystemStatus({ smtpConfigured: true, now: TICK_NOW })
  assert.equal(status.imapHealth, 'stale')
  assert.ok(status.warnings.some((w) => w.code === 'imap_stale'))
  assert.ok(!JSON.stringify(status).includes('secret-not-exposed'))
})
