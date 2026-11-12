// Phase 3A: tests of the experimental data-driven physics engine
// (src/experimental/physics). The approved instruments are not touched; the
// approved metal bar is used here only as the reference in Experiment A.
import { PerformanceObserver } from 'node:perf_hooks'
import { describe, expect, test } from 'vitest'
import { FaustMonoDspGenerator } from '@grame/faustwasm'
import {
  ALUMINIUM_BAR,
  barModes,
  hertzContactTime,
  HertzContact,
  ModalResonator,
  pointMass,
  runCoupled,
  SpringDamper,
  strikeBar,
  strikeWithMallet,
  System,
  systemFrequencies,
  type Mode,
} from '../analysis/experimental'
import { compileFactory } from '../analysis/offline'
import { barModeFrequencies, barModeShape } from '../src/audio/engine/physics'
import { barContactTime, halfSinePulse } from '../src/experimental/physics/bar'
import { amplitudeAt, createBar, dB, decayTime, maxStep, peak, rms, spectralPeaks, SR } from './helpers'

const METAL = { length: 0.3, thickness: 10, density: 2700, youngsModulus: 70 }
const relativeError = (measured: number, expected: number) => Math.abs(measured / expected - 1)

/** RMS of (a - b) relative to the RMS of b, in dB. */
function residualDb(a: Float32Array, b: Float32Array): number {
  let diff = 0
  let ref = 0
  for (let i = 0; i < b.length; i++) {
    diff += (a[i] - b[i]) ** 2
    ref += b[i] * b[i]
  }
  return 10 * Math.log10(diff / ref)
}
const scaled = (x: Float32Array, k: number) => Float32Array.from(x, (v) => v * k)

/**
 * The approved bar's signal path written out directly: the same two-pole,
 * two-zero filter per mode, the same weights and gain. With `single` true the
 * coefficients and the running state are rounded to 32-bit floats at every
 * step, as the compiled Faust model computes them; otherwise 64-bit.
 */
function referenceBar(stroke: { strikePosition: number; hardness: number; velocity: number; key?: number }, seconds: number, single: boolean) {
  const f32 = single ? Math.fround : (v: number) => v
  const T = 1 / SR
  const freqs = barModeFrequencies(METAL, stroke.key ?? 0).filter((f) => f < 0.45 * SR)
  const weights = freqs.map((_, n) => barModeShape(n, stroke.strikePosition) ** 2)
  const norm = Math.sqrt(weights.reduce((s, w) => s + w * w, 0))
  const pulse = halfSinePulse(barContactTime(stroke.hardness, stroke.velocity), stroke.velocity, SR)
  const out = new Float32Array(Math.round(seconds * SR))
  const modes = freqs.map((f, n) => {
    const r = Math.exp(-Math.log(1000) / ((1 / (1 / 6 + (0.001 * f) / 2.2)) * SR))
    return { a1: f32(-2 * r * Math.cos(2 * Math.PI * f * T)), a2: f32(r * r), g: f32(weights[n] / norm), y1: 0, y2: 0 }
  })
  let x1 = 0
  let x2 = 0
  for (let i = 0; i < out.length; i++) {
    const x = f32(i < pulse.length ? pulse[i] : 0)
    let sum = 0
    for (const m of modes) {
      const y = f32(f32(x - x2) - f32(f32(m.a1 * m.y1) + f32(m.a2 * m.y2)))
      m.y2 = m.y1
      m.y1 = y
      sum = f32(sum + f32(y * m.g))
    }
    x2 = x1
    x1 = x
    out[i] = f32(sum * 0.2)
  }
  return out
}

