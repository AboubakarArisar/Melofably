// Offline tests of the compiled Faust wooden bar model. Modal frequencies,
// amplitudes and decay rates are measured from rendered audio and compared
// with Euler-Bernoulli free-free beam theory and the documented damping law
// (src/audio/engine/physics.ts, docs/WOOD_MODEL.md).
import { describe, expect, test } from 'vitest'
import { BAR_MODE_K, barModeFrequencies, barModeShape, woodDecayTime, type BarParams } from '../src/audio/engine/physics'
import {
  amplitudeAt,
  bandPower,
  createBar,
  createWood,
  dB,
  decayTime,
  envelope,
  peak,
  powerSpectrum,
  rms,
  spectralCentroid,
  spectralPeaks,
  SR,
  type Params,
} from './helpers'

const NMODES = 6 // the wood model keeps the first six bending modes
const WOOD: BarParams = { length: 0.38, thickness: 19, density: 950, youngsModulus: 18 } // model defaults
const METAL: BarParams = { length: 0.3, thickness: 10, density: 2700, youngsModulus: 70 } // bar model defaults
// Hard mallet on the very end of the bar (no mode has a node there), least
// damping, no resonator tube: every mode is excited and as long-lived as the
// model allows.
const ALL_MODES = { strikePosition: 0, hardness: 1, velocity: 1, lossFactor: 0.001, resonator: 0 }

const woodModes = (p: BarParams, key = 0) => barModeFrequencies(p, key).slice(0, NMODES)
const relativeError = (measured: number, expected: number) => Math.abs(measured / expected - 1)

/** Frequency of the strongest component within 3 % of `f` in `x`, by scanning a single-bin DFT. */
function scanNear(x: Float32Array, f: number, sampleRate: number): number {
  let best = { f: 0, amp: 0 }
  for (let g = f * 0.97; g <= f * 1.03; g += f * 0.0002) {
    const amp = amplitudeAt(x, g, sampleRate)
    if (amp > best.amp) best = { f: g, amp }
  }
  return best.f
}

/** Measured frequencies of the spectral peaks, lowest first. */
async function measuredModes(params: Params, sampleRate = SR) {
  const wood = await createWood({ ...ALL_MODES, ...params }, sampleRate)
  return spectralPeaks(wood.play(1.5), 65536, 110, sampleRate).map((p) => p.freq)
}

