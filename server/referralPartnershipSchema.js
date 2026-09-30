/** Referral partnerships and versioned agreements. venueId is optional: venue CRM offers still set it; public partners do not. */

function tryAlterTable(db, sql) {
  try {
    db.exec(sql)
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e
  }
}

function ensureReferralPartnershipShape(db) {
  const cols = db.prepare('PRAGMA table_info(referral_partnerships)').all()
  if (!cols.length) return
  const venue = cols.find((c) => c.name === 'venueId')
  const hasPartnerEmail = cols.some((c) => c.name === 'partnerEmail')
  const venueRequired = Boolean(venue && venue.notnull === 1)

  if (venueRequired) {
    db.exec('BEGIN')
    try {
      db.exec(`
        CREATE TABLE referral_partnerships_new (
          id TEXT PRIMARY KEY,
          venueId TEXT UNIQUE,
          status TEXT NOT NULL DEFAULT 'inactive',
          activeAgreementId TEXT,
          w9ReceivedAt TEXT,
          partnerName TEXT,
          partnerEmail TEXT,
          partnerPhone TEXT,
          companyName TEXT,
          businessType TEXT,
          referralToken TEXT,
          createdAt TEXT NOT NULL,
          updatedAt TEXT NOT NULL
        );
        INSERT INTO referral_partnerships_new (
          id, venueId, status, activeAgreementId, w9ReceivedAt, createdAt, updatedAt
        )
        SELECT id, venueId, status, activeAgreementId, w9ReceivedAt, createdAt, updatedAt
        FROM referral_partnerships;
        DROP TABLE referral_partnerships;
        ALTER TABLE referral_partnerships_new RENAME TO referral_partnerships;
      `)
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  } else if (!hasPartnerEmail) {
    for (const col of [
      'partnerName TEXT',
      'partnerEmail TEXT',
      'partnerPhone TEXT',
      'companyName TEXT',
      'businessType TEXT',
      'referralToken TEXT',
    ]) {
      tryAlterTable(db, `ALTER TABLE referral_partnerships ADD COLUMN ${col}`)
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_referral_partnerships_venue ON referral_partnerships (venueId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_partnerships_token
      ON referral_partnerships (referralToken)
      WHERE referralToken IS NOT NULL AND length(referralToken) > 0;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_partnerships_partner_email
      ON referral_partnerships (lower(partnerEmail))
      WHERE partnerEmail IS NOT NULL AND length(trim(partnerEmail)) > 0;
  `)
}

export function initReferralPartnershipSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS referral_partnerships (
      id TEXT PRIMARY KEY,
      venueId TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'inactive',
      activeAgreementId TEXT,
      w9ReceivedAt TEXT,
      partnerName TEXT,
      partnerEmail TEXT,
      partnerPhone TEXT,
      companyName TEXT,
      businessType TEXT,
      referralToken TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_referral_partnerships_venue ON referral_partnerships (venueId);

    CREATE TABLE IF NOT EXISTS referral_partnership_agreements (
      id TEXT PRIMARY KEY,
      partnershipId TEXT NOT NULL,
      version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      termsJson TEXT NOT NULL,
      contentHtml TEXT NOT NULL,
      authorizedSignatoryContactId TEXT,
      signatoryName TEXT,
      signatoryTitle TEXT,
      partnerSignerName TEXT,
      partnerSignerTitle TEXT,
      partnerSignedDate TEXT,
      agencySignerName TEXT,
      agencySignedDate TEXT,
      generatedPdfBlob BLOB,
      signedPdfBlob BLOB,
      auditLogJson TEXT NOT NULL DEFAULT '[]',
      legalApprovalStatus TEXT NOT NULL DEFAULT 'pending',
      legalApprovedAt TEXT,
      legalApprovalNotes TEXT,
      legalReviewerName TEXT,
      legalRecordedByUsername TEXT,
      legalRejectedAt TEXT,
      legalRejectionNotes TEXT,
      agreementVersionIdentifier TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(partnershipId, version)
    );
    CREATE INDEX IF NOT EXISTS idx_rpa_partnership ON referral_partnership_agreements (partnershipId);

    CREATE TABLE IF NOT EXISTS venue_activity (
      id TEXT PRIMARY KEY,
      venueId TEXT NOT NULL,
      type TEXT NOT NULL,
      subject TEXT,
      body TEXT,
      metadataJson TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_venue_activity_venue ON venue_activity (venueId, createdAt DESC);
  `)

  ensureReferralPartnershipShape(db)

  for (const col of [
    'partnershipId TEXT',
    'agreementId TEXT',
    'agreementTermsSnapshot TEXT',
    'agreementSnapshotKind TEXT',
    'eventCompletedAt TEXT',
    'clientPaidInFullAt TEXT',
    'linkedProjectId TEXT',
    'referralSubmittedAt TEXT',
    'referralDecisionDeadline TEXT',
    'referralDecisionStatus TEXT',
    'referralAcceptedAt TEXT',
    'referralRejectedAt TEXT',
    'referralDecisionBy TEXT',
    'referralDecisionNotes TEXT',
    'referralDecisionAuditJson TEXT',
    'referralDecisionDeadlineAdjustedAt TEXT',
    'referralDecisionDeadlineAdjustedBy TEXT',
    'referralDecisionDeadlineAdjustReason TEXT',
    'commissionStatementNumber TEXT',
    'commissionStatementGeneratedAt TEXT',
    'commissionStatementDeliveredAt TEXT',
    'commissionStatementDeliveryMethod TEXT',
    'commissionStatementDeliveryReference TEXT',
    'commissionStatementDeliveredBy TEXT',
    'commissionStatementBlob BLOB',
    'commissionStatementDataJson TEXT',
    'commissionPaymentDate TEXT',
    'commissionPaymentMethod TEXT',
    'commissionPaymentReference TEXT',
    'termsAcceptedAt TEXT',
  ]) {
    tryAlterTable(db, `ALTER TABLE partner_referrals ADD COLUMN ${col}`)
  }
  for (const col of [
    "legalApprovalStatus TEXT NOT NULL DEFAULT 'pending'",
    'legalApprovedAt TEXT',
    'legalApprovalNotes TEXT',
    'legalReviewerName TEXT',
    'legalRecordedByUsername TEXT',
    'legalRejectedAt TEXT',
    'legalRejectionNotes TEXT',
    'agreementVersionIdentifier TEXT',
    'externalCounselReviewedAt TEXT',
    'externalCounselReviewerName TEXT',
    'externalCounselReviewNotes TEXT',
  ]) {
    tryAlterTable(db, `ALTER TABLE referral_partnership_agreements ADD COLUMN ${col}`)
  }
}
