// Offline tests of the compiled Faust glass vessel model. Modal frequencies,
// amplitudes and decay rates are measured from rendered audio and compared
// with the documented shell approximation (src/audio/engine/physics.ts,
// docs/GLASS_MODEL.md).
import { describe, expect, test } from 'vitest'
import {
  BAR_MODE_K,
  CANTILEVER_B,
  cantileverShape,
  GLASS_MODES,
  glassModeFrequencies,
  type GlassParams,
} from '../src/audio/engine/physics'
import { amplitudeAt, createGlass, dB, decayTime, envelope, peak, rms, spectralPeaks, SR, type Params } from './helpers'

const GLASS: GlassParams = { diameter: 70, height: 90, thickness: 1.2, density: 2500, youngsModulus: 70 } // model defaults
// Hard striker on the rim (no mode has a node there), low loss: every mode is
// excited and rings long enough to measure.
const ALL_MODES = { strikeHeight: 1, hardness: 1, velocity: 1, lossFactor: 0.0001 }

const relativeError = (measured: number, expected: number) => Math.abs(measured / expected - 1)
const ascending = (list: number[]) => [...list].sort((a, b) => a - b)
/** Frequency of mode (n, m) for given parameters. */
const modeHz = (p: GlassParams, n: number, m: number, key = 0) =>
  glassModeFrequencies(p, key)[GLASS_MODES.findIndex((mode) => mode.n === n && mode.m === m)]

/** Measured frequencies of the spectral peaks, lowest first. */
async function measuredModes(params: Params, sampleRate = SR) {
  const glass = await createGlass({ ...ALL_MODES, ...params }, sampleRate)
  return spectralPeaks(glass.play(1.5), 65536, 100, sampleRate).map((p) => p.freq)
}

/** Render with `params` and check every audible mode against the formula. */
async function expectModesToMatch(params: GlassParams, key = 0, sampleRate = SR) {
  const expected = ascending(glassModeFrequencies(params, key)).filter((f) => f < 0.45 * sampleRate)
  const measured = await measuredModes({ ...params, key }, sampleRate)
  expect(measured, JSON.stringify({ params, key, sampleRate })).toHaveLength(expected.length)
  expected.forEach((f, i) => expect(relativeError(measured[i], f)).toBeLessThan(5e-4)) // 0.05 %, under 1 cent
  return { expected, measured }
}

describe('vessel wall theory (reference maths)', () => {
  test('axial constants are roots of cos(b) cosh(b) = -1 and the shapes are orthonormal', () => {
    for (const b of CANTILEVER_B) expect(Math.abs(Math.cos(b) * Math.cosh(b) + 1)).toBeLessThan(1e-9)
    const steps = 20000
    const inner = (p: number, q: number) => {
      let s = 0
      for (let i = 0; i < steps; i++) s += (cantileverShape(p, (i + 0.5) / steps) * cantileverShape(q, (i + 0.5) / steps)) / steps
      return s
    }
    expect(inner(0, 0)).toBeCloseTo(1, 4)
    expect(inner(1, 1)).toBeCloseTo(1, 4)
    expect(inner(0, 1)).toBeCloseTo(0, 4)
    // Clamped at the base, largest at the rim; the second shape has one nodal
    // circle, at 0.7834 of the height.
    expect(cantileverShape(0, 0)).toBe(0)
    expect(Math.abs(cantileverShape(0, 1))).toBeCloseTo(2, 6)
    expect(Math.abs(cantileverShape(1, 0.7834))).toBeLessThan(1e-3)
  })

  test('the fundamental agrees with French (1983) and with the classical ring', () => {
    // French: f = 1 / (2 pi) * sqrt(3 E / (5 rho)) * a / R^2 * sqrt(1 + 4/3 (R / H)^4).
    const [R, H, a, E, rho] = [0.035, 0.09, 0.0012, 70e9, 2500]
    const french = (Math.sqrt((3 * E) / (5 * rho)) / (2 * Math.PI)) * (a / (R * R)) * Math.sqrt(1 + (4 / 3) * (R / H) ** 4)
    expect(relativeError(modeHz(GLASS, 2, 0), french)).toBeLessThan(1e-3)
    // A very tall vessel tends to the inextensional ring:
    // f_n = a / (2 pi R^2) * sqrt(E / (12 rho)) * n (n^2 - 1) / sqrt(n^2 + 1).
    const tall = { ...GLASS, height: 1e6 }
    for (const n of [2, 3, 4]) {
      const ring = ((a / (2 * Math.PI * R * R)) * Math.sqrt(E / (12 * rho)) * n * (n * n - 1)) / Math.sqrt(n * n + 1)
      expect(relativeError(modeHz(tall, n, 0), ring)).toBeLessThan(1e-9)
    }
  })

  test('the overtone ratios are not those of the metal bar', () => {
    const f = ascending(glassModeFrequencies(GLASS))
    const glassRatios = f.slice(0, 4).map((v) => v / f[0])
    const barRatios = BAR_MODE_K.slice(0, 4).map((k) => (k / BAR_MODE_K[0]) ** 2)
    console.log('lowest four ratios, glass:', glassRatios.map((r) => r.toFixed(3)), 'bar:', barRatios.map((r) => r.toFixed(3)))
    // The second partial of the glass is the (2,1) mode, far below the bar's.
    expect(glassRatios[1]).toBeLessThan(barRatios[1] * 0.7)
  })
})

