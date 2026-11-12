// Scenarios for the Phase 3A experimental physics engine, shared by its tests
// (tests/experimental.test.ts) and its listening renders
// (analysis/render-experimental.ts). No Faust here.
import { barModeShape } from '../src/audio/engine/physics.ts'
import { ALUMINIUM_BAR, barContactTime, barModes, halfSinePulse, type BarGeometry } from '../src/experimental/physics/bar.ts'
import { HertzContact, SpringDamper } from '../src/experimental/physics/connections.ts'
import { ModalResonator, pointMass, type Mode, type Prewarp } from '../src/experimental/physics/resonator.ts'
import { System } from '../src/experimental/physics/system.ts'
import { SR } from './lib.ts'

export { ALUMINIUM_BAR, barModes, HertzContact, ModalResonator, pointMass, SpringDamper, System }
export type { BarGeometry, Mode, Prewarp }

// ---- Experiment A: one bar, driven exactly as the approved Faust bar is -------

export interface BarStrike {
  bar?: BarGeometry
  strikePosition?: number
  hardness?: number
  velocity?: number
  key?: number
  seconds: number
  sampleRate?: number
  prewarp?: Prewarp
}

/**
 * One bar in the experimental engine, struck by the approved model's
 * half-sine force pulse and observed at the strike point.
 *
 * `velocity` is the raw physical output: the bar's velocity at that point in
 * m/s, for a pulse whose impulse is `velocity` N s. `toFaust` is the constant
 * that converts it to the approved model's output level, which differs only
 * by that model's loudness normalisation (mode weights divided by their
 * root-sum-square, times 0.2) where the engine divides by the bar's mass.
 */
export function strikeBar(o: BarStrike) {
  const sampleRate = o.sampleRate ?? SR
  const bar = o.bar ?? ALUMINIUM_BAR
  const position = o.strikePosition ?? 0.35
  const velocity = o.velocity ?? 0.8
  const modes = barModes(bar, [position], sampleRate, o.key ?? 0)
  const system = new System()
  const port = { resonator: system.add(new ModalResonator(modes, sampleRate, o.prewarp ?? 'full')), port: 0 }
  system.build(sampleRate)
  const pulse = halfSinePulse(barContactTime(o.hardness ?? 0.6, velocity), velocity, sampleRate)
  const out = new Float32Array(Math.round(o.seconds * sampleRate))
  const energy = new Float64Array(out.length)
  let supplied = 0
  let lost = 0
  for (let n = 0; n < out.length; n++) {
    const force = n < pulse.length ? pulse[n] : 0
    system.applyForce(port, force)
    system.step()
    out[n] = system.velocity(port)
    supplied += (force * system.velocity(port)) / sampleRate
    lost += system.dissipated()
    energy[n] = system.energy()
  }
  const weights = modes.map((_, n) => barModeShape(n, position) ** 2)
  const norm = Math.sqrt(weights.reduce((s, w) => s + w * w, 0))
  const toFaust = (0.2 * 2 * modes[0].mass * sampleRate) / norm
  return { velocity: out, toFaust, modes, energy, supplied, lost }
}

// ---- Experiment B: two resonators joined by a spring --------------------------

export interface Coupled {
  a: Mode[]
  b: Mode[]
  /** Spring between port 0 of each. null leaves them unconnected. */
  spring: SpringDamper | null
  /** Impulse given to port 0 of resonator a at time zero (N s). */
  impulse: number
  seconds: number
  sampleRate?: number
}

/**
 * Two resonators, optionally joined by a spring, with the first one struck.
 * Returns each resonator's port velocity and stored energy over time, plus
 * the spring force. Without a spring the two are simply independent, which
 * is what mixing two instruments amounts to.
 */
export function runCoupled(o: Coupled) {
  const sampleRate = o.sampleRate ?? SR
  const system = new System()
  const [ra, rb] = [new ModalResonator(o.a, sampleRate), new ModalResonator(o.b, sampleRate)]
  const a = { resonator: system.add(ra), port: 0 }
  const b = { resonator: system.add(rb), port: 0 }
  if (o.spring) system.connect(o.spring, a, b)
  system.build(sampleRate)
  const N = Math.round(o.seconds * sampleRate)
  const result = {
    a: new Float32Array(N),
    b: new Float32Array(N),
    energyA: new Float64Array(N),
    energyB: new Float64Array(N),
    energy: new Float64Array(N),
    force: new Float64Array(N),
    momentum: new Float64Array(N),
    system,
    spring: o.spring,
  }
  for (let n = 0; n < N; n++) {
    // A one-sample force of impulse J has value J / T.
    if (n === 0) system.applyForce(a, o.impulse * sampleRate)
    system.step()
    result.a[n] = system.velocity(a)
    result.b[n] = system.velocity(b)
    result.energyA[n] = ra.energy()
    result.energyB[n] = rb.energy()
    result.energy[n] = system.energy()
    result.force[n] = o.spring ? system.connectionForce(0) : 0
    result.momentum[n] = ra.momentum() + rb.momentum()
  }
  return result
}

// ---- Experiment C: a mallet striking through a Hertz contact --------------------

export interface MalletStrike {
  /** What is struck, with its strike point as port 0. */
  target: Mode[]
  malletMass: number // kg
  velocity: number // m/s, towards the target
  stiffness: number // N / m^1.5
  alpha?: number
  seconds: number
  sampleRate?: number
}

/**
 * A free mass approaching a resonator and meeting it through a one-sided
 * Hertz contact. The mallet is part of the system, so its kinetic energy is
 * part of the system's energy: nothing is injected from outside.
 */
export function strikeWithMallet(o: MalletStrike) {
  const sampleRate = o.sampleRate ?? SR
  const system = new System()
  const mallet = pointMass(o.malletMass, sampleRate)
  mallet.setVelocity(o.velocity)
  const target = new ModalResonator(o.target, sampleRate)
  const m = { resonator: system.add(mallet), port: 0 }
  const t = { resonator: system.add(target), port: 0 }
  // Compression = mallet position - target position; starts at zero (just touching).
  system.connect(new HertzContact(o.stiffness, o.alpha ?? 1.5), m, t)
  system.build(sampleRate)
  const N = Math.round(o.seconds * sampleRate)
  const out = new Float32Array(N)
  const force = new Float64Array(N)
  const energy = new Float64Array(N)
  let contactSamples = 0
  let lastContact = -1
  let peakForce = 0
  let lost = 0
  let impulse = 0
  for (let n = 0; n < N; n++) {
    system.step()
    out[n] = system.velocity(t)
    force[n] = system.connectionForce(0)
    energy[n] = system.energy()
    lost += system.dissipated()
    impulse += force[n] / sampleRate
    if (force[n] > 0) {
      contactSamples++
      lastContact = n
      peakForce = Math.max(peakForce, force[n])
    }
  }
  return {
    velocity: out,
    force,
    energy,
    contactTime: contactSamples / sampleRate,
    /** True if the mallet left and never came back within the render. */
    separated: lastContact >= 0 && lastContact < N - 2,
    lastContactTime: (lastContact + 1) / sampleRate,
    peakForce,
    impulse,
    malletVelocityAfter: mallet.momentum() / o.malletMass,
    targetEnergyAfter: target.energy(),
    lost,
    worstIterations: system.worstIterations,
  }
}

/** Contact time of a mass m hitting a rigid wall at speed v through F = K eta^1.5 (Hertz, exact). */
export function hertzContactTime(mass: number, velocity: number, stiffness: number): number {
  const compression = ((5 * mass * velocity * velocity) / (4 * stiffness)) ** 0.4
  return (2.9432 * compression) / velocity
}
