// Offline tests of the compiled Faust metal bar model. Modal frequencies,
// amplitudes and decay rates are measured from rendered audio and compared
// with Euler-Bernoulli free-free beam theory (src/audio/engine/physics.ts).
import { describe, expect, test } from 'vitest'
import { BAR_MODE_K, barModeFrequencies, barModeShape, type BarParams } from '../src/audio/engine/physics'
import { amplitudeAt, createBar, dB, decayTime, envelope, peak, rms, spectralPeaks, SR, type Params } from './helpers'

const BAR: BarParams = { length: 0.3, thickness: 10, density: 2700, youngsModulus: 70 } // model defaults
// Hard mallet on the very end of the bar (no mode has a node there), low loss:
// every mode is excited and
// rings long enough to measure.
const ALL_MODES = { strikePosition: 0, hardness: 1, velocity: 1, lossFactor: 0.0002 }

/** Measured frequencies of the spectral peaks, lowest first. */
async function measuredModes(params: Params, sampleRate = SR) {
  const bar = await createBar({ ...ALL_MODES, ...params }, sampleRate)
  return spectralPeaks(bar.play(1.5), 65536, 100, sampleRate).map((p) => p.freq)
}

const relativeError = (measured: number, expected: number) => Math.abs(measured / expected - 1)

describe('free-free beam theory (reference maths)', () => {
  test('mode constants are roots of cos(k) cosh(k) = 1', () => {
    for (const k of BAR_MODE_K) expect(Math.abs(Math.cos(k) - 1 / Math.cosh(k))).toBeLessThan(1e-11)
    const ratios = BAR_MODE_K.map((k) => (k / BAR_MODE_K[0]) ** 2)
    expect(ratios[1]).toBeCloseTo(2.7565, 3)
    expect(ratios[2]).toBeCloseTo(5.4039, 3)
    expect(ratios[3]).toBeCloseTo(8.933, 3)
  })

  test('mode shapes are orthonormal and symmetric about the middle', () => {
    const steps = 20000
    const inner = (m: number, n: number) => {
      let s = 0
      for (let i = 0; i < steps; i++) {
        const xi = (i + 0.5) / steps
        // Left half directly, right half by symmetry (even/odd about 0.5).
        const a = xi <= 0.5 ? barModeShape(m, xi) : (m % 2 ? -1 : 1) * barModeShape(m, 1 - xi)
        const b = xi <= 0.5 ? barModeShape(n, xi) : (n % 2 ? -1 : 1) * barModeShape(n, 1 - xi)
        s += (a * b) / steps
      }
      return s
    }
    for (let m = 0; m < 5; m++) {
      for (let n = m; n < 5; n++) expect(inner(m, n)).toBeCloseTo(m === n ? 1 : 0, 3)
    }
    // Free end: amplitude 2. First mode's nodes: 0.2242 L from each end.
    expect(barModeShape(0, 0)).toBeCloseTo(2, 6)
    expect(Math.abs(barModeShape(0, 0.2242))).toBeLessThan(1e-3)
    // Antisymmetric modes vanish at the middle.
    expect(Math.abs(barModeShape(1, 0.5))).toBeLessThan(1e-9)
  })
})