describe('Experiment A: metal bar parity with the approved Faust model', () => {
  test('the engine is the approved filter in double precision; the remaining gap is single-precision rounding', async () => {
    const stroke = { strikePosition: 0.35, hardness: 0.6, velocity: 0.8 }
    const faust = (await createBar(stroke)).play(2)
    const result = strikeBar({ ...stroke, seconds: 2 })
    const engine = scaled(result.velocity, result.toFaust)
    const double = referenceBar(stroke, 2, false)
    const single = referenceBar(stroke, 2, true)
    const window = (x: Float32Array, from: number, to: number) => x.subarray(from * SR, to * SR)
    const report = {
      'engine vs approved Faust bar, first 20 ms': residualDb(window(engine, 0, 0.02), window(faust, 0, 0.02)),
      'engine vs approved Faust bar, first 200 ms': residualDb(window(engine, 0, 0.2), window(faust, 0, 0.2)),
      'engine vs approved Faust bar, 2 s': residualDb(engine, faust),
      'engine vs same filter in 64-bit, 2 s': residualDb(engine, double),
      '32-bit filter vs 64-bit filter, 2 s': residualDb(single, double),
      'approved Faust bar vs 32-bit filter, 2 s': residualDb(faust, single),
    }
    console.table(Object.fromEntries(Object.entries(report).map(([k, v]) => [k, { residual_dB: v.toFixed(1) }])))
    // The engine and the approved filter are the same filter.
    expect(report['engine vs same filter in 64-bit, 2 s']).toBeLessThan(-120)
    // Rounding to 32 bits alone moves the filter about as far from the 64-bit
    // one as the approved model is from the engine: a drift that grows with time.
    expect(report['engine vs approved Faust bar, first 20 ms']).toBeLessThan(-75)
    expect(report['engine vs approved Faust bar, first 20 ms']).toBeLessThan(report['engine vs approved Faust bar, 2 s'] - 20)
    expect(Math.abs(report['32-bit filter vs 64-bit filter, 2 s'] - report['engine vs approved Faust bar, 2 s'])).toBeLessThan(15)
  })

  const strokes: { name: string; strikePosition: number; hardness: number; velocity: number; key?: number }[] = [
    { name: 'default stroke', strikePosition: 0.35, hardness: 0.6, velocity: 0.8 },
    { name: 'hard, at the end', strikePosition: 0, hardness: 1, velocity: 1 },
    { name: 'soft, at the middle', strikePosition: 0.5, hardness: 0.1, velocity: 0.4 },
    { name: 'octave up', strikePosition: 0.2, hardness: 0.8, velocity: 0.7, key: 12 },
  ]

  test('with the same force pulse, the two outputs differ only by a constant gain', async () => {
    const report: Record<string, string>[] = []
    for (const { name, ...stroke } of strokes) {
      const faust = (await createBar(stroke)).play(2)
      const engine = strikeBar({ ...stroke, seconds: 2 })
      const matched = scaled(engine.velocity, engine.toFaust)
      const residual = residualDb(matched, faust)
      report.push({
        stroke: name,
        faustPeak: peak(faust).toFixed(4),
        enginePeak_m_per_s: peak(engine.velocity).toExponential(3),
        gainToMatch: engine.toFaust.toFixed(1),
        residual_dB: residual.toFixed(1),
      })
      // -45 dB over two seconds: under 0.6 % of the signal, all of it slow
      // phase drift from the approved model's 32-bit coefficients (see above).
      expect(residual, name).toBeLessThan(-45)
    }
    console.table(report)
  })

  test('modal frequencies, decay, attack, balance and level each match', async () => {
    const stroke = { strikePosition: 0, hardness: 1, velocity: 1, lossFactor: 0.0002 }
    const faust = (await createBar(stroke)).play(1.5)
    const result = strikeBar({ ...stroke, bar: { ...METAL, width: 0.04, lossFactor: 0.0002 }, seconds: 1.5 })
    const engine = scaled(result.velocity, result.toFaust)
    const expected = barModeFrequencies(METAL)
    const [fp, ep] = [spectralPeaks(faust, 65536, 100), spectralPeaks(engine, 65536, 100)]
    expect(ep).toHaveLength(8)
    const report: Record<string, string>[] = []
    expected.forEach((f, n) => {
      const level = (x: Float32Array) => amplitudeAt(x.subarray(0, 0.3 * SR), f)
      const decay = (x: Float32Array) => dB(amplitudeAt(x.subarray(0.05 * SR, 0.15 * SR), f) / amplitudeAt(x.subarray(0.25 * SR, 0.35 * SR), f)) / 0.2
      report.push({
        mode: String(n + 1),
        beamHz: f.toFixed(2),
        faustHz: fp[n].freq.toFixed(2),
        engineHz: ep[n].freq.toFixed(2),
        levelDifference_dB: dB(level(engine) / level(faust)).toFixed(3),
        faustDecay_dB_per_s: decay(faust).toFixed(1),
        engineDecay_dB_per_s: decay(engine).toFixed(1),
      })
      expect(relativeError(ep[n].freq, f)).toBeLessThan(5e-4) // frequency
      expect(Math.abs(dB(level(engine) / level(faust)))).toBeLessThan(0.05) // spectral balance, mode by mode
      if (n < 6) expect(relativeError(decay(engine), decay(faust))).toBeLessThan(0.01) // decay
    })
    console.table(report)
    // Attack: the first 5 ms, sample for sample, and the largest jump.
    expect(residualDb(engine.subarray(0, 240), faust.subarray(0, 240))).toBeLessThan(-80)
    expect(relativeError(maxStep(engine, 1, 960), maxStep(faust, 1, 960))).toBeLessThan(1e-3)
    // Level and overall decay.
    expect(relativeError(peak(engine), peak(faust))).toBeLessThan(1e-3)
    expect(relativeError(rms(engine), rms(faust))).toBeLessThan(1e-3)
    expect(decayTime(engine, 20)).toBe(decayTime(faust, 20))
  })

  test('what each part of the discretisation contributes', async () => {
    // Same bar, same pulse, three ways of mapping the modes to discrete time.
    const stroke = { strikePosition: 0, hardness: 1, velocity: 1 }
    const faust = (await createBar(stroke)).play(1)
    const expected = barModeFrequencies(METAL)
    const report: Record<string, string>[] = []
    const residuals: Record<string, number> = {}
    for (const prewarp of ['none', 'poles', 'full'] as const) {
      const result = strikeBar({ ...stroke, seconds: 1, prewarp })
      const engine = scaled(result.velocity, result.toFaust)
      const peaks = spectralPeaks(engine, 65536, 100)
      // Where the uncorrected midpoint rule puts a mode of true frequency f.
      const warped = (f: number) => (SR / Math.PI) * Math.atan((Math.PI * f) / SR)
      const near = (f: number) => {
        const target = prewarp === 'none' ? warped(f) : f
        return peaks.reduce((best, p) => (Math.abs(p.freq - target) < Math.abs(best.freq - target) ? p : best))
      }
      // The top mode is short-lived and, without the mass correction, weak:
      // locate it by scanning the first 50 ms around where it should be.
      const early = engine.subarray(0, 0.05 * SR)
      const target = prewarp === 'none' ? warped(expected[7]) : expected[7]
      const top = { freq: 0, amp: 0 }
      for (let g = target * 0.98; g <= target * 1.02; g += target * 0.0005) {
        const amp = amplitudeAt(early, g)
        if (amp > top.amp) Object.assign(top, { freq: g, amp })
      }
      residuals[prewarp] = residualDb(engine, faust)
      report.push({
        prewarp,
        residual_dB: residuals[prewarp].toFixed(1),
        mode1_error_pct: (100 * (near(expected[0]).freq / expected[0] - 1)).toFixed(4),
        mode4_error_pct: (100 * (near(expected[3]).freq / expected[3] - 1)).toFixed(2),
        mode8_Hz: top.freq.toFixed(1),
        mode8_error_pct: (100 * (top.freq / expected[7] - 1)).toFixed(2),
        mode8_level_dB: dB(top.amp / amplitudeAt(faust.subarray(0, 0.05 * SR), expected[7])).toFixed(1),
      })
    }
    console.table(report)
    // Uncorrected, the midpoint rule puts the top mode far too low and too weak.
    expect(residuals.none).toBeGreaterThan(-10)
    // Correcting the poles fixes the frequencies but not the high modes' level.
    expect(residuals.poles).toBeLessThan(residuals.none - 15)
    // Correcting the mass as well gives parity.
    expect(residuals.full).toBeLessThan(residuals.poles - 15)
  })

  test('energy: what the pulse supplies equals what the bar stores plus what it dissipates', () => {
    const result = strikeBar({ strikePosition: 0.35, hardness: 0.6, velocity: 0.8, seconds: 3 })
    const stored = result.energy.at(-1)!
    console.log('supplied J:', result.supplied, 'dissipated J:', result.lost, 'still stored J:', stored)
    expect(result.supplied).toBeGreaterThan(0)
    expect(relativeError(result.lost + stored, result.supplied)).toBeLessThan(1e-9)
    // After the pulse nothing is supplied, so stored energy can only fall.
    for (let n = 200; n < result.energy.length; n++) expect(result.energy[n]).toBeLessThanOrEqual(result.energy[n - 1])
    expect(result.velocity.every(Number.isFinite)).toBe(true)
  })
})

