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

let phoneSeq = 0
function attribute(token, clientName, clientEmail, eventDate) {
  const clientPhone = `212-555-${String(phoneSeq++).padStart(4, '0')}`
  const r = partners.attributeInquiryToReferralPartner({
    partnerToken: token,
    clientName,
    clientEmail,
    clientPhone,
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

let projectSeq = 0
function makeProject(clientName, weddingDate, { email = '', phone = null, value = 9999 } = {}) {
  projectSeq += 1
  const clientId = `ctest-${projectSeq}`
  const id = `ptest-${projectSeq}`
  db.createClient({ id: clientId, name: clientName, email, phone, createdAt: new Date().toISOString() })
  db.createProject({
    id,
    clientId,
    clientName,
    title: `${clientName} wedding`,
    stage: 'inquiry',
    value,
    weddingDate,
    dueDate: weddingDate,
  })
  return id
}

function link(referralId, projectId) {
  const r = db.linkReferralToProject(referralId, projectId, 'admin')
  assert.ok(r.link, r.error)
  return r.link.id
}

function act(linkId, action, payload) {
  const r = db.applyReferralProjectAction(linkId, action, payload)
  assert.ok(r.link, r.error)
  return r.link
}

function earn(linkId, amount) {
  act(linkId, 'confirm_booked')
  act(linkId, 'set_amount', { eligibleAmount: amount })
  return act(linkId, 'confirm_complete_paid')
}

test('project commission state needs every explicit admin confirmation', async () => {
  const c = await import('../server/referralProjectCommission.js')
  const referral = { agreementTermsSnapshot: { termsKind: 'public_partner_agreement', commissionRate: 0.1 } }
  const base = { bookedConfirmedAt: 'x', eligibleAmount: 5000, payoutStatus: 'none' }
  assert.equal(c.computeProjectCommission(base, referral), 500)
  assert.equal(c.computeProjectCommission({ ...base, bookedConfirmedAt: null }, referral), 0)
  assert.equal(c.computeProjectCommission({ ...base, eligibleAmount: 0 }, referral), 0)
  const withAmount = { ...base, commissionAmount: 500 }
  assert.equal(c.projectCommissionState({ ...withAmount, bookedConfirmedAt: null }, referral), null)
  assert.equal(c.projectCommissionState(withAmount, referral), 'pending')
  assert.equal(c.projectCommissionState({ ...withAmount, eventCompletedAt: 'x' }, referral), 'pending')
  assert.equal(c.projectCommissionState({ ...withAmount, eventCompletedAt: 'x', clientPaidInFullAt: 'x' }, referral), 'earned')
  assert.equal(c.projectCommissionState({ ...withAmount, payoutStatus: 'completed' }, referral), 'paid')

  const venue = { agreementTermsSnapshot: { termsKind: 'referral_partnership_mvp' }, referralDecisionStatus: 'pending' }
  assert.equal(c.computeProjectCommission(base, venue), 0, 'venue referral earns nothing before acceptance')
  assert.equal(
    c.projectCommissionState({ ...withAmount, eventCompletedAt: 'x', clientPaidInFullAt: 'x' }, venue),
    null
  )

  assert.equal(portal.partnerReferralStatusLabel({ referralStatus: 'new' }, []), 'New')
  assert.equal(portal.partnerReferralStatusLabel({ referralStatus: 'booked' }, []), 'New', 'no link cannot be Booked')
  assert.equal(portal.partnerReferralStatusLabel({ referralStatus: 'contacted' }, [{}]), 'In Progress')
  assert.equal(portal.partnerReferralStatusLabel({ referralStatus: 'new' }, [{ bookedConfirmedAt: 'x' }]), 'Booked')
  assert.equal(portal.partnerReferralStatusLabel({ referralStatus: 'closed_lost' }, [{}]), 'Not Booked')
  for (const payoutStatus of ['Paid', 'PAID', 'Completed', 'COMPLETED']) {
    assert.equal(
      portal.partnerReferralStatusLabel({ referralStatus: 'new', payoutStatus, payoutAmount: 200 }, []),
      'Booked',
      payoutStatus
    )
  }
  assert.equal(
    portal.partnerReferralStatusLabel({ referralStatus: 'new', payoutStatus: 'Paid', payoutAmount: 0 }, []),
    'New',
    'a zero payout is not a booked legacy commission'
  )
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

  // Pat and Quinn: two bookings, one confirmed and awaiting the event, one linked but not confirmed.
  const patFirst = link(pending, makeProject('Pat and Quinn', '2027-06-01'))
  act(patFirst, 'confirm_booked')
  act(patFirst, 'set_amount', { eligibleAmount: 5000 })
  link(pending, makeProject('Pat and Quinn', '2028-06-01'))
  // A referral-level commission with no project confirmation is history only, never counted.
  setRow(pending, { referralStatus: 'booked', bookingAmount: 7777, payoutAmount: 777, payoutStatus: 'pending' })

  const robinLink = earn(link(earned, makeProject('Robin and Sky', '2026-08-01')), 3000)
  assert.equal(robinLink.commissionAmount, 300)

  // Taylor and Uma: commission paid on the old referral record before per-project tracking.
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
    recordStatus: 'New',
    status: 'New',
    projects: [],
    earlierRecord: null,
  })
  const pat = byCouple['Pat and Quinn']
  assert.equal(pat.status, 'Booked')
  assert.equal(pat.projects.length, 2)
  assert.deepEqual(pat.projects[0], {
    projectDate: '2027-06-01',
    eligibleAmount: 5000,
    commission: 500,
    commissionStatus: 'Pending',
    bookingStatus: 'Booked',
    completionStatus: 'Awaiting event and final payment',
    payoutStatus: 'Not paid',
  })
  assert.equal(pat.projects[1].commission, null)
  assert.equal(pat.projects[1].bookingStatus, 'Not yet confirmed')
  assert.equal(byCouple['Robin and Sky'].projects[0].commissionStatus, 'Earned')
  assert.deepEqual(byCouple['Taylor and Uma'].earlierRecord, { commission: 200, commissionStatus: 'Paid' })
  assert.equal(byCouple['Taylor and Uma'].status, 'Booked')
  assert.equal(byCouple['Val and Wren'].status, 'Not Booked')

  const json = JSON.stringify(dash)
  for (const secret of ['casey@client.example', '212-555-0000', 'Secret Venue', '9999', '7777', '777', 'Other Couple', 'Email Only Couple', 'partnershipId', a.partnershipId, 'ptest-']) {
    assert.ok(!json.includes(secret), `dashboard must not expose ${secret}`)
  }

  const bDash = portal.portalDashboard(portal.resolvePortalAccessById(b.partnershipId))
  assert.deepEqual(bDash.referrals.map((r) => r.couple), ['Other Couple'])
  assert.notEqual(portal.resolvePortalAccessById(b.partnershipId).agreement.id, access.agreement.id)
  assert.equal(access.agreement.partnershipId, a.partnershipId)

  // The admin payout status on the project row is the source of truth.
  act(robinLink.id, 'set_payout_status', { payoutStatus: 'completed' })
  assert.deepEqual(portal.portalDashboard(portal.resolvePortalAccessById(a.partnershipId)).earnings, {
    pending: 500,
    earned: 0,
    paid: 500,
  })
})

test('admin workflow: link is association only, every step is explicit, paid is locked', async () => {
  const p = await signPartner('flow@partner.example', 'Flow Partner')
  const ref = attribute(p.referralToken, 'Flow Couple', 'flow@client.example', '2027-09-01')
  const projectId = makeProject('Flow Couple', '2027-09-01', { email: 'flow@client.example' })

  const suggested = db.getProjectReferralContext(projectId)
  assert.equal(suggested.kind, 'suggestion')
  assert.equal(suggested.referral.id, ref)

  const linkId = link(ref, projectId)
  const fresh = db.getReferralProjectLink(linkId)
  assert.equal(fresh.bookedConfirmedAt, null)
  assert.equal(fresh.eligibleAmount, null)
  assert.equal(fresh.payoutStatus, 'none')
  assert.equal(fresh.commissionAmount, 0)

  const other = attribute(p.referralToken, 'Someone Else', 'else@client.example', null)
  assert.ok(db.linkReferralToProject(other, projectId).error, 'a project belongs to one referral')
  assert.equal(db.getReferralProjectLink(linkId).referralId, ref, 'existing link is never overwritten')

  assert.ok(db.applyReferralProjectAction(linkId, 'confirm_complete_paid').error, 'needs booking first')
  act(linkId, 'confirm_booked')
  assert.ok(db.applyReferralProjectAction(linkId, 'confirm_complete_paid').error, 'needs amount first')
  act(linkId, 'set_amount', { eligibleAmount: 4000 })
  assert.ok(db.applyReferralProjectAction(linkId, 'set_payout_status', { payoutStatus: 'pending' }).error, 'not payable yet')

  // Paid invoices and projects.value never confirm anything.
  db.default
    .prepare(
      `INSERT INTO invoices (id, projectId, clientName, projectTitle, amount, status, dueDate) VALUES ('inv-flow', ?, 'Flow Couple', 'x', 4000, 'paid', '2027-09-01')`
    )
    .run(projectId)
  assert.equal(db.getReferralProjectLink(linkId).clientPaidInFullAt, null)

  act(linkId, 'confirm_complete_paid')
  // Before payout the admin may reduce the amount (e.g. after a refund).
  assert.equal(act(linkId, 'set_amount', { eligibleAmount: 3000 }).commissionAmount, 300)
  act(linkId, 'set_payout_status', { payoutStatus: 'pending' })
  const paidLink = act(linkId, 'set_payout_status', { payoutStatus: 'completed' })
  assert.equal(paidLink.commissionState, 'paid')
  assert.ok(db.applyReferralProjectAction(linkId, 'set_amount', { eligibleAmount: 1 }).error, 'paid is locked')
  assert.ok(db.applyReferralProjectAction(linkId, 'set_payout_status', { payoutStatus: 'none' }).error, 'paid cannot reopen')
  assert.ok(db.unlinkReferralProject(linkId).error, 'confirmed link cannot be removed')
  assert.throws(() => db.deletePartnerReferral(ref), /kept as history/)

  assert.throws(
    () => db.updatePartnerReferral(ref, { bookingAmount: 123 }),
    /tracked per project/,
    'referral-level amounts are read-only once projects are linked'
  )
  assert.ok(db.updatePartnerReferral(ref, { notes: 'still editable' }))

  const bare = makeProject('Unlink Couple', '2027-10-01')
  const bareLink = link(other, bare)
  assert.ok(db.unlinkReferralProject(bareLink).ok, 'untouched link can be removed')

  assert.equal(db.getProjectReferralContext(makeProject('Flow Couple', '2027-11-01')).kind, 'none', 'name alone never suggests')
})

test('backfill links only unambiguous legacy ids, once, and flags the rest for review', async () => {
  const p = await signPartner('mig@partner.example', 'Mig Partner')
  const good = attribute(p.referralToken, 'Good Link', 'good@client.example', null)
  const mismatch = attribute(p.referralToken, 'Mismatch', 'mismatch@client.example', null)
  const missing = attribute(p.referralToken, 'Missing', 'missing@client.example', null)
  const paidLegacy = attribute(p.referralToken, 'Paid Legacy', 'paidlegacy@client.example', null)
  const goodProject = makeProject('Good Link', '2027-01-01')
  const paidProject = makeProject('Paid Legacy', '2026-01-01')
  setRow(good, { linkedProjectId: goodProject, linkedLeadId: goodProject, bookingAmount: 5000, payoutAmount: 500, eventCompletedAt: 'x' })
  setRow(mismatch, { linkedProjectId: goodProject, linkedLeadId: paidProject })
  setRow(missing, { linkedProjectId: 'p-does-not-exist' })
  setRow(paidLegacy, { linkedProjectId: paidProject, referralStatus: 'booked', bookingAmount: 2000, payoutAmount: 200, payoutStatus: 'completed' })

  const paidNoId = attribute(p.referralToken, 'Paid No Id', 'paidnoid@client.example', null)
  setRow(paidNoId, { bookingAmount: 1000, payoutAmount: 100, payoutStatus: 'completed' })

  db.default
    .prepare("DELETE FROM app_settings WHERE key IN ('partner_referral_projects_backfill_v1', 'partner_referral_legacy_paid_project_v1')")
    .run()
  db.protectLegacyPaidProjectsOnce()
  db.backfillReferralProjectLinksOnce()
  assert.equal(db.getPartnerReferral(paidLegacy).legacyPaidProjectId, paidProject)
  assert.equal(db.getPartnerReferral(paidNoId).legacyPaidProjectId, undefined, 'no reliable id: nothing guessed')
  assert.equal(db.backfillReferralProjectLinksOnce().skipped, true, 'runs once')

  const goodLink = db.getReferralProjectLinkByProjectId(goodProject)
  assert.equal(goodLink.referralId, good)
  assert.equal(goodLink.linkSource, 'migration')
  assert.equal(goodLink.eligibleAmount, null, 'legacy amount is not copied')
  assert.equal(goodLink.bookedConfirmedAt, null)
  assert.equal(goodLink.eventCompletedAt, null, 'legacy dates are not copied')
  assert.equal(db.listReferralProjectLinksForReferral(mismatch).length, 0)
  assert.equal(db.listReferralProjectLinksForReferral(missing).length, 0)

  const paidLink = db.getReferralProjectLinkByProjectId(paidProject)
  assert.equal(paidLink.referralId, paidLegacy)
  assert.ok(db.applyReferralProjectAction(paidLink.id, 'confirm_booked').error, 'no second commission for a paid legacy booking')
  assert.equal(db.getPartnerReferral(paidLegacy).payoutStatus, 'completed', 'paid history untouched')

  // Unlinking and relinking as an admin link does not lift the protection.
  assert.ok(db.unlinkReferralProject(paidLink.id).ok)
  const relinked = link(paidLegacy, paidProject)
  assert.ok(db.applyReferralProjectAction(relinked, 'confirm_booked').error, 'still blocked after relink')

  // Ordinary referral updates cannot clear or replace the protected id.
  db.updatePartnerReferral(paidLegacy, { linkedProjectId: null, linkedLeadId: null, legacyPaidProjectId: null })
  assert.equal(db.getPartnerReferral(paidLegacy).legacyPaidProjectId, paidProject)
  assert.ok(db.applyReferralProjectAction(relinked, 'confirm_booked').error)

  // A genuinely separate later booking for the same couple still earns.
  const later = link(paidLegacy, makeProject('Paid Legacy', '2028-01-01'))
  assert.ok(act(later, 'confirm_booked').bookedConfirmedAt)

  // Portal: the protected booking appears only as the earlier record; the later booking is still listed.
  const migDash = portal.portalDashboard(portal.resolvePortalAccessById(p.partnershipId))
  const paidRow = migDash.referrals.find((r) => r.couple === 'Paid Legacy')
  assert.deepEqual(paidRow.projects.map((x) => x.projectDate), ['2028-01-01'])
  assert.deepEqual(paidRow.earlierRecord, { commission: 200, commissionStatus: 'Paid' })
  assert.equal(db.listReferralProjectLinksForReferral(paidLegacy).length, 2, 'records unchanged; only the portal view filters')

  const noIdOther = link(paidNoId, makeProject('Paid No Id', '2028-02-01'))
  assert.ok(act(noIdOther, 'confirm_booked').bookedConfirmedAt, 'unrelated project is not blocked')

  const review = Object.fromEntries(db.listReferralProjectLinkReview().map((r) => [r.referralId, r.reasons.map((x) => x.code)]))
  assert.deepEqual(review[mismatch], ['legacy_link_mismatch'])
  assert.deepEqual(review[missing], ['legacy_link_missing_project'])
  assert.ok(review[good].includes('legacy_commission_unconfirmed'))
  assert.ok(review[paidNoId].includes('legacy_paid_no_project'))
  assert.ok(!(review[paidLegacy] || []).includes('legacy_paid_no_project'))
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
  const owedLink = link(owed, makeProject('Owed Couple', '2027-02-01'))
  act(owedLink, 'confirm_booked')
  act(owedLink, 'set_amount', { eligibleAmount: 1000 })
  db.default.prepare("UPDATE referral_partnerships SET status = 'inactive' WHERE id = ?").run(former.partnershipId)

  const formerAccess = portal.resolvePortalAccessById(former.partnershipId)
  assert.ok(formerAccess, 'former partner keeps read-only access while owed')
  const formerDash = portal.portalDashboard(formerAccess)
  assert.equal(formerDash.active, false)
  assert.equal(formerDash.referralLink, null, 'no referral link once the partnership ends')
  assert.equal(formerDash.earnings.pending, 100)

  act(owedLink, 'confirm_complete_paid')
  act(owedLink, 'set_payout_status', { payoutStatus: 'completed' })
  assert.equal(portal.resolvePortalAccessById(former.partnershipId), null, 'access ends when nothing is outstanding')

  const venueLike = db.default.prepare('SELECT id FROM referral_partnerships WHERE venueId IS NOT NULL').get()
  if (venueLike) assert.equal(portal.resolvePortalAccessById(venueLike.id), null)
})