describe('struck wooden bar', () => {
  test('1. is silent until struck, then produces audio', async () => {
    const wood = await createWood()
    expect(peak(wood.render(0.2))).toBe(0)
    expect(rms(wood.play(0.3))).toBeGreaterThan(0.01)
  })

  test('2. measured modal frequencies match the beam equation', async () => {
    const report: Record<string, string>[] = []
    for (const [sampleRate, bar, key] of [
      [48000, WOOD, 0],
      [44100, WOOD, 0],
      [48000, { length: 0.6, thickness: 22, density: 700, youngsModulus: 12 }, 0], // long, light, softer wood
      [48000, WOOD, 12], // one octave up: a shorter bar
    ] as [number, BarParams, number][]) {
      const expected = woodModes(bar, key).filter((f) => f < 0.45 * sampleRate)
      const wood = await createWood({ ...ALL_MODES, ...bar, key }, sampleRate)
      const out = wood.play(1.5)
      const peaks = spectralPeaks(out, 65536, 110, sampleRate).map((p) => p.freq)
      expected.forEach((f, n) => {
        // A mode that lives at least 40 ms leaves a sharp spectral peak, held
        // to 0.05 % (under a cent). Wood's top modes die faster than that:
        // their peak is tens of Hz wide, so they are located by scanning the
        // first 30 ms and held to 0.5 %.
        const t60 = woodDecayTime(f, ALL_MODES.lossFactor)
        const sharp = t60 >= 0.04
        const measured = sharp
          ? peaks.reduce((best, p) => (Math.abs(p - f) < Math.abs(best - f) ? p : best), Infinity)
          : scanNear(out.subarray(0, 0.03 * sampleRate), f, sampleRate)
        report.push({
          sampleRate: String(sampleRate),
          bar: `${bar.length} m x ${bar.thickness} mm, key ${key}`,
          mode: String(n + 1),
          expectedHz: f.toFixed(2),
          measuredHz: measured.toFixed(2),
          errorPct: (100 * (measured / f - 1)).toFixed(4),
          t60_ms: (1000 * t60).toFixed(0),
          method: sharp ? 'FFT peak' : 'scan',
        })
        expect(relativeError(measured, f), `mode ${n + 1}`).toBeLessThan(sharp ? 5e-4 : 5e-3)
      })
    }
    console.table(report)
  })

  test('the bending-mode ratios are those of any uniform free-free bar', async () => {
    const m = await measuredModes(WOOD)
    BAR_MODE_K.slice(0, 4).forEach((k, n) => expect(relativeError(m[n] / m[0], (k / BAR_MODE_K[0]) ** 2)).toBeLessThan(1e-3))
  })

  test('3. doubling the length divides every modal frequency by 4', async () => {
    const short = await measuredModes({ ...WOOD, length: 0.3 })
    const long = await measuredModes({ ...WOOD, length: 0.6 })
    for (let n = 0; n < 4; n++) expect(relativeError(short[n] / long[n], 4)).toBeLessThan(5e-4)
  })

  test('4. doubling the thickness doubles every modal frequency', async () => {
    const thin = await measuredModes({ ...WOOD, thickness: 12 })
    const thick = await measuredModes({ ...WOOD, thickness: 24 })
    for (let n = 0; n < 4; n++) expect(relativeError(thick[n] / thin[n], 2)).toBeLessThan(5e-4)
  })

  test('5. frequency goes as sqrt(stiffness / density)', async () => {
    const base = await measuredModes({ ...WOOD, youngsModulus: 6, density: 500 })
    const stiffer = await measuredModes({ ...WOOD, youngsModulus: 24, density: 500 })
    const denser = await measuredModes({ ...WOOD, youngsModulus: 6, density: 1250 })
    expect(relativeError(stiffer[0] / base[0], 2)).toBeLessThan(5e-4)
    expect(relativeError(base[0] / denser[0], Math.sqrt(2.5))).toBeLessThan(5e-4)
  })

  test('6. more internal damping shortens the decay, and each mode follows the damping law', async () => {
    const times: number[] = []
    for (const lossFactor of [0.002, 0.008, 0.03]) {
      times.push(decayTime((await createWood({ lossFactor, resonator: 0 })).play(2), 20))
    }
    console.log('time to -20 dB at loss factor 0.002 / 0.008 / 0.03 (s):', times)
    expect(times[1]).toBeLessThan(times[0] * 0.8)
    expect(times[2]).toBeLessThan(times[1] * 0.8)

    // 60 dB in 1 / (1/0.7 + eta f^2 / 2200) s: losses rise with frequency squared.
    const out = (await createWood(ALL_MODES)).play(0.5)
    const report: Record<string, string>[] = []
    woodModes(WOOD)
      .slice(0, 3)
      .forEach((f, n) => {
        const early = amplitudeAt(out.subarray(0.03 * SR, 0.08 * SR), f)
        const late = amplitudeAt(out.subarray(0.1 * SR, 0.15 * SR), f)
        const measured = dB(early / late) / 0.07
        const expected = 60 / woodDecayTime(f, ALL_MODES.lossFactor)
        report.push({ mode: String(n + 1), hz: f.toFixed(0), expected_dB_per_s: expected.toFixed(1), measured_dB_per_s: measured.toFixed(1) })
        expect(relativeError(measured, expected)).toBeLessThan(0.05)
      })
    console.table(report)
  })

  test('7. strike position sets how strongly each mode is excited', async () => {
    const amps = async (strikePosition: number) => {
      const out = (await createWood({ ...ALL_MODES, strikePosition })).play(0.3)
      return woodModes(WOOD)
        .slice(0, 4)
        .map((f) => amplitudeAt(out.subarray(0, 0.05 * SR), f))
    }
    // Middle of the bar: a node of every antisymmetric mode (2nd, 4th).
    const middle = await amps(0.5)
    expect(middle[1] / middle[0]).toBeLessThan(0.01)
    expect(middle[2] / middle[0]).toBeGreaterThan(0.05)
    // On the first mode's node (0.2242 L): the fundamental all but vanishes.
    const node = await amps(0.2242)
    expect(node[0] / node[1]).toBeLessThan(0.01)
    // Elsewhere each mode's level follows its mode shape squared, divided by
    // the root-sum-square over the six modes (the level normalisation).
    const weight = (n: number, xi: number) =>
      barModeShape(n, xi) ** 2 / Math.sqrt(BAR_MODE_K.slice(0, NMODES).reduce((s, _, m) => s + barModeShape(m, xi) ** 4, 0))
    const [a, b] = [await amps(0.07), await amps(0.4)]
    const report: Record<string, string>[] = []
    for (let n = 0; n < 3; n++) {
      const expected = weight(n, 0.07) / weight(n, 0.4)
      report.push({ mode: String(n + 1), expectedRatio: expected.toFixed(4), measuredRatio: (a[n] / b[n]).toFixed(4) })
      expect(relativeError(a[n] / b[n], expected)).toBeLessThan(0.03)
    }
    console.table(report)
  })

  test('8. a harder mallet excites the upper modes more', async () => {
    const tilt = async (hardness: number) => {
      const out = (await createWood({ ...ALL_MODES, hardness })).play(0.3)
      const [f1, f2, f3] = woodModes(WOOD)
      const window = out.subarray(0, 0.05 * SR)
      return { mode2: dB(amplitudeAt(window, f2) / amplitudeAt(window, f1)), mode3: dB(amplitudeAt(window, f3) / amplitudeAt(window, f1)) }
    }
    const soft = await tilt(0)
    const hard = await tilt(1)
    console.log('modes 2 and 3 relative to mode 1, dB. soft:', soft, 'hard:', hard)
    expect(hard.mode2).toBeGreaterThan(soft.mode2 + 10)
    expect(hard.mode3).toBeGreaterThan(soft.mode3 + 10)
  })

  test('9. strike velocity scales the level', async () => {
    const level = async (velocity: number) => rms((await createWood({ velocity })).play(0.2))
    const [quiet, loud] = [await level(0.4), await level(0.8)]
    console.log('rms at velocity 0.4 / 0.8:', quiet, loud)
    expect(loud / quiet).toBeGreaterThan(1.7)
    expect(loud / quiet).toBeLessThan(2.6)
    expect(await level(0)).toBe(0)
  })

  test('the keyboard is evenly loud from bottom to top', async () => {
    // Level of the attack (first 20 ms) and the peak, for every third bar, at
    // default settings and with soft and hard mallets.
    for (const hardness of [0.5, 0.1, 0.9]) {
      const attack: number[] = []
      const peaks: number[] = []
      for (const key of [0, 3, 6, 9, 12, 15, 18, 21, 24]) {
        const out = (await createWood({ key, hardness })).play(0.15)
        attack.push(rms(out, 0, 0.02 * SR))
        peaks.push(peak(out))
      }
      const spread = (v: number[]) => dB(Math.max(...v) / Math.min(...v))
      console.log(`hardness ${hardness}: attack rms`, attack.map((v) => v.toFixed(3)).join(' '), '| spread dB: attack', spread(attack).toFixed(1), 'peak', spread(peaks).toFixed(1))
      expect(spread(attack)).toBeLessThan(6)
      expect(spread(peaks)).toBeLessThan(6)
    }
  })

  test('the resonator tube strengthens the fundamental and nothing else', async () => {
    const run = async (resonator: number) => {
      const out = (await createWood({ strikePosition: 0.1, hardness: 1, resonator })).play(0.3)
      const window = out.subarray(0, 0.06 * SR)
      const [f1, f2] = woodModes(WOOD)
      return { m1: amplitudeAt(window, f1), m2: amplitudeAt(window, f2), f: spectralPeaks(out, 65536, 30)[0].freq }
    }
    const bare = await run(0)
    const tubed = await run(1)
    console.log('fundamental gain with tube, dB:', dB(tubed.m1 / bare.m1).toFixed(1), '| mode 2 change, dB:', dB(tubed.m2 / bare.m2).toFixed(2))
    expect(dB(tubed.m1 / bare.m1)).toBeGreaterThan(6)
    expect(Math.abs(dB(tubed.m2 / bare.m2))).toBeLessThan(1)
    expect(relativeError(tubed.f, bare.f)).toBeLessThan(1e-3) // the pitch does not move
  })

  test('each bar rings on its own: a second strike does not stop the first', async () => {
    const wood = await createWood({ ...ALL_MODES })
    wood.play(0.05)
    wood.set({ key: 7 })
    const found = spectralPeaks(wood.play(1), 65536, 40).map((p) => p.freq)
    for (const f of [woodModes(WOOD, 0)[0], woodModes(WOOD, 7)[0]]) {
      expect(found.some((m) => relativeError(m, f) < 5e-4), `${f.toFixed(1)} Hz present`).toBe(true)
    }
  })

  test('10. output is finite and bounded at extremes, and modes above Nyquist are dropped', async () => {
    const extremes: Params[] = [
      { length: 0.6, thickness: 8, density: 1300, youngsModulus: 6, lossFactor: 0.001, hardness: 1, velocity: 1, strikePosition: 0, resonator: 1 },
      // Short, thick, stiff, light: every mode is far above Nyquist.
      { length: 0.15, thickness: 30, density: 400, youngsModulus: 25, key: 24, hardness: 1, velocity: 1, strikePosition: 0, resonator: 1 },
      { hardness: 0, velocity: 0.01, strikePosition: 0.5, lossFactor: 0.03 },
      // Out-of-range and hostile values must be clamped by the model.
      { length: 0, thickness: 0, density: 0, youngsModulus: 1e9, lossFactor: -1, hardness: 9, velocity: 50, strikePosition: 7, resonator: 40, key: 999 },
      { length: -1, thickness: -1, density: -1, youngsModulus: -1, lossFactor: 0, resonator: -3 },
    ]
    for (const p of extremes) {
      const out = (await createWood(p)).play(1)
      expect(out.every(Number.isFinite), JSON.stringify(p)).toBe(true)
      expect(peak(out), JSON.stringify(p)).toBeLessThanOrEqual(1)
    }
    // All 25 bars struck as hard as possible within 0.25 s.
    const wood = await createWood({ hardness: 1, velocity: 1, strikePosition: 0, lossFactor: 0.001, resonator: 1 })
    let loudest = 0
    for (let key = 0; key < 25; key++) {
      wood.set({ key })
      loudest = Math.max(loudest, peak(wood.play(0.01)))
    }
    const tail = wood.render(5)
    expect(tail.every(Number.isFinite)).toBe(true)
    expect(Math.max(loudest, peak(tail))).toBeLessThanOrEqual(1)
    // Passive resonators: once nothing is striking, the level only falls.
    const env = envelope(tail, 0.25)
    for (let i = 1; i < env.length; i++) expect(env[i]).toBeLessThanOrEqual(env[i - 1] * 1.001)
  })

  test('a single hard strike stays below the limiter', async () => {
    let loudest = 0
    for (const strikePosition of [0, 0.07, 0.2, 0.35, 0.5]) {
      for (const key of [0, 12, 24]) {
        for (const resonator of [0, 1]) {
          loudest = Math.max(loudest, peak((await createWood({ hardness: 1, velocity: 1, strikePosition, key, resonator })).play(0.2)))
        }
      }
    }
    console.log('loudest single strike:', loudest)
    expect(loudest).toBeLessThan(0.7)
  })

  test('11. identical inputs produce bit-identical audio', async () => {
    const run = async () => {
      const wood = await createWood({ strikePosition: 0.13, hardness: 0.7 })
      const a = wood.play(0.3)
      wood.set({ key: 5, thickness: 15 })
      return [...a, ...wood.play(0.3)]
    }
    expect(await run()).toEqual(await run())
  })
})