// ---------------------------------------------------------------------------

/** A single undamped oscillator with one port. */
const oscillator = (frequency: number, mass: number, t60 = Infinity): Mode[] => [{ frequency, t60, mass, shape: [1] }]

/** Frequencies of two modal objects joined by a spring between port 0 of each, from continuous-time theory. */
const coupledFrequencies = (a: Mode[], b: Mode[], kc: number) => systemFrequencies([a, b], [{ a: [0, 0], b: [1, 0], stiffness: kc }])

describe('Experiment B: two resonators joined by a spring', () => {
  const [f0, mass] = [440, 0.1]
  // Stiffness that puts the out-of-phase mode at 480 Hz: w2^2 = w0^2 + 2 kc / m.
  const kc = (mass * ((2 * Math.PI * 480) ** 2 - (2 * Math.PI * f0) ** 2)) / 2

  test('two equal oscillators: the coupled frequencies are those of the textbook two-mass system', () => {
    const run = runCoupled({ a: oscillator(f0, mass), b: oscillator(f0, mass), spring: new SpringDamper(kc), impulse: 0.01, seconds: 1.5 })
    const peaks = spectralPeaks(run.a, 65536, 40).map((p) => p.freq)
    console.log('coupled modes, expected 440 and 480 Hz, measured:', peaks.map((f) => f.toFixed(3)))
    expect(peaks).toHaveLength(2)
    expect(relativeError(peaks[0], 440)).toBeLessThan(1e-4) // in-phase: the spring is not stretched
    expect(relativeError(peaks[1], 480)).toBeLessThan(2e-4) // out-of-phase: stiffened by the spring
  })

  test('mixing is not coupling: without the spring nothing splits and nothing is exchanged', () => {
    const mixed = runCoupled({ a: oscillator(f0, mass), b: oscillator(f0, mass), spring: null, impulse: 0.01, seconds: 1.5 })
    const coupled = runCoupled({ a: oscillator(f0, mass), b: oscillator(f0, mass), spring: new SpringDamper(kc), impulse: 0.01, seconds: 1.5 })
    // Mixed: the struck one rings at 440 Hz alone; the other never moves.
    const sum = Float32Array.from(mixed.a, (v, i) => v + mixed.b[i])
    expect(spectralPeaks(sum, 65536, 40).map((p) => Math.round(p.freq))).toEqual([440])
    expect(peak(mixed.b)).toBe(0)
    expect(Math.max(...mixed.energyB)).toBe(0)
    // Coupled: two frequencies, and the second oscillator takes energy.
    expect(spectralPeaks(Float32Array.from(coupled.a, (v, i) => v + coupled.b[i]), 65536, 40)).toHaveLength(1) // the sum cancels the out-of-phase mode...
    expect(spectralPeaks(coupled.a, 65536, 40)).toHaveLength(2) // ...but each oscillator carries both
    expect(Math.max(...coupled.energyB)).toBeGreaterThan(0.99 * coupled.energy[0])
  })

  test('energy passes back and forth at the beat rate, and the total is conserved', () => {
    const run = runCoupled({ a: oscillator(f0, mass), b: oscillator(f0, mass), spring: new SpringDamper(kc), impulse: 0.01, seconds: 0.5 })
    const total = run.energy[0]
    // Beats at 480 - 440 = 40 Hz: all the energy is in b after 12.5 ms, back in a after 25 ms.
    const firstMaxB = run.energyB.findIndex((e, i) => i > 10 && e > 0.99 * total)
    const backInA = run.energyA.findIndex((e, i) => i > firstMaxB + 100 && e > 0.99 * total)
    console.log('energy fully in b after ms:', (1000 * firstMaxB) / SR, '| back in a after ms:', (1000 * backInA) / SR, '(expected 12.5 and 25)')
    expect(Math.abs(firstMaxB / SR - 0.0125)).toBeLessThan(0.0015)
    expect(Math.abs(backInA / SR - 0.025)).toBeLessThan(0.0015)
    let drift = 0
    for (const e of run.energy) drift = Math.max(drift, Math.abs(e / total - 1))
    console.log('largest relative drift of total energy over 0.5 s:', drift)
    expect(drift).toBeLessThan(1e-10)
  })

  test('the interaction is equal and opposite: two free masses keep their total momentum', () => {
    const [m1, m2, k] = [0.3, 0.1, 5e4]
    const run = runCoupled({ a: [{ frequency: 0, t60: Infinity, mass: m1, shape: [1] }], b: [{ frequency: 0, t60: Infinity, mass: m2, shape: [1] }], spring: new SpringDamper(k), impulse: 0.02, seconds: 1 })
    // The impulse is the only momentum ever put in.
    let worst = 0
    for (let n = 1; n < run.momentum.length; n++) worst = Math.max(worst, Math.abs(run.momentum[n] / 0.02 - 1))
    console.log('largest relative change in total momentum over 1 s:', worst)
    expect(worst).toBeLessThan(1e-12)
    // And the pair vibrates against each other at sqrt(k (1/m1 + 1/m2)) / 2 pi.
    const expected = Math.sqrt(k * (1 / m1 + 1 / m2)) / (2 * Math.PI)
    const relative = Float32Array.from(run.a, (v, i) => v - run.b[i])
    const measured = spectralPeaks(relative, 32768, 40)[0].freq
    expect(relativeError(measured, expected)).toBeLessThan(5e-4)
  })

  test('two eight-mode bars: every coupled frequency matches the eigenvalues of the joined system', () => {
    // An aluminium bar and a slightly longer one, undamped so the peaks are sharp,
    // joined by a spring between a point on each.
    const undamped = (modes: Mode[]) => modes.map((m) => ({ ...m, t60: Infinity }))
    const a = undamped(barModes(ALUMINIUM_BAR, [0.1], SR))
    const b = undamped(barModes({ ...ALUMINIUM_BAR, length: 0.32 }, [0.3], SR))
    const stiffness = 4e5
    const expected = coupledFrequencies(a, b, stiffness)
    const uncoupled = [...a, ...b].map((m) => m.frequency).sort((x, y) => x - y)
    const run = runCoupled({ a, b, spring: new SpringDamper(stiffness), impulse: 0.01, seconds: 1.5 })
    const found = [...spectralPeaks(run.a, 65536, 110), ...spectralPeaks(run.b, 65536, 110)].map((p) => p.freq)
    const report: Record<string, string>[] = []
    expected.forEach((f, i) => {
      const measured = found.reduce((best, p) => (Math.abs(p - f) < Math.abs(best - f) ? p : best), Infinity)
      report.push({
        uncoupledHz: uncoupled[i].toFixed(2),
        theoryHz: f.toFixed(2),
        measuredHz: measured.toFixed(2),
        shiftFromUncoupled_Hz: (f - uncoupled[i]).toFixed(2),
        errorPct: (100 * (measured / f - 1)).toFixed(4),
      })
    })
    console.table(report)
    // The modes themselves are exact; the spring is integrated with the
    // midpoint rule, whose error grows with frequency.
    // A mode with a node at the connection point is neither shifted by the
    // spring nor reached by the strike, so it cannot be observed. Every other
    // coupled mode must be where the theory puts it.
    const unobservable = report.filter((row) => Math.abs(Number(row.shiftFromUncoupled_Hz)) < 0.005 && Math.abs(Number(row.errorPct)) > 1)
    expect(unobservable.length).toBeLessThanOrEqual(1)
    const observed = report.filter((row) => !unobservable.includes(row))
    expect(observed.length).toBeGreaterThanOrEqual(15)
    for (const row of observed) expect(Math.abs(Number(row.errorPct)), `mode at ${row.theoryHz} Hz`).toBeLessThan(0.02)
    // The coupling moved things: this is not the two bars' own mode lists.
    expect(Math.max(...expected.map((f, i) => Math.abs(f - uncoupled[i])))).toBeGreaterThan(20)
    // Bar b was never struck, yet it sounds.
    expect(rms(run.b)).toBeGreaterThan(0.01 * rms(run.a))
  })

  test('long render with damping: finite, and total energy only ever falls', () => {
    const a = barModes(ALUMINIUM_BAR, [0.1], SR)
    const b = barModes({ ...ALUMINIUM_BAR, length: 0.32 }, [0.3], SR)
    const run = runCoupled({ a, b, spring: new SpringDamper(4e5, 2), impulse: 0.01, seconds: 30 })
    expect(run.a.every(Number.isFinite) && run.b.every(Number.isFinite)).toBe(true)
    let rises = 0
    for (let n = 2; n < run.energy.length; n++) if (run.energy[n] > run.energy[n - 1]) rises++
    expect(rises).toBe(0)
    expect(run.energy.at(-1)!).toBeLessThan(1e-6 * run.energy[1])
  })

  test('a very stiff spring does not destabilise it', () => {
    // 1e12 N/m would put the out-of-phase mode at 712 kHz, far above Nyquist.
    const run = runCoupled({ a: oscillator(f0, mass), b: oscillator(f0, mass), spring: new SpringDamper(1e12), impulse: 0.01, seconds: 2 })
    expect(run.a.every(Number.isFinite)).toBe(true)
    let drift = 0
    for (const e of run.energy) drift = Math.max(drift, Math.abs(e / run.energy[0] - 1))
    expect(drift).toBeLessThan(1e-6)
    // The two are effectively welded: they move together at 440 Hz.
    expect(relativeError(spectralPeaks(run.a, 65536, 30)[0].freq, 440)).toBeLessThan(1e-4)
  })
})

