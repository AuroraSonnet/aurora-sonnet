/**
 * Aurora Sonnet organization fields used in referral partnership agreements.
 * Stored in app_settings; never infers personal/home addresses.
 */
import { getAppSetting, setAppSetting } from './db.js'

export const AURORA_ORG_SETTINGS_KEYS = {
  legalName: 'auroraOrgLegalName',
  legalAddress: 'auroraOrgLegalAddress',
  signatoryName: 'auroraOrgSignatoryName',
  signatoryTitle: 'auroraOrgSignatoryTitle',
  noticeEmail: 'auroraOrgNoticeEmail',
}

export const DEFAULT_AURORA_ORG = {
  legalName: 'Aurora Sonnet LLC',
  legalAddress: '',
  signatoryName: 'Lisa Dubocquet',
  signatoryTitle: 'Founder & Artistic Director',
  noticeEmail: '',
}

export function getAuroraOrganizationSettings() {
  return {
    legalName: getAppSetting(AURORA_ORG_SETTINGS_KEYS.legalName, DEFAULT_AURORA_ORG.legalName) || DEFAULT_AURORA_ORG.legalName,
    legalAddress: getAppSetting(AURORA_ORG_SETTINGS_KEYS.legalAddress, DEFAULT_AURORA_ORG.legalAddress) ?? '',
    signatoryName: getAppSetting(AURORA_ORG_SETTINGS_KEYS.signatoryName, DEFAULT_AURORA_ORG.signatoryName) || DEFAULT_AURORA_ORG.signatoryName,
    signatoryTitle:
      getAppSetting(AURORA_ORG_SETTINGS_KEYS.signatoryTitle, DEFAULT_AURORA_ORG.signatoryTitle) ||
      DEFAULT_AURORA_ORG.signatoryTitle,
    noticeEmail: getAppSetting(AURORA_ORG_SETTINGS_KEYS.noticeEmail, DEFAULT_AURORA_ORG.noticeEmail) ?? '',
  }
}

export function updateAuroraOrganizationSettings(patch) {
  const cur = getAuroraOrganizationSettings()
  const next = {
    legalName: patch.legalName != null ? String(patch.legalName).trim() : cur.legalName,
    legalAddress: patch.legalAddress != null ? String(patch.legalAddress).trim() : cur.legalAddress,
    signatoryName: patch.signatoryName != null ? String(patch.signatoryName).trim() : cur.signatoryName,
    signatoryTitle: patch.signatoryTitle != null ? String(patch.signatoryTitle).trim() : cur.signatoryTitle,
    noticeEmail: patch.noticeEmail != null ? String(patch.noticeEmail).trim() : cur.noticeEmail,
  }
  setAppSetting(AURORA_ORG_SETTINGS_KEYS.legalName, next.legalName)
  setAppSetting(AURORA_ORG_SETTINGS_KEYS.legalAddress, next.legalAddress)
  setAppSetting(AURORA_ORG_SETTINGS_KEYS.signatoryName, next.signatoryName)
  setAppSetting(AURORA_ORG_SETTINGS_KEYS.signatoryTitle, next.signatoryTitle)
  setAppSetting(AURORA_ORG_SETTINGS_KEYS.noticeEmail, next.noticeEmail)
  return getAuroraOrganizationSettings()
}

export function auroraOrgFieldsForAgreement() {
  const org = getAuroraOrganizationSettings()
  return {
    agencyLegalName: org.legalName,
    agencyAddress: org.legalAddress,
    agencySignatoryName: org.signatoryName,
    agencySignatoryTitle: org.signatoryTitle,
    agencyNoticeEmail: org.noticeEmail,
  }
}
