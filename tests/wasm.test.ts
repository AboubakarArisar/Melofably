// Phase 3A.1: the WebAssembly physics engine (assembly/engine.ts) against the
// TypeScript reference (src/experimental/physics) and against theory.
import { PerformanceObserver } from 'node:perf_hooks'
import { describe, expect, test } from 'vitest'
import { ALUMINIUM_BAR, barModes, hertzContactTime, ModalResonator, runCoupled, SpringDamper, strikeBar, strikeWithMallet, System, systemFrequencies, type BarGeometry, type Mode, type SpringLink } from '../analysis/experimental'
import { createEngine, Design, outputBuffer, render, runCoupledWasm, strikeBarWasm, strikeWithMalletWasm, type Engine } from '../analysis/wasm'
import { INSTANT, RAMP, ZERO_CROSSING } from '../src/experimental/wasm/engine'
import { maxStep, spectralPeaks, SR } from './helpers'

const relativeError = (measured: number, expected: number) => Math.abs(measured / expected - 1)
const oscillator = (frequency: number, mass: number, t60 = Infinity): Mode[] => [{ frequency, t60, mass, shape: [1] }]

/** Largest |a - b| relative to the largest |b|. */
function worstDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let diff = 0
  let ref = 0
  for (let i = 0; i < b.length; i++) {
    diff = Math.max(diff, Math.abs(a[i] - b[i]))
    ref = Math.max(ref, Math.abs(b[i]))
  }
  return diff / ref
}

// Tolerances for "the same as the reference". The two engines evaluate the
// same formulas in 64-bit arithmetic, but not in the same order (the port
// sums are arranged differently) and with different sin/cos/exp/pow
// implementations (AssemblyScript's own, not V8's), each good to about one
// unit in the last place (1e-16). Those differences accumulate over a render:
const LINEAR = 1e-12 // linear systems, relative to the signal's peak, up to 30 s (measured: at most 2e-14)
const CONTACT = 1e-9 // through a nonlinear contact, where small differences are amplified (measured: 0)

