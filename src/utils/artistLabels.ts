/** Map requestedArtist id (from inquiry form) to display name */
export const REQUESTED_ARTIST_LABELS: Record<string, string> = {
  'eli-liv': 'Eli & Liv',
  'riley-richard': 'Riley & Lu',
  'garrett-tamara': 'Garrett & Tamara',
}

export function getRequestedArtistLabel(id: string | undefined | null): string | null {
  if (!id || !id.trim()) return null
  return REQUESTED_ARTIST_LABELS[id] ?? id
}