describe('struck glass vessel', () => {
  test('1. is silent until struck, then produces audio', async () => {
    const glass = await createGlass()
    expect(peak(glass.render(0.2))).toBe(0)
    expect(rms(glass.play(0.5))).toBeGreaterThan(0.01)
  })

  test('2. measured resonant frequencies match the shell model', async () => {
    const report: Record<string, string>[] = []
    for (const [sampleRate, params, key] of [
      [48000, GLASS, 0],
      [44100, GLASS, 0],
      [48000, { diameter: 100, height: 60, thickness: 2, density: 3100, youngsModulus: 60 }, 0], // wide, squat, lead crystal
      [48000, GLASS, 12], // one octave up: a smaller vessel
    ] as [number, GlassParams, number][]) {
      const { measured } = await expectModesToMatch(params, key, sampleRate)
      const byMode = glassModeFrequencies(params, key)
      ascending(byMode)
        .filter((f) => f < 0.45 * sampleRate)
        .forEach((f, i) => {
          const { n, m } = GLASS_MODES[byMode.indexOf(f)]
          report.push({
            sampleRate: String(sampleRate),
            vessel: `${params.diameter} x ${params.height} x ${params.thickness} mm, key ${key}`,
            mode: `(${n},${m})`,
            expectedHz: f.toFixed(2),
            measuredHz: measured[i].toFixed(2),
            errorPct: (100 * (measured[i] / f - 1)).toFixed(4),
          })
        })
    }
    console.table(report)
  })

  test('3. diameter changes the modes as the model predicts', async () => {
    // Scaling diameter and height together by 2 divides every mode by 4.
    const small = await measuredModes({ ...GLASS, diameter: 50, height: 60 })
    const large = await measuredModes({ ...GLASS, diameter: 100, height: 120 })
    for (let i = 0; i < 5; i++) expect(relativeError(small[i] / large[i], 4)).toBeLessThan(5e-4)
    // Diameter alone also changes the proportions, so the modes move by
    // different amounts: each must still land where the formula says.
    await expectModesToMatch({ ...GLASS, diameter: 60 })
    await expectModesToMatch({ ...GLASS, diameter: 95 })
    const ratio = (d: number, n: number, m: number) => modeHz({ ...GLASS, diameter: d }, n, m) / modeHz({ ...GLASS, diameter: d }, 2, 0)
    expect(ratio(95, 2, 1)).toBeGreaterThan(ratio(60, 2, 1) * 1.5) // the overtone structure itself changed
  })

  test('4. wall thickness scales every mode in proportion', async () => {
    const thin = await measuredModes({ ...GLASS, thickness: 1 })
    const thick = await measuredModes({ ...GLASS, thickness: 2 })
    for (let i = 0; i < 5; i++) expect(relativeError(thick[i] / thin[i], 2)).toBeLessThan(5e-4)
  })

  test('5. frequency goes as sqrt(stiffness / density)', async () => {
    const base = await measuredModes({ ...GLASS, youngsModulus: 50, density: 2400 })
    const stiffer = await measuredModes({ ...GLASS, youngsModulus: 80, density: 2400 })
    const denser = await measuredModes({ ...GLASS, youngsModulus: 50, density: 3000 })
    expect(stiffer[0]).toBeGreaterThan(base[0])
    expect(relativeError(stiffer[0] / base[0], Math.sqrt(80 / 50))).toBeLessThan(5e-4)
    expect(relativeError(base[0] / denser[0], Math.sqrt(3000 / 2400))).toBeLessThan(5e-4)
  })

  test('6. more material damping shortens the decay, and each mode has its own rate', async () => {
    const times: number[] = []
    for (const lossFactor of [0.0003, 0.001, 0.004]) {
      times.push(decayTime((await createGlass({ lossFactor })).play(8), 20))
    }
    console.log('time to -20 dB at loss factor 0.0003 / 0.001 / 0.004 (s):', times)
    expect(times[1]).toBeLessThan(times[0] * 0.7)
    expect(times[2]).toBeLessThan(times[1] * 0.7)

    // 60 dB in 1 / (1/8 + eta f / 2.2) s for a mode at f.
    const lossFactor = 0.002
    const out = (await createGlass({ ...ALL_MODES, lossFactor })).play(1)
    const report: Record<string, string>[] = []
    for (const [n, m] of [[2, 0], [2, 1], [3, 0], [4, 0]]) {
      const f = modeHz(GLASS, n, m)
      const early = amplitudeAt(out.subarray(0.05 * SR, 0.15 * SR), f)
      const late = amplitudeAt(out.subarray(0.25 * SR, 0.35 * SR), f)
      const measured = dB(early / late) / 0.2
      const expected = 60 * (1 / 8 + (lossFactor * f) / 2.2)
      report.push({ mode: `(${n},${m})`, hz: f.toFixed(1), expected_dB_per_s: expected.toFixed(1), measured_dB_per_s: measured.toFixed(1) })
      expect(relativeError(measured, expected)).toBeLessThan(0.05)
    }
    console.table(report)
  })

  test('7. strike height sets how strongly each family of modes is excited', async () => {
    const amps = async (strikeHeight: number) => {
      const out = (await createGlass({ ...ALL_MODES, strikeHeight })).play(0.5)
      return GLASS_MODES.map(({ n, m }) => amplitudeAt(out.subarray(0, 0.3 * SR), modeHz(GLASS, n, m)))
    }
    const index = (n: number, m: number) => GLASS_MODES.findIndex((mode) => mode.n === n && mode.m === m)
    // On the nodal circle of the m = 1 shape (0.7834 of the height): the whole
    // (n, 1) family all but vanishes, the (n, 0) family does not.
    const onNode = await amps(0.7834)
    for (const n of [2, 3, 4]) expect(onNode[index(n, 1)] / onNode[index(2, 0)]).toBeLessThan(0.002)
    expect(onNode[index(3, 0)] / onNode[index(2, 0)]).toBeGreaterThan(0.05)
    // Elsewhere each mode's level follows its axial shape squared (driving
    // point), divided by the root-sum-square over the 8 modes (the model's
    // level normalisation). Comparing two heights cancels the striker spectrum.
    const weight = (j: number, zeta: number) =>
      cantileverShape(GLASS_MODES[j].m, zeta) ** 2 /
      Math.sqrt(GLASS_MODES.reduce((s, mode) => s + cantileverShape(mode.m, zeta) ** 4, 0))
    const [rim, mid] = [await amps(1), await amps(0.5)]
    const report: Record<string, string>[] = []
    for (const [n, m] of [[2, 0], [3, 0], [2, 1], [3, 1]]) {
      const j = index(n, m)
      const expected = weight(j, 1) / weight(j, 0.5)
      report.push({ mode: `(${n},${m})`, expectedRatio: expected.toFixed(4), measuredRatio: (rim[j] / mid[j]).toFixed(4) })
      expect(relativeError(rim[j] / mid[j], expected)).toBeLessThan(0.02)
    }
    console.table(report)
  })

  test('8. a harder striker excites the high modes more', async () => {
    const tilt = async (hardness: number) => {
      const out = (await createGlass({ strikeHeight: 1, lossFactor: 0.0001, hardness })).play(0.5)
      const window = out.subarray(0, 0.3 * SR)
      const level = (n: number) => dB(amplitudeAt(window, modeHz(GLASS, n, 0)) / amplitudeAt(window, modeHz(GLASS, 2, 0)))
      return { mode40: level(4), mode50: level(5) }
    }
    const soft = await tilt(0)
    const hard = await tilt(1)
    console.log('modes (4,0) and (5,0) relative to (2,0), dB. soft:', soft, 'hard:', hard)
    expect(hard.mode40).toBeGreaterThan(soft.mode40 + 10)
    expect(hard.mode50).toBeGreaterThan(soft.mode50 + 10)
  })

  test('strike velocity scales the level', async () => {
    const level = async (velocity: number) => rms((await createGlass({ velocity })).play(0.3))
    const [quiet, loud] = [await level(0.4), await level(0.8)]
    expect(loud / quiet).toBeGreaterThan(1.7)
    expect(loud / quiet).toBeLessThan(2.6)
    expect(await level(0)).toBe(0)
  })

  test('each vessel rings on its own: a second strike does not stop the first', async () => {
    const glass = await createGlass({ ...ALL_MODES })
    glass.play(0.1)
    glass.set({ key: 7 })
    const found = spectralPeaks(glass.play(1.5), 65536, 40).map((p) => p.freq)
    for (const f of [modeHz(GLASS, 2, 0, 0), modeHz(GLASS, 2, 0, 7)]) {
      expect(found.some((m) => relativeError(m, f) < 5e-4), `${f.toFixed(1)} Hz present`).toBe(true)
    }
  })

  test('9. output is finite and bounded at extremes, and modes above Nyquist are dropped', async () => {
    const extremes: Params[] = [
      { diameter: 120, height: 200, thickness: 0.5, density: 3200, youngsModulus: 50, lossFactor: 0.0001, hardness: 1, velocity: 1, strikeHeight: 1 },
      // Small, thick, stiff, light: every mode is above Nyquist.
      { diameter: 40, height: 40, thickness: 4, density: 2200, youngsModulus: 90, key: 24, hardness: 1, velocity: 1, strikeHeight: 1 },
      { hardness: 0, velocity: 0.01, strikeHeight: 0.05, lossFactor: 0.005 },
      // Out-of-range and hostile values must be clamped by the model.
      { diameter: 0, height: 0, thickness: 0, density: 0, youngsModulus: 1e9, lossFactor: -1, hardness: 9, velocity: 50, strikeHeight: -3, key: 999 },
      { diameter: -1, height: -1, thickness: 1e6, density: -1, youngsModulus: -1, lossFactor: 0, strikeHeight: 99 },
    ]
    for (const p of extremes) {
      const out = (await createGlass(p)).play(1)
      expect(out.every(Number.isFinite), JSON.stringify(p)).toBe(true)
      expect(peak(out), JSON.stringify(p)).toBeLessThanOrEqual(1)
    }
    // All 25 vessels struck as hard as possible within 0.25 s.
    const glass = await createGlass({ hardness: 1, velocity: 1, strikeHeight: 1, lossFactor: 0.0001 })
    let loudest = 0
    for (let key = 0; key < 25; key++) {
      glass.set({ key })
      loudest = Math.max(loudest, peak(glass.play(0.01)))
    }
    const tail = glass.render(30)
    expect(tail.every(Number.isFinite)).toBe(true)
    expect(Math.max(loudest, peak(tail))).toBeLessThanOrEqual(1)
    // Passive resonators: once nothing is striking, the level only falls.
    const env = envelope(tail, 0.5)
    for (let i = 1; i < env.length; i++) expect(env[i]).toBeLessThanOrEqual(env[i - 1] * 1.001)
  })

  test('a single hard strike stays below the limiter', async () => {
    let loudest = 0
    for (const strikeHeight of [0.05, 0.3, 0.6, 0.7834, 1]) {
      for (const key of [0, 12, 24]) {
        loudest = Math.max(loudest, peak((await createGlass({ hardness: 1, velocity: 1, strikeHeight, key })).play(0.3)))
      }
    }
    console.log('loudest single strike:', loudest)
    expect(loudest).toBeLessThan(0.6)
  })

  test('10. identical inputs produce bit-identical audio', async () => {
    const run = async () => {
      const glass = await createGlass({ strikeHeight: 0.63, hardness: 0.7 })
      const a = glass.play(0.3)
      glass.set({ key: 5, thickness: 1.5 })
      return [...a, ...glass.play(0.3)]
    }
    expect(await run()).toEqual(await run())
  })
})
