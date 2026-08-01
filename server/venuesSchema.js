/**
 * Venue relationship / visit / debrief schema — additive only, does not alter or drop any existing
 * table (partnership_contacts, outreach_*, partner_referrals all stay exactly as they were).
 *
 * Also runs a one-time, idempotent data migration that copies every non-website-form
 * partnership_contacts row into venues + venue_contacts (see migratePartnershipContactsToVenues).
 * The website-contact-form pipeline is deliberately left untouched in partnership_contacts.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { deriveStageAdvanceFromDebrief } from './venuePipeline.js'

export const DEFAULT_OUTREACH_REGIONS = [
  { id: 'manhattan', name: 'Manhattan' },
  { id: 'brooklyn', name: 'Brooklyn' },
  { id: 'queens', name: 'Queens' },
  { id: 'long_island', name: 'Long Island' },
  { id: 'upstate_ny', name: 'Upstate New York' },
  { id: 'new_jersey', name: 'New Jersey' },
]

const REGION_ALIASES = {
  manhattan: ['manhattan', 'nyc manhattan', 'new york city', 'ny, ny', 'midtown', 'downtown manhattan'],
  brooklyn: ['brooklyn', 'bklyn', 'bk'],
  queens: ['queens'],
  long_island: ['long island', 'li', 'nassau', 'suffolk'],
  upstate_ny: ['upstate new york', 'upstate ny', 'upstate', 'hudson valley', 'westchester', 'catskills'],
  new_jersey: ['new jersey', 'nj', 'jersey'],
}

function normalizeRegionText(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
}

/** Best-effort region match against the editable region list. Returns regionId or null. */
export function matchRegionId(rawText, regions) {
  const norm = normalizeRegionText(rawText)
  if (!norm) return null
  for (const region of regions) {
    if (normalizeRegionText(region.name) === norm) return region.id
    const aliases = REGION_ALIASES[region.id] || []
    if (aliases.includes(norm)) return region.id
    if (norm.includes(normalizeRegionText(region.name))) return region.id
  }
  return null
}

function tryAlterTable(db, sql) {
  try {
    db.exec(sql)
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e
  }
}

