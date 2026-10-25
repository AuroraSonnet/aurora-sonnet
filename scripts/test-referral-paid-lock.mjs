import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

let dataDir
let db

test.before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'aurora-referral-paid-lock-'))
  process.env.DATA_DIR = dataDir
  db = await import('../server/db.js')
  const opened = String(db.default?.name || '')
  if (!opened.startsWith(dataDir)) {
    throw new Error(`Test opened ${opened} instead of ${dataDir}. Refusing to touch another database.`)
  }
})

test.after(() => {
  delete process.env.DATA_DIR
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

const FINANCIAL_COLUMNS = [
  'bookingAmount',
  'travelExpenseAmount',
  'hotelExpenseAmount',
  'expense_line_items',
  'commissionableAmount',
  'commissionableOverrideAmount',
  'payoutAmount',
  'payoutOverrideAmount',
  'payoutStatus',
]

const financial = (id) => {
  const row = db.default.prepare(`SELECT ${FINANCIAL_COLUMNS.join(', ')} FROM partner_referrals WHERE id = ?`).get(id)
  return { ...row }
}

let seq = 0
function makeReferral() {
  seq += 1
  return db.createPartnerReferral({
    partnerName: 'Lock Partner',
    partnerEmail: 'lock.partner@example.com',
    clientName: `Lock Couple ${seq}`,
    clientEmail: `lock.couple.${seq}@example.com`,
    referralStatus: 'booked',
    bookingAmount: 3000,
  }).id
}

/** A historical paid record whose stored amounts do not match today's formula (older rows used separate travel/hotel columns). */
function makePaidReferral(payoutStatus = 'completed') {
  const id = makeReferral()
  db.default
    .prepare(
      `UPDATE partner_referrals SET bookingAmount = 3000, travelExpenseAmount = 300, hotelExpenseAmount = 200,
        expense_line_items = NULL, commissionableAmount = 2500, commissionableOverrideAmount = NULL,
        payoutAmount = 175, payoutOverrideAmount = NULL, payoutStatus = ?, referralStatus = 'booked' WHERE id = ?`
    )
    .run(payoutStatus, id)
  return id
}

/** What the admin form sends: travel/hotel converted to expense lines, both columns sent as 0. */
function formPayload(id, overrides = {}) {
  const r = db.getPartnerReferral(id)
  return {
    partnerName: r.partnerName,
    partnerEmail: r.partnerEmail,
    clientName: r.clientName,
    clientEmail: r.clientEmail,
    notes: r.notes,
    referralStatus: r.referralStatus,
    payoutStatus: r.payoutStatus,
    bookingAmount: r.bookingAmount,
    expenseLineItems: [
      { id: 'l1', name: 'Travel', amount: 300 },
      { id: 'l2', name: 'Hotel', amount: 200 },
    ],
    travelExpenseAmount: 0,
    hotelExpenseAmount: 0,
    commissionableOverrideAmount: null,
    payoutOverrideAmount: null,
    ...overrides,
  }
}

for (const paidStatus of ['completed', 'paid']) {
  test(`${paidStatus} referral: status changes keep the financial record exactly as recorded`, () => {
    const id = makePaidReferral(paidStatus)
    const before = financial(id)
    for (const referralStatus of ['closed_lost', 'contacted', 'new', 'booked']) {
      const updated = db.updatePartnerReferral(id, { referralStatus })
      assert.equal(updated.referralStatus, referralStatus)
      assert.deepEqual(financial(id), before, `after status ${referralStatus}`)
    }
  })

  test(`${paidStatus} referral: non-financial edits from the admin form still save`, () => {
    const id = makePaidReferral(paidStatus)
    const before = financial(id)
    const updated = db.updatePartnerReferral(id, formPayload(id, { notes: 'Edited note', clientPhone: '555-010-9999', referralStatus: 'closed_lost' }))
    assert.equal(updated.notes, 'Edited note')
    assert.equal(updated.referralStatus, 'closed_lost')
    assert.deepEqual(financial(id), before)
  })

  test(`${paidStatus} referral: direct attempts to change locked fields are refused and change nothing`, () => {
    const id = makePaidReferral(paidStatus)
    const before = financial(id)
    const attempts = [
      { bookingAmount: 9000 },
      { travelExpenseAmount: 0, hotelExpenseAmount: 0, expenseLineItems: [] },
      { expenseLineItems: [{ name: 'Travel', amount: 1 }], travelExpenseAmount: 0, hotelExpenseAmount: 0 },
      { commissionableOverrideAmount: 100 },
      { payoutOverrideAmount: 5000 },
      { payoutAmount: 5000 },
      { commissionableAmount: 1 },
      { payoutStatus: 'none' },
      { payoutStatus: 'pending' },
      { payoutStatus: paidStatus === 'paid' ? 'completed' : 'paid' },
      { referralStatus: 'closed_lost', bookingAmount: 0 },
    ]
    for (const updates of attempts) {
      assert.throws(() => db.updatePartnerReferral(id, updates), { message: db.PAID_REFERRAL_LOCK_MESSAGE }, JSON.stringify(updates))
      assert.deepEqual(financial(id), before, JSON.stringify(updates))
    }
  })
}

const paymentDetails = (id) => {
  const r = db.default
    .prepare('SELECT commissionPaymentDate, commissionPaymentMethod, commissionPaymentReference FROM partner_referrals WHERE id = ?')
    .get(id)
  return { ...r }
}

/** Unpaid, booked referral that meets every payout precondition (event done, client paid, statement delivered). */
function makePayableUnpaid() {
  const id = makeReferral()
  const now = new Date().toISOString()
  db.default.prepare('UPDATE partner_referrals SET eventCompletedAt = ?, clientPaidInFullAt = ? WHERE id = ?').run(now, now, id)
  db.patchPartnerReferralFields(id, { commissionStatementGeneratedAt: now, commissionStatementDeliveredAt: now })
  return id
}

const DETAILS = { commissionPaymentDate: '2026-09-01', commissionPaymentMethod: 'ACH', commissionPaymentReference: 'TX-1001' }

test('unpaid payout: payment date, method and reference stay editable', () => {
  const id = makePayableUnpaid()
  db.updatePartnerReferral(id, DETAILS)
  assert.deepEqual(paymentDetails(id), DETAILS)
  db.updatePartnerReferral(id, { commissionPaymentMethod: 'Check', commissionPaymentReference: '' })
  assert.deepEqual(paymentDetails(id), { ...DETAILS, commissionPaymentMethod: 'Check', commissionPaymentReference: null })
  db.updatePartnerReferral(id, { notes: 'unrelated edit' })
  assert.equal(paymentDetails(id).commissionPaymentMethod, 'Check', 'omitted fields are left as saved')
  assert.equal(db.getPartnerReferral(id).payoutStatus, 'none')
})

for (const paidStatus of ['completed', 'paid']) {
  test(`first transition to ${paidStatus}: payment details save with the change, then lock`, async () => {
    const id = makePayableUnpaid()
    const marked = db.updatePartnerReferral(id, { payoutStatus: paidStatus, ...DETAILS })
    assert.equal(marked.payoutStatus, paidStatus)
    assert.deepEqual(paymentDetails(id), DETAILS)
    const moneyAfterPaid = financial(id)

    for (const updates of [
      { commissionPaymentDate: '2026-12-31' },
      { commissionPaymentMethod: 'Wire' },
      { commissionPaymentReference: 'TX-other' },
      { commissionPaymentReference: '' },
      { commissionPaymentDate: null },
      { referralStatus: 'closed_lost', commissionPaymentMethod: 'Wire' },
    ]) {
      assert.throws(() => db.updatePartnerReferral(id, updates), { message: db.PAYMENT_DETAILS_LOCK_MESSAGE }, JSON.stringify(updates))
      assert.deepEqual(paymentDetails(id), DETAILS, JSON.stringify(updates))
    }

    // Re-sending the saved values (what the admin form does) and non-financial edits still save.
    const resaved = db.updatePartnerReferral(id, { ...DETAILS, notes: 'after payment', referralStatus: 'closed_lost' })
    assert.equal(resaved.notes, 'after payment')
    assert.deepEqual(paymentDetails(id), DETAILS)
    assert.deepEqual(financial(id), moneyAfterPaid)

    // The commission statement path cannot rewrite them either.
    const decisions = await import('../server/partnerReferralDecisions.js')
    const changed = await decisions.generatePartnerReferralCommissionStatement(id, { paymentMethod: 'Wire' })
    assert.equal(changed.ok, false)
    assert.equal(changed.error, db.PAYMENT_DETAILS_LOCK_MESSAGE)
    assert.deepEqual(paymentDetails(id), DETAILS)
    const regenerated = await decisions.generatePartnerReferralCommissionStatement(id, { paymentDate: null, paymentMethod: null, paymentReference: null })
    assert.equal(regenerated.ok, true, 'regenerating without new details keeps the saved ones')
    assert.deepEqual(paymentDetails(id), DETAILS)
    assert.deepEqual(financial(id), moneyAfterPaid)
  })
}

test('statement path still saves payment details while the payout is unpaid', async () => {
  const id = makePayableUnpaid()
  const decisions = await import('../server/partnerReferralDecisions.js')
  const gen = await decisions.generatePartnerReferralCommissionStatement(id, { paymentDate: '2026-10-01', paymentMethod: 'Check', paymentReference: 'CHK-7' })
  assert.equal(gen.ok, true)
  assert.deepEqual(paymentDetails(id), { commissionPaymentDate: '2026-10-01', commissionPaymentMethod: 'Check', commissionPaymentReference: 'CHK-7' })
})

test('unpaid referral keeps current behavior: amounts recalculate from status and booking amount', () => {
  const id = makeReferral()
  db.updatePartnerReferral(id, { referralStatus: 'contacted' })
  assert.equal(db.getPartnerReferral(id).payoutAmount, 0, 'no payout before booked')
  const booked = db.updatePartnerReferral(id, { referralStatus: 'booked', bookingAmount: 4000 })
  assert.ok(booked.payoutAmount > 0, 'booked recalculates a payout')
  const higher = db.updatePartnerReferral(id, { bookingAmount: 8000 })
  assert.ok(higher.payoutAmount > booked.payoutAmount, 'booking amount still drives the payout')
  const withExpenses = db.updatePartnerReferral(id, { expenseLineItems: [{ name: 'Travel', amount: 1000 }] })
  assert.equal(withExpenses.bookingAmount, 8000)
  const pending = db.updatePartnerReferral(id, { payoutStatus: 'none', payoutOverrideAmount: 123 })
  assert.equal(pending.payoutAmount, 123, 'overrides still editable while unpaid')
})
