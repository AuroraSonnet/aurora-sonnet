/**
 * A homepage quote through a partner link must attach to an existing referral
 * when the couple matches, without booking it or paying commission.
 * Run: node --test scripts/test-inquiry-referral-link.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let dataDir
let db
let partners
let portal

test.before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'aurora-inquiry-link-'))
  process.env.DATA_DIR = dataDir
  db = await import('../server/db.js')
  const opened = String(db.default?.name || '')
  if (!opened.startsWith(dataDir)) {
    throw new Error(`Test opened ${opened} instead of ${dataDir}. Refusing to touch another database.`)
  }
  partners = await import('../server/publicReferralPartner.js')
  portal = await import('../server/partnerPortal.js')
})

test.after(() => {
  delete process.env.DATA_DIR
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

function quote({ name, email, phone, partnerToken }) {
  const coupleMatch = partners.classifyIncomingCouple({ email, phone, name })
  const recorded = db.createInquiryInTransaction({
    name,
    email,
    phone: phone || undefined,
    today: '2026-10-25',
    weddingDate: '2027-06-12',
    value: 0,
    title: 'Quote request',
    clientName: name,
    dueDate: '2026-10-25',
    notes: 'Homepage quote request.\nSinger: Blake (Operatic Vocalist)',
    requestedArtist: 'Blake',
    performanceMoment: ['Ceremony'],
    venue: 'The Plaza',
    existingClientId:
      coupleMatch.kind === 'existing_client' || coupleMatch.kind === 'existing_referral'
        ? coupleMatch.clientId
        : undefined,
  })
  const attribution = partners.attributeInquiryToReferralPartner({
    partnerToken,
    clientName: name,
    clientEmail: email,
    clientPhone: phone,
    eventDate: '2027-06-12',
    eventLocation: 'The Plaza',
    linkedProjectId: recorded.projectId,
    linkedLeadId: recorded.projectId,
    priorMatch: coupleMatch,
  })
  return { recorded, attribution }
}

function projectRow(projectId) {
  return db.default.prepare('SELECT stage, requestedArtist FROM projects WHERE id = ?').get(projectId)
}

function links(referralId) {
  return db.listReferralProjectLinksWithProjects(referralId)
}

test('a matching quote attaches to the existing referral and is not a booking', async () => {
  const signed = await partners.submitPublicPartnerApplication({
    fullName: 'Alo Wiza',
    email: 'info@alowiza.com',
    companyName: 'Litest',
    businessType: 'Planner',
    signaturePngBase64: TINY_PNG,
  })
  const saved = partners.savePublicCoupleReferral({
    referralToken: signed.referralToken,
    partnerName: 'Alo Wiza',
    partnerEmail: 'info@alowiza.com',
    companyName: 'Litest',
    clientName: 'Alo',
    clientEmail: 'info@alowiz.com',
    clientPhone: '9173313663',
  })
  assert.equal(saved.partnerNotice, null)
  const referral = db.getPartnerReferral(saved.referralId)
  assert.equal(links(referral.id).length, 0)

  const sameEmail = quote({
    name: 'Alo',
    email: 'Info@AloWiz.com',
    phone: '',
    partnerToken: signed.referralToken,
  })
  assert.equal(sameEmail.attribution.status, 'existing')
  assert.equal(sameEmail.attribution.referralId, referral.id)
  assert.equal(projectRow(sameEmail.recorded.projectId).stage, 'inquiry')
  assert.equal(projectRow(sameEmail.recorded.projectId).requestedArtist, 'Blake')
  const afterEmail = links(referral.id)
  assert.equal(afterEmail.length, 1)
  assert.equal(afterEmail[0].link.projectId, sameEmail.recorded.projectId)
  assert.equal(afterEmail[0].link.bookedConfirmedAt, null)
  assert.equal(afterEmail[0].link.eligibleAmount, null)
  assert.equal(afterEmail[0].link.commissionAmount, 0)

  const samePhone = quote({
    name: 'Alo',
    email: 'phone-match@example.com',
    phone: '(917) 331-3663',
    partnerToken: signed.referralToken,
  })
  assert.equal(samePhone.attribution.status, 'existing')
  assert.equal(samePhone.attribution.referralId, referral.id)
  assert.equal(links(referral.id).length, 2)
  assert.equal(links(referral.id).every((row) => !row.link.bookedConfirmedAt), true)

  const beforeCount = db.default.prepare('SELECT COUNT(*) AS n FROM partner_referrals').get().n
  const nameOnly = quote({
    name: 'Alo',
    email: 'name-only@example.com',
    phone: '',
    partnerToken: signed.referralToken,
  })
  assert.equal(nameOnly.attribution.status, 'created')
  assert.notEqual(nameOnly.attribution.referralId, referral.id)
  assert.equal(links(referral.id).some((row) => row.link.projectId === nameOnly.recorded.projectId), false)

  const other = await partners.submitPublicPartnerApplication({
    fullName: 'Other Vendor',
    email: 'other-vendor@example.com',
    companyName: 'Other Co',
    businessType: 'Florist',
    signaturePngBase64: TINY_PNG,
  })
  const stolen = quote({
    name: 'Alo',
    email: 'info@alowiz.com',
    phone: '',
    partnerToken: other.referralToken,
  })
  assert.equal(stolen.attribution.status, 'already_referred')
  assert.equal(stolen.attribution.referralId, referral.id)
  assert.equal(db.getReferralProjectLinkByProjectId(stolen.recorded.projectId).referralId, referral.id)
  const kept = db.getPartnerReferral(referral.id)
  assert.equal(kept.partnershipId, signed.partnershipId)
  assert.equal(kept.partnerEmail, 'info@alowiza.com')
  assert.equal(kept.payoutAmount || 0, 0)
  assert.equal(kept.bookingAmount || 0, 0)

  const phoneOtherName = quote({
    name: 'Someone Else',
    email: 'conflict@example.com',
    phone: '917-331-3663',
    partnerToken: signed.referralToken,
  })
  assert.equal(phoneOtherName.attribution.status, 'needs_review')
  assert.equal(db.getReferralProjectLinkByProjectId(phoneOtherName.recorded.projectId), null)

  const conflicting = quote({
    name: 'Alo',
    email: 'info@alowiz.com',
    phone: '9173313663',
    partnerToken: signed.referralToken,
  })
  assert.equal(conflicting.attribution.status, 'needs_review')
  assert.equal(db.getReferralProjectLinkByProjectId(conflicting.recorded.projectId), null)

  const vendorEmail = quote({
    name: 'Alo Wiza',
    email: 'info@alowiza.com',
    phone: '',
    partnerToken: signed.referralToken,
  })
  assert.equal(vendorEmail.attribution.status, 'created')
  assert.notEqual(vendorEmail.attribution.referralId, referral.id)
  const afterCount = db.default.prepare('SELECT COUNT(*) AS n FROM partner_referrals').get().n
  assert.equal(afterCount, beforeCount + 2)

  const dash = portal.portalDashboard(portal.resolvePortalAccessById(signed.partnershipId))
  const alo = dash.referrals.filter((row) => row.couple === 'Alo').find((row) => row.projects.length === 3)
  assert.ok(alo)
  assert.equal(alo.status, 'Received')
  assert.equal(alo.projects.every((p) => p.bookingStatus === 'Not yet confirmed'), true)
  assert.equal(alo.projects.every((p) => p.commission == null), true)
  assert.deepEqual(dash.earnings, { pending: 0, earned: 0, paid: 0 })
})