describe('Parity with the TypeScript reference', () => {
  const strokes = [
    { name: 'default stroke', strikePosition: 0.35, hardness: 0.6, velocity: 0.8 },
    { name: 'hard, at the end', strikePosition: 0, hardness: 1, velocity: 1 },
    { name: 'soft, at the middle, octave up', strikePosition: 0.5, hardness: 0.1, velocity: 0.4, key: 12 },
  ]

  test('one bar: output, stored energy and dissipation agree sample for sample (modal frequencies and decay rates)', () => {
    const report: Record<string, Record<string, string>> = {}
    for (const { name, ...stroke } of strokes) {
      for (const prewarp of ['full', 'poles', 'none'] as const) {
        const ts = strikeBar({ ...stroke, seconds: 3, prewarp })
        const wasm = strikeBarWasm({ ...stroke, seconds: 3, prewarp })
        const row = { output: worstDifference(wasm.velocity, ts.velocity), energy: worstDifference(wasm.energy, ts.energy), dissipated: relativeError(wasm.lost, ts.lost) }
        report[`${name}, prewarp ${prewarp}`] = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v.toExponential(1)]))
        expect(row.output, name).toBeLessThan(LINEAR)
        expect(row.energy, name).toBeLessThan(LINEAR)
        expect(row.dissipated, name).toBeLessThan(LINEAR)
        expect(relativeError(wasm.supplied, ts.supplied)).toBeLessThan(LINEAR)
      }
    }
    console.table(report)
  })

  test('two coupled resonators: both outputs, the spring force and the energy exchange agree', () => {
    const [f0, mass] = [440, 0.1]
    const kc = (mass * ((2 * Math.PI * 480) ** 2 - (2 * Math.PI * f0) ** 2)) / 2
    const barA = barModes(ALUMINIUM_BAR, [0.1], SR)
    const barB = barModes({ ...ALUMINIUM_BAR, length: 0.32 }, [0.3], SR)
    const cases: Record<string, { a: Mode[]; b: Mode[]; stiffness: number; damping: number; seconds: number }> = {
      'two 440 Hz oscillators, undamped': { a: oscillator(f0, mass), b: oscillator(f0, mass), stiffness: kc, damping: 0, seconds: 2 },
      'two eight-mode bars, spring and damper, 30 s': { a: barA, b: barB, stiffness: 4e5, damping: 2, seconds: 30 },
      'spring far too stiff for the time step (1e12 N/m)': { a: oscillator(f0, mass), b: oscillator(f0, mass), stiffness: 1e12, damping: 0, seconds: 2 },
    }
    const report: Record<string, Record<string, string>> = {}
    for (const [name, c] of Object.entries(cases)) {
      const ts = runCoupled({ a: c.a, b: c.b, spring: new SpringDamper(c.stiffness, c.damping), impulse: 0.01, seconds: c.seconds })
      const wasm = runCoupledWasm({ a: c.a, b: c.b, spring: c, impulse: 0.01, seconds: c.seconds })
      const row = {
        outputA: worstDifference(wasm.a, ts.a),
        outputB: worstDifference(wasm.b, ts.b),
        springForce: worstDifference(wasm.force, ts.force),
        energyOfA: worstDifference(wasm.energyA, ts.energyA),
        energyOfB: worstDifference(wasm.energyB, ts.energyB),
        totalEnergy: worstDifference(wasm.energy, ts.energy),
      }
      report[name] = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v.toExponential(1)]))
      // With the absurdly stiff spring the force is the small difference of
      // large numbers; it is compared more loosely.
      for (const [k, v] of Object.entries(row)) expect(v, `${name}: ${k}`).toBeLessThan(c.stiffness > 1e10 ? 1e-6 : LINEAR)
      expect(wasm.a.every(Number.isFinite) && wasm.b.every(Number.isFinite)).toBe(true)
    }
    console.table(report)
  })

  test('coupled frequencies are the same numbers', () => {
    const undamped = (modes: Mode[]) => modes.map((m) => ({ ...m, t60: Infinity }))
    const a = undamped(barModes(ALUMINIUM_BAR, [0.1], SR))
    const b = undamped(barModes({ ...ALUMINIUM_BAR, length: 0.32 }, [0.3], SR))
    const ts = runCoupled({ a, b, spring: new SpringDamper(4e5), impulse: 0.01, seconds: 1.5 })
    const wasm = runCoupledWasm({ a, b, spring: { stiffness: 4e5 }, impulse: 0.01, seconds: 1.5 })
    const [tp, wp] = [spectralPeaks(ts.a, 65536, 110), spectralPeaks(wasm.a, 65536, 110)]
    expect(wp.length).toBe(tp.length)
    expect(wp.length).toBeGreaterThanOrEqual(12)
    tp.forEach((p, i) => expect(relativeError(wp[i].freq, p.freq)).toBeLessThan(1e-9))
  })

  test('momentum: two free masses on a spring keep their total momentum', () => {
    const free = (mass: number): Mode[] => [{ frequency: 0, t60: Infinity, mass, shape: [1] }]
    const ts = runCoupled({ a: free(0.3), b: free(0.1), spring: new SpringDamper(5e4), impulse: 0.02, seconds: 1 })
    const wasm = runCoupledWasm({ a: free(0.3), b: free(0.1), spring: { stiffness: 5e4 }, impulse: 0.02, seconds: 1 })
    let worst = 0
    for (let n = 1; n < wasm.momentum.length; n++) worst = Math.max(worst, Math.abs(wasm.momentum[n] / 0.02 - 1))
    console.log('WebAssembly: largest relative change in total momentum over 1 s:', worst)
    expect(worst).toBeLessThan(1e-12)
    expect(worstDifference(wasm.a, ts.a)).toBeLessThan(LINEAR)
    expect(worstDifference(wasm.momentum, ts.momentum)).toBeLessThan(1e-12)
  })

  const wall: Mode[] = [{ frequency: 0, t60: Infinity, mass: 1e12, shape: [1] }]
  const [malletMass, stiffness] = [0.02, 1e7]

  test('Hertz contact: duration, rebound, peak force and impulse agree, at four strike velocities', () => {
    const report: Record<string, Record<string, string>> = {}
    for (const velocity of [0.25, 1, 4]) {
      for (const [name, target, K, sampleRate] of [['rigid wall, 192 kHz', wall, stiffness, 192000], ['aluminium bar, 48 kHz', barModes(ALUMINIUM_BAR, [0.35], SR), 1e8, SR]] as const) {
        const o = { target: target as Mode[], malletMass, velocity, stiffness: K, seconds: 0.5, sampleRate }
        const [ts, wasm] = [strikeWithMallet(o), strikeWithMalletWasm(o)]
        report[`${name}, ${velocity} m/s`] = {
          contact_ms: (1000 * wasm.contactTime).toFixed(4),
          contactSamplesDiffer: String(Math.round((wasm.contactTime - ts.contactTime) * sampleRate)),
          rebound: relativeError(wasm.malletVelocityAfter, ts.malletVelocityAfter).toExponential(1),
          peakForce: relativeError(wasm.peakForce, ts.peakForce).toExponential(1),
          impulse: relativeError(wasm.impulse, ts.impulse).toExponential(1),
          output: worstDifference(wasm.velocity, ts.velocity).toExponential(1),
          newtonWorst: `${wasm.worstIterations} (ts ${ts.worstIterations})`,
        }
        expect(wasm.contactTime).toBe(ts.contactTime)
        expect(wasm.separated).toBe(ts.separated)
        expect(relativeError(wasm.malletVelocityAfter, ts.malletVelocityAfter)).toBeLessThan(CONTACT)
        expect(relativeError(wasm.peakForce, ts.peakForce)).toBeLessThan(CONTACT)
        expect(relativeError(wasm.impulse, ts.impulse)).toBeLessThan(CONTACT)
        expect(worstDifference(wasm.velocity, ts.velocity)).toBeLessThan(CONTACT)
        expect(worstDifference(wasm.energy, ts.energy)).toBeLessThan(CONTACT)
      }
    }
    console.table(report)
  })

  test('Hertz contact against theory, in WebAssembly alone: contact time and its v^(-1/5) law', () => {
    const velocities = [0.25, 0.5, 1, 2, 4]
    const times = velocities.map((velocity) => strikeWithMalletWasm({ target: wall, malletMass, velocity, stiffness, seconds: 0.02, sampleRate: 384000 }).contactTime)
    expect(relativeError(times[2], hertzContactTime(malletMass, 1, stiffness))).toBeLessThan(0.005)
    const [lx, ly] = [velocities.map(Math.log), times.map(Math.log)]
    const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length
    const slope = lx.reduce((s, x, i) => s + (x - mean(lx)) * (ly[i] - mean(ly)), 0) / lx.reduce((s, x) => s + (x - mean(lx)) ** 2, 0)
    console.log('WebAssembly contact-time exponent:', slope.toFixed(4), '(theory -0.2)')
    expect(Math.abs(slope + 0.2)).toBeLessThan(0.005)
  })

  test('extreme parameters: stable, passive, and the same as the reference', () => {
    // A contact far too stiff for the time step, hit hard, at a low sample rate.
    const o = { target: barModes(ALUMINIUM_BAR, [0.35], 24000), malletMass, velocity: 4, stiffness: 1e12, seconds: 1, sampleRate: 24000 }
    const [ts, wasm] = [strikeWithMallet(o), strikeWithMalletWasm(o)]
    const before = 0.5 * malletMass * 16
    expect(wasm.velocity.every(Number.isFinite)).toBe(true)
    let worstRise = 0
    for (let n = 1; n < wasm.energy.length; n++) worstRise = Math.max(worstRise, wasm.energy[n] - wasm.energy[n - 1])
    expect(worstRise).toBeLessThan(1e-9 * before)
    expect(Math.max(...wasm.energy)).toBeLessThanOrEqual(before * (1 + 1e-9))
    console.log('too-stiff contact: output differs from the reference by', worstDifference(wasm.velocity, ts.velocity).toExponential(1), '| Newton worst', wasm.worstIterations, 'vs', ts.worstIterations)
    expect(relativeError(wasm.targetEnergyAfter, ts.targetEnergyAfter)).toBeLessThan(1e-3)
  })

  test('deterministic: two instances render identical samples, and process() equals step()', () => {
    const make = () => {
      const design = new Design(SR, true)
      const a = design.modal(barModes(ALUMINIUM_BAR, [0.1, 0.35], SR))
      const b = design.modal(barModes({ ...ALUMINIUM_BAR, length: 0.32 }, [0.3], SR))
      const mallet = design.mass(0.02)
      design.spring([a, 0], [b, 0], 4e5, 1)
      const contact = design.contact([mallet, 0], [a, 1], 1e8, 1.5, -1)
      design.output([a, 1]).output([b, 0], 0.5)
      return { engine: createEngine(design), contact, a }
    }
    const play = (stepwise: boolean) => {
      const { engine, contact, a } = make()
      const out = new Float32Array(SR)
      const events = (block: number) => {
        if (block === 0) engine.launch(contact, 1)
        if (block === 100) engine.strike(a, 0, 0.01, 0.0005)
      }
      if (!stepwise) return render(engine, out, events)
      // The same thing one sample at a time, building the pulse by hand.
      const width = Math.max(2, 0.0005 * SR)
      for (let n = 0; n < out.length; n++) {
        if (n % 128 === 0) events(n / 128)
        const i = n - 100 * 128
        if (i >= 0 && i < Math.ceil(width)) engine.applyForce(a, 0, (Math.sin((Math.PI * i) / width) * 0.01 * Math.PI * SR) / (2 * width))
        engine.step()
        out[n] = engine.output()
      }
      return out
    }
    const [first, second, stepwise] = [play(false), play(false), play(true)]
    expect(first.some((v) => v !== 0)).toBe(true)
    expect(first.every(Number.isFinite)).toBe(true)
    expect(Buffer.from(first.buffer).equals(Buffer.from(second.buffer))).toBe(true)
    expect(worstDifference(stepwise, first)).toBeLessThan(1e-12)
  })
})

