// Offline tests of the compiled Faust string model. Every assertion is made on
// audio rendered by the same WebAssembly module the browser runs.
import { describe, expect, test } from 'vitest'
import { stringFundamental } from '../src/audio/engine/physics'
import {
  amplitudeAt,
  bandPower,
  cents,
  createString,
  dB,
  decayTime,
  envelope,
  maxStep,
  measureFrequency,
  peak,
  powerSpectrum,
  rms,
  spectralCentroid,
  SR,
  type Params,
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
    const extremes: Params[] = [
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

  test('retriggering a ringing note does not click', async () => {
    const s = await createString({ damping: 0 })
    const first = s.pluckAndRender(0.4)
    const freshStep = maxStep(first, 1, 960)
    s.set({ fret: 7 })
    const second = s.pluckAndRender(0.4)
    const joined = Float32Array.from([...first, ...second])
    const retriggerStep = maxStep(joined, first.length - 2, first.length + 960)
    console.log('largest sample-to-sample jump, fresh pluck / retrigger:', freshStep, retriggerStep)
    // Cutting the old note must be no more abrupt than a pluck itself.
    expect(retriggerStep).toBeLessThan(freshStep * 1.5)
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

describe('sound character (Phase 1.1)', () => {
  const spectrumOf = (x: Float32Array, seconds: number) => powerSpectrum(x, Math.round(seconds * SR), 16384)

  test('character controls do not move the pitch', async () => {
    for (const p of [
      { body: 0 },
      { body: 1 },
      { brightness: 0 },
      { brightness: 1 },
      { softness: 0 },
      { softness: 1 },
      { body: 1, brightness: 1, softness: 0, fret: 24 },
    ] as Params[]) {
      const expected = stringFundamental(DEFAULTS.tension, DEFAULTS.density, DEFAULTS.length, p.fret ?? 0)
      const err = cents(await measured({ ...DEFAULTS, ...p }), expected)
      expect(Math.abs(err), JSON.stringify(p)).toBeLessThan(2)
    }
  })

  test('brightness changes how long the high partials last', async () => {
    const run = async (brightness: number) => {
      const out = (await createString({ brightness, damping: 0.1 })).pluckAndRender(1)
      return {
        // 0.3 s in, when the difference is in the sustain rather than the pluck.
        centroid: spectralCentroid(spectrumOf(out, 0.3)),
        highs: dB(Math.sqrt(bandPower(spectrumOf(out, 0.3), 2000) / bandPower(spectrumOf(out, 0), 2000))),
      }
    }
    const dull = await run(0)
    const brightest = await run(1)
    console.log('brightness 0 / 1: centroid Hz', dull.centroid, brightest.centroid, '| >2 kHz after 0.3 s, dB', dull.highs, brightest.highs)
    expect(brightest.centroid).toBeGreaterThan(dull.centroid * 1.5)
    expect(brightest.highs).toBeGreaterThan(dull.highs + 6)
  })

  test('high partials decay at a rate set by their frequency, not by the note', async () => {
    // Decay, in dB/s, of a partial near 3 kHz on a low note and on a high one.
    const rate = async (params: Params, harmonic: number) => {
      const out = (await createString({ brightness: 0.8, pluckPosition: 0.13, ...params })).pluckAndRender(0.5)
      const f = measureFrequency(out) * harmonic
      const early = amplitudeAt(out.subarray(0.05 * SR, 0.15 * SR), f)
      const late = amplitudeAt(out.subarray(0.25 * SR, 0.35 * SR), f)
      return dB(early / late) / 0.2
    }
    const low = await rate({ ...DEFAULTS, fret: 0 }, 27) // 110 Hz x 27 = 2968 Hz
    const high = await rate({ ...DEFAULTS, fret: 24 }, 7) // 440 Hz x 7 = 3078 Hz
    console.log('decay of a ~3 kHz partial, dB/s, on 110 Hz / 440 Hz notes:', low, high)
    // In Phase 1 the high note lost this partial about 4x faster.
    expect(high / low).toBeGreaterThan(0.7)
    expect(high / low).toBeLessThan(1.4)
  })

  test('attack softness rounds the pluck without removing it', async () => {
    const run = async (softness: number) => {
      const out = (await createString({ softness })).pluckAndRender(0.5)
      return { step: maxStep(out, 1, 960) / peak(out), centroid: spectralCentroid(spectrumOf(out, 0)), peak: peak(out) }
    }
    const hard = await run(0)
    const softest = await run(1)
    console.log('softness 0 / 1: attack step (fraction of peak)', hard.step, softest.step, '| centroid Hz', hard.centroid, softest.centroid)
    expect(softest.step).toBeLessThan(hard.step * 0.5)
    expect(softest.centroid).toBeLessThan(hard.centroid * 0.7)
    // Still a pluck: the softest setting keeps most of the level.
    expect(softest.peak).toBeGreaterThan(hard.peak * 0.5)
  })

  test('body resonance reshapes the spectrum', async () => {
    // A string tuned to the main body mode (204 Hz).
    const tuned = { length: 0.65, tension: 140.7, density: 0.002 }
    const run = async (body: number) => {
      const out = (await createString({ ...tuned, body, softness: 0 })).pluckAndRender(1)
      const f = measureFrequency(out)
      const steady = out.subarray(0.1 * SR, 0.6 * SR)
      return {
        f,
        // Fundamental (on the mode) relative to the 3rd harmonic (off it).
        h1OverH3: dB(amplitudeAt(steady, f) / amplitudeAt(steady, 3 * f)),
        above8k: dB(Math.sqrt(bandPower(spectrumOf(out, 0), 8000) / bandPower(spectrumOf(out, 0), 0))),
      }
    }
    const dry = await run(0)
    const full = await run(1)
    console.log('body 0 / 1: h1 over h3, dB', dry.h1OverH3, full.h1OverH3, '| above 8 kHz, dB', dry.above8k, full.above8k)
    expect(Math.abs(dry.f - 204)).toBeLessThan(1)
    expect(full.h1OverH3).toBeGreaterThan(dry.h1OverH3 + 3) // the mode lifts the fundamental
    expect(full.above8k).toBeLessThan(dry.above8k - 6) // the body radiates less treble
    expect(Math.abs(cents(full.f, dry.f))).toBeLessThan(1) // and leaves the pitch alone
  })

  test('normal playing never reaches the limiter', async () => {
    // The limiter's knee is at 0.8. Hardest pluck, every character extreme.
    let loudest = 0
    for (const p of [{}, { body: 1 }, { body: 0 }, { softness: 0, brightness: 1 }, { softness: 1 }] as Params[]) {
      for (const fret of [0, 7, 12, 19, 24]) {
        const out = (await createString({ strength: 1, fret, ...p })).pluckAndRender(0.5)
        loudest = Math.max(loudest, peak(out))
      }
    }
    console.log('loudest single-note peak at full strength:', loudest)
    expect(loudest).toBeLessThan(0.8)
  })
})
