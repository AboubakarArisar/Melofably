// EXPERIMENTAL (Phase 3D.3). Not used by the application or the builder.
// Sound radiated by a bar vibrating in bending, as pressure at a listener.
// A research prototype: what it assumes and what it leaves out is in
// docs/RADIATION.md. Nothing here changes how any instrument sounds.
//
// The model. A bar in open, still air; no floor, no supports, no tube under
// it. Each short piece of the bar is a rigid strip moving across its own
// flat face. Where the strip is narrow beside the wavelength of the sound,
// the air it pushes away from one face slips round to the other, and the
// piece radiates as a dipole: a small body pushing on the air with the force
//
//     rho (A + A_added) a        per metre of bar,
//
// where a is its acceleration, A = w t the air it displaces and
// A_added = pi w^2 / 4 the air a thin strip of width w drags with it. The
// bar is a line of such dipoles, one for each piece, each with the motion
// the bar's modes give it there. Their pressures are added at the listener
// with the distance, direction and travel time of each: the cancellation
// between neighbouring pieces moving opposite ways is then in the sum, not
// assumed.
//
// Where the strip is wide beside the wavelength the air no longer slips
// round: each face radiates into its own side, as a piston in a wall. The
// two regimes meet where their pressures are equal, at the angular frequency
// w_c = 2 w c / (A + A_added), and are joined by a first-order rolloff of
// the dipole's rise.
import { barModeShape } from '../../audio/engine/physics.ts'

/** Density of air, kg/m^3, and the speed of sound in it, m/s, at about 20 degrees C. */
export const AIR_DENSITY = 1.2
export const SOUND_SPEED = 343

export interface BarGeometry {
  /** Length, width (across the face that is struck) and thickness, m. */
  length: number
  width: number
  thickness: number
}

export interface Listener {
  /** Distance from the middle of the bar, m. */
  distance: number
  /**
   * Direction, degrees: 0 is straight out from the bar's flat face (above
   * its middle); 90 is along the bar, beyond its far end. Measured in the
   * plane that holds the bar's length and that straight-out direction.
   */
  angle: number
}

export type Complex = [re: number, im: number]
export const size = (z: Complex) => Math.hypot(z[0], z[1])

/** Air a metre of the bar acts on as a dipole, m^2: what it displaces and what it drags with it. */
export const dipoleArea = (g: BarGeometry) => g.width * g.thickness + (Math.PI * g.width ** 2) / 4

/** Frequency above which a piece of the bar radiates from each face separately rather than as a dipole, Hz. */
export const crossover = (g: BarGeometry) => (2 * g.width * SOUND_SPEED) / dipoleArea(g) / (2 * Math.PI)

/**
 * Pressure at the listener per unit of (acceleration x length) of the piece
 * of bar at `xi` (a fraction of its length), at angular frequency `w`:
 * Pa per (m/s^2 x m). The time sound takes from the middle of the bar to the
 * listener is left out (it is the same for every piece's reference), so the
 * phase is that of each piece relative to the middle.
 *
 *   rho B cos(theta) / (4 pi) x [ (j w / c R) / (1 + j w / w_c)  +  1 / R^2 ] x e^(-j w (R - r) / c)
 *
 * The first term is the sound that travels; the second is the near field,
 * which matters within a wavelength or so.
 */
export function pieceTransfer(g: BarGeometry, listener: Listener, xi: number, w: number): Complex {
  const angle = (listener.angle * Math.PI) / 180
  const [along, out] = [listener.distance * Math.sin(angle) - (xi - 0.5) * g.length, listener.distance * Math.cos(angle)]
  const R = Math.hypot(along, out)
  const strength = (AIR_DENSITY * dipoleArea(g) * (out / R)) / (4 * Math.PI)
  const x = w / (2 * Math.PI * crossover(g))
  // (j w / c R) / (1 + j x) = (w / c R) (x + j) / (1 + x^2)
  const far = w / (SOUND_SPEED * R) / (1 + x * x)
  const [re, im] = [strength * (far * x + 1 / (R * R)), strength * far]
  const phase = (-w * (R - listener.distance)) / SOUND_SPEED
  return [re * Math.cos(phase) - im * Math.sin(phase), re * Math.sin(phase) + im * Math.cos(phase)]
}

/**
 * Pressure at the listener per unit acceleration of one mode's coordinate,
 * Pa per m/s^2: the pieces' transfers weighted by the mode's shape and added
 * along the bar (midpoint rule; `shape(xi)` is the mode's shape, as the
 * engine's ports use it).
 */
export function modeTransfer(g: BarGeometry, listener: Listener, shape: (xi: number) => number, w: number, pieces = 240): Complex {
  let [re, im] = [0, 0]
  for (let i = 0; i < pieces; i++) {
    const xi = (i + 0.5) / pieces
    const h = pieceTransfer(g, listener, xi, w)
    const weight = (shape(xi) * g.length) / pieces
    re += h[0] * weight
    im += h[1] * weight
  }
  return [re, im]
}

/** The shape of free-free bending mode n (0-based), as every bar here has it. */
export const freeBarShape = (n: number) => (xi: number) => barModeShape(n, xi)

/**
 * One number per mode, for an engine that has one output: the size of the
 * mode's transfer at the mode's own frequency, signed by its larger part.
 * The engine's output with these as a port's shape is sum(weight x modal
 * velocity); its time derivative is then the pressure, exact in size for
 * each mode ringing at its own frequency (a struck bar), with each mode's
 * phase at the listener rounded to the nearest quarter turn. It is not right
 * for a mode driven at some other frequency: see docs/RADIATION.md.
 */
export function radiationWeights(g: BarGeometry, listener: Listener, frequencies: number[]): number[] {
  return frequencies.map((f, n) => {
    const h = modeTransfer(g, listener, freeBarShape(n), 2 * Math.PI * f)
    return Math.sign(Math.abs(h[0]) >= Math.abs(h[1]) ? h[0] : h[1]) * size(h)
  })
}

/**
 * Sound power the bar sends out, W, for one mode ringing with modal velocity
 * amplitude `velocity` (m/s) at `frequency`: the intensity p^2 / (2 rho c)
 * summed over a sphere of radius `distance` round the bar, by the same
 * model. Far from the bar it does not depend on the distance. An estimate of
 * what radiation takes from the bar; the engine does not take it.
 */
export function radiatedPower(g: BarGeometry, shape: (xi: number) => number, frequency: number, velocity: number, distance = 20): number {
  const w = 2 * Math.PI * frequency
  // The model is the same all the way round the bar's length, so one ring per polar angle.
  let power = 0
  const steps = 90
  for (let i = 0; i < steps; i++) {
    // Polar angle from the bar's axis, and the pressure in the plane of bar and normal at that angle.
    const polar = ((i + 0.5) * Math.PI) / steps
    const p = size(modeTransfer(g, { distance, angle: 90 - (polar * 180) / Math.PI }, shape, w, 120)) * w * velocity
    // A dipole's cos^2 round the bar averages to a half.
    power += ((p * p) / (2 * AIR_DENSITY * SOUND_SPEED)) * 0.5 * 2 * Math.PI * distance * distance * Math.sin(polar) * (Math.PI / steps)
  }
  return power
}