// ---------------------------------------------------------------------------

const undamped = (modes: Mode[]) => modes.map((m) => ({ ...m, t60: Infinity }))
const STEEL: BarGeometry = { length: 0.28, thickness: 8, density: 7850, youngsModulus: 200, width: 0.04, lossFactor: 0.0005 }
const WOOD: BarGeometry = { length: 0.35, thickness: 15, density: 800, youngsModulus: 12, width: 0.05, lossFactor: 0.01 }

/** Three bars of different materials, two ports each. */
const threeBars = (sampleRate = SR) => [
  barModes(ALUMINIUM_BAR, [0.1, 0.4], sampleRate),
  barModes(STEEL, [0.3, 0.05], sampleRate),
  barModes(WOOD, [0.2, 0.45], sampleRate),
]
const CHAIN: SpringLink[] = [
  { a: [0, 0], b: [1, 0], stiffness: 4e5 },
  { a: [1, 1], b: [2, 0], stiffness: 2e5 },
]
const MESH: SpringLink[] = [...CHAIN, { a: [2, 1], b: [0, 1], stiffness: 3e5 }, { a: [0, 1], b: [1, 1], stiffness: 1e5 }]

/** Builds resonators and springs in the engine; returns it with the connection indices. */
function assemble(resonators: Mode[][], springs: SpringLink[], corrected: boolean, sampleRate = SR, damping = 0) {
  const design = new Design(sampleRate, corrected)
  for (const modes of resonators) design.modal(modes)
  const links = springs.map((s) => design.spring(s.a, s.b, s.stiffness, damping))
  return { engine: createEngine(design), links }
}

/** Strike every resonator at once (different strengths), record each one's port 0. */
function ring(engine: Engine, count: number, seconds: number, sampleRate = SR) {
  const out = Array.from({ length: count }, () => new Float32Array(Math.round(seconds * sampleRate)))
  for (let n = 0; n < out[0].length; n++) {
    if (n === 0) for (let r = 0; r < count; r++) engine.applyForce(r, 0, 0.01 * (r + 1) * sampleRate)
    engine.step()
    for (let r = 0; r < count; r++) out[r][n] = engine.velocity(r, 0)
  }
  return out
}

/** For each frequency theory predicts, the nearest spectral peak in any of the recordings. */
function againstTheory(recordings: Float32Array[], resonators: Mode[][], springs: SpringLink[], sampleRate = SR) {
  const expected = systemFrequencies(resonators, springs)
  const uncoupled = resonators.flatMap((modes) => modes.map((m) => m.frequency)).sort((x, y) => x - y)
  const found = recordings.flatMap((x) => spectralPeaks(x, 65536, 110, sampleRate).map((p) => p.freq))
  return expected.map((f, i) => {
    const measured = found.reduce((best, p) => (Math.abs(p - f) < Math.abs(best - f) ? p : best), Infinity)
    return { uncoupledHz: uncoupled[i], theoryHz: f, measuredHz: measured, errorPct: 100 * (measured / f - 1) }
  })
}
const worstError = (rows: { errorPct: number }[], allowMissing: number) =>
  rows.map((r) => Math.abs(r.errorPct)).sort((x, y) => y - x)[allowMissing]

