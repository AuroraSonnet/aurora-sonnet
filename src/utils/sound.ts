const AudioCtx = typeof window !== 'undefined'
  ? (window.AudioContext || (window as any).webkitAudioContext)
  : null

let inquirySoundCtx: AudioContext | null = null

/**
 * Call this synchronously when the user clicks Sync (before any await).
 * Browsers only allow audio after a user gesture; creating/resuming here
 * "unlocks" playback so the chime can play when sync completes.
 */
export function prepareInquirySoundContext(): void {
  if (typeof window === 'undefined' || !AudioCtx) return
  try {
    if (!inquirySoundCtx) inquirySoundCtx = new AudioCtx()
    if (inquirySoundCtx.state === 'suspended') inquirySoundCtx.resume()
  } catch {
    // ignore
  }
}

/** Soft UI-style completion chime when a new inquiry is synced. Uses context prepared on click. */
export function playNewInquirySound(): void {
  try {
    if (typeof window === 'undefined' || !AudioCtx) return
    const ctx = inquirySoundCtx || new AudioCtx()
    if (ctx.state === 'suspended') ctx.resume()
    if (!inquirySoundCtx) inquirySoundCtx = ctx

    const gain = ctx.createGain()
    gain.gain.value = 0.2
    gain.connect(ctx.destination)

    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = 1100 // bright but soft
    osc.connect(gain)

    const now = ctx.currentTime
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.2, now + 0.03)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25)

    osc.start(now)
    osc.stop(now + 0.3)
  } catch {
    // ignore audio errors
  }
}

