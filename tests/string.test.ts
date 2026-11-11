// Offline tests of the compiled Faust string model. Every assertion is made on
// audio rendered by the same WebAssembly module the browser runs.
import { describe, expect, test } from 'vitest'
import { stringFundamental } from '../src/audio/engine/physics'
import {
  amplitudeAt,
  cents,
  createString,
  decayTime,
  envelope,
  measureFrequency,
  peak,
  rms,
  SR,
} from './helpers'

const DEFAULTS = { length: 0.65, tension: 73.5, density: 0.0036 }

async function measured(params: Parameters<typeof createString>[0], sampleRate = SR) {
  const s = await createString({ damping: 0.1, ...params }, sampleRate)
  return measureFrequency(s.pluckAndRender(1), sampleRate)
}

describe('plucked string', () => {
  test('1. is silent until plucked, then produces audio', async () => {
    const s = await createString()
    expect(peak(s.render(0.2))).toBe(0)
    const out = s.pluckAndRender(0.5)
    expect(rms(out)).toBeGreaterThan(0.05)
  })

  test('2. doubling length halves the fundamental', async () => {
    const short = await measured({ ...DEFAULTS, length: 0.5 })
    const long = await measured({ ...DEFAULTS, length: 1.0 })
    expect(Math.abs(cents(short / long, 2))).toBeLessThan(1)
  })

  test('3. increasing tension raises the fundamental as sqrt(T)', async () => {
    const low = await measured({ ...DEFAULTS, tension: 40 })
    const high = await measured({ ...DEFAULTS, tension: 160 })
    expect(high).toBeGreaterThan(low)
    expect(Math.abs(cents(high / low, 2))).toBeLessThan(1)
  })

  test('4. increasing linear density lowers the fundamental as 1/sqrt(mu)', async () => {
    const light = await measured({ ...DEFAULTS, density: 0.002 })
    const heavy = await measured({ ...DEFAULTS, density: 0.008 })
    expect(heavy).toBeLessThan(light)
    expect(Math.abs(cents(light / heavy, 2))).toBeLessThan(1)
  })

  test('measured pitch matches f = sqrt(T/mu) / (2L) across the range', async () => {
    const cases = [
      { ...DEFAULTS, fret: 0 }, // ~110 Hz
      { ...DEFAULTS, fret: 7 },
      { ...DEFAULTS, fret: 12 },
      { ...DEFAULTS, fret: 24 }, // ~440 Hz
      { length: 1.2, tension: 30, density: 0.01, fret: 0 }, // lowest, ~23 Hz
      { length: 0.3, tension: 200, density: 0.0004, fret: 0 }, // ~1179 Hz
      { length: 0.3, tension: 200, density: 0.0004, fret: 24 }, // highest, ~4714 Hz
    ]
    const report: Record<string, string>[] = []
    for (const sampleRate of [44100, 48000]) {
      for (const c of cases) {
        const expected = stringFundamental(c.tension, c.density, c.length, c.fret)
        const got = await measured(c, sampleRate)
        const err = cents(got, expected)
        report.push({
          sampleRate: String(sampleRate),
          expectedHz: expected.toFixed(3),
          measuredHz: got.toFixed(3),
          cents: err.toFixed(3),
        })
        expect(Math.abs(err), JSON.stringify(c)).toBeLessThan(2)
      }
    }
    console.table(report)
  })

  test('5. increasing damping shortens decay time', async () => {
    const times: number[] = []
    for (const damping of [0.2, 0.5, 0.8]) {
      const s = await createString({ damping })
      times.push(decayTime(s.pluckAndRender(5), 20))
    }
    console.log('time to -20 dB at damping 0.2 / 0.5 / 0.8 (s):', times)
    expect(times[1]).toBeLessThan(times[0] * 0.6)
    expect(times[2]).toBeLessThan(times[1] * 0.6)
  })

  test('6. pluck position sets which harmonics are present', async () => {
    const harmonics = async (pluckPosition: number) => {
      const s = await createString({ damping: 0.1, pluckPosition })
      const out = s.pluckAndRender(1)
      const f0 = measureFrequency(out)
      const h = [1, 2, 3, 4, 5].map((k) => amplitudeAt(out, k * f0))
      return h.map((v) => v / h[0])
    }
    // Plucked at the middle: even harmonics have a node there and vanish.
    const middle = await harmonics(0.5)
    expect(middle[1]).toBeLessThan(0.01)
    expect(middle[3]).toBeLessThan(0.01)
    expect(middle[2]).toBeGreaterThan(0.1)
    // Plucked at 1/5: the 5th harmonic vanishes, the 2nd is strong.
    const fifth = await harmonics(0.2)
    expect(fifth[4]).toBeLessThan(0.01)
    expect(fifth[1]).toBeGreaterThan(0.3)
    console.log('harmonics 1-5 relative to fundamental, pluck at 1/2:', middle.map((v) => v.toFixed(4)))
    console.log('harmonics 1-5 relative to fundamental, pluck at 1/5:', fifth.map((v) => v.toFixed(4)))
  })

  test('7. output is finite and within range at parameter extremes', async () => {
    const extremes = [
      { length: 0.3, tension: 200, density: 0.0004, fret: 24, damping: 0, strength: 1, pluckPosition: 0.02 },
      { length: 1.2, tension: 30, density: 0.01, fret: 0, damping: 0, strength: 1, pluckPosition: 0.5 },
      { damping: 1, strength: 0 },
      // Out-of-range and hostile values must be clamped by the model.
      { length: 0, tension: 1e9, density: 0, damping: -5, strength: 50, pluckPosition: 3, fret: 999 },
      { length: -1, tension: -1, density: -1 },
    ]
    for (const p of extremes) {
      const s = await createString(p)
      const out = s.pluckAndRender(1)
      expect(out.every(Number.isFinite), JSON.stringify(p)).toBe(true)
      expect(peak(out), JSON.stringify(p)).toBeLessThanOrEqual(1)
    }
  })

  test('8. the feedback loop is passive: energy never grows', async () => {
    for (const p of [DEFAULTS, { length: 0.3, tension: 200, density: 0.0004, fret: 24 }]) {
      const s = await createString({ ...p, damping: 0, strength: 1 })
      const out = s.pluckAndRender(20)
      expect(out.every(Number.isFinite)).toBe(true)
      const env = envelope(out, 0.25)
      for (let i = 1; i < env.length; i++) expect(env[i]).toBeLessThanOrEqual(env[i - 1] * 1.001)
      expect(env.at(-1)!).toBeLessThan(env[0] * 0.2)
    }
  })

  test('9. repeated notes do not accumulate energy or leave residue', async () => {
    const s = await createString({ damping: 0, strength: 1 })
    const first = rms(s.pluckAndRender(0.1))
    let loudest = 0
    let last = 0
    for (let i = 0; i < 300; i++) {
      s.set({ fret: i % 25 })
      const out = s.pluckAndRender(0.1)
      loudest = Math.max(loudest, peak(out))
      if (i % 25 === 0) last = rms(out) // same note as `first`
    }
    expect(loudest).toBeLessThan(0.9) // no build-up toward the safety clamp
    expect(last / first).toBeGreaterThan(0.95)
    expect(last / first).toBeLessThan(1.05)
    // Fully damped, the string returns to silence.
    s.set({ damping: 1 })
    s.render(3)
    expect(peak(s.render(0.1))).toBeLessThan(1e-5)
  })

  test('10. identical inputs produce bit-identical audio', async () => {
    const run = async () => {
      const s = await createString({ damping: 0.4, pluckPosition: 0.13 })
      const a = s.pluckAndRender(0.3)
      s.set({ fret: 5, tension: 90 })
      const b = s.pluckAndRender(0.3)
      return [...a, ...b]
    }
    expect(await run()).toEqual(await run())
  })
})