describe('Experiment C: a mallet striking through a nonlinear Hertz contact', () => {
  const wall: Mode[] = [{ frequency: 0, t60: Infinity, mass: 1e12, shape: [1] }] // effectively immovable
  const [malletMass, stiffness] = [0.02, 1e7]

  test('against a rigid wall: contact time matches Hertz theory and the rebound is elastic', () => {
    const report: Record<string, string>[] = []
    for (const sampleRate of [48000, 192000]) {
      const hit = strikeWithMallet({ target: wall, malletMass, velocity: 1, stiffness, seconds: 0.02, sampleRate })
      const theory = hertzContactTime(malletMass, 1, stiffness)
      report.push({
        sampleRate: String(sampleRate),
        theory_ms: (1000 * theory).toFixed(4),
        measured_ms: (1000 * hit.contactTime).toFixed(4),
        errorPct: (100 * (hit.contactTime / theory - 1)).toFixed(2),
        reboundVelocity: hit.malletVelocityAfter.toFixed(9),
      })
      expect(relativeError(hit.contactTime, theory)).toBeLessThan(sampleRate === 48000 ? 0.04 : 0.01)
      expect(hit.separated).toBe(true)
      expect(relativeError(-hit.malletVelocityAfter, 1)).toBeLessThan(1e-6) // comes back at the speed it arrived
    }
    console.table(report)
  })

  test('contact time shortens with strike velocity as v^(-1/5)', () => {
    const velocities = [0.25, 0.5, 1, 2, 4]
    const times = velocities.map((velocity) => strikeWithMallet({ target: wall, malletMass, velocity, stiffness, seconds: 0.02, sampleRate: 384000 }).contactTime)
    // Least-squares slope of log(time) against log(velocity).
    const [lx, ly] = [velocities.map(Math.log), times.map(Math.log)]
    const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length
    const slope = lx.reduce((s, x, i) => s + (x - mean(lx)) * (ly[i] - mean(ly)), 0) / lx.reduce((s, x) => s + (x - mean(lx)) ** 2, 0)
    console.log('contact times (ms):', times.map((t) => (1000 * t).toFixed(4)), '| exponent:', slope.toFixed(4), '(theory -0.2)')
    expect(Math.abs(slope + 0.2)).toBeLessThan(0.005)
  })

  test('striking a bar: energy is accounted for, the mallet separates, nothing is created', () => {
    const bar = barModes(ALUMINIUM_BAR, [0.35], SR)
    const hit = strikeWithMallet({ target: bar, malletMass, velocity: 1, stiffness: 1e8, seconds: 2 })
    const before = 0.5 * malletMass * 1 * 1
    const malletAfter = 0.5 * malletMass * hit.malletVelocityAfter ** 2
    console.table({
      strike: {
        contact_ms: (1000 * hit.lastContactTime).toFixed(3),
        peakForce_N: hit.peakForce.toFixed(1),
        malletVelocityAfter: hit.malletVelocityAfter.toFixed(4),
        energyBefore_J: before.toFixed(6),
        malletAfter_J: malletAfter.toFixed(6),
        barAfter_J: hit.targetEnergyAfter.toExponential(3),
        dissipated_J: hit.lost.toFixed(6),
        unaccounted_J: (before - malletAfter - hit.targetEnergyAfter - hit.lost).toExponential(2),
        worstNewtonIterations: hit.worstIterations,
      },
    })
    expect(hit.separated).toBe(true)
    expect(hit.malletVelocityAfter).toBeLessThan(0) // it bounces back...
    expect(-hit.malletVelocityAfter).toBeLessThan(1) // ...slower than it came
    expect(hit.velocity.every(Number.isFinite)).toBe(true)
    // Every joule: what the mallet lost is in the bar or was dissipated by it.
    expect(Math.abs(before - malletAfter - hit.targetEnergyAfter - hit.lost)).toBeLessThan(1e-9 * before)
    // Passive, unforced system: stored energy never rises, step by step.
    let worstRise = 0
    for (let n = 1; n < hit.energy.length; n++) worstRise = Math.max(worstRise, hit.energy[n] - hit.energy[n - 1])
    console.log('largest single-step rise in total energy, relative to the initial energy:', worstRise / before)
    expect(worstRise).toBeLessThan(1e-12 * before) // rounding and solver tolerance only
    expect(hit.worstIterations).toBeLessThan(12)
  })

  test('sensitivity to the time step', () => {
    const report: Record<string, Record<string, string>> = {}
    const results = [24000, 48000, 96000, 192000].map((sampleRate) => {
      const hit = strikeWithMallet({ target: barModes(ALUMINIUM_BAR, [0.35], sampleRate), malletMass, velocity: 1, stiffness: 1e8, seconds: 0.5, sampleRate })
      report[`${sampleRate} Hz`] = {
        contact_ms: (1000 * hit.lastContactTime).toFixed(3),
        peakForce_N: hit.peakForce.toFixed(1),
        impulse_Ns: hit.impulse.toFixed(5),
        reboundVelocity: hit.malletVelocityAfter.toFixed(4),
        modesInBar: String(barModes(ALUMINIUM_BAR, [0.35], sampleRate).length),
      }
      return hit
    })
    console.table(report)
    const reference = results[3]
    // At 48 kHz the delivered impulse and the rebound are within a few percent of the fine-step answer.
    expect(relativeError(results[1].impulse, reference.impulse)).toBeLessThan(0.03)
    expect(relativeError(results[1].malletVelocityAfter, reference.malletVelocityAfter)).toBeLessThan(0.1)
    for (const hit of results) expect(hit.velocity.every(Number.isFinite)).toBe(true)
  })

  test('a contact far too stiff for the time step stays stable (but is not accurate)', () => {
    // 1e12 N/m^1.5 at 24 kHz: the contact would last a small fraction of one sample.
    const hit = strikeWithMallet({ target: barModes(ALUMINIUM_BAR, [0.35], 24000), malletMass, velocity: 4, stiffness: 1e12, seconds: 1, sampleRate: 24000 })
    const before = 0.5 * malletMass * 16
    expect(hit.velocity.every(Number.isFinite)).toBe(true)
    let worstRise = 0
    for (let n = 1; n < hit.energy.length; n++) worstRise = Math.max(worstRise, hit.energy[n] - hit.energy[n - 1])
    expect(worstRise).toBeLessThan(1e-9 * before)
    expect(Math.max(...hit.energy)).toBeLessThanOrEqual(before * (1 + 1e-9))
  })
})

