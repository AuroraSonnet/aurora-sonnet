export function playNewInquirySound() {
  try {
    if (typeof window === 'undefined') return
    const AudioCtx = (window.AudioContext || (window as any).webkitAudioContext) as
      | (new () => AudioContext)
      | undefined
    if (!AudioCtx) return

    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.value = 0.15

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start()
    setTimeout(() => {
      osc.stop()
      ctx.close()
    }, 200)
  } catch {
    // ignore audio errors
  }
}

