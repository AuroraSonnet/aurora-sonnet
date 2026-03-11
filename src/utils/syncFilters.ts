/**
 * Emails we treat as test/demo and skip when syncing inquiries from the website.
 * Prevents contacts like Test@example.com from being pulled into your CRM.
 */
const TEST_DOMAINS = ['example.com', 'example.org', 'test.com', 'localhost']
const TEST_LOCAL_PARTS = ['test', 'example', 'demo', 'foo', 'user']

function isTestEmail(email: string): boolean {
  const e = email.trim().toLowerCase()
  if (!e) return true
  const [local, domain] = e.split('@')
  if (!domain) return true
  const isTestDomain = TEST_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))
  if (isTestDomain) return true
  if (TEST_LOCAL_PARTS.includes(local) && isTestDomain) return true
  return false
}

const DELETED_KEY = 'aurora_deleted_client_ids'

function loadDeleted(): Set<string> {
  try {
    const raw = localStorage.getItem(DELETED_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}

function saveDeleted(ids: Set<string>): void {
  localStorage.setItem(DELETED_KEY, JSON.stringify([...ids]))
}

export function getDeletedClientIds(): Set<string> {
  return loadDeleted()
}

export function addDeletedClientId(id: string): void {
  const ids = loadDeleted()
  ids.add(id)
  saveDeleted(ids)
}

export function addDeletedClientIds(idList: string[]): void {
  const ids = loadDeleted()
  for (const id of idList) ids.add(id)
  saveDeleted(ids)
}

export function removeDeletedClientId(id: string): void {
  const ids = loadDeleted()
  ids.delete(id)
  saveDeleted(ids)
}

export function clearDeletedClientIds(): void {
  localStorage.removeItem(DELETED_KEY)
}

export { isTestEmail }
