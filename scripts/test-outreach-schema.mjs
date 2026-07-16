import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'

const EXPECTED_TABLES = [
  'outreach_sequences',
  'outreach_scheduled_sends',
  'outreach_sent_messages',
  'outreach_inbound_messages',
  'outreach_send_log',
  'outreach_daily_quota',
  'imap_sync_state',
]

const OUTREACH_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS partnership_contacts (
    id TEXT PRIMARY KEY,
    companyName TEXT NOT NULL,
    email TEXT NOT NULL,
    stage TEXT NOT NULL DEFAULT 'not_contacted',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    deletedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS outreach_sequences (
    id TEXT PRIMARY KEY,
    partnershipContactId TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    currentStep TEXT NOT NULL DEFAULT 'follow_up_1',
    enrolledAt TEXT NOT NULL,
    anchorAt TEXT NOT NULL,
    pausedAt TEXT,
    stoppedAt TEXT,
    stopReason TEXT,
    lastInboundAt TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS outreach_scheduled_sends (
    id TEXT PRIMARY KEY,
    sequenceId TEXT NOT NULL,
    partnershipContactId TEXT NOT NULL,
    step TEXT NOT NULL,
    templateId TEXT,
    scheduledAt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attemptCount INTEGER NOT NULL DEFAULT 0,
    lastAttemptAt TEXT,
    lastError TEXT,
    sentAt TEXT,
    messageId TEXT,
    deferReason TEXT,
    sortOrder INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS outreach_sent_messages (
    id TEXT PRIMARY KEY,
    partnershipContactId TEXT NOT NULL,
    scheduledSendId TEXT,
    messageId TEXT NOT NULL,
    inReplyTo TEXT,
    referencesHeader TEXT,
    subject TEXT,
    toEmail TEXT NOT NULL,
    sentAt TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS outreach_inbound_messages (
    id TEXT PRIMARY KEY,
    partnershipContactId TEXT,
    imapUid INTEGER,
    messageId TEXT,
    fromEmail TEXT,
    subject TEXT,
    receivedAt TEXT NOT NULL,
    matchMethod TEXT,
    inReplyTo TEXT,
    referencesHeader TEXT,
    snippet TEXT,
    processedAt TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS outreach_send_log (
    id TEXT PRIMARY KEY,
    scheduledSendId TEXT,
    partnershipContactId TEXT NOT NULL,
    templateId TEXT,
    subject TEXT,
    body TEXT,
    attemptedAt TEXT NOT NULL,
    result TEXT NOT NULL,
    smtpResponse TEXT,
    messageId TEXT,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS outreach_daily_quota (
    businessDate TEXT PRIMARY KEY,
    sentCount INTEGER NOT NULL DEFAULT 0,
    deferredCount INTEGER NOT NULL DEFAULT 0,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS imap_sync_state (
    mailbox TEXT PRIMARY KEY,
    lastUid INTEGER,
    lastPollAt TEXT,
    uidValidity INTEGER,
    updatedAt TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_oss_contact_step_active
    ON outreach_scheduled_sends (partnershipContactId, step)
    WHERE status IN ('pending', 'claimed');
`

const LEGACY_OUTREACH_SCHEMA_SQL = OUTREACH_SCHEMA_SQL.replace(
  "WHERE status IN ('pending', 'claimed');",
  "WHERE status IN ('pending', 'claimed', 'sent');"
)

test('outreach schema tables and columns exist (additive migration shape)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurora-outreach-schema-'))
  const dbPath = join(dir, 'aurora.db')
  const db = new Database(dbPath)
  try {
    db.exec(OUTREACH_SCHEMA_SQL)
    try {
      db.exec('ALTER TABLE partnership_contacts ADD COLUMN doNotContact INTEGER NOT NULL DEFAULT 0')
    } catch (e) {
      if (!/duplicate column/i.test(e.message)) throw e
    }
    try {
      db.exec('ALTER TABLE partnership_contacts ADD COLUMN sequenceStatus TEXT')
    } catch (e) {
      if (!/duplicate column/i.test(e.message)) throw e
    }

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name)
    for (const name of EXPECTED_TABLES) {
      assert.ok(tables.includes(name), `missing table ${name}`)
    }

    const seqCols = db.prepare('PRAGMA table_info(outreach_sequences)').all().map((c) => c.name)
    assert.deepEqual(seqCols, [
      'id',
      'partnershipContactId',
      'status',
      'currentStep',
      'enrolledAt',
      'anchorAt',
      'pausedAt',
      'stoppedAt',
      'stopReason',
      'lastInboundAt',
      'createdAt',
      'updatedAt',
    ])

    const contactCols = db.prepare('PRAGMA table_info(partnership_contacts)').all().map((c) => c.name)
    assert.ok(contactCols.includes('doNotContact'))
    assert.ok(contactCols.includes('sequenceStatus'))

    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO partnership_contacts (id, companyName, email, stage, createdAt, updatedAt)
       VALUES ('poc-test-1', 'Test Venue', 'test@example.com', 'not_contacted', ?, ?)`
    ).run(now, now)

    const row = db.prepare('SELECT * FROM partnership_contacts WHERE id = ?').get('poc-test-1')
    assert.equal(row.companyName, 'Test Venue')
    assert.equal(row.doNotContact, 0)
    assert.equal(row.sequenceStatus, null)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('server/db.js migration creates outreach tables on fresh database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurora-dbjs-phase1-'))
  const prev = process.env.DATA_DIR
  process.env.DATA_DIR = dir
  try {
    await import('../server/db.js')
    const db = new Database(join(dir, 'aurora.db'))
    try {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'outreach%' OR name = 'imap_sync_state')"
        )
        .all()
        .map((r) => r.name)
      for (const name of EXPECTED_TABLES) {
        assert.ok(tables.includes(name), `db.js migration missing ${name}`)
      }
      const cols = db.prepare('PRAGMA table_info(partnership_contacts)').all().map((c) => c.name)
      assert.ok(cols.includes('doNotContact'))
      assert.ok(cols.includes('sequenceStatus'))
    } finally {
      db.close()
    }
  } finally {
    if (prev === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
})

test('partial unique index prevents duplicate active step per contact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurora-outreach-schema-'))
  const dbPath = join(dir, 'aurora.db')
  const db = new Database(dbPath)
  try {
    db.exec(OUTREACH_SCHEMA_SQL)
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO outreach_scheduled_sends
       (id, sequenceId, partnershipContactId, step, scheduledAt, status, createdAt, updatedAt)
       VALUES ('oss-1', 'seq-1', 'poc-1', 'follow_up_1', ?, 'pending', ?, ?)`
    ).run(now, now, now)

    assert.throws(() => {
      db.prepare(
        `INSERT INTO outreach_scheduled_sends
         (id, sequenceId, partnershipContactId, step, scheduledAt, status, createdAt, updatedAt)
         VALUES ('oss-2', 'seq-1', 'poc-1', 'follow_up_1', ?, 'pending', ?, ?)`
      ).run(now, now, now)
    }, /UNIQUE constraint failed/)

    db.prepare(
      `INSERT INTO outreach_scheduled_sends
       (id, sequenceId, partnershipContactId, step, scheduledAt, status, createdAt, updatedAt)
       VALUES ('oss-3', 'seq-1', 'poc-1', 'follow_up_1', ?, 'cancelled', ?, ?)`
    ).run(now, now, now)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('current index (pending/claimed only) allows re-enrollment after a sent step', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurora-outreach-schema-'))
  const dbPath = join(dir, 'aurora.db')
  const db = new Database(dbPath)
  try {
    db.exec(OUTREACH_SCHEMA_SQL)
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO outreach_scheduled_sends
       (id, sequenceId, partnershipContactId, step, scheduledAt, status, createdAt, updatedAt)
       VALUES ('oss-1', 'seq-1', 'poc-1', 'follow_up_1', ?, 'sent', ?, ?)`
    ).run(now, now, now)

    // A brand-new sequence re-enrolling this contact for the same step must not be blocked
    // by the old row now that it's 'sent' (historical), not 'pending'/'claimed' (active).
    db.prepare(
      `INSERT INTO outreach_scheduled_sends
       (id, sequenceId, partnershipContactId, step, scheduledAt, status, createdAt, updatedAt)
       VALUES ('oss-2', 'seq-2', 'poc-1', 'follow_up_1', ?, 'pending', ?, ?)`
    ).run(now, now, now)

    const sentRow = db.prepare("SELECT * FROM outreach_scheduled_sends WHERE id = 'oss-1'").get()
    assert.equal(sentRow.status, 'sent')

    assert.throws(() => {
      db.prepare(
        `INSERT INTO outreach_scheduled_sends
         (id, sequenceId, partnershipContactId, step, scheduledAt, status, createdAt, updatedAt)
         VALUES ('oss-3', 'seq-2', 'poc-1', 'follow_up_1', ?, 'claimed', ?, ?)`
      ).run(now, now, now)
    }, /UNIQUE constraint failed/)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('migrateScheduledSendActiveIndexExcludeSent narrows a legacy index without touching row data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurora-dbjs-index-migration-'))
  const dbPath = join(dir, 'aurora.db')
  const seedDb = new Database(dbPath)
  const now = new Date().toISOString()
  try {
    seedDb.exec(LEGACY_OUTREACH_SCHEMA_SQL)
    seedDb.prepare(
      `INSERT INTO partnership_contacts (id, companyName, email, stage, createdAt, updatedAt)
       VALUES ('poc-1', 'Legacy Venue', 'legacy@example.com', 'follow_up_1', ?, ?)`
    ).run(now, now)
    seedDb.prepare(
      `INSERT INTO outreach_scheduled_sends
       (id, sequenceId, partnershipContactId, step, scheduledAt, status, createdAt, updatedAt)
       VALUES ('oss-legacy-1', 'seq-legacy-1', 'poc-1', 'follow_up_1', ?, 'sent', ?, ?)`
    ).run(now, now, now)

    const legacyIndex = seedDb
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_oss_contact_step_active'")
      .get()
    assert.ok(/'sent'/.test(legacyIndex.sql), 'seed index must include sent to simulate a pre-migration install')
  } finally {
    seedDb.close()
  }

  const prev = process.env.DATA_DIR
  process.env.DATA_DIR = dir
  try {
    // Cache-bust: db.js is an ES module and other tests in this file already import it once;
    // without a unique specifier, Node reuses the cached module and skips re-running its
    // top-level schema/migration code against this test's DATA_DIR.
    await import(`../server/db.js?t=${Date.now()}-${Math.random()}`)

    const db = new Database(dbPath)
    try {
      const migratedIndex = db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_oss_contact_step_active'")
        .get()
      assert.ok(!/'sent'/.test(migratedIndex.sql), 'migrated index must no longer include sent')
      assert.ok(/'pending'/.test(migratedIndex.sql) && /'claimed'/.test(migratedIndex.sql))

      const preserved = db.prepare("SELECT * FROM outreach_scheduled_sends WHERE id = 'oss-legacy-1'").get()
      assert.equal(preserved.status, 'sent', 'pre-existing sent row must be preserved untouched')
      assert.equal(preserved.step, 'follow_up_1')

      // New enrollment for the same contact/step should now succeed post-migration.
      const laterNow = new Date().toISOString()
      db.prepare(
        `INSERT INTO outreach_scheduled_sends
         (id, sequenceId, partnershipContactId, step, scheduledAt, status, createdAt, updatedAt)
         VALUES ('oss-legacy-2', 'seq-legacy-2', 'poc-1', 'follow_up_1', ?, 'pending', ?, ?)`
      ).run(laterNow, laterNow, laterNow)
      const reenrolled = db.prepare("SELECT * FROM outreach_scheduled_sends WHERE id = 'oss-legacy-2'").get()
      assert.equal(reenrolled.status, 'pending')
    } finally {
      db.close()
    }
  } finally {
    if (prev === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
})