describe('Experiment D: changing a connection while it sounds', () => {
  const [f0, mass] = [440, 0.1]
  const k1 = (mass * ((2 * Math.PI * 460) ** 2 - (2 * Math.PI * f0) ** 2)) / 2

  /**
   * Two coupled oscillators, struck once. `change` is applied to the spring
   * at the moment, shortly after 100 ms, when the spring is most stretched
   * (found by a first run without the change), which is the worst case for a
   * stiffness edit.
   */
  function edit(change: (spring: SpringDamper) => void, t60 = Infinity, seconds = 0.6) {
    const N = Math.round(seconds * SR)
    const simulate = (at: number) => {
      const spring = new SpringDamper(k1)
      const system = new System()
      const [ra, rb] = [new ModalResonator(oscillator(f0, mass, t60), SR), new ModalResonator(oscillator(f0, mass, t60), SR)]
      const a = { resonator: system.add(ra), port: 0 }
      const b = { resonator: system.add(rb), port: 0 }
      system.connect(spring, a, b)
      system.build(SR)
      const out = new Float32Array(N)
      const energy = new Float64Array(N)
      const stretch = new Float64Array(N)
      for (let n = 0; n < N; n++) {
        if (n === 0) system.applyForce(a, 0.01 * SR)
        if (n === at) change(spring)
        system.step()
        out[n] = system.velocity(a)
        energy[n] = system.energy()
        stretch[n] = system.connectionStretch(0)
      }
      return { out, energy, stretch, spring }
    }
    const dry = simulate(-1)
    let at = Math.round(0.1 * SR)
    for (let n = at; n < at + 480; n++) if (Math.abs(dry.stretch[n]) > Math.abs(dry.stretch[at])) at = n
    const run = simulate(at)
    // Largest rise in total energy from one step to the next from the edit on.
    let rise = 0
    for (let n = at; n < N; n++) rise = Math.max(rise, run.energy[n] - run.energy[n - 1])
    return {
      ...run,
      at,
      energyAtEdit: run.energy[at - 1],
      largestEnergyRise: rise,
      energyAfter: run.energy[N - 1],
      // Largest sample-to-sample jump in the 20 ms before the edit and the 20 ms after it.
      stepBefore: maxStep(run.out, at - 960, at),
      stepAfter: maxStep(run.out, at, at + 960),
    }
  }
  test('an instant stiffness change is not passive: it adds or removes exactly k eta^2 / 2 of energy', () => {
    const stiffer = edit((s) => s.setStiffness(4 * k1, 'instant'))
    const softer = edit((s) => s.setStiffness(k1 / 4, 'instant'))
    console.log('instant x4 at full stretch: energy added', ((100 * stiffer.spring.injected) / stiffer.energyAtEdit).toFixed(1), '% | instant /4: energy added', ((100 * softer.spring.injected) / softer.energyAtEdit).toFixed(1), '%')
    expect(stiffer.spring.injected).toBeGreaterThan(0.1 * stiffer.energyAtEdit)
    expect(softer.spring.injected).toBeLessThan(0)
    // Undamped, so the only thing that can change the total energy is the edit:
    // the engine's own account of the jump matches what the total did.
    expect(relativeError(stiffer.energyAfter - stiffer.energyAtEdit, stiffer.spring.injected)).toBeLessThan(1e-9)
    expect(relativeError(softer.energyAfter - softer.energyAtEdit, softer.spring.injected)).toBeLessThan(1e-9)
    expect(stiffer.out.every(Number.isFinite) && softer.out.every(Number.isFinite)).toBe(true)
  })

  test('three ways to change stiffness, compared', () => {
    const cases = {
      instant: edit((s) => s.setStiffness(4 * k1, 'instant')),
      'ramp over 10 ms': edit((s) => s.setStiffness(4 * k1, 'ramp', 480)),
      'at the next zero crossing': edit((s) => s.setStiffness(4 * k1, 'zero-crossing')),
    }
    console.table(
      Object.fromEntries(
        Object.entries(cases).map(([name, c]) => [
          name,
          {
            energyAdded_pct: ((100 * c.spring.injected) / c.energyAtEdit).toFixed(4),
            largestJumpBefore: c.stepBefore.toExponential(3),
            largestJumpAfter: c.stepAfter.toExponential(3),
            jumpRatio: (c.stepAfter / c.stepBefore).toFixed(2),
            finite: c.out.every(Number.isFinite),
          },
        ]),
      ),
    )
    for (const c of Object.values(cases)) {
      expect(c.out.every(Number.isFinite)).toBe(true)
      expect(c.spring.k).toBe(4 * k1) // the change did take effect
      // No click: the waveform's largest jump stays in proportion to the new,
      // higher frequency content (at most 4x: the stiffness went up 4x).
      expect(c.stepAfter / c.stepBefore).toBeLessThan(4)
    }
    // Waiting for the spring to pass through rest adds essentially nothing.
    expect(Math.abs(cases['at the next zero crossing'].spring.injected)).toBeLessThan(0.02 * Math.abs(cases.instant.spring.injected))
    // A ramp spreads the change out but does not make it passive.
    expect(cases['ramp over 10 ms'].spring.injected).toBeGreaterThan(0)
  })

  test('changing damping is passive: energy never rises, and it dies faster', () => {
    const plain = edit(() => {}, 4)
    const damped = edit((s) => s.setDamping(5), 4)
    expect(damped.largestEnergyRise).toBeLessThanOrEqual(0)
    expect(damped.energyAfter).toBeLessThan(0.5 * plain.energyAfter)
    expect(damped.stepAfter / damped.stepBefore).toBeLessThan(1.2)
    expect(damped.out.every(Number.isFinite)).toBe(true)
  })

  test('edits are plain parameter writes: nothing is rebuilt, and nothing is allocated while running', async () => {
    // Counts garbage collections that start while the engine is stepping. The
    // loop is synchronous, so nothing but the engine runs during it: if the
    // engine allocated anything per sample, the collector would have to run.
    const collections: number[] = []
    const observer = new PerformanceObserver((list) => collections.push(...list.getEntries().map((e) => e.startTime)))
    observer.observe({ entryTypes: ['gc'] })
    const results: Record<string, { samples: number; collections: number }> = {}
    const block = new Float32Array(128)

    const scenarios: Record<string, () => (i: number) => void> = {
      'two bars and a spring, struck and edited every 100 ms': () => {
        const spring = new SpringDamper(4e5, 0.5)
        const system = new System()
        const a = { resonator: system.add(new ModalResonator(barModes(ALUMINIUM_BAR, [0.1], SR), SR)), port: 0 }
        const b = { resonator: system.add(new ModalResonator(barModes({ ...ALUMINIUM_BAR, length: 0.32 }, [0.3], SR), SR)), port: 0 }
        system.connect(spring, a, b)
        system.build(SR)
        return (i) => {
          if (i % 37 === 0) {
            system.applyForce(a, 480)
            spring.setStiffness(4e5 * (1 + (i % 7)), i % 2 ? 'ramp' : 'zero-crossing', 240)
            spring.setDamping(0.5 + (i % 3))
          }
          system.process(block, a)
        }
      },
      'mallet thrown at a bar every 100 ms (Hertz contact)': () => {
        const system = new System()
        const mallet = pointMass(0.02, SR)
        const m = { resonator: system.add(mallet), port: 0 }
        const bar = { resonator: system.add(new ModalResonator(barModes(ALUMINIUM_BAR, [0.35], SR), SR)), port: 0 }
        system.connect(new HertzContact(1e8), m, bar, -0.001)
        system.build(SR)
        return (i) => {
          if (i % 37 === 0) mallet.setVelocity(1)
          system.process(block, bar)
        }
      },
    }
    for (const [name, make] of Object.entries(scenarios)) {
      const tick = make()
      for (let i = 0; i < 4000; i++) tick(i) // let the JIT settle
      await new Promise((resolve) => setTimeout(resolve, 20))
      const [blocks, from] = [24000, performance.now()] // 3 million samples, 64 s of audio
      for (let i = 0; i < blocks; i++) tick(i)
      const to = performance.now()
      await new Promise((resolve) => setTimeout(resolve, 20)) // let the observer deliver
      results[name] = { samples: blocks * 128, collections: collections.filter((t) => t >= from && t <= to).length }
      expect(block.every(Number.isFinite)).toBe(true)
    }
    observer.disconnect()
    console.table(results)
    for (const r of Object.values(results)) expect(r.collections).toBe(0)
  })
})
describe('Faust comparison: the same two-oscillator system written in Faust', () => {
  const [f0, mass] = [440, 0.1]
  const stiffnessFor = (f: number, f2: number) => (mass * ((2 * Math.PI * f2) ** 2 - (2 * Math.PI * f) ** 2)) / 2

  test('accuracy and stability against the engine', async () => {
    const { factory, compileMs } = await compileFactory('src/experimental/faust/coupled.dsp', ['-double'])
    const faust = async (frequency: number, coupling: number, seconds: number) => {
      const dsp = await new FaustMonoDspGenerator().createOfflineProcessor(SR, 128, factory)
      for (const [k, v] of Object.entries({ mass, frequency, coupling, impulse: 0.01, strike: 1 })) dsp.setParamValue(`/coupled/${k}`, v)
      return dsp.render([], Math.round(seconds * SR))[0]
    }
    const engine = (frequency: number, coupling: number, seconds: number) =>
      runCoupled({ a: oscillator(frequency, mass), b: oscillator(frequency, mass), spring: new SpringDamper(coupling), impulse: 0.01, seconds }).a
    const report: Record<string, string>[] = []
    for (const [low, high] of [[440, 480], [2000, 2200], [8000, 8800]]) {
      const kc = stiffnessFor(low, high)
      const [fp, ep] = [spectralPeaks(await faust(low, kc, 1.5), 65536, 40), spectralPeaks(engine(low, kc, 1.5), 65536, 40)]
      report.push({
        expectedHz: `${low} / ${high}`,
        faustHz: fp.map((p) => p.freq.toFixed(2)).join(' / '),
        faustErrorPct: [low, high].map((f, i) => (100 * (fp[i].freq / f - 1)).toFixed(3)).join(' / '),
        engineHz: ep.map((p) => p.freq.toFixed(2)).join(' / '),
        engineErrorPct: [low, high].map((f, i) => (100 * (ep[i].freq / f - 1)).toFixed(3)).join(' / '),
      })
      if (low === 440) {
        expect(relativeError(fp[1].freq, high)).toBeLessThan(1e-3)
        expect(relativeError(ep[1].freq, high)).toBeLessThan(2e-4)
      }
    }
    console.table(report)
    console.log('Faust compile time for this two-oscillator program, ms:', Math.round(compileMs))

    // Stability: stiffen the spring until the out-of-phase mode would be at
    // 16 kHz, beyond the explicit method's limit of SR / pi = 15.3 kHz.
    const stiff = stiffnessFor(f0, 16000)
    const [fo, eo] = [await faust(f0, stiff, 0.5), engine(f0, stiff, 0.5)]
    const faustBlewUp = !fo.every(Number.isFinite) || peak(fo) > 1e6
    console.log('spring stiff enough for a 16 kHz mode: Faust peak', peak(fo), '| engine peak', peak(eo))
    expect(faustBlewUp).toBe(true)
    expect(eo.every(Number.isFinite)).toBe(true)
    expect(peak(eo)).toBeLessThan(1)
    // Just inside the limit the Faust version is stable.
    expect(peak(await faust(f0, stiffnessFor(f0, 14000), 0.5))).toBeLessThan(1)
  })
})