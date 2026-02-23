/**
 * Aurora Sonnet performance packages — Solo Opera Singer Experience.
 * Clients choose one when requesting a specific artist.
 */

export type PackageId = 'signature-aria' | 'aria-plus' | 'grand-atelier'

export interface PerformancePackage {
  id: PackageId
  name: string
  shortName: string
  fromPrice: number
  description: string
  bullets: string[]
}

export const PERFORMANCE_PACKAGES: PerformancePackage[] = [
  {
    id: 'signature-aria',
    name: 'Signature Aria',
    shortName: 'Signature Aria',
    fromPrice: 2750,
    description: 'One curated live vocal moment — ceremony, dinner serenade, or featured reception highlight.',
    bullets: [
      'One curated live vocal moment (ceremony, dinner serenade, or featured reception highlight)',
      'One bespoke song request',
      'Refined repertoire guidance',
    ],
  },
  {
    id: 'aria-plus',
    name: 'Aria +',
    shortName: 'Aria +',
    fromPrice: 3950,
    description: 'Two curated live vocal moments with expanded repertoire.',
    bullets: [
      'Two curated live vocal moments',
      'Expanded repertoire with up to two bespoke requests',
      'Refined repertoire guidance',
    ],
  },
  {
    id: 'grand-atelier',
    name: 'Grand Atelier',
    shortName: 'Grand Atelier',
    fromPrice: 5800,
    description: 'Three vocal moments woven throughout the day — the full experience.',
    bullets: [
      'Three curated live vocal moments woven throughout the day',
      'Signature repertoire expansion with up to three bespoke requests',
      'Refined repertoire guidance',
    ],
  },
]

export function getPackage(id: PackageId | string | undefined): PerformancePackage | undefined {
  if (!id) return undefined
  return PERFORMANCE_PACKAGES.find((p) => p.id === id)
}

export function getPackageLabel(id: PackageId | string | undefined): string {
  const pkg = getPackage(id)
  return pkg ? pkg.shortName : id ?? '—'
}

export function getPackagePrice(id: PackageId | string | undefined): number | undefined {
  const pkg = getPackage(id)
  return pkg?.fromPrice
}

/** Duo Vocal experience packages (two vocalists). */
export type DuoPackageId = 'signature-aria-duo' | 'aria-plus-duo' | 'grand-atelier-duo'

export interface DuoPackage {
  id: DuoPackageId
  name: string
  shortName: string
  fromPrice: number
  description: string
  bullets: string[]
}

export const DUO_PACKAGES: DuoPackage[] = [
  {
    id: 'signature-aria-duo',
    name: 'Signature Aria Duo',
    shortName: 'Signature Aria Duo',
    fromPrice: 4950,
    description: 'A timeless, emotionally resonant pairing.',
    bullets: [
      'One curated live moment (ceremony, cocktail hour, or featured reception highlight)',
      'One bespoke song request',
      'Refined repertoire guidance',
    ],
  },
  {
    id: 'aria-plus-duo',
    name: 'Aria + Duo',
    shortName: 'Aria + Duo',
    fromPrice: 6950,
    description: 'An expanded live presence that carries the atmosphere beyond the aisle.',
    bullets: [
      'Two curated live vocal moments (ceremony, cocktail hour, or featured reception highlight)',
      'Expanded repertoire with up to two bespoke requests',
      'Refined repertoire guidance',
    ],
  },
  {
    id: 'grand-atelier-duo',
    name: 'Grand Atelier Duo',
    shortName: 'Grand Atelier Duo',
    fromPrice: 9950,
    description: 'For couples who want a cohesive live vocal thread woven throughout their celebration.',
    bullets: [
      'Three curated live vocal moments woven throughout your day',
      'Signature repertoire expansion, with up to three bespoke requests',
      'Refined repertoire guidance',
    ],
  },
]

export function getDuoPackage(id: DuoPackageId | string | undefined): DuoPackage | undefined {
  if (!id) return undefined
  return DUO_PACKAGES.find((p) => p.id === id)
}

/** Label for either solo or duo package (for display in Bookings, etc.). */
export function getPackageOrDuoLabel(id: string | undefined): string {
  const solo = getPackage(id)
  if (solo) return solo.shortName
  const duo = getDuoPackage(id)
  if (duo) return duo.shortName
  return id ?? '—'
}

/** Price for either solo or duo package. */
export function getPackageOrDuoPrice(id: string | undefined): number | undefined {
  const solo = getPackage(id)
  if (solo) return solo.fromPrice
  const duo = getDuoPackage(id)
  if (duo) return duo.fromPrice
  return undefined
}

/** All packages (solo + duo) for dropdowns that need both. */
export const ALL_PACKAGES = [...PERFORMANCE_PACKAGES, ...DUO_PACKAGES] as (PerformancePackage | DuoPackage)[]