describe('Several components coupled', () => {
  test('chain of three bars and a mesh with four springs: coupled frequencies match eigenvalue theory', () => {
    const bars = threeBars().map(undamped)
    const report: Record<string, Record<string, string>> = {}
    for (const [name, springs] of [['chain A-B-C (2 springs)', CHAIN], ['mesh (4 springs, two between A and B)', MESH]] as const) {
      for (const corrected of [false, true]) {
        const { engine } = assemble(bars, springs, corrected)
        const rows = againstTheory(ring(engine, 3, 1.5), bars, springs)
        if (corrected) console.table(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.toFixed(k === 'errorPct' ? 4 : 2)]))))
        // Two peaks closer together than the peak finder resolves count as one; allow two such misses.
        const worst = worstError(rows, 2)
        report[`${name}, ${corrected ? 'corrected' : 'uncorrected'}`] = {
          modes: String(rows.length),
          worstErrorPct: worst.toFixed(4),
          largestShiftHz: Math.max(...rows.map((r) => Math.abs(r.theoryHz - r.uncoupledHz))).toFixed(1),
        }
        expect(rows).toHaveLength(24)
        expect(worst, name).toBeLessThan(corrected ? 0.02 : 0.05)
      }
    }
    console.table(report)
  })

  test('forces are solved together: every connection obeys its law for the motion that results, in the same step', () => {
    // Uncorrected attachment, so that velocity() reads exactly what the springs see.
    const bars = threeBars()
    const { engine, links } = assemble(bars, MESH, false, SR, 3)
    let worst = 0
    let energyRises = 0
    let previous = Infinity
    for (let n = 0; n < SR; n++) {
      if (n === 0) for (let r = 0; r < 3; r++) engine.applyForce(r, 0, 0.01 * (r + 1) * SR)
      engine.step()
      MESH.forEach((s, i) => {
        const k = links[i].spring
        const w = engine.velocity(...s.a) - engine.velocity(...s.b) // relative velocity after ALL forces acted
        const law = s.stiffness * (engine.connectionStretch(k) + (0.5 * w) / SR) + 3 * w
        worst = Math.max(worst, Math.abs(engine.connectionForce(k) - law) / (Math.abs(law) + 1e-12))
      })
      const energy = engine.energy()
      if (n > 0 && energy > previous) energyRises++
      previous = energy
    }
    console.log('largest relative mismatch between a connection force and its law, 4 connections, 1 s:', worst.toExponential(1), '| Newton iterations worst:', engine.worstIterations())
    expect(worst).toBeLessThan(1e-9)
    expect(engine.worstIterations()).toBe(1) // linear: one solve of all four forces at once
    expect(energyRises).toBe(0)
  })

  test('undamped mesh conserves energy; momentum-free forces', () => {
    const { engine } = assemble(threeBars().map(undamped), MESH, true)
    let drift = 0
    let first = 0
    for (let n = 0; n < 2 * SR; n++) {
      if (n === 0) engine.applyForce(0, 0, 0.01 * SR)
      engine.step()
      if (n === 0) first = engine.energy()
      drift = Math.max(drift, Math.abs(engine.energy() / first - 1))
    }
    console.log('undamped three-bar mesh, corrected springs: largest relative energy drift over 2 s:', drift.toExponential(1))
    expect(drift).toBeLessThan(1e-9)
  })

  test('different damping: against an independent Runge-Kutta solution of the same equations', () => {
    // Three oscillators with different masses and decay times, springs with
    // dampers between neighbours. Reference: classical RK4 at 16x the rate.
    const osc = [
      { frequency: 220, t60: 1.5, mass: 0.1 },
      { frequency: 277, t60: 0.4, mass: 0.25 },
      { frequency: 330, t60: 4, mass: 0.05 },
    ]
    const springs = [
      { a: 0, b: 1, k: 3e4, c: 1.5 },
      { a: 1, b: 2, k: 1e4, c: 0.2 },
    ]
    const design = new Design(SR, true)
    for (const o of osc) design.modal([{ ...o, shape: [1] }])
    for (const s of springs) design.spring([s.a, 0], [s.b, 0], s.k, s.c)
    const engine = createEngine(design)
    const N = Math.round(0.5 * SR)
    const out = [0, 1, 2].map(() => new Float64Array(N))
    for (let n = 0; n < N; n++) {
      if (n === 0) engine.applyForce(0, 0, 0.01 * SR)
      engine.step()
      for (let r = 0; r < 3; r++) out[r][n] = engine.velocity(r, 0)
    }
    // RK4 on y = (q0..q2, v0..v2); the strike is an initial velocity J / m.
    const acceleration = (y: Float64Array, d: Float64Array) => {
      for (let i = 0; i < 3; i++) {
        const sigma = Math.log(1000) / osc[i].t60
        const w = 2 * Math.PI * osc[i].frequency
        d[i] = y[3 + i]
        d[3 + i] = -(w * w + sigma * sigma) * y[i] - 2 * sigma * y[3 + i]
      }
      for (const s of springs) {
        const force = s.k * (y[s.a] - y[s.b]) + s.c * (y[3 + s.a] - y[3 + s.b])
        d[3 + s.a] -= force / osc[s.a].mass
        d[3 + s.b] += force / osc[s.b].mass
      }
    }
    const h = 1 / (16 * SR)
    const y = new Float64Array(6)
    y[3] = 0.01 / osc[0].mass
    const [k1, k2, k3, k4, t] = [0, 1, 2, 3, 4].map(() => new Float64Array(6))
    const reference = [0, 1, 2].map(() => new Float64Array(N))
    for (let n = 0; n < N; n++) {
      for (let r = 0; r < 3; r++) reference[r][n] = y[3 + r]
      for (let sub = 0; sub < 16; sub++) {
        acceleration(y, k1)
        for (let i = 0; i < 6; i++) t[i] = y[i] + 0.5 * h * k1[i]
        acceleration(t, k2)
        for (let i = 0; i < 6; i++) t[i] = y[i] + 0.5 * h * k2[i]
        acceleration(t, k3)
        for (let i = 0; i < 6; i++) t[i] = y[i] + h * k3[i]
        acceleration(t, k4)
        for (let i = 0; i < 6; i++) y[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])
      }
    }
    // The engine's sample n is the velocity half a step after n T, and its
    // one-sample strike is centred half a step after zero: the two line up.
    const report: Record<string, string> = {}
    for (let r = 0; r < 3; r++) {
      let diff = 0
      let ref = 0
      for (let n = 1; n < N; n++) {
        diff += (out[r][n] - reference[r][n]) ** 2
        ref += reference[r][n] ** 2
      }
      const residual = 10 * Math.log10(diff / ref)
      report[`oscillator ${r + 1}`] = `${residual.toFixed(1)} dB`
      expect(residual).toBeLessThan(-50)
    }
    console.table(report)
  })

  test('several notes at once: the response to simultaneous strikes is the sum of the separate responses', () => {
    const bars = threeBars()
    const play = (struck: number[]) => {
      const { engine } = assemble(bars, MESH, true, SR, 1)
      engine.addOutput(0, 0, 1)
      engine.addOutput(1, 0, 1)
      engine.addOutput(2, 0, 1)
      return render(engine, new Float32Array(SR), (block) => {
        if (block === 0) for (const r of struck) engine.strike(r, 1, 0.01 * (r + 1), 0.0004)
      })
    }
    const [together, a, b, c] = [play([0, 1, 2]), play([0]), play([1]), play([2])]
    const sum = Float32Array.from(a, (v, i) => v + b[i] + c[i])
    expect(together.every(Number.isFinite)).toBe(true)
    expect(worstDifference(together, sum)).toBeLessThan(1e-6) // 32-bit output samples
  })
})