export function initVenuesAndVisitsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outreach_regions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS venues (
      id TEXT PRIMARY KEY,
      companyName TEXT NOT NULL,
      partnerType TEXT,
      website TEXT,
      instagram TEXT,
      phone TEXT,
      officialContactFormUrl TEXT,
      address TEXT,
      neighborhood TEXT,
      borough TEXT,
      city TEXT,
      regionId TEXT,
      regionRaw TEXT,
      regionNeedsReview INTEGER NOT NULL DEFAULT 0,
      sourceUrl TEXT,
      lastVerifiedAt TEXT,
      preferredMusicalStyle TEXT,
      typicalWeddingBudget TEXT,
      weddingsPerYearApprox TEXT,
      existingVendors TEXT,
      commonCoupleRequests TEXT,
      bestTimeToVisit TEXT,
      coordinatorNotes TEXT,
      teamStructure TEXT,
      referralProcess TEXT,
      preferredVendorProcess TEXT,
      openToShowcase TEXT,
      showcaseHistory TEXT,
      referralPotential TEXT,
      fitLevel TEXT,
      operatorGroup TEXT,
      notes TEXT,
      stage TEXT NOT NULL DEFAULT 'target',
      relationshipStrength INTEGER,
      doNotContact INTEGER NOT NULL DEFAULT 0,
      dailyVisitTargetOverride INTEGER,
      linkedPartnershipContactId TEXT,
      linkedReferralId TEXT,
      source TEXT,
      migratedFromPartnershipContactId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS venue_contacts (
      id TEXT PRIMARY KEY,
      venueId TEXT NOT NULL,
      name TEXT,
      jobTitle TEXT,
      email TEXT,
      phone TEXT,
      businessCardCollected INTEGER NOT NULL DEFAULT 0,
      isDecisionMaker INTEGER NOT NULL DEFAULT 0,
      preferredCommunicationMethod TEXT,
      notes TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );
    CREATE TABLE IF NOT EXISTS visits (
      id TEXT PRIMARY KEY,
      venueId TEXT NOT NULL,
      plannedDate TEXT NOT NULL,
      visitDate TEXT,
      visitTime TEXT,
      orderIndex INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'planned',
      sameDayEmailSentAt TEXT,
      sequenceStartedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visit_debriefs (
      id TEXT PRIMARY KEY,
      visitId TEXT NOT NULL UNIQUE,
      outcomes TEXT NOT NULL,
      partnershipConfidenceScore INTEGER NOT NULL,
      contactsMetIds TEXT,
      nextAction TEXT NOT NULL,
      nextActionDueDate TEXT,
      nextActionOtherNote TEXT,
      noFurtherActionReason TEXT,
      closedStatus TEXT,
      whatWentWell TEXT,
      whatCouldGoBetter TEXT,
      objectionTag TEXT,
      objectionNotes TEXT,
      whatLearned TEXT,
      whatDoDifferently TEXT,
      whatWouldChangeOverall TEXT,
      whatInterestedThem TEXT,
      generalNotes TEXT,
      materialsLeft TEXT,
      permissionToFollowUp INTEGER NOT NULL DEFAULT 0,
      agreedNextStep TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_venues_active ON venues (id) WHERE deletedAt IS NULL;
    CREATE INDEX IF NOT EXISTS idx_venue_contacts_venue ON venue_contacts (venueId);
    CREATE INDEX IF NOT EXISTS idx_visits_venue ON visits (venueId);
    CREATE INDEX IF NOT EXISTS idx_visits_planned_date ON visits (plannedDate);
    CREATE INDEX IF NOT EXISTS idx_visit_debriefs_visit ON visit_debriefs (visitId);
  `)

  // Additive columns on existing, proven outreach tables — lets the same battle-tested scheduler
  // and IMAP engine drive both the legacy cold-outreach path and the new visit-triggered path.
  tryAlterTable(db, "ALTER TABLE outreach_sequences ADD COLUMN sequenceType TEXT NOT NULL DEFAULT 'cold_outreach'")
  tryAlterTable(db, 'ALTER TABLE outreach_sequences ADD COLUMN visitId TEXT')
  tryAlterTable(db, 'ALTER TABLE outreach_sequences ADD COLUMN venueId TEXT')
  tryAlterTable(db, "ALTER TABLE outreach_scheduled_sends ADD COLUMN sequenceType TEXT NOT NULL DEFAULT 'cold_outreach'")
  tryAlterTable(db, 'ALTER TABLE outreach_scheduled_sends ADD COLUMN visitId TEXT')
  tryAlterTable(db, 'ALTER TABLE outreach_scheduled_sends ADD COLUMN venueId TEXT')

  // Referral tracking reuses partner_referrals (Decision A) instead of a separate table.
  tryAlterTable(db, 'ALTER TABLE partner_referrals ADD COLUMN venueId TEXT')
  tryAlterTable(db, 'ALTER TABLE partner_referrals ADD COLUMN referringContactId TEXT')

  seedDefaultRegions(db)
  seedDefaultAppSettings(db)
}

function seedDefaultRegions(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM outreach_regions').get().n
  if (count > 0) return
  const now = new Date().toISOString()
  const insert = db.prepare(
    'INSERT INTO outreach_regions (id, name, sortOrder, active, createdAt) VALUES (?, ?, ?, 1, ?)'
  )
  DEFAULT_OUTREACH_REGIONS.forEach((r, i) => insert.run(r.id, r.name, i, now))
}

function seedDefaultAppSettings(db) {
  const existing = db.prepare("SELECT value FROM app_settings WHERE key = 'dailyVisitTarget'").get()
  if (existing) return
  db.prepare("INSERT INTO app_settings (key, value, updatedAt) VALUES ('dailyVisitTarget', '5', ?)").run(
    new Date().toISOString()
  )
}

/**
 * One-time, idempotent migration: every non-website-form partnership_contacts row (including
 * soft-deleted ones, to preserve history) becomes exactly one venues row + at most one
 * venue_contacts row. The original partnership_contacts row is left completely untouched and
 * remains the row that the existing (unmodified) automated cold-outreach engine sends from —
 * venues.linkedPartnershipContactId points back to it so relationship stage (on venues) and
 * email-sequence progress (on outreach_sequences, keyed by partnershipContactId) stay decoupled
 * while still sharing one proven sending/reply-detection engine.
 *
 * Safe to call on every boot: no-ops once 'venuesMigratedAt' is recorded in app_settings.
 * Takes an atomic SQLite backup (VACUUM INTO) immediately before making any change.
 */
export function migratePartnershipContactsToVenues(db, dataDir) {
  const already = db.prepare("SELECT value FROM app_settings WHERE key = 'venuesMigratedAt'").get()
  if (already) return { skipped: true, migratedAt: already.value }

  const contacts = db
    .prepare("SELECT * FROM partnership_contacts WHERE outreachMethod IS NULL OR outreachMethod != 'website_contact_form'")
    .all()

  if (contacts.length > 0) {
    const backupPath = backupDatabaseFile(db, dataDir, 'pre-venues-migration')
    if (!backupPath) {
      // Fail closed: never migrate existing venue data without a verified backup taken first.
      // Idempotent + retried on every boot, so this just waits for the next restart once
      // whatever blocked the backup (disk space, permissions, etc.) is resolved.
      console.error(
        '[VENUES-MIGRATION] Skipping migration this boot — pre-migration backup failed. Will retry on next restart.'
      )
      return { skipped: true, backupFailed: true }
    }
  }

  const regions = db.prepare('SELECT * FROM outreach_regions').all()
  const now = new Date().toISOString()

  const insertVenue = db.prepare(`
    INSERT INTO venues (
      id, companyName, partnerType, website, instagram, city, regionId, regionRaw, regionNeedsReview,
      fitLevel, notes, stage, doNotContact, linkedPartnershipContactId, linkedReferralId, source,
      migratedFromPartnershipContactId, createdAt, updatedAt, deletedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insertVenueContact = db.prepare(`
    INSERT INTO venue_contacts (id, venueId, name, jobTitle, email, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const emailStageToVenueStage = {
    not_contacted: 'target',
    first_email_sent: 'target',
    follow_up_1: 'target',
    follow_up_2: 'target',
    follow_up_3: 'target',
    replied: 'engaged_replied',
    meeting_scheduled: 'meeting_scheduled',
    partner: 'preferred_partner',
    not_interested: 'not_interested',
    archived_no_response: 'not_fit_archived',
    email_delivery_failed: 'target',
  }

  let venueSeq = 0
  let contactSeq = 0
  const nextVenueId = () => `ven-${++venueSeq}`
  const nextVenueContactId = () => `vc-${++contactSeq}`

  const tx = db.transaction(() => {
    for (const c of contacts) {
      const venueId = nextVenueId()
      const regionId = matchRegionId(c.region, regions)
      insertVenue.run(
        venueId,
        c.companyName,
        c.partnerType || null,
        c.website || null,
        c.instagram || null,
        c.city || null,
        regionId,
        c.region || null,
        regionId ? 0 : c.region ? 1 : 0,
        c.fitLevel || null,
        c.notes || null,
        emailStageToVenueStage[c.stage] || 'target',
        c.doNotContact ? 1 : 0,
        c.id,
        c.linkedReferralId || null,
        'migrated_from_partnership_contact',
        c.id,
        c.createdAt || now,
        c.updatedAt || now,
        c.deletedAt || null
      )
      if ((c.contactName && c.contactName.trim()) || (c.email && c.email.trim())) {
        insertVenueContact.run(
          nextVenueContactId(),
          venueId,
          c.contactName || null,
          c.jobTitle || null,
          c.email || null,
          c.createdAt || now,
          c.updatedAt || now
        )
      }
    }
    db.prepare("INSERT INTO app_settings (key, value, updatedAt) VALUES ('venuesMigratedAt', ?, ?)").run(now, now)
    db.prepare(
      "INSERT INTO app_settings (key, value, updatedAt) VALUES ('venuesMigratedCount', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt"
    ).run(String(contacts.length), now)
  })
  tx()

  return { skipped: false, migratedAt: now, migratedCount: contacts.length }
}

/** Atomic hot-backup of the whole SQLite file via VACUUM INTO, written to <dataDir>/backups/. */
export function backupDatabaseFile(db, dataDir, label = 'backup') {
  try {
    const backupsDir = join(dataDir, 'backups')
    if (!existsSync(backupsDir)) mkdirSync(backupsDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = join(backupsDir, `aurora-${label}-${stamp}.db`)
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`)
    return backupPath
  } catch (e) {
    // Never let a backup failure block startup — but make it loud in logs.
    console.error('[VENUES-MIGRATION] Backup before migration failed:', e && e.message)
    return null
  }
}

export { deriveStageAdvanceFromDebrief }
