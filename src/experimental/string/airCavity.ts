// EXPERIMENTAL (Phase 3C.2.2). Not used by the application or the builder.
// The smallest enclosed body: a closed box of air behind the soundboard with
// one round hole. The air in the box is a spring on the board's mean motion
// and on the plug of air in the hole; the plug is a mass. Nothing is added to
// the sound from outside: the box only changes what the board does and adds
// the hole's own flow to what is radiated. docs/SOUNDBOARD.md, section 9.
import type { Mode } from '../physics/resonator.ts'
import { AIR, meanShape, plateFrequency, plateMass, type PlateParams } from './soundboard.ts'
import { SOUND_SPEED } from './soundboardRefined.ts'

export interface Cavity {
  /** Depth of the box behind the plate, m. Its volume is the plate's area times this. */
  depth: number
  /** Radius of the round hole, m. */
  holeRadius: number
  /**
   * Quality factor of the air plug's motion at the box's own resonance: its
   * losses to friction at the hole's edge and to the sound it radiates.
   * An estimate, not derived. Default 15.
   */
  quality?: number
  /** Leave out the energy the box sends into the air as sound (for checks that need exact energy). */
  noRadiationLoss?: boolean
}

/**
 * The box as data for the engine.
 *
 * The plate's mean displacement w (its radiation port) and the plug's
 * displacement x, both positive outwards, change the air's volume by
 * S w + s x (S: plate area, s: hole area). The air's pressure pushes back
 * with energy (rho c^2 / 2V) (S w + s x)^2. That is a spring of stiffness
 * rho c^2 S^2 / V between the plate's radiation port and a port that moves by
 * -(s / S) x, which is how the plug is given to the engine: one free mass
 * whose single port has shape -(s / S).
 *
 * The plug's mass is rho s (1.7 r): the air in a hole of radius r in a thin
 * wall, with the usual end correction of 0.85 r on each side.
 */
export function airCavity(plate: PlateParams, c: Cavity) {
  const area = plate.length * plate.width
  const volume = area * c.depth
  const hole = Math.PI * c.holeRadius ** 2
  const mass = AIR * hole * 1.7 * c.holeRadius
  const stiffness = (AIR * SOUND_SPEED ** 2 * area ** 2) / volume
  // Resonance of the plug on the air of a rigid box (Helmholtz).
  const helmholtz = Math.sqrt((stiffness * (hole / area) ** 2) / mass) / (2 * Math.PI)
  const plug: Mode = { frequency: 0, t60: (Math.log(1000) * (c.quality ?? 15)) / (Math.PI * helmholtz), mass, shape: [-hole / area] }
  // Sound takes energy. A source small beside the wavelength sending a flow q into open air radiates
  // rho w^2 q^2 / (4 pi c) watts: a damper of rho w^2 S^2 / (4 pi c) on the total flow per plate area,
  // which is the stretch rate of the air spring. It grows as frequency squared; the engine's damper
  // cannot, so it is fixed at the frequency where it matters most: the plate's lowest mode on the
  // closed box, the body's strongest resonance. Above that it takes too little, below it too much.
  const lowest = 2 * Math.PI * plateFrequency(plate, 1, 1)
  const bodyResonance = Math.sqrt(lowest ** 2 + (stiffness * meanShape(1, 1) ** 2) / (plateMass(plate) / 4))
  const damping = c.noRadiationLoss ? 0 : (AIR * bodyResonance ** 2 * area ** 2) / (4 * Math.PI * SOUND_SPEED)
  return { stiffness, damping, plug, helmholtz, bodyResonance: bodyResonance / (2 * Math.PI), volume, holeArea: hole }
}

/**
 * Frequency around which a box stops radiating in all directions and starts
 * radiating forwards only, Hz: where the sound's wavelength is the
 * circumference of a disc of the front's area (k a = 1).
 */
export const enclosedCorner = (area: number) => SOUND_SPEED / (2 * Math.PI * Math.sqrt(area / Math.PI))

/**
 * Turns the pressure a baffled source would give into that of the same
 * source on the front of a closed box. At low frequencies the box is small
 * beside the wavelength and the sound spreads all round: half the pressure
 * of a source in a wall. At high frequencies the front is its own wall. In
 * between: a first-order shelf from 1/2 to 1 centred on enclosedCorner(area).
 * The shape of the step for a real box depends on the box; this is the
 * simplest curve with both ends right.
 */
export function enclosed(pressure: ArrayLike<number>, area: number, sampleRate: number): Float32Array {
  const out = new Float32Array(pressure.length)
  // H(s) = (s + w / sqrt 2) / (s + w sqrt 2): 1/2 at zero, 1 at the top, bilinear transform.
  const w = 2 * Math.tan((Math.PI * enclosedCorner(area)) / sampleRate)
  const [zero, pole] = [w / Math.SQRT2, w * Math.SQRT2]
  const [b0, b1, a1] = [(2 + zero) / (2 + pole), (zero - 2) / (2 + pole), (pole - 2) / (2 + pole)]
  let [x1, y1] = [0, 0]
  for (let n = 0; n < out.length; n++) {
    y1 = b0 * pressure[n] + b1 * x1 - a1 * y1
    x1 = pressure[n]
    out[n] = y1
  }
  return out
}
