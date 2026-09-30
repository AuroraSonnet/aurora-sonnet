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
  dataDir = mkdtempSync(join(tmpdir(), 'aurora-partner-portal-'))
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

async function signPartner(email, name) {
  return partners.submitPublicPartnerApplication({
    fullName: name,
    email,
    companyName: `${name} Co`,
    businessType: 'Planner',
    signaturePngBase64: TINY_PNG,
  })
}

function attribute(token, clientName, clientEmail, eventDate) {
  const r = partners.attributeInquiryToReferralPartner({
    partnerToken: token,
    clientName,
    clientEmail,
    clientPhone: '212-555-0000',
    eventDate,
    eventLocation: 'Secret Venue',
  })
  assert.equal(r.status, 'created')
  return r.referralId
}

function setRow(id, fields) {
  const keys = Object.keys(fields)
  db.default
    .prepare(`UPDATE partner_referrals SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), id)
}

test('commission state and partner-facing status come from existing referral fields', () => {
  const base = { referralStatus: 'booked', payoutAmount: 500, payoutStatus: 'none' }
  assert.equal(portal.partnerCommissionState({ ...base, referralStatus: 'new', payoutAmount: 0 }), null)
  assert.equal(portal.partnerCommissionState(base), 'pending')
  assert.equal(
    portal.partnerCommissionState({ ...base, eventCompletedAt: 'x', clientPaidInFullAt: 'x' }),
    'earned'
  )
  assert.equal(portal.partnerCommissionState({ ...base, payoutStatus: 'pending' }), 'earned')
  assert.equal(portal.partnerCommissionState({ ...base, payoutStatus: 'completed' }), 'paid')
  assert.equal(portal.partnerCommissionState({ ...base, payoutStatus: 'paid' }), 'paid')
  assert.equal(portal.partnerCommissionState({ ...base, referralStatus: 'closed_lost' }), null)

  assert.equal(portal.partnerReferralStatusLabel({ referralStatus: 'new' }), 'Received')
  assert.equal(portal.partnerReferralStatusLabel({ referralStatus: 'under_review' }), 'In Progress')
  assert.equal(portal.partnerReferralStatusLabel({ referralStatus: 'contacted' }), 'In Progress')
  assert.equal(portal.partnerReferralStatusLabel({ referralStatus: 'booked' }), 'Booked')
  assert.equal(portal.partnerReferralStatusLabel({ referralStatus: 'closed_lost' }), 'Not Booked')
})

test('login tokens are hashed, single-use, and expire', () => {
  const token = portal.createPortalLoginToken('rp-x')
  const stored = db.default.prepare('SELECT tokenHash FROM partner_portal_login_tokens').all()
  assert.ok(stored.every((r) => r.tokenHash !== token), 'raw token is never stored')
  assert.equal(portal.consumePortalLoginToken(token), 'rp-x')
  assert.equal(portal.consumePortalLoginToken(token), null, 'second use fails')

  const expired = portal.createPortalLoginToken('rp-x', -1000)
  assert.equal(portal.consumePortalLoginToken(expired), null)
  assert.equal(portal.consumePortalLoginToken('made-up-token'), null)
  assert.equal(portal.consumePortalLoginToken(''), null)
})

test('portal shows only the partner’s own referrals with partner-safe fields and correct totals', async () => {
  const a = await signPartner('a@partner.example', 'Alice Planner')
  const b = await signPartner('b@partner.example', 'Bob Florist')

  const received = attribute(a.referralToken, 'Casey and Jordan', 'casey@client.example', '2027-05-01')
  const pending = attribute(a.referralToken, 'Pat and Quinn', 'pat@client.example', '2027-06-01')
  const earned = attribute(a.referralToken, 'Robin and Sky', 'robin@client.example', '2026-08-01')
  const paid = attribute(a.referralToken, 'Taylor and Uma', 'taylor@client.example', '2026-07-01')
  const lost = attribute(a.referralToken, 'Val and Wren', 'val@client.example', null)
  attribute(b.referralToken, 'Other Couple', 'other@client.example', '2027-01-01')

  setRow(pending, { referralStatus: 'booked', bookingAmount: 5000, payoutAmount: 500 })
  setRow(earned, {
    referralStatus: 'booked',
    bookingAmount: 3000,
    payoutAmount: 300,
    eventCompletedAt: '2026-08-02T00:00:00Z',
    clientPaidInFullAt: '2026-08-02T00:00:00Z',
  })
  setRow(paid, { referralStatus: 'booked', bookingAmount: 2000, payoutAmount: 200, payoutStatus: 'completed' })
  setRow(lost, { referralStatus: 'closed_lost' })

  // Refer a Couple with the partner's email but no token stays independent of the partnership.
  db.createPartnerReferral({
    referralProgram: 'public_10',
    partnerName: 'Alice Planner',
    partnerEmail: 'a@partner.example',
    clientName: 'Email Only Couple',
    clientEmail: 'emailonly@client.example',
  })

  const access = portal.resolvePortalAccessByEmail('A@Partner.example')
  assert.ok(access)
  const dash = portal.portalDashboard(access)
  assert.equal(dash.partnerName, 'Alice Planner')
  assert.equal(dash.companyName, 'Alice Planner Co')
  assert.equal(dash.referralLink, a.referralLink)
  assert.deepEqual(dash.earnings, { pending: 500, earned: 300, paid: 200 })
  assert.equal(dash.referrals.length, 5)
  const couples = dash.referrals.map((r) => r.couple).sort()
  assert.deepEqual(couples, ['Casey and Jordan', 'Pat and Quinn', 'Robin and Sky', 'Taylor and Uma', 'Val and Wren'])

  const byCouple = Object.fromEntries(dash.referrals.map((r) => [r.couple, r]))
  assert.deepEqual(byCouple['Casey and Jordan'], {
    couple: 'Casey and Jordan',
    eventDate: '2027-05-01',
    status: 'Received',
    commission: null,
    commissionStatus: null,
  })
  assert.equal(byCouple['Pat and Quinn'].commissionStatus, 'Pending')
  assert.equal(byCouple['Robin and Sky'].commissionStatus, 'Earned')
  assert.equal(byCouple['Taylor and Uma'].commissionStatus, 'Paid')
  assert.equal(byCouple['Val and Wren'].status, 'Not Booked')

  const json = JSON.stringify(dash)
  for (const secret of ['casey@client.example', '212-555-0000', 'Secret Venue', '5000', 'Other Couple', 'Email Only Couple', 'partnershipId', a.partnershipId]) {
    assert.ok(!json.includes(secret), `dashboard must not expose ${secret}`)
  }

  const bDash = portal.portalDashboard(portal.resolvePortalAccessById(b.partnershipId))
  assert.deepEqual(bDash.referrals.map((r) => r.couple), ['Other Couple'])
  assert.notEqual(portal.resolvePortalAccessById(b.partnershipId).agreement.id, access.agreement.id)
  assert.equal(access.agreement.partnershipId, a.partnershipId)

  // Payout data in the app is the source of truth: marking the earned one paid moves it immediately.
  setRow(earned, { payoutStatus: 'completed' })
  assert.deepEqual(portal.portalDashboard(portal.resolvePortalAccessById(a.partnershipId)).earnings, {
    pending: 500,
    earned: 0,
    paid: 500,
  })
})

test('who gets access: signed partners only; former partners only while commission is outstanding', async () => {
  assert.equal(portal.resolvePortalAccessByEmail('nobody@example.com'), null)

  db.createPartnerReferral({
    referralProgram: 'public_10',
    partnerName: 'One Off',
    partnerEmail: 'oneoff@example.com',
    clientName: 'Some Couple',
    clientEmail: 'some@client.example',
  })
  assert.equal(portal.resolvePortalAccessByEmail('oneoff@example.com'), null, 'Refer a Couple users get no portal')

  const former = await signPartner('former@partner.example', 'Former Partner')
  const owed = attribute(former.referralToken, 'Owed Couple', 'owed@client.example', '2027-02-01')
  setRow(owed, { referralStatus: 'booked', bookingAmount: 1000, payoutAmount: 100 })
  db.default.prepare("UPDATE referral_partnerships SET status = 'inactive' WHERE id = ?").run(former.partnershipId)

  const formerAccess = portal.resolvePortalAccessById(former.partnershipId)
  assert.ok(formerAccess, 'former partner keeps read-only access while owed')
  const formerDash = portal.portalDashboard(formerAccess)
  assert.equal(formerDash.active, false)
  assert.equal(formerDash.referralLink, null, 'no referral link once the partnership ends')
  assert.equal(formerDash.earnings.pending, 100)

  setRow(owed, { payoutStatus: 'completed' })
  assert.equal(portal.resolvePortalAccessById(former.partnershipId), null, 'access ends when nothing is outstanding')

  const venueLike = db.default.prepare('SELECT id FROM referral_partnerships WHERE venueId IS NOT NULL').get()
  if (venueLike) assert.equal(portal.resolvePortalAccessById(venueLike.id), null)
})
