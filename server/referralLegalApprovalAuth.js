/**
 * CRM users authorized to record Owner Approval / rejection for referral agreements.
 */
import { getAppSetting, setAppSetting } from './db.js'

const SETTINGS_KEY = 'referralOwnerApprovalUsernames'

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

export function getOwnerApprovalAuthorizedUsernames(adminUsername = '') {
  const fromSettings = parseUsernameList(getAppSetting(SETTINGS_KEY, ''))
  if (fromSettings.length) return fromSettings
  const legacy = parseUsernameList(getAppSetting('referralLegalApprovalUsernames', ''))
  if (legacy.length) return legacy
  const fromEnv = parseUsernameList(process.env.OWNER_APPROVAL_USERNAMES || process.env.LEGAL_APPROVAL_USERNAMES || '')
  if (fromEnv.length) return fromEnv
  const admin = String(adminUsername || process.env.ADMIN_USERNAME || '').trim()
  return admin ? [admin] : []
}

export function canUserRecordOwnerApproval(username) {
  const u = String(username || '').trim()
  if (!u) return false
  return getOwnerApprovalAuthorizedUsernames().includes(u)
}

/** @deprecated */
export function getLegalApprovalAuthorizedUsernames(adminUsername) {
  return getOwnerApprovalAuthorizedUsernames(adminUsername)
}

/** @deprecated */
export function canUserRecordLegalApproval(username) {
  return canUserRecordOwnerApproval(username)
}

export function setOwnerApprovalAuthorizedUsernames(usernames) {
  const list = parseUsernameList(usernames)
  setAppSetting(SETTINGS_KEY, JSON.stringify(list))
  return list
}

/** @deprecated */
export function setLegalApprovalAuthorizedUsernames(usernames) {
  return setOwnerApprovalAuthorizedUsernames(usernames)
}