describe('High-frequency coupling accuracy', () => {
  /**
   * Two identical undamped oscillators at `f` joined by a spring that puts
   * the out-of-phase mode at `ratio` x f. Their difference is then a pure
   * sinusoid, whose frequency x[n+1] + x[n-1] = 2 cos(wT) x[n] gives to
   * rounding error. Returns the relative error of that frequency.
   */
  function upperModeError(f: number, ratio: number, sampleRate: number, corrected: boolean) {
    const mass = 0.1
    const kc = (mass * ((2 * Math.PI * f * ratio) ** 2 - (2 * Math.PI * f) ** 2)) / 2
    const { engine } = assemble([oscillator(f, mass), oscillator(f, mass)], [{ a: [0, 0], b: [1, 0], stiffness: kc }], corrected, sampleRate)
    const N = Math.round(0.25 * sampleRate)
    const x = new Float64Array(N)
    for (let n = 0; n < N; n++) {
      if (n === 0) engine.applyForce(0, 0, 0.01 * sampleRate)
      engine.step()
      x[n] = engine.velocity(0, 0) - engine.velocity(1, 0)
    }
    let num = 0
    let den = 0
    for (let n = 2; n < N - 1; n++) {
      num += x[n] * (x[n + 1] + x[n - 1])
      den += 2 * x[n] * x[n]
    }
    return (Math.acos(num / den) * sampleRate) / (2 * Math.PI) / (f * ratio) - 1
  }

  test('error of the coupled mode at 44.1, 48, 96 and 192 kHz: uncorrected, corrected, and at twice the rate', () => {
    const pct = (v: number) => (100 * v).toFixed(4)
    for (const [ratio, label] of [[1.01, 'weak spring: mode moved 1 %'], [1.1, 'moderate spring: mode moved 10 % (the Phase 3A case)'], [1.5, 'very stiff spring: mode moved 50 %']] as const) {
      const rows: Record<string, Record<string, string>> = {}
      for (const f of [440, 2000, 8000, 16000]) {
        for (const sampleRate of [44100, 48000, 96000, 192000]) {
          if (f * ratio > 0.45 * sampleRate) continue
          rows[`${f} -> ${Math.round(f * ratio)} Hz at ${sampleRate}`] = {
            uncorrected_pct: pct(upperModeError(f, ratio, sampleRate, false)),
            corrected_pct: pct(upperModeError(f, ratio, sampleRate, true)),
            oversampled2x_pct: pct(upperModeError(f, ratio, 2 * sampleRate, false)),
            oversampled2x_corrected_pct: pct(upperModeError(f, ratio, 2 * sampleRate, true)),
          }
        }
      }
      console.log(label)
      console.table(rows)
    }
    // The Phase 3A measurement, reproduced, and what the correction does to it.
    expect(Math.abs(upperModeError(8000, 1.1, 48000, false) + 0.011)).toBeLessThan(0.0005)
    expect(Math.abs(upperModeError(8000, 1.1, 48000, true))).toBeLessThan(0.0003) // 1.1 % -> under 0.03 %
    // At 48 kHz the corrected spring beats the uncorrected one run at 4x the rate, weak or stiff.
    for (const ratio of [1.01, 1.1, 1.5]) {
      expect(Math.abs(upperModeError(8000, ratio, 48000, true))).toBeLessThan(Math.abs(upperModeError(8000, ratio, 192000, false)))
    }
    // It never makes things worse, at any rate or strength tried.
    for (const ratio of [1.01, 1.1, 1.5]) {
      for (const sampleRate of [44100, 48000, 96000, 192000]) {
        for (const f of [440, 2000, 8000]) {
          expect(Math.abs(upperModeError(f, ratio, sampleRate, true))).toBeLessThanOrEqual(Math.abs(upperModeError(f, ratio, sampleRate, false)) + 1e-9)
        }
      }
    }
  })

  test('realistic case: two eight-mode bars, springs from soft to very stiff, every mode up to 20 kHz', () => {
    const report: Record<string, Record<string, string>> = {}
    for (const stiffness of [4e5, 4e6, 4e7]) {
      const springs: SpringLink[] = [{ a: [0, 0], b: [1, 0], stiffness }]
      const row: Record<string, string> = {}
      for (const [label, sampleRate, corrected] of [['48 kHz uncorrected', 48000, false], ['48 kHz corrected', 48000, true], ['96 kHz uncorrected', 96000, false], ['96 kHz corrected', 96000, true]] as const) {
        // The same sixteen modes at both rates, so the rows are comparable.
        const bars = [barModes(ALUMINIUM_BAR, [0.1], 48000), barModes({ ...ALUMINIUM_BAR, length: 0.32 }, [0.3], 48000)].map(undamped)
        const { engine } = assemble(bars, springs, corrected, sampleRate)
        row[label] = worstError(againstTheory(ring(engine, 2, 1.5, sampleRate), bars, springs, sampleRate), 2).toFixed(4)
      }
      report[`spring ${stiffness.toExponential(0)} N/m: worst error, percent`] = row
      expect(Number(row['48 kHz corrected'])).toBeLessThan(0.04) // even with the bars all but welded together
      expect(Number(row['48 kHz corrected'])).toBeLessThanOrEqual(Number(row['48 kHz uncorrected']))
    }
    console.table(report)
    // Twice the sample rate without the correction is less accurate than 48 kHz with it.
    expect(Number(report['spring 4e+7 N/m: worst error, percent']['96 kHz uncorrected'])).toBeGreaterThan(Number(report['spring 4e+7 N/m: worst error, percent']['48 kHz corrected']))
  })

  test('the correction is for springs only: a damper keeps the plain attachment', () => {
    // Decay rate that a damper between two identical oscillators gives the
    // out-of-phase mode, relative to theory (c / m), for the three ways of attaching it.
    const [mass, damping, sampleRate] = [0.1, 0.5, 48000]
    const measure = (f: number, build: (d: Design, a: number, b: number, kc: number) => void) => {
      const kc = (mass * ((2 * Math.PI * f * 1.01) ** 2 - (2 * Math.PI * f) ** 2)) / 2
      const design = new Design(sampleRate, true)
      const [a, b] = [design.modal(oscillator(f, mass)), design.modal(oscillator(f, mass))]
      build(design, a, b, kc)
      const engine = createEngine(design)
      const energyAt: number[] = []
      for (let n = 0; n < sampleRate / 4; n++) {
        if (n === 0) {
          engine.applyForce(a, 0, 0.01 * sampleRate)
          engine.applyForce(b, 0, -0.01 * sampleRate) // out-of-phase mode only
        }
        engine.step()
        energyAt.push(engine.energy())
      }
      const [from, to] = [1000, 11000]
      return Math.log(energyAt[from] / energyAt[to]) / (2 * ((to - from) / sampleRate)) / (damping / mass)
    }
    const rows: Record<string, Record<string, string>> = {}
    for (const f of [440, 2000, 8000, 16000]) {
      const plain = measure(f, (d, a, b, kc) => d.calls.push(['addSpring', a, 0, b, 0, kc, damping, 0, 0]))
      const split = measure(f, (d, a, b, kc) => d.spring([a, 0], [b, 0], kc, damping))
      const both = measure(f, (d, a, b, kc) => d.calls.push(['addSpring', a, 0, b, 0, kc, damping, 0, 1]))
      rows[`${f} Hz`] = { 'nothing corrected': plain.toFixed(4), 'spring corrected, damper plain (used)': split.toFixed(4), 'both corrected': both.toFixed(4) }
      expect(Math.abs(split - 1)).toBeLessThan(0.05)
      if (f >= 8000) expect(Math.abs(both - 1)).toBeGreaterThan(Math.abs(split - 1))
    }
    console.log('decay rate given by a damper, measured / theory:')
    console.table(rows)
  })
})

