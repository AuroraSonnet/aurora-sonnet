import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import {
  initVenuesAndVisitsSchema,
  matchRegionId,
  migratePartnershipContactsToVenues,
} from '../server/venuesSchema.js'

const PARTNERSHIP_CONTACTS_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS partnership_contacts (
    id TEXT PRIMARY KEY,
    companyName TEXT NOT NULL,
    email TEXT NOT NULL,
    contactName TEXT,
    jobTitle TEXT,
    partnerType TEXT,
    website TEXT,
    instagram TEXT,
    city TEXT,
    region TEXT,
    fitLevel TEXT,
    notes TEXT,
    stage TEXT NOT NULL DEFAULT 'not_contacted',
    doNotContact INTEGER NOT NULL DEFAULT 0,
    outreachMethod TEXT,
    contactFormUrl TEXT,
    linkedReferralId TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    deletedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS partner_referrals (
    id TEXT PRIMARY KEY,
    createdAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS outreach_sequences (
    id TEXT PRIMARY KEY,
    partnershipContactId TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS outreach_scheduled_sends (
    id TEXT PRIMARY KEY,
    sequenceId TEXT NOT NULL,
    partnershipContactId TEXT NOT NULL,
    step TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
`

function seedDb(dir) {
  const dbPath = join(dir, 'aurora.db')
  const db = new Database(dbPath)
  db.exec(PARTNERSHIP_CONTACTS_SCHEMA_SQL)
  return db
}

function insertContact(db, overrides = {}) {
  const now = new Date().toISOString()
  const row = {
    id: overrides.id || `poc-${Math.random().toString(36).slice(2, 8)}`,
    companyName: 'Test Venue',
    email: 'venue@example.com',
    contactName: 'Jane Coordinator',
    jobTitle: 'Coordinator',
    partnerType: 'venue',
    website: null,
    instagram: null,
    city: 'Brooklyn',
    region: 'Brooklyn',
    fitLevel: null,
    notes: null,
    stage: 'not_contacted',
    doNotContact: 0,
    outreachMethod: 'email',
    contactFormUrl: null,
    linkedReferralId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  }
  db.prepare(
    `INSERT INTO partnership_contacts
      (id, companyName, email, contactName, jobTitle, partnerType, website, instagram, city, region,
       fitLevel, notes, stage, doNotContact, outreachMethod, contactFormUrl, linkedReferralId,
       createdAt, updatedAt, deletedAt)
     VALUES (@id, @companyName, @email, @contactName, @jobTitle, @partnerType, @website, @instagram, @city, @region,
       @fitLevel, @notes, @stage, @doNotContact, @outreachMethod, @contactFormUrl, @linkedReferralId,
       @createdAt, @updatedAt, @deletedAt)`
  ).run(row)
  return row
}

test('matchRegionId matches by name, alias, and substring; returns null for unknown text', () => {
  const regions = [
    { id: 'manhattan', name: 'Manhattan' },
    { id: 'brooklyn', name: 'Brooklyn' },
    { id: 'new_jersey', name: 'New Jersey' },
  ]
  assert.equal(matchRegionId('Brooklyn', regions), 'brooklyn')
  assert.equal(matchRegionId('bklyn', regions), 'brooklyn')
  assert.equal(matchRegionId('NJ', regions), 'new_jersey')
  assert.equal(matchRegionId('Jersey City Area', regions), null, 'unrecognized sub-area text should be flagged, not guessed')
  assert.equal(matchRegionId('Westchester', regions), null)
  assert.equal(matchRegionId('', regions), null)
})

test('migration: eligible contacts become venues + venue_contacts; form leads are excluded; regions matched/flagged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurora-venue-migration-'))
  const db = seedDb(dir)
  try {
    initVenuesAndVisitsSchema(db)

    const emailVenue = insertContact(db, { id: 'poc-email', companyName: 'Email Venue', region: 'Brooklyn' })
    const formLead = insertContact(db, {
      id: 'poc-form',
      companyName: 'Form Lead Venue',
      outreachMethod: 'website_contact_form',
      contactFormUrl: 'https://example.com/contact',
    })
    const unmatchedRegion = insertContact(db, {
      id: 'poc-unmatched-region',
      companyName: 'Jersey City Venue',
      region: 'Jersey City Area',
    })
    const softDeleted = insertContact(db, { id: 'poc-deleted', companyName: 'Closed Venue', deletedAt: new Date().toISOString() })

    const result = migratePartnershipContactsToVenues(db, dir)

    assert.equal(result.skipped, false)
    assert.equal(result.migratedCount, 3, 'form-lead contact must be excluded from the migrated count')

    const venues = db.prepare('SELECT * FROM venues ORDER BY id').all()
    assert.equal(venues.length, 3)

    const migratedIds = venues.map((v) => v.migratedFromPartnershipContactId)
    assert.ok(migratedIds.includes(emailVenue.id))
    assert.ok(migratedIds.includes(unmatchedRegion.id))
    assert.ok(migratedIds.includes(softDeleted.id), 'soft-deleted contacts are preserved as history, not dropped')
    assert.ok(!migratedIds.includes(formLead.id), 'website contact-form leads must never become venues')

    const emailVenueRow = venues.find((v) => v.migratedFromPartnershipContactId === emailVenue.id)
    assert.equal(emailVenueRow.regionId, 'brooklyn')
    assert.equal(emailVenueRow.regionNeedsReview, 0)
    assert.equal(emailVenueRow.linkedPartnershipContactId, emailVenue.id)
    assert.equal(emailVenueRow.deletedAt, null)

    const unmatchedRow = venues.find((v) => v.migratedFromPartnershipContactId === unmatchedRegion.id)
    assert.equal(unmatchedRow.regionId, null)
    assert.equal(unmatchedRow.regionNeedsReview, 1, 'unrecognized region text must be flagged for review')
    assert.equal(unmatchedRow.regionRaw, 'Jersey City Area')

    const deletedRow = venues.find((v) => v.migratedFromPartnershipContactId === softDeleted.id)
    assert.ok(deletedRow.deletedAt, 'soft-deleted source contact must migrate as a soft-deleted venue')

    const contacts = db.prepare('SELECT * FROM venue_contacts').all()
    assert.equal(contacts.length, 3, 'every migrated venue with a name/email gets exactly one venue_contacts row')

    // partnership_contacts must remain byte-for-byte as inserted (read-only source of truth).
    const stillThere = db.prepare('SELECT * FROM partnership_contacts ORDER BY id').all()
    assert.equal(stillThere.length, 4)
    const formLeadRow = stillThere.find((r) => r.id === 'poc-form')
    assert.equal(formLeadRow.outreachMethod, 'website_contact_form')
    assert.equal(formLeadRow.companyName, 'Form Lead Venue')

    const setting = db.prepare("SELECT value FROM app_settings WHERE key = 'venuesMigratedAt'").get()
    assert.ok(setting && setting.value, 'venuesMigratedAt must be recorded after a successful migration')
    const countSetting = db.prepare("SELECT value FROM app_settings WHERE key = 'venuesMigratedCount'").get()
    assert.equal(countSetting.value, '3')

    const backupsDir = join(dir, 'backups')
    assert.ok(existsSync(backupsDir), 'a backups directory must be created')
    const backupFiles = readdirSync(backupsDir).filter((f) => f.includes('pre-venues-migration'))
    assert.equal(backupFiles.length, 1, 'exactly one pre-migration backup file must be written')
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('migration is idempotent: a second call is a no-op and does not duplicate venues', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurora-venue-migration-idempotent-'))
  const db = seedDb(dir)
  try {
    initVenuesAndVisitsSchema(db)
    insertContact(db, { id: 'poc-1', companyName: 'Venue One' })
    insertContact(db, { id: 'poc-2', companyName: 'Venue Two' })

    const first = migratePartnershipContactsToVenues(db, dir)
    assert.equal(first.skipped, false)
    assert.equal(first.migratedCount, 2)
    const firstMigratedAt = db.prepare("SELECT value FROM app_settings WHERE key = 'venuesMigratedAt'").get().value

    const second = migratePartnershipContactsToVenues(db, dir)
    assert.equal(second.skipped, true)
    assert.equal(second.migratedAt, firstMigratedAt, 'a second run must not touch venuesMigratedAt at all')

    const venues = db.prepare('SELECT * FROM venues').all()
    assert.equal(venues.length, 2, 'a second run must not create duplicate venues')
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('migration is atomic: if an insert fails partway, no venues, no partial app_settings row', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurora-venue-migration-atomic-'))
  const db = seedDb(dir)
  try {
    initVenuesAndVisitsSchema(db)
    insertContact(db, { id: 'poc-ok', companyName: 'Fine Venue' })
    insertContact(db, { id: 'poc-bad', companyName: 'Bad Venue' })

    // Force the second insert in the migration's transaction to fail by making companyName NOT NULL
    // violation impossible to hit naturally, so instead corrupt the venues table mid-way by dropping
    // a column the insert depends on right before running the migration.
    db.exec('CREATE TRIGGER IF NOT EXISTS venues_reject_bad_venue BEFORE INSERT ON venues WHEN NEW.migratedFromPartnershipContactId = \'poc-bad\' BEGIN SELECT RAISE(ABORT, \'simulated failure\'); END;')

    assert.throws(() => migratePartnershipContactsToVenues(db, dir), /simulated failure/)

    const venues = db.prepare('SELECT * FROM venues').all()
    assert.equal(venues.length, 0, 'a failed migration must leave zero venues behind (all-or-nothing)')

    const setting = db.prepare("SELECT value FROM app_settings WHERE key = 'venuesMigratedAt'").get()
    assert.equal(setting, undefined, 'venuesMigratedAt must never be recorded when the migration transaction fails')

    // And it must be retried (not permanently skipped) once the underlying problem is gone.
    db.exec('DROP TRIGGER venues_reject_bad_venue')
    const retry = migratePartnershipContactsToVenues(db, dir)
    assert.equal(retry.skipped, false)
    assert.equal(retry.migratedCount, 2)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM venues').get().n, 2)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('migration fails closed and retries later if the pre-migration backup cannot be written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurora-venue-migration-backupfail-'))
  const db = seedDb(dir)
  try {
    initVenuesAndVisitsSchema(db)
    insertContact(db, { id: 'poc-1', companyName: 'Venue One' })

    // Make the backups directory unwritable so VACUUM INTO fails inside backupDatabaseFile.
    const backupsDir = join(dir, 'backups')
    mkdirSync(backupsDir, { recursive: true })
    chmodSync(backupsDir, 0o000)

    let result
    try {
      result = migratePartnershipContactsToVenues(db, dir)
    } finally {
      chmodSync(backupsDir, 0o755)
    }

    assert.equal(result.skipped, true)
    assert.equal(result.backupFailed, true)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM venues').get().n, 0, 'must not migrate without a successful backup')
    assert.equal(
      db.prepare("SELECT value FROM app_settings WHERE key = 'venuesMigratedAt'").get(),
      undefined
    )

    // Next boot (backup path now writable again) must succeed.
    const retry = migratePartnershipContactsToVenues(db, dir)
    assert.equal(retry.skipped, false)
    assert.equal(retry.migratedCount, 1)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a migration with zero eligible contacts records venuesMigratedAt without requiring a backup file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurora-venue-migration-empty-'))
  const db = seedDb(dir)
  try {
    initVenuesAndVisitsSchema(db)
    insertContact(db, { id: 'poc-form-only', companyName: 'Only Form Lead', outreachMethod: 'website_contact_form' })

    const result = migratePartnershipContactsToVenues(db, dir)
    assert.equal(result.skipped, false)
    assert.equal(result.migratedCount, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM venues').get().n, 0)
    const setting = db.prepare("SELECT value FROM app_settings WHERE key = 'venuesMigratedAt'").get()
    assert.ok(setting && setting.value)
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('server/db.js fresh boot initializes venue schema, seeds regions/target, and records an empty migration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aurora-dbjs-venue-boot-'))
  const prev = process.env.DATA_DIR
  process.env.DATA_DIR = dir
  try {
    await import(`../server/db.js?t=${Date.now()}-${Math.random()}`)
    const raw = new Database(join(dir, 'aurora.db'))
    try {
      const tables = raw
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((r) => r.name)
      for (const name of ['venues', 'venue_contacts', 'visits', 'visit_debriefs', 'outreach_regions', 'app_settings']) {
        assert.ok(tables.includes(name), `fresh boot must create ${name}`)
      }
      const regions = raw.prepare('SELECT * FROM outreach_regions ORDER BY sortOrder').all()
      assert.equal(regions.length, 6, 'the six default regions must be seeded on first boot')
      const target = raw.prepare("SELECT value FROM app_settings WHERE key = 'dailyVisitTarget'").get()
      assert.equal(target.value, '5', 'default daily visit target must default to five')
      const migratedAt = raw.prepare("SELECT value FROM app_settings WHERE key = 'venuesMigratedAt'").get()
      assert.ok(migratedAt && migratedAt.value, 'fresh boot with zero contacts still records a completed migration')
      const migratedCount = raw.prepare("SELECT value FROM app_settings WHERE key = 'venuesMigratedCount'").get()
      assert.equal(migratedCount.value, '0')

      const seqCols = raw.prepare('PRAGMA table_info(outreach_sequences)').all().map((c) => c.name)
      assert.ok(seqCols.includes('sequenceType'))
      assert.ok(seqCols.includes('venueId'))
      assert.ok(seqCols.includes('visitId'))
    } finally {
      raw.close()
    }
  } finally {
    if (prev === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  }
})
