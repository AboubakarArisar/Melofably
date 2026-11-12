// Phase 3A.1: the scenarios of analysis/experimental.ts run on the WebAssembly
// engine instead of the TypeScript reference, returning the same quantities.
// Shared by tests/wasm.test.ts, the renders and the benchmarks. Node only.
import { readFileSync } from 'node:fs'
import { barModeShape } from '../src/audio/engine/physics.ts'
import { ALUMINIUM_BAR, barContactTime, barModes, halfSinePulse } from '../src/experimental/physics/bar.ts'
import type { Mode } from '../src/experimental/physics/resonator.ts'
import { Design, instantiate, outputBuffer, run, type Call, type Engine, type Port } from '../src/experimental/wasm/engine.ts'
import type { BarStrike, MalletStrike } from './experimental.ts'
import { SR } from './lib.ts'

export { Design, outputBuffer, run }
export type { Call, Engine, Port }

/** The exact file the browser loads (built by `npm run engine`). */
export const engineBytes = readFileSync(new URL('../src/experimental/wasm/generated/engine.wasm', import.meta.url))

/** A fresh engine, optionally built from a design. */
export function createEngine(design?: Design): Engine {
  const engine = instantiate(engineBytes)
  if (design) run(engine, design.build())
  return engine
}

/** Advance `out.length` samples through process() in 128-sample blocks, as an AudioWorklet would. */
export function render(engine: Engine, out: Float32Array, before?: (block: number) => void): Float32Array {
  const buffer = outputBuffer(engine)
  for (let at = 0, block = 0; at < out.length; at += 128, block++) {
    before?.(block)
    const count = Math.min(128, out.length - at)
    engine.process(count)
    out.set(buffer.subarray(0, count), at)
  }
  return out
}

/** strikeBar() of analysis/experimental.ts on the WebAssembly engine. */
export function strikeBarWasm(o: BarStrike) {
  const sampleRate = o.sampleRate ?? SR
  const position = o.strikePosition ?? 0.35
  const velocity = o.velocity ?? 0.8
  const modes = barModes(o.bar ?? ALUMINIUM_BAR, [position], sampleRate, o.key ?? 0)
  const design = new Design(sampleRate, false, ({ none: 0, poles: 1, full: 2 } as const)[o.prewarp ?? 'full'])
  const bar = design.modal(modes)
  const engine = createEngine(design)
  const pulse = halfSinePulse(barContactTime(o.hardness ?? 0.6, velocity), velocity, sampleRate)
  const out = new Float32Array(Math.round(o.seconds * sampleRate))
  const energy = new Float64Array(out.length)
  let supplied = 0
  let lost = 0
  for (let n = 0; n < out.length; n++) {
    const force = n < pulse.length ? pulse[n] : 0
    engine.applyForce(bar, 0, force)
    engine.step()
    out[n] = engine.velocity(bar, 0)
    supplied += (force * engine.velocity(bar, 0)) / sampleRate
    lost += engine.dissipated()
    energy[n] = engine.energy()
  }
  const weights = modes.map((_, n) => barModeShape(n, position) ** 2)
  const norm = Math.sqrt(weights.reduce((s, w) => s + w * w, 0))
  return { velocity: out, toFaust: (0.2 * 2 * modes[0].mass * sampleRate) / norm, modes, energy, supplied, lost }
}

export interface CoupledWasm {
  a: Mode[]
  b: Mode[]
  /** Spring between port 0 of each; null leaves them unconnected. */
  spring: { stiffness: number; damping?: number } | null
  impulse: number
  seconds: number
  sampleRate?: number
  /** Frequency-corrected spring attachment. Off reproduces the reference. */
  corrected?: boolean
}

/** runCoupled() of analysis/experimental.ts on the WebAssembly engine. */
export function runCoupledWasm(o: CoupledWasm) {
  const sampleRate = o.sampleRate ?? SR
  const design = new Design(sampleRate, o.corrected ?? false)
  const [a, b] = [design.modal(o.a), design.modal(o.b)]
  const link = o.spring ? design.spring([a, 0], [b, 0], o.spring.stiffness, o.spring.damping ?? 0) : null
  const engine = createEngine(design)
  const N = Math.round(o.seconds * sampleRate)
  const result = {
    a: new Float32Array(N),
    b: new Float32Array(N),
    energyA: new Float64Array(N),
    energyB: new Float64Array(N),
    energy: new Float64Array(N),
    force: new Float64Array(N),
    momentum: new Float64Array(N),
    engine,
    link,
  }
  for (let n = 0; n < N; n++) {
    if (n === 0) engine.applyForce(a, 0, o.impulse * sampleRate)
    engine.step()
    result.a[n] = engine.velocity(a, 0)
    result.b[n] = engine.velocity(b, 0)
    result.energyA[n] = engine.resonatorEnergy(a)
    result.energyB[n] = engine.resonatorEnergy(b)
    result.energy[n] = engine.energy()
    result.force[n] = link ? engine.connectionForce(link.spring) : 0
    result.momentum[n] = engine.momentum(a) + engine.momentum(b)
  }
  return result
}

/** strikeWithMallet() of analysis/experimental.ts on the WebAssembly engine. */
export function strikeWithMalletWasm(o: MalletStrike) {
  const sampleRate = o.sampleRate ?? SR
  const design = new Design(sampleRate, false)
  const mallet = design.mass(o.malletMass)
  const target = design.modal(o.target)
  const contact = design.contact([mallet, 0], [target, 0], o.stiffness, o.alpha ?? 1.5)
  const engine = createEngine(design)
  engine.setVelocity(mallet, o.velocity)
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
    engine.step()
    out[n] = engine.velocity(target, 0)
    force[n] = engine.connectionForce(contact)
    energy[n] = engine.energy()
    lost += engine.dissipated()
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
    separated: lastContact >= 0 && lastContact < N - 2,
    lastContactTime: (lastContact + 1) / sampleRate,
    peakForce,
    impulse,
    malletVelocityAfter: engine.momentum(mallet) / o.malletMass,
    targetEnergyAfter: engine.resonatorEnergy(target),
    lost,
    worstIterations: engine.worstIterations(),
  }
}
