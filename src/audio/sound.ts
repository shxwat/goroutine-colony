/**
 * Procedural, asset-free sound. Everything is synthesized from oscillators and
 * a noise buffer: a low hum for the colony's metabolism, ticks for channel
 * traffic, a mechanical clunk for locks, a torn burst for races, and the hum
 * sinking into silence before a deadlock is announced.
 */
class ColonyAudio {
  ctx: AudioContext | null = null
  master!: GainNode
  private humGain!: GainNode
  /** Event sounds sit ~8 dB above the hum so they read on laptop and phone speakers. */
  private fx!: GainNode
  private hum: OscillatorNode[] = []
  private noise!: AudioBuffer
  enabled = false

  enable() {
    if (!this.ctx) this.build()
    this.enabled = true
    void this.ctx!.resume()
    this.ramp(this.master.gain, 2.4, 0.4)
  }

  disable() {
    this.enabled = false
    if (!this.ctx) return
    this.ramp(this.master.gain, 0, 0.25)
  }

  private build() {
    const ctx = new AudioContext()
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -18
    comp.ratio.value = 4
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -6
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.001
    limiter.release.value = 0.08
    this.master.connect(comp).connect(limiter).connect(ctx.destination)
    this.fx = ctx.createGain()
    this.fx.gain.value = 2.6
    this.fx.connect(this.master)

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = this.noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1

    // the hum: two beating sines and a breath of filtered noise
    this.humGain = ctx.createGain()
    this.humGain.gain.value = 0.05
    this.humGain.connect(this.master)
    // an audible body for small speakers: a soft filtered triangle an octave up
    const body = ctx.createOscillator()
    body.type = 'triangle'
    body.frequency.value = 110
    const bodyLp = ctx.createBiquadFilter()
    bodyLp.type = 'lowpass'
    bodyLp.frequency.value = 420
    const bodyGain = ctx.createGain()
    bodyGain.gain.value = 0.32
    body.connect(bodyLp).connect(bodyGain).connect(this.humGain)
    body.start()
    this.hum.push(body)
    for (const f of [55, 55.6, 165.2]) {
      const o = ctx.createOscillator()
      o.type = 'sine'
      o.frequency.value = f
      const g = ctx.createGain()
      g.gain.value = f > 100 ? 0.12 : 0.6
      o.connect(g).connect(this.humGain)
      o.start()
      this.hum.push(o)
    }
    const n = ctx.createBufferSource()
    n.buffer = this.noise
    n.loop = true
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 700
    const ng = ctx.createGain()
    ng.gain.value = 0.22
    n.connect(lp).connect(ng).connect(this.humGain)
    n.start()
  }

  private ramp(p: AudioParam, v: number, secs: number) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    p.cancelScheduledValues(t)
    p.setValueAtTime(p.value, t)
    p.linearRampToValueAtTime(v, t + secs)
  }

  private get live() {
    return this.enabled && this.ctx != null
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0) {
    const ctx = this.ctx!
    const t = ctx.currentTime + delay
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f0, t)
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.fx)
    o.start(t)
    o.stop(t + dur + 0.02)
  }

  private burst(freq: number, q: number, dur: number, gain: number, delay = 0) {
    const ctx = this.ctx!
    const t = ctx.currentTime + delay
    const s = ctx.createBufferSource()
    s.buffer = this.noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = freq
    bp.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    s.connect(bp).connect(g).connect(this.fx)
    s.start(t, Math.random())
    s.stop(t + dur + 0.02)
  }

  /** Payload enters a conduit. */
  tick(pitch = 1) {
    if (!this.live) return
    this.burst(3200 * pitch, 6, 0.03, 0.12)
    this.tone('sine', 1900 * pitch, 1300 * pitch, 0.05, 0.03)
  }

  spawn() {
    if (!this.live) return
    this.tone('sine', 280, 620, 0.12, 0.035)
    this.burst(5000, 3, 0.05, 0.03)
  }

  block() {
    if (!this.live) return
    this.tone('triangle', 160, 120, 0.09, 0.05)
  }

  lock() {
    if (!this.live) return
    this.tone('sine', 110, 48, 0.16, 0.16)
    this.burst(900, 10, 0.06, 0.12)
    this.tone('triangle', 1240, 1180, 0.18, 0.025, 0.01)
  }

  unlock() {
    if (!this.live) return
    this.burst(2400, 8, 0.025, 0.08)
    this.burst(2900, 8, 0.025, 0.06, 0.06)
  }

  write() {
    if (!this.live) return
    this.tone('sine', 880, 990, 0.08, 0.025)
  }

  glitch() {
    if (!this.live) return
    for (let i = 0; i < 9; i++) {
      this.tone('square', 200 + Math.random() * 1800, 60 + Math.random() * 400, 0.05 + Math.random() * 0.08, 0.06, i * 0.045)
    }
    this.burst(1200, 0.7, 0.5, 0.18)
  }

  /** The hum sinks and dies. */
  drain(secs: number) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    for (const o of this.hum) {
      o.frequency.cancelScheduledValues(t)
      o.frequency.setValueAtTime(o.frequency.value, t)
      o.frequency.exponentialRampToValueAtTime(o.frequency.value * 0.35, t + secs)
    }
    this.ramp(this.humGain.gain, 0, secs)
  }

  /** One dull note as the runtime speaks. */
  fatal() {
    if (!this.live) return
    this.tone('sine', 65, 40, 1.6, 0.16)
    this.tone('triangle', 130, 80, 1.2, 0.045)
    this.burst(400, 1, 0.3, 0.05)
  }

  type() {
    if (!this.live) return
    this.burst(4200, 4, 0.012, 0.025)
  }

  restore() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const base = [110, 55, 55.6, 165.2]
    this.hum.forEach((o, i) => {
      o.frequency.cancelScheduledValues(t)
      o.frequency.setValueAtTime(o.frequency.value, t)
      o.frequency.linearRampToValueAtTime(base[i], t + 1.2)
    })
    this.ramp(this.humGain.gain, 0.05, 1.5)
  }
}

export const audio = new ColonyAudio()

if (import.meta.env.DEV) {
  ;(window as unknown as { __audio: unknown }).__audio = audio
}
