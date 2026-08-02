/** Additive schema for referral partnerships (1:1 with venues) and versioned agreements. */

function tryAlterTable(db, sql) {
  try {
    db.exec(sql)
  } catch (e) {
    if (!/duplicate column/i.test(e.message)) throw e
  }
}

export function initReferralPartnershipSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS referral_partnerships (
      id TEXT PRIMARY KEY,
      venueId TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'inactive',
      activeAgreementId TEXT,
      w9ReceivedAt TEXT,
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

  for (const col of [
    'partnershipId TEXT',
    'agreementId TEXT',
    'agreementTermsSnapshot TEXT',
    'agreementSnapshotKind TEXT',
    'eventCompletedAt TEXT',
    'clientPaidInFullAt TEXT',
    'linkedProjectId TEXT',
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
  ]) {
    tryAlterTable(db, `ALTER TABLE referral_partnership_agreements ADD COLUMN ${col}`)
  }
}
