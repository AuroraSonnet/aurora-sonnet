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
  // Only treat test/demo/etc as test when domain is also test (e.g. test@example.com). Allow test@gmail.com.
  if (TEST_LOCAL_PARTS.includes(local) && isTestDomain) return true
  return false
}

// Soft-delete tracking (currently disabled to avoid blocking new inquiries).
// We keep these functions so calls compile, but they are no-ops so sync always
// reflects whatever the API returns.
export function getDeletedClientIds(): Set<string> {
  return new Set()
}

export function addDeletedClientId(_id: string): void {
  // no-op
}

export function removeDeletedClientId(_id: string): void {
  // no-op
}

export function clearDeletedClientIds(): void {
  // no-op
}

export { isTestEmail }
