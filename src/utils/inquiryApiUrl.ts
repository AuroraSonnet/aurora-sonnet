/**
 * Single source of truth for where inquiry forms submit and where the app syncs from.
 * Change this default if your deployed API has a different URL (e.g. new Render service).
 * You can also override per device in Settings → Inquiry API URL.
 */
export const DEFAULT_INQUIRY_API_URL = 'https://aurora-sonnet.onrender.com'

const STORAGE_KEY = 'aurora_inquiry_api_url'

export function getInquiryApiBaseUrl(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_INQUIRY_API_URL
  const saved = localStorage.getItem(STORAGE_KEY)
  const base = saved && saved.trim() ? saved.trim().replace(/\/$/, '') : DEFAULT_INQUIRY_API_URL
  return base || DEFAULT_INQUIRY_API_URL
}

export function getInquiryApiUrlKey(): string {
  return STORAGE_KEY
}