describe('Editing while it sounds', () => {
  test('connection stiffness and damping: same behaviour as the reference, for all three policies', () => {
    const [f0, mass] = [440, 0.1]
    const k1 = (mass * ((2 * Math.PI * 460) ** 2 - (2 * Math.PI * f0) ** 2)) / 2
    const N = Math.round(0.4 * SR)
    for (const [name, policy] of [['instant', INSTANT], ['ramp', RAMP], ['zero-crossing', ZERO_CROSSING]] as const) {
      const spring = new SpringDamper(k1)
      const system = new System()
      const a = { resonator: system.add(new ModalResonator(oscillator(f0, mass, 4), SR)), port: 0 }
      const b = { resonator: system.add(new ModalResonator(oscillator(f0, mass, 4), SR)), port: 0 }
      system.connect(spring, a, b)
      system.build(SR)
      const { engine, links } = assemble([oscillator(f0, mass, 4), oscillator(f0, mass, 4)], [{ a: [0, 0], b: [1, 0], stiffness: k1 }], false)
      const [ts, wasm] = [new Float64Array(N), new Float64Array(N)]
      for (let n = 0; n < N; n++) {
        if (n === 0) {
          system.applyForce(a, 0.01 * SR)
          engine.applyForce(0, 0, 0.01 * SR)
        }
        if (n === 5000) {
          spring.setStiffness(4 * k1, name, 480)
          engine.setStiffness(links[0].spring, 4 * k1, policy, 480)
        }
        if (n === 9000) {
          spring.setDamping(5)
          engine.setDamping(links[0].damper, 5)
        }
        system.step()
        engine.step()
        ts[n] = system.velocity(a)
        wasm[n] = engine.velocity(0, 0)
      }
      expect(worstDifference(wasm, ts), name).toBeLessThan(LINEAR)
      expect(relativeError(engine.injected(links[0].spring), spring.injected), name).toBeLessThan(1e-9)
      expect(engine.stiffness(links[0].spring)).toBe(4 * k1)
    }
  })

  /** Two undamped coupled bars, struck; `edit` is called before sample `at`. Tracks energy and the output's largest jump around the edit. */
  function editing(edit: (engine: Engine, n: number) => void, seconds = 1.2, decay = false) {
    const bars = [barModes(ALUMINIUM_BAR, [0.1], SR), barModes({ ...ALUMINIUM_BAR, length: 0.32 }, [0.3], SR)]
    const { engine, links } = assemble(decay ? bars : bars.map(undamped), [{ a: [0, 0], b: [1, 0], stiffness: 4e5 }], true)
    const N = Math.round(seconds * SR)
    const out = new Float32Array(N)
    const energy = new Float64Array(N)
    for (let n = 0; n < N; n++) {
      if (n === 0) engine.applyForce(0, 0, 0.01 * SR)
      edit(engine, n)
      engine.step()
      out[n] = engine.velocity(0, 0) + engine.velocity(1, 0)
      energy[n] = engine.energy()
    }
    return { out, energy, engine, links, bars }
  }

  test('resonator frequency: retuning a sounding bar by 20 % adds no energy and makes no jump', () => {
    const at = 9001
    const run = editing((engine, n) => {
      if (n !== at) return
      barModes(ALUMINIUM_BAR, [0.1], SR).forEach((mode, i) => engine.tune(0, i, mode.frequency * 1.2, Infinity))
    })
    const change = run.energy[at] / run.energy[at - 1] - 1
    const jump = maxStep(run.out, at - 2, at + 3) / maxStep(run.out, at - 960, at - 2)
    // After the edit it is a different instrument: its frequencies are those theory gives for the retuned bar.
    const retuned = [run.bars[0].map((m) => ({ ...m, t60: Infinity, frequency: m.frequency * 1.2 })), undamped(run.bars[1])]
    const rows = againstTheory([run.out.subarray(at)], retuned, [{ a: [0, 0], b: [1, 0], stiffness: 4e5 }])
    console.log('retune +20 % at one sample: relative energy change', change.toExponential(1), '| jump across the edit / largest jump before', jump.toFixed(2), '| worst frequency error after, %', worstError(rows, 2).toFixed(4))
    expect(Math.abs(change)).toBeLessThan(1e-12)
    expect(jump).toBeLessThan(1.5)
    expect(worstError(rows, 2)).toBeLessThan(0.02)
    expect(run.out.every(Number.isFinite)).toBe(true)
  })

  test('resonator frequency: a continuous glide, and rapid random retuning, never add energy', () => {
    const base = barModes(ALUMINIUM_BAR, [0.1], SR)
    const glide = editing((engine, n) => {
      if (n % 128 !== 0 || n < 4800 || n > 28800) return
      const ratio = 1 + (0.5 * (n - 4800)) / 24000 // up a fifth over half a second, one step per block
      base.forEach((mode, i) => engine.tune(0, i, mode.frequency * ratio, Infinity))
    })
    let seed = 1
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    const wild = editing((engine, n) => {
      if (n % 64 === 0 && n > 0) base.forEach((mode, i) => engine.tune(0, i, mode.frequency * (0.5 + 1.5 * random()), Infinity))
    })
    for (const [name, run] of [['glide', glide], ['random retune every 64 samples', wild]] as const) {
      let drift = 0
      for (const e of run.energy) drift = Math.max(drift, Math.abs(e / run.energy[0] - 1))
      console.log(`${name}: largest relative change of total energy:`, drift.toExponential(1))
      expect(drift, name).toBeLessThan(1e-9)
      expect(run.out.every(Number.isFinite)).toBe(true)
    }
    expect(maxStep(glide.out, 4800, 28800) / maxStep(glide.out, 1, 4800)).toBeLessThan(2)
  })

  test('resonator damping: shortening the decay while it rings is passive and smooth', () => {
    const at = 9001
    const base = barModes(ALUMINIUM_BAR, [0.1], SR)
    const plain = editing(() => {}, 1.2, true)
    const run = editing((engine, n) => {
      if (n === at) base.forEach((mode, i) => engine.tune(0, i, mode.frequency, 0.05))
    }, 1.2, true)
    let rises = 0
    for (let n = 2; n < run.energy.length; n++) if (run.energy[n] > run.energy[n - 1]) rises++
    expect(rises).toBe(0)
    expect(Math.abs(run.energy[at] / run.energy[at - 1] - 1)).toBeLessThan(0.01) // one step's worth of the new loss (0.6 %), no jump
    expect(run.energy.at(-1)!).toBeLessThan(0.2 * plain.energy.at(-1)!)
    expect(maxStep(run.out, at - 2, at + 3) / maxStep(run.out, at - 960, at - 2)).toBeLessThan(1.2)
  })

  test('topology: connecting and disconnecting a third bar while the others ring', () => {
    const bars = threeBars().map(undamped)
    // The second spring exists from the start with no stiffness: no connection.
    const { engine, links } = assemble(bars, [CHAIN[0], { ...CHAIN[1], stiffness: 0 }], true)
    const joint = links[1].spring
    const N = SR
    const out = new Float32Array(N)
    const energy = new Float64Array(N)
    const energyC = new Float64Array(N)
    const [connectAt, releaseAt] = [9601, 28801]
    for (let n = 0; n < N; n++) {
      if (n === 0) engine.applyForce(0, 0, 0.01 * SR)
      if (n === connectAt) {
        engine.attach(joint) // rest length := present length
        engine.setStiffness(joint, 2e5, INSTANT, 0)
      }
      if (n === releaseAt) engine.setStiffness(joint, 0, ZERO_CROSSING, 0)
      engine.step()
      out[n] = engine.velocity(0, 0) + engine.velocity(1, 0) + engine.velocity(2, 0)
      energy[n] = engine.energy()
      energyC[n] = engine.resonatorEnergy(2)
    }
    const released = energy.findIndex((_, n) => n > releaseAt && engine.stiffness(joint) === 0 && Math.abs(energyC[n] - energyC[N - 1]) < 1e-14 * energy[0])
    console.table({
      'before connecting': { totalEnergy: energy[connectAt - 1].toExponential(6), energyOfC: energyC[connectAt - 1].toExponential(3) },
      'just after connecting': { totalEnergy: energy[connectAt].toExponential(6), energyOfC: energyC[connectAt].toExponential(3) },
      'while connected (peak of C)': { totalEnergy: energy[releaseAt - 1].toExponential(6), energyOfC: Math.max(...energyC.subarray(connectAt, releaseAt)).toExponential(3) },
      'after disconnecting': { totalEnergy: energy[N - 1].toExponential(6), energyOfC: energyC[N - 1].toExponential(3) },
    })
    expect(Math.max(...energyC.subarray(0, connectAt))).toBe(0) // C is silent until connected
    expect(Math.abs(energy[connectAt] / energy[connectAt - 1] - 1)).toBeLessThan(1e-12) // connecting adds nothing
    expect(engine.injected(joint)).toBeLessThanOrEqual(1e-12 * energy[0])
    expect(Math.max(...energyC.subarray(connectAt, releaseAt))).toBeGreaterThan(1e-5 * energy[0]) // C now sounds
    expect(Math.abs(energy[N - 1] / energy[0] - 1)).toBeLessThan(1e-3) // releasing at a zero crossing removes almost nothing
    expect(energy[N - 1]).toBeLessThanOrEqual(energy[0] * (1 + 1e-12)) // and never adds
    expect(released).toBeGreaterThan(releaseAt) // afterwards C keeps exactly what it had: it is disconnected
    for (let n = released; n < N; n++) expect(Math.abs(energyC[n] - energyC[N - 1])).toBeLessThan(1e-12 * energy[0])
    for (const at of [connectAt, releaseAt]) expect(maxStep(out, at - 2, at + 100) / maxStep(out, at - 960, at - 2)).toBeLessThan(1.5)
    expect(out.every(Number.isFinite)).toBe(true)
  })

  test('no recompilation, no allocation: every kind of edit and strike, 64 s of audio, memory fixed and no garbage collected', async () => {
    const design = new Design(SR, true)
    const bars = threeBars().map((modes) => design.modal(modes))
    const mallet = design.mass(0.02)
    const first = design.spring([bars[0], 0], [bars[1], 0], 4e5, 1)
    const second = design.spring([bars[1], 1], [bars[2], 0], 0, 0)
    const contact = design.contact([mallet, 0], [bars[0], 1], 1e8, 1.5, -1)
    design.output([bars[0], 0]).output([bars[2], 1])
    const engine = createEngine(design)
    const block = new Float32Array(engine.memory.buffer, engine.outputPointer(), 128)
    const base = threeBars()[0]
    const memoryBefore = engine.memory.buffer.byteLength
    const tick = (i: number) => {
      if (i % 37 === 0) {
        engine.launch(contact, 0.5 + (i % 5))
        engine.strike(bars[1], 0, 0.01, 0.0005)
        engine.setStiffness(first.spring, 4e5 * (1 + (i % 7)), i % 2 ? RAMP : ZERO_CROSSING, 240)
        engine.setDamping(first.damper, 0.5 + (i % 3))
        if (i % 2) {
          engine.attach(second.spring)
          engine.setStiffness(second.spring, 2e5, INSTANT, 0)
        } else engine.setStiffness(second.spring, 0, RAMP, 480)
      }
      if (i % 5 === 0) for (let m = 0; m < 8; m++) engine.tune(bars[0], m, base[m].frequency * (1 + 0.01 * (i % 50)), base[m].t60)
      engine.process(128)
    }
    const collections: number[] = []
    const observer = new PerformanceObserver((list) => collections.push(...list.getEntries().map((e) => e.startTime)))
    observer.observe({ entryTypes: ['gc'] })
    for (let i = 0; i < 4000; i++) tick(i) // let the JIT settle
    await new Promise((resolve) => setTimeout(resolve, 20))
    const from = performance.now()
    let finite = true
    for (let i = 0; i < 24000; i++) {
      tick(i)
      finite &&= block[0] === block[0] && Math.abs(block[127]) < 1e6
    }
    const to = performance.now()
    await new Promise((resolve) => setTimeout(resolve, 20))
    observer.disconnect()
    const during = collections.filter((t) => t >= from && t <= to).length
    console.log('3,072,000 samples with edits every block group: garbage collections', during, '| WebAssembly memory bytes before/after', memoryBefore, engine.memory.buffer.byteLength, '| faults', engine.faults(), '| ms', Math.round(to - from))
    expect(during).toBe(0)
    expect(engine.memory.buffer.byteLength).toBe(memoryBefore)
    expect(engine.faults()).toBe(0)
    expect(finite).toBe(true)
    expect(outputBuffer(engine).length).toBe(4096)
  })
})
