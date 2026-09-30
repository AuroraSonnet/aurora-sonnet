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

test.before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'aurora-referral-delete-'))
  process.env.DATA_DIR = dataDir
  db = await import('../server/db.js')
  const opened = String(db.default?.name || '')
  if (!opened.startsWith(dataDir)) {
    throw new Error(`Test opened ${opened} instead of ${dataDir}. Refusing to touch another database.`)
  }
  partners = await import('../server/publicReferralPartner.js')
})

test.after(() => {
  delete process.env.DATA_DIR
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

const count = (table, id) => db.default.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`).get(id).n

test('deletes manual, Refer a Couple and partner-link referrals without touching linked records', async () => {
  const signed = await partners.submitPublicPartnerApplication({
    fullName: 'Link Partner',
    email: 'link.partner@example.com',
    companyName: 'Link Co',
    businessType: 'Planner',
    signaturePngBase64: TINY_PNG,
  })
  const partnership = db.getReferralPartnershipById(signed.partnershipId)
  const agreementId = signed.agreementId
  assert.ok(agreementId)

  const now = new Date().toISOString()
  db.createClient({ id: 'c-del', name: 'Link Couple', email: 'link.couple@example.com', createdAt: now })
  db.createProject({
    id: 'p-del', clientId: 'c-del', clientName: 'Link Couple', title: 'Wedding', stage: 'inquiry',
    value: 0, weddingDate: '2027-06-01', dueDate: '2027-06-01', createdAt: now,
  })
  const link = partners.attributeInquiryToReferralPartner({
    partnerToken: partnership.referralToken,
    clientName: 'Link Couple',
    clientEmail: 'link.couple@example.com',
    eventDate: '2027-06-01',
    linkedProjectId: 'p-del',
  })
  assert.equal(link.status, 'created')

  const couple = db.createPartnerReferral({
    partnerName: 'Public Referrer', partnerEmail: 'public@example.com',
    clientName: 'Public Couple', clientEmail: 'public.couple@example.com',
  })
  const manual = db.createPartnerReferral({
    partnerName: 'Old Vendor', partnerEmail: 'vendor@example.com',
    clientName: 'Manual Couple', clientEmail: 'manual@example.com',
    referralStatus: 'booked', payoutStatus: 'paid',
  })

  for (const id of [link.referralId, couple.id, manual.id]) {
    assert.equal(db.deletePartnerReferral(id), true, id)
    assert.equal(count('partner_referrals', id), 0, id)
    assert.equal(db.deletePartnerReferral(id), false, `${id} second delete reports not found`)
  }
  assert.equal(count('clients', 'c-del'), 1)
  assert.equal(count('projects', 'p-del'), 1)
  assert.equal(count('referral_partnerships', partnership.id), 1)
  assert.equal(count('referral_partnership_agreements', agreementId), 1)
})

test('a deleted referral id and reference are never reused', () => {
  const a = db.createPartnerReferral({ partnerName: 'P', partnerEmail: 'p@example.com', clientName: 'A', clientEmail: 'a@example.com' })
  assert.equal(db.deletePartnerReferral(a.id), true)
  const b = db.createPartnerReferral({ partnerName: 'P', partnerEmail: 'p@example.com', clientName: 'B', clientEmail: 'b@example.com' })
  assert.notEqual(b.id, a.id)
  assert.notEqual(b.referralReference, a.referralReference)
})