describe('struck metal bar', () => {
  test('1. is silent until struck, then produces audio', async () => {
    const bar = await createBar()
    expect(peak(bar.render(0.2))).toBe(0)
    expect(rms(bar.play(0.5))).toBeGreaterThan(0.01)
  })

  test('2. measured modal frequencies match the beam equation', async () => {
    const report: Record<string, string>[] = []
    for (const [sampleRate, bar, key] of [
      [48000, BAR, 0],
      [44100, BAR, 0],
      [48000, { length: 0.5, thickness: 6, density: 7850, youngsModulus: 200 }, 0], // long steel bar
      [48000, BAR, 12], // one octave up: a shorter bar
    ] as [number, BarParams, number][]) {
      const expected = barModeFrequencies(bar, key).filter((f) => f < 0.45 * sampleRate)
      const measured = await measuredModes({ ...bar, key }, sampleRate)
      expect(measured, `modes found at ${sampleRate} Hz`).toHaveLength(expected.length)
      expected.forEach((f, n) => {
        report.push({
          sampleRate: String(sampleRate),
          bar: `${bar.length} m x ${bar.thickness} mm, key ${key}`,
          mode: String(n + 1),
          expectedHz: f.toFixed(2),
          measuredHz: measured[n].toFixed(2),
          errorPct: (100 * (measured[n] / f - 1)).toFixed(4),
        })
        expect(relativeError(measured[n], f)).toBeLessThan(5e-4) // 0.05 %, under 1 cent
      })
    }
    console.table(report)
  })

  test('the modes are inharmonic, in the free-free ratios', async () => {
    const m = await measuredModes(BAR)
    expect(m[1] / m[0]).toBeCloseTo(2.7565, 2)
    expect(m[2] / m[0]).toBeCloseTo(5.4039, 2)
    expect(m[3] / m[0]).toBeCloseTo(8.933, 2)
  })

  test('3. doubling the length divides every modal frequency by 4', async () => {
    const short = await measuredModes({ ...BAR, length: 0.25 })
    const long = await measuredModes({ ...BAR, length: 0.5 })
    for (let n = 0; n < 4; n++) expect(relativeError(short[n] / long[n], 4)).toBeLessThan(5e-4)
  })

  test('4. doubling the thickness doubles every modal frequency', async () => {
    const thin = await measuredModes({ ...BAR, thickness: 5 })
    const thick = await measuredModes({ ...BAR, thickness: 10 })
    for (let n = 0; n < 4; n++) expect(relativeError(thick[n] / thin[n], 2)).toBeLessThan(5e-4)
  })

  test('material: frequency goes as sqrt(E / rho)', async () => {
    const base = await measuredModes({ ...BAR, youngsModulus: 50, density: 2000 })
    const stiffer = await measuredModes({ ...BAR, youngsModulus: 200, density: 2000 })
    const denser = await measuredModes({ ...BAR, youngsModulus: 50, density: 8000 })
    expect(relativeError(stiffer[0] / base[0], 2)).toBeLessThan(5e-4)
    expect(relativeError(base[0] / denser[0], 2)).toBeLessThan(5e-4)
  })

  test('5. more internal damping shortens the decay, and higher modes decay faster', async () => {
    const times: number[] = []
    for (const lossFactor of [0.0005, 0.002, 0.008]) {
      times.push(decayTime((await createBar({ lossFactor })).play(6), 20))
    }
    console.log('time to -20 dB at loss factor 0.0005 / 0.002 / 0.008 (s):', times)
    expect(times[1]).toBeLessThan(times[0] * 0.7)
    expect(times[2]).toBeLessThan(times[1] * 0.7)

    // Each mode has its own decay rate: 60 dB in 1 / (1/6 + eta f / 2.2) s.
    const lossFactor = 0.002
    const out = (await createBar({ ...ALL_MODES, lossFactor })).play(1)
    const report: Record<string, string>[] = []
    barModeFrequencies(BAR)
      .slice(0, 4)
      .forEach((f, n) => {
        const early = amplitudeAt(out.subarray(0.05 * SR, 0.15 * SR), f)
        const late = amplitudeAt(out.subarray(0.25 * SR, 0.35 * SR), f)
        const measured = dB(early / late) / 0.2
        const expected = 60 * (1 / 6 + (lossFactor * f) / 2.2)
        report.push({ mode: String(n + 1), expected_dB_per_s: expected.toFixed(1), measured_dB_per_s: measured.toFixed(1) })
        expect(relativeError(measured, expected)).toBeLessThan(0.05)
      })
    console.table(report)
  })

  test('6. strike position sets how strongly each mode is excited', async () => {
    const amps = async (strikePosition: number) => {
      const out = (await createBar({ ...ALL_MODES, strikePosition })).play(0.5)
      return barModeFrequencies(BAR)
        .slice(0, 4)
        .map((f) => amplitudeAt(out.subarray(0, 0.3 * SR), f))
    }
    // Middle of the bar: a node of every antisymmetric mode (2nd, 4th).
    const middle = await amps(0.5)
    expect(middle[1] / middle[0]).toBeLessThan(0.002)
    expect(middle[3] / middle[0]).toBeLessThan(0.002)
    expect(middle[2] / middle[0]).toBeGreaterThan(0.05)
    // On the first mode's node (0.2242 L): the fundamental all but vanishes.
    const node = await amps(0.2242)
    expect(node[0] / node[1]).toBeLessThan(0.002)
    // Elsewhere, each mode's level follows its mode shape squared (driving
    // point), divided by the root-sum-square over the 8 modes (the model's
    // level normalisation).
    // Comparing two positions cancels the mallet spectrum.
    const weight = (n: number, xi: number) =>
      barModeShape(n, xi) ** 2 / Math.sqrt(BAR_MODE_K.reduce((s, _, m) => s + barModeShape(m, xi) ** 4, 0))
    const [a, b] = [await amps(0.07), await amps(0.4)]
    const report: Record<string, string>[] = []
    for (let n = 0; n < 4; n++) {
      const expected = weight(n, 0.07) / weight(n, 0.4)
      report.push({ mode: String(n + 1), expectedRatio: expected.toFixed(4), measuredRatio: (a[n] / b[n]).toFixed(4) })
      expect(relativeError(a[n] / b[n], expected)).toBeLessThan(0.02)
    }
    console.table(report)
  })

  test('7. a harder mallet excites the high modes more', async () => {
    const tilt = async (hardness: number) => {
      const out = (await createBar({ strikePosition: 0, lossFactor: 0.0002, hardness })).play(0.5)
      const [f1, , f3, f4] = barModeFrequencies(BAR)
      const window = out.subarray(0, 0.3 * SR)
      return { m3: dB(amplitudeAt(window, f3) / amplitudeAt(window, f1)), m4: dB(amplitudeAt(window, f4) / amplitudeAt(window, f1)) }
    }
    const soft = await tilt(0)
    const hard = await tilt(1)
    console.log('mode 3 and 4 relative to mode 1, dB. soft:', soft, 'hard:', hard)
    expect(hard.m3).toBeGreaterThan(soft.m3 + 10)
    expect(hard.m4).toBeGreaterThan(soft.m4 + 10)
  })

  test('strike velocity scales the level', async () => {
    const level = async (velocity: number) => rms((await createBar({ velocity })).play(0.3))
    const [quiet, loud] = [await level(0.4), await level(0.8)]
    expect(loud / quiet).toBeGreaterThan(1.7)
    expect(loud / quiet).toBeLessThan(2.6)
    expect(await level(0)).toBe(0)
  })

  test('each bar rings on its own: a second strike does not stop the first', async () => {
    const bar = await createBar({ ...ALL_MODES })
    bar.play(0.1)
    bar.set({ key: 7 })
    const both = bar.play(1.5)
    const found = spectralPeaks(both, 65536, 40).map((p) => p.freq)
    for (const f of [barModeFrequencies(BAR, 0)[0], barModeFrequencies(BAR, 7)[0]]) {
      expect(found.some((m) => relativeError(m, f) < 5e-4), `${f.toFixed(1)} Hz present`).toBe(true)
    }
  })

  test('8. output is finite and bounded at extremes, and modes above Nyquist are dropped', async () => {
    const extremes: Params[] = [
      { length: 0.6, thickness: 3, density: 9000, youngsModulus: 20, lossFactor: 0.0001, hardness: 1, velocity: 1, strikePosition: 0 },
      // Short, thick, stiff, light: every mode is far above Nyquist.
      { length: 0.1, thickness: 30, density: 1500, youngsModulus: 220, key: 24, hardness: 1, velocity: 1, strikePosition: 0 },
      { hardness: 0, velocity: 0.01, strikePosition: 0.5, lossFactor: 0.01 },
      // Out-of-range and hostile values must be clamped by the model.
      { length: 0, thickness: 0, density: 0, youngsModulus: 1e9, lossFactor: -1, hardness: 9, velocity: 50, strikePosition: 7, key: 999 },
      { length: -1, thickness: -1, density: -1, youngsModulus: -1, lossFactor: 0 },
    ]
    for (const p of extremes) {
      const out = (await createBar(p)).play(1)
      expect(out.every(Number.isFinite), JSON.stringify(p)).toBe(true)
      expect(peak(out), JSON.stringify(p)).toBeLessThanOrEqual(1)
    }
    // All 25 bars struck as hard as possible within 0.25 s.
    const bar = await createBar({ hardness: 1, velocity: 1, strikePosition: 0, lossFactor: 0.0001 })
    let loudest = 0
    for (let key = 0; key < 25; key++) {
      bar.set({ key })
      loudest = Math.max(loudest, peak(bar.play(0.01)))
    }
    const tail = bar.render(20)
    expect(tail.every(Number.isFinite)).toBe(true)
    expect(Math.max(loudest, peak(tail))).toBeLessThanOrEqual(1)
    // Passive resonators: once nothing is striking, the level only falls.
    const env = envelope(tail, 0.5)
    for (let i = 1; i < env.length; i++) expect(env[i]).toBeLessThanOrEqual(env[i - 1] * 1.001)
  })

  test('a single hard strike stays below the limiter', async () => {
    let loudest = 0
    for (const strikePosition of [0, 0.07, 0.2, 0.35, 0.5]) {
      for (const key of [0, 12, 24]) {
        loudest = Math.max(loudest, peak((await createBar({ hardness: 1, velocity: 1, strikePosition, key })).play(0.3)))
      }
    }
    console.log('loudest single strike:', loudest)
    expect(loudest).toBeLessThan(0.6)
  })

  test('10. identical inputs produce bit-identical audio', async () => {
    const run = async () => {
      const bar = await createBar({ strikePosition: 0.13, hardness: 0.7 })
      const a = bar.play(0.3)
      bar.set({ key: 5, thickness: 12 })
      return [...a, ...bar.play(0.3)]
    }
    expect(await run()).toEqual(await run())
  })
})
