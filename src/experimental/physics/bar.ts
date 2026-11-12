// EXPERIMENTAL (Phase 3A proof of concept). Not used by the application.
import { barModeFrequencies, barModeShape, type BarParams } from '../../audio/engine/physics.ts'
import type { Mode } from './resonator.ts'

export type BarGeometry = BarParams & {
  /** m. The beam equation's frequencies do not depend on it; the mass does. */
  width: number
  /** Material loss factor, as in the approved metal bar model. */
  lossFactor: number
}

/** The approved metal bar's defaults, plus a width. */
export const ALUMINIUM_BAR: BarGeometry = {
  length: 0.3,
  thickness: 10,
  density: 2700,
  youngsModulus: 70,
  width: 0.04,
  lossFactor: 0.001,
}

/**
 * Modal data of a uniform free-free bar, with one port at each of the given
 * positions (fractions of the length from one end, 0 to 0.5).
 *
 * Frequencies and mode shapes are those of the approved bar model. Decay
 * times use the same law: 1 / T60 = 1 / 6 + eta f / 2.2. The modal mass is
 * new: with mode shapes normalised to unit mean square, every mode's
 * effective mass is the mass of the whole bar, rho L w h.
 */
export function barModes(bar: BarGeometry, portPositions: number[], sampleRate: number, key = 0, count = 8): Mode[] {
  const length = bar.length * 2 ** (-key / 24)
  const mass = bar.density * length * bar.width * (bar.thickness / 1000)
  return barModeFrequencies(bar, key)
    .slice(0, count)
    .map((frequency, n) => ({
      frequency,
      t60: 1 / (1 / 6 + (bar.lossFactor * frequency) / 2.2),
      mass,
      shape: portPositions.map((xi) => barModeShape(n, xi)),
    }))
    .filter((mode) => mode.frequency < 0.45 * sampleRate) // as the approved model: no modes near Nyquist
}

/**
 * The approved models' elastic striker: a half-sine force pulse of the given
 * contact time whose area is `impulse` (N s). Sample 0 is the instant of the
 * strike and is zero, exactly as the Faust code produces it.
 */
export function halfSinePulse(contact: number, impulse: number, sampleRate: number): Float64Array {
  const width = Math.max(2, contact * sampleRate)
  const pulse = new Float64Array(Math.ceil(width))
  for (let i = 0; i < pulse.length; i++) pulse[i] = (Math.sin((Math.PI * i) / width) * impulse * Math.PI) / (2 * width)
  return pulse
}

/** Contact time of the approved bar's mallet for a hardness and velocity (s). */
export const barContactTime = (hardness: number, velocity: number) =>
  0.0012 * (0.15 / 1.2) ** hardness * Math.max(velocity, 0.05) ** -0.2
