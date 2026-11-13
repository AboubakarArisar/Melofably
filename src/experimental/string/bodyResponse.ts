// EXPERIMENTAL (Phase 3C.2.3). Not used by the application or the builder.
// What a body does at one frequency, worked out directly from its modes
// instead of by running the engine: how far the bridge yields to a force
// (which sets how far a string is pulled off pitch) and how much flow of air
// that force produces (which sets how loud a string's partial comes out).
// Continuous-time theory; the engine agrees with it to the accuracy shown in
// tests/body-response.test.ts.
import type { Mode } from '../physics/resonator.ts'

export type Complex = [re: number, im: number]
export const size = (a: Complex) => Math.hypot(a[0], a[1])

/**
 * Velocity at port b per force at port a, m/(N s), of a set of modes at
 * angular frequency w. (Plain sums: this runs for every mode at every
 * frequency of a search, and must not leave garbage behind.)
 */
export function mobility(modes: Mode[], a: number, b: number, w: number): Complex {
  let [re, im] = [0, 0]
  for (let i = 0; i < modes.length; i++) {
    const m = modes[i]
    const sigma = Number.isFinite(m.t60) ? Math.log(1000) / m.t60 : 0
    const w0 = 2 * Math.PI * m.frequency
    // j w g / (w0^2 + sigma^2 - w^2 + 2 j sigma w), g = shape a x shape b / mass: the engine's damped mode.
    const g = (w * m.shape[a] * m.shape[b]) / m.mass
    const dr = w0 * w0 + sigma * sigma - w * w
    const di = 2 * sigma * w
    const d = dr * dr + di * di
    re += (g * di) / d
    im += (g * dr) / d
  }
  return [re, im]
}
/** The air behind the body, as instrument.ts takes it. */
export interface AirParts {
  stiffness: number
  damping: number
  plug: Mode
  /** Resistance to the plug's own motion, N s/m (a screen over the hole). */
  resistance?: number
}

export interface Response {
  /** Velocity of the bridge point per unit force on it, m/(N s). */
  bridge: Complex
  /**
   * The engine's output per unit force at the bridge: flow of air out of the
   * body divided by the plate's area, m/(N s). For a bare plate, its mean
   * velocity.
   */
  flow: Complex
}

/**
 * Response of a body to a force at its bridge port at `frequency` Hz.
 *
 * With air: the air spring and its radiation damper join the plate's
 * radiation port to the plug's port. If F is the force they carry, the plate
 * moves at Y_BR - Y_RR F and the plug's port at Y_P F, and F is their
 * difference times the joint's impedance k / (j w) + c. Solving:
 * flow = Y_BR / (1 + Z (Y_RR + Y_P)).
 */
export function bodyResponse(body: Mode[], bridgePort: number, radiationPort: number, frequency: number, air?: AirParts): Response {
  const w = 2 * Math.PI * frequency
  const bridge = mobility(body, bridgePort, bridgePort, w)
  const across = mobility(body, bridgePort, radiationPort, w)
  if (!air) return { bridge, flow: across }
  const own = mobility(body, radiationPort, radiationPort, w)
  const sigma = Number.isFinite(air.plug.t60) ? Math.log(1000) / air.plug.t60 : 0
  const m = air.plug.mass
  // The plug at its port: shape^2 / (resistance + j reactance). Resistance: the engine's damped free mass
  // (2 sigma m) and a screen; reactance: its mass, less the small spring sigma^2 m that the damping brings.
  const [pr, pi] = [2 * sigma * m + (air.resistance ?? 0), w * m - (sigma * sigma * m) / w]
  const scale = air.plug.shape[0] ** 2 / (pr * pr + pi * pi)
  // What the joint works against: the plate's radiation port and the plug's port together.
  const [sr, si] = [own[0] + scale * pr, own[1] - scale * pi]
  // The joint: Z = c - j k / w. Denominator 1 + Z (Y_RR + Y_P).
  const [zr, zi] = [air.damping, -air.stiffness / w]
  const [dr, di] = [1 + zr * sr - zi * si, zr * si + zi * sr]
  const d = dr * dr + di * di
  const flow: Complex = [(across[0] * dr + across[1] * di) / d, (across[1] * dr - across[0] * di) / d]
  // The force in the joint, Z x flow, acts back on the bridge through the plate.
  const [fr, fi] = [zr * flow[0] - zi * flow[1], zr * flow[1] + zi * flow[0]]
  return { bridge: [bridge[0] - (fr * across[0] - fi * across[1]), bridge[1] - (fr * across[1] + fi * across[0])], flow }
}
/**
 * How far a string partial at `frequency` is pulled by a bridge that yields,
 * in cents, to first order in the yielding: a string of wave impedance Z
 * whose end moves with mobility Y has partial n shifted by the fraction
 * -Z Im(Y) / (n pi): flat where the body is springy (below a resonance),
 * sharp where it is massy (above one). Valid while the shift is small; near a body
 * resonance the true shift is smaller than this.
 */
export const pullCents = (impedance: number, bridge: Complex, partial = 1) => (-(1200 / Math.LN2) * (impedance * bridge[1])) / (Math.PI * partial)
