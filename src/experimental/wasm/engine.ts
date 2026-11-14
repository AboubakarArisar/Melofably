// EXPERIMENTAL (Phase 3A.1). Not used by the application.
// The WebAssembly physics engine (assembly/engine.ts) seen from JavaScript.
import type { Mode } from '../physics/resonator.ts'

/** The functions the WebAssembly module exports. Documented in assembly/engine.ts. */
export interface Engine {
  memory: WebAssembly.Memory
  reset(sampleRate: number, prewarp: number): void
  addResonator(ports: number, modes: number): number
  setMode(r: number, n: number, frequency: number, t60: number, mass: number): void
  setShape(r: number, port: number, n: number, value: number): void
  addSpring(ra: number, pa: number, rb: number, pb: number, stiffness: number, damping: number, offset: number, corrected: number): number
  addContact(ra: number, pa: number, rb: number, pb: number, stiffness: number, alpha: number, offset: number): number
  addOutput(r: number, port: number, gain: number): void
  build(): void
  applyForce(r: number, port: number, force: number): void
  step(): void
  process(count: number): void
  silence(): void
  outputPointer(): number
  strike(r: number, port: number, impulse: number, contact: number): void
  launch(k: number, velocity: number): void
  setStiffness(k: number, stiffness: number, policy: number, samples: number): void
  setDamping(k: number, damping: number): void
  attach(k: number): void
  tune(r: number, n: number, frequency: number, t60: number): void
  output(): number
  velocity(r: number, port: number): number
  connectionForce(k: number): number
  connectionStretch(k: number): number
  stiffness(k: number): number
  injected(k: number): number
  resonatorEnergy(r: number): number
  energy(): number
  dissipated(): number
  momentum(r: number): number
  setVelocity(r: number, value: number): void
  iterations(): number
  worstIterations(): number
  faults(): number
}

/** Stiffness change policies, as the reference's ChangePolicy. */
export const INSTANT = 0
export const RAMP = 1
export const ZERO_CROSSING = 2

/** Largest block process() will fill. */
export const MAX_BLOCK = 4096

/**
 * Calls answered by the AudioWorklet processor itself, not by the engine (processor.js): a plucking
 * force over many samples, the conversion of the engine's output to sound pressure, a finger's touch
 * (a damper brought on and taken off) and a finger's pull (a held force, let go).
 */
export type HostCall = 'pluck' | 'radiate' | 'touch' | 'hold'

/** One call of an engine function (or of the processor), as data: what is sent to the AudioWorklet. */
export type Call = [name: Exclude<keyof Engine, 'memory'> | HostCall, ...args: number[]]

export const instantiate = (bytes: BufferSource): Engine =>
  new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports as unknown as Engine

export function run(engine: Engine, calls: Call[]): void {
  for (const [name, ...args] of calls) {
    if (name === 'pluck' || name === 'radiate' || name === 'touch' || name === 'hold') throw new Error(`"${name}" is answered by the audio processor: run these calls through it (analysis/worklet.ts in Node)`)
    ;(engine[name] as (...a: number[]) => unknown)(...args)
  }
}

/** The engine's output buffer. Valid for the life of the instance: its memory never grows after start-up. */
export const outputBuffer = (engine: Engine) => new Float32Array(engine.memory.buffer, engine.outputPointer(), MAX_BLOCK)

export type Port = [resonator: number, port: number]

/**
 * Describes a system of resonators and connections as a list of engine
 * calls. The same list builds the system in Node (run()) and in the
 * AudioWorklet (posted as a message).
 */
export class Design {
  readonly calls: Call[]
  private resonators = 0
  private connections = 0

  /**
   * Correct springs for the time step: frequency-corrected attachment plus
   * static-compliance compensation (design() and excess() in
   * assembly/engine.ts). false reproduces the TypeScript reference exactly.
   */
  readonly corrected: boolean

  constructor(sampleRate: number, corrected = true, prewarp: 0 | 1 | 2 = 2) {
    this.corrected = corrected
    this.calls = [['reset', sampleRate, prewarp]]
  }

  modal(modes: Mode[]): number {
    const r = this.resonators++
    this.calls.push(['addResonator', modes[0].shape.length, modes.length])
    modes.forEach((mode, n) => {
      mode.shape.forEach((value, port) => this.calls.push(['setShape', r, port, n, value]))
      this.calls.push(['setMode', r, n, mode.frequency, mode.t60, mode.mass])
    })
    return r
  }

  /** A free point mass with one port. */
  mass(kilograms: number): number {
    return this.modal([{ frequency: 0, t60: Infinity, mass: kilograms, shape: [1] }])
  }

  /**
   * Spring and damper between two ports. Returns the connection to address
   * for stiffness and the one for damping: with correction on they are two
   * connections, because the correction applies to springs only.
   */
  spring(a: Port, b: Port, stiffness: number, damping = 0, offset = 0): { spring: number; damper: number } {
    const spring = this.connections++
    if (!this.corrected || damping === 0) {
      this.calls.push(['addSpring', ...a, ...b, stiffness, damping, offset, this.corrected ? 1 : 0])
      return { spring, damper: spring }
    }
    this.calls.push(['addSpring', ...a, ...b, stiffness, 0, offset, 1], ['addSpring', ...a, ...b, 0, damping, offset, 0])
    return { spring, damper: this.connections++ }
  }

  /** Hertz contact; side a is the striker. offset < 0 starts with a gap. */
  contact(a: Port, b: Port, stiffness: number, alpha = 1.5, offset = 0): number {
    this.calls.push(['addContact', ...a, ...b, stiffness, alpha, offset])
    return this.connections++
  }

  output(port: Port, gain = 1): this {
    this.calls.push(['addOutput', ...port, gain])
    return this
  }

  /** The finished call list. */
  build(): Call[] {
    return [...this.calls, ['build']]
  }
}
