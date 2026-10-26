/**
 * Opening Bookings must not save a second copy of a booking that is already on this server.
 * Run: node --test scripts/test-booking-duplicate-guard.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('the hosted admin is the same server as its inquiry URL', async () => {
  const urls = await import('../src/utils/inquiryApiUrl.ts')
  assert.equal(
    urls.inquiryApiIsThisApp('https://aurora-sonnet-1.onrender.com', 'https://aurora-sonnet-1.onrender.com'),
    true
  )
  assert.equal(
    urls.inquiryApiIsThisApp('https://aurora-sonnet-1.onrender.com/', 'https://aurora-sonnet-1.onrender.com'),
    true
  )
  assert.equal(urls.inquiryApiIsThisApp('https://aurora-sonnet-1.onrender.com', 'http://127.0.0.1:3001'), false)
})

test('a sync copy of an existing booking is refused', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'aurora-booking-copy-'))
  process.env.DATA_DIR = dataDir
  try {
    const db = await import('../server/db.js')
    const opened = String(db.default?.name || '')
    if (!opened.startsWith(dataDir)) throw new Error(`Test opened ${opened} instead of ${dataDir}`)
    const project = {
      id: 'p1',
      clientId: 'c1',
      clientName: 'John Taylon',
      title: 'General inquiry',
      stage: 'inquiry',
      value: 0,
      weddingDate: '2026-06-12',
      dueDate: '2026-06-12',
      createdAt: '2026-06-12',
    }
    db.createProject(project)
    assert.equal(db.findStoredProjectCopy('p1'), 'p1')
    const copy = { ...project, id: 'p2', cloudProjectId: 'p1' }
    assert.equal(db.findStoredProjectCopy(copy.cloudProjectId), 'p1')
    const before = db.default.prepare('SELECT COUNT(*) AS n FROM projects').get().n
    if (!db.findStoredProjectCopy(copy.cloudProjectId)) db.createProject(copy)
    const after = db.default.prepare('SELECT COUNT(*) AS n FROM projects').get().n
    assert.equal(before, 1)
    assert.equal(after, 1)
    db.createProject({ ...project, id: 'p9', clientName: 'Someone New', title: 'Other wedding', cloudProjectId: null })
    assert.equal(db.default.prepare('SELECT COUNT(*) AS n FROM projects').get().n, 2)
  } finally {
    delete process.env.DATA_DIR
    rmSync(dataDir, { recursive: true, force: true })
  }
})
