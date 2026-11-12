// EXPERIMENTAL (Phase 3C.1 prototype). Not used by the application or the
// builder. The approved string's digital waveguide (src/audio/models/string.dsp)
// rewritten as a resonator of the TypeScript physics engine, so that its
// bridge end can be joined to other objects. Findings: docs/STRING_PROTOTYPE.md.
import type { Resonator } from '../physics/resonator.ts'
import { fundamental, impedance, type StringLoss, type StringParams } from './modalString.ts'

/**
 * One delay loop: a velocity wave leaves the bridge, travels to the nut, is
 * reflected and returns, losing a little on the way. One port: the bridge
 * end.
 *
 * At the bridge, with v_in the wave arriving and F a force applied to the
 * string's end, the end moves at  u = 2 v_in + F / Z  (Z: wave impedance) and
 * the wave sent back is  v_out = u - v_in. So the port's mobility is exactly
 * 1 / Z with no memory, which is the form the engine's solver needs: with no
 * force the end is free (u = 2 v_in); held still, the wave returns inverted.
 *
 * The loop is the approved model's: a delay line read with fourth-order
 * Lagrange interpolation, two three-tap loss filters and a loop gain, with
 * the same delay budget (N = line + 2 + 1), so an end held still gives the
 * approved string exactly.
 */
export class WaveguideString implements Resonator {
  readonly ports = 1
  readonly portVelocity = new Float64Array(1)
  /** Wave impedance, kg/s. */
  readonly Z: number
  /** Round trip in samples. */
  readonly N: number
  private readonly dt: number
  private readonly line: Float64Array
  private readonly mask: number
  private write = 0
  private readonly taps = new Float64Array(5)
  private readonly whole: number
  private readonly a: number // loss filter coefficient
  private readonly gain: number // per round trip
  // Loss filter state (two three-tap filters) and running values.
  private readonly s = new Float64Array(4)
  private readonly state = new Float64Array(4) // [arriving wave, end displacement, energy lost last step, pending excitation]

  constructor(string: StringParams, sampleRate: number, loss: StringLoss | null) {
    this.dt = 1 / sampleRate
    this.Z = impedance(string)
    this.N = sampleRate / fundamental(string)
    if (this.N < 8) throw new Error('string too high for this sample rate')
    const size = 2 ** Math.ceil(Math.log2(this.N + 8))
    this.line = new Float64Array(size)
    this.mask = size - 1
    // Read the line N - 3 samples back: taps at whole delays m .. m + 4 around it.
    const delay = this.N - 3
    this.whole = Math.floor(delay) - 1
    const p = delay - this.whole
    for (let k = 0; k < 5; k++) {
      let h = 1
      for (let j = 0; j < 5; j++) if (j !== k) h *= (p - j) / (k - j)
      this.taps[k] = h
    }
    const sigma = loss ? 6.91 / loss.hfT60 / (2 * Math.PI * 5000) ** 2 : 0
    this.a = Math.min(0.25, (sigma * sampleRate * this.N) / 2)
    this.gain = loss ? 10 ** ((-3 * this.N) / (sampleRate * loss.t60)) : 1
  }

  mobility(): number {
    return 1 / this.Z
  }

  /** Add to the wave arriving at the bridge during the next step (m/s): how a pluck enters, as in the approved model. */
  excite(velocity: number): void {
    this.state[3] += velocity
  }

  // The wave arriving at the bridge now: what left N samples ago, through the losses, inverted by the nut.
  private arrive(): void {
    const { line, mask, taps, s, a } = this
    let x = 0
    for (let k = 0; k < 5; k++) x += taps[k] * line[(this.write - 1 - this.whole - k) & mask]
    // Two filters [a, 1 - 2a, a]: unit gain at zero frequency, two samples of delay in all.
    const y1 = a * x + (1 - 2 * a) * s[0] + a * s[1]
    s[1] = s[0]
    s[0] = x
    const y2 = a * y1 + (1 - 2 * a) * s[2] + a * s[3]
    s[3] = s[2]
    s[2] = y1
    this.state[0] = -this.gain * y2 + this.state[3]
    this.state[3] = 0
  }

  predict(external: Float64Array, free: Float64Array): void {
    this.arrive()
    free[0] = 2 * this.state[0] + external[0] / this.Z
    this.portVelocity[0] = free[0]
  }

  commit(forces: Float64Array): void {
    const u = this.portVelocity[0] + forces[0] / this.Z
    this.portVelocity[0] = u
    this.line[this.write] = u - this.state[0]
    this.write = (this.write + 1) & this.mask
    this.state[1] += this.dt * u
  }

  advance(external: Float64Array): void {
    this.predict(external, this.portVelocity)
    this.commit(ZERO)
  }

  displacements(out: Float64Array): void {
    out[0] = this.state[1]
  }

  /** Energy travelling in the loop, J: each sample of a velocity wave v carries Z v^2 dt. Exact only without the interpolation and losses. */
  energy(): number {
    let sum = 0
    const count = Math.round(this.N)
    for (let i = 1; i <= count; i++) {
      const v = this.line[(this.write - i) & this.mask]
      sum += v * v
    }
    return this.Z * this.dt * sum
  }

  dissipated(): number {
    return 0 // not tracked: the loop's losses are filters, not dampers
  }
}

const ZERO = new Float64Array(1)
