// EXPERIMENTAL (Phase 3C.2.1). Not used by the application or the builder.
// Refinements of the soundboard plate (soundboard.ts, which is unchanged):
// how the bridge meets the plate, how the plate loses energy, and how its
// motion becomes sound. What each one assumes: docs/SOUNDBOARD.md, section 8.
import type { Mode } from '../physics/resonator.ts'
import { AIR, plateMass, plateModeList, rigidities, type PlateParams } from './soundboard.ts'

/** Speed of sound in air, m/s, at about 20 degrees C. */
export const SOUND_SPEED = 343

export interface Refinements {
  /**
   * Where the listener is: degrees away from the plate's axis, and degrees
   * round from the grain direction. { offAxis: 0 } is straight in front, the
   * Phase 3C.2 model.
   */
  listener?: { offAxis: number; azimuth: number }
  /** Length of the bridge across the grain, m. The strings' force is spread evenly along it. 0: a point. */
  bridgeLength?: number
  /**
   * Loss factors of the wood by the kind of bending: along the grain, across
   * it, and twisting. Absent: the plate's single loss factor for all.
   */
  loss?: { along: number; across: number; twist: number }
  /** Take from each mode the energy it sends into the air, for modes that radiate efficiently. */
  radiationLoss?: boolean
}

/**
 * Loss factor of mode (m, n): the three kinds of bending weighted by how
 * much of the mode's strain energy each holds. Those shares are the three
 * terms of the frequency formula.
 */
export function modeLossFactor(p: PlateParams, m: number, n: number, loss: { along: number; across: number; twist: number }): number {
  const { Dx, Dy, H } = rigidities(p)
  const [kx, ky] = [(m * Math.PI) / p.length, (n * Math.PI) / p.width]
  const [along, twist, across] = [Dx * kx ** 4, 2 * H * kx * kx * ky * ky, Dy * ky ** 4]
  return (loss.along * along + loss.twist * twist + loss.across * across) / (along + twist + across)
}

/**
 * Whether mode (m, n) at `frequency` is "acoustically fast": its bending
 * wave is longer than the sound wave of the same frequency, so the plate
 * pushes air efficiently (radiation efficiency about 1). Slower modes mostly
 * move air from crest to trough and radiate little.
 */
export function radiatesEfficiently(p: PlateParams, m: number, n: number, frequency: number): boolean {
  const bending = Math.hypot((m * Math.PI) / p.length, (n * Math.PI) / p.width)
  return (2 * Math.PI * frequency) / SOUND_SPEED >= bending
}

/** One factor of the far-field integral: the average of sin(m pi u) cos or sin(alpha (u - 1/2)) over 0..1. */
function directional(m: number, alpha: number): number {
  let [even, odd] = [0, 0]
  const steps = 64 * m + 64
  for (let i = 0; i < steps; i++) {
    const u = (i + 0.5) / steps
    const s = Math.sin(m * Math.PI * u)
    even += s * Math.cos(alpha * (u - 0.5))
    odd += s * Math.sin(alpha * (u - 0.5))
  }
  // A mode symmetric about the middle gives only the first, an antisymmetric one only the second.
  return (even + odd) / steps
}

/**
 * How strongly mode (m, n) is heard by a distant listener in a given
 * direction, relative to a plate moving all together: the far field of a
 * baffled, simply supported plate mode (Wallace, 1972), evaluated at the
 * mode's own frequency. Straight in front it is the mode's mean shape.
 *
 * Two approximations. A mode driven at another frequency (by a string
 * partial) is given the weight of its own frequency. And antisymmetric modes
 * reach the listener a quarter of a cycle out of step with symmetric ones;
 * that phase is dropped, keeping the size.
 */
export function listenerWeight(p: PlateParams, m: number, n: number, frequency: number, offAxis: number, azimuth: number): number {
  const k = (2 * Math.PI * frequency) / SOUND_SPEED
  const tilt = Math.sin((offAxis * Math.PI) / 180)
  const alpha = k * p.length * tilt * Math.cos((azimuth * Math.PI) / 180)
  const beta = k * p.width * tilt * Math.sin((azimuth * Math.PI) / 180)
  return directional(m, alpha) * directional(n, beta)
}

/**
 * The plate's modes as data for the engine, with the refinements asked for.
 * Ports as soundboard.ts: the bridge points, then the radiation port, whose
 * velocity times the plate's area is what radiatedPressure() takes.
 */
export function refinedPlateModes(p: PlateParams, points: [number, number][], sampleRate: number, limit: number, r: Refinements): Mode[] {
  const mass = plateMass(p) / 4
  const spread = (r.bridgeLength ?? 0) / p.width // the bridge's length as a fraction of the plate's width
  return plateModeList(p, Math.min(limit, 0.45 * sampleRate)).map(({ m, n, frequency }) => {
    let loss = r.loss ? modeLossFactor(p, m, n, r.loss) : p.lossFactor
    // Sound carries energy away from both faces at rho c per unit area and velocity squared.
    if (r.radiationLoss && radiatesEfficiently(p, m, n, frequency)) loss += (2 * AIR * SOUND_SPEED) / (2 * Math.PI * frequency * p.density * p.thickness)
    // sin(n pi y) averaged along the bridge: its value at the middle times sin(x) / x.
    const half = (n * Math.PI * spread) / 2
    const footprint = half > 1e-9 ? Math.sin(half) / half : 1
    return {
      frequency,
      t60: 2.2 / (loss * frequency),
      mass,
      shape: [...points.map(([x, y]) => Math.sin(m * Math.PI * x) * Math.sin(n * Math.PI * y) * footprint), listenerWeight(p, m, n, frequency, r.listener?.offAxis ?? 0, r.listener?.azimuth ?? 0)],
    }
  })
}

/**
 * Frequency below which a plate with no baffle loses its bass, Hz. A rigid
 * disc of radius a moving in free air is a dipole: air slips round the edge
 * from front to back. Far away on its axis it gives 4 k a / (3 pi) of what
 * the same disc gives in a wall (k = 2 pi f / c), which is 1 at
 * f = 3 c / (8 a). The plate is given the radius of a disc of equal area.
 */
export const unbaffledCorner = (area: number) => (3 * SOUND_SPEED) / (8 * Math.sqrt(area / Math.PI))

/**
 * Turns the pressure a baffled plate would give into that of the same plate
 * with nothing around it: a first-order high-pass at unbaffledCorner(area).
 * It has exactly the dipole's low-frequency behaviour (size and phase) and
 * leaves high frequencies, where the plate is its own baffle, unchanged.
 * Treating a bending plate as a rigid disc is the approximation.
 */
export function unbaffled(pressure: ArrayLike<number>, area: number, sampleRate: number): Float32Array {
  const out = new Float32Array(pressure.length)
  // Bilinear form: -3 dB exactly at the corner, gain exactly 1 at the top.
  const t = Math.tan((Math.PI * unbaffledCorner(area)) / sampleRate)
  const a = (1 - t) / (1 + t)
  let [x1, y1] = [0, 0]
  for (let n = 0; n < out.length; n++) {
    y1 = a * y1 + ((1 + a) / 2) * (pressure[n] - x1)
    x1 = pressure[n]
    out[n] = y1
  }
  return out
}