describe('wood compared with metal', () => {
  // Comparable conditions: each model at its own default material, damping
  // and mallet; the wooden bar's length adjusted so both fundamentals are the
  // same; both struck at 0.35 of the length at velocity 0.8, hardness 0.7.
  const metalF1 = barModeFrequencies(METAL)[0]
  const woodTuned = { ...WOOD, length: WOOD.length * Math.sqrt(barModeFrequencies(WOOD)[0] / metalF1) }
  const stroke = { strikePosition: 0.35, hardness: 0.7, velocity: 0.8 }

  test('14. the wooden bar decays much faster, its upper modes fastest of all', async () => {
    const wood = (await createWood({ ...woodTuned, ...stroke })).play(3)
    const metal = (await createBar({ ...METAL, ...stroke })).play(3)
    const measure = (x: Float32Array, modes: number[]) => {
      const rate = (f: number) =>
        dB(amplitudeAt(x.subarray(0.02 * SR, 0.05 * SR), f) / amplitudeAt(x.subarray(0.05 * SR, 0.08 * SR), f)) / 0.03
      return {
        fundamentalHz: spectralPeaks(x, 65536, 20)[0].freq,
        secondsTo20dB: decayTime(x, 20),
        mode1_dB_per_s: rate(modes[0]),
        mode2_dB_per_s: rate(modes[1]),
        centroidFirst40ms_Hz: spectralCentroid(powerSpectrum(x, 0, 2048)),
        centroidAt200ms_Hz: spectralCentroid(powerSpectrum(x, 0.2 * SR, 2048)),
        above2kHzAt100ms_dB: dB(Math.sqrt(bandPower(powerSpectrum(x, 0.1 * SR, 2048), 2000) / bandPower(powerSpectrum(x, 0, 2048), 0))),
      }
    }
    const w = measure(wood, barModeFrequencies(woodTuned))
    const m = measure(metal, barModeFrequencies(METAL))
    console.table({ wood: w, metal: m })
    expect(relativeError(w.fundamentalHz, m.fundamentalHz)).toBeLessThan(1e-3) // same note
    expect(w.secondsTo20dB).toBeLessThan(m.secondsTo20dB * 0.5) // shorter sustain
    expect(w.mode2_dB_per_s).toBeGreaterThan(m.mode2_dB_per_s * 3) // upper modes die far faster
    expect(w.mode2_dB_per_s).toBeGreaterThan(w.mode1_dB_per_s * 2) // and faster than its own fundamental
    expect(w.above2kHzAt100ms_dB).toBeLessThan(m.above2kHzAt100ms_dB - 10) // little treble left after the attack
  })
})
