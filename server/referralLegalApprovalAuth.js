/**
 * CRM users authorized to record external legal approval/rejection for referral agreements.
 */
import { getAppSetting, setAppSetting } from './db.js'

const SETTINGS_KEY = 'referralLegalApprovalUsernames'

function parseUsernameList(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map((u) => String(u).trim()).filter(Boolean)
  try {
    const parsed = JSON.parse(String(raw))
    if (Array.isArray(parsed)) return parsed.map((u) => String(u).trim()).filter(Boolean)
  } catch {
    // fall through
  }
  return String(raw)
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
}

export function getLegalApprovalAuthorizedUsernames(adminUsername = '') {
  const fromSettings = parseUsernameList(getAppSetting(SETTINGS_KEY, ''))
  if (fromSettings.length) return fromSettings
  const fromEnv = parseUsernameList(process.env.LEGAL_APPROVAL_USERNAMES || '')
  if (fromEnv.length) return fromEnv
  const admin = String(adminUsername || process.env.ADMIN_USERNAME || '').trim()
  return admin ? [admin] : []
}

export function canUserRecordLegalApproval(username) {
  const u = String(username || '').trim()
  if (!u) return false
  const allowed = getLegalApprovalAuthorizedUsernames()
  return allowed.includes(u)
}

export function setLegalApprovalAuthorizedUsernames(usernames) {
  const list = parseUsernameList(usernames)
  setAppSetting(SETTINGS_KEY, JSON.stringify(list))
  return list
}
