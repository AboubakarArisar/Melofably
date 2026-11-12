// EXPERIMENTAL (Phase 3C.1 prototype). Not used by the application or the
// builder. An ideal flexible string described as modal data for the physics
// engine. Findings and limits: docs/STRING_PROTOTYPE.md.
import type { Mode } from '../physics/resonator.ts'

export interface StringParams {
  length: number // m, nut to bridge
  tension: number // N
  density: number // kg/m (mass per unit length)
}

/** The approved string instrument's defaults (src/audio/models/string.dsp). */
export const GUITAR_A: StringParams = { length: 0.65, tension: 73.5, density: 0.0036 }

export const waveSpeed = (s: StringParams) => Math.sqrt(s.tension / s.density) // m/s
/** Fundamental of the string with both ends fixed, Hz: the approved model's pitch. */
export const fundamental = (s: StringParams) => waveSpeed(s) / (2 * s.length)
/** Wave impedance, kg/s: force per unit velocity of a travelling wave. */
export const impedance = (s: StringParams) => Math.sqrt(s.tension * s.density)

/**
 * How fast partials die, as the approved string defines it: a rate common to
 * all partials (60 dB in `t60` seconds) plus one rising with the square of
 * frequency, set by the 60 dB decay time `hfT60` of a 5 kHz partial.
 */
export interface StringLoss {
  t60: number
  hfT60: number
}
/** The approved string's defaults: damping 0.3, brightness 0.4. */
export const DEFAULT_LOSS: StringLoss = { t60: 12 * (0.25 / 12) ** 0.3, hfT60: (0.25 * 10 ** 0.4) / (0.5 + 2 * 0.3) }

/** Amplitude decay rate of a partial at `frequency`, 1/s. */
export const decayRate = (loss: StringLoss, frequency: number) =>
  Math.log(1000) / loss.t60 + (6.91 / loss.hfT60) * (frequency / 5000) ** 2

/**
 * Modes of the string with its nut fixed and its bridge end FREE:
 *   f_n = (n - 1/2) c / (2 L),  shape sin((n - 1/2) pi x / L),  mass mu L / 2.
 *
 * A free end is what lets the string be joined to something: with both ends
 * fixed every mode shape is zero at the bridge and nothing could be attached
 * there. Joined to a heavy object through a stiff bridge, these modes combine
 * into the familiar ones at n c / (2 L).
 *
 * `ports` are positions along the string as fractions of its length (0 = nut,
 * 1 = bridge). Modes at or above 0.45 x the sample rate are left out, and at
 * most `count` are kept.
 */
export function stringModes(s: StringParams, ports: number[], sampleRate: number, loss: StringLoss | null = DEFAULT_LOSS, count = Infinity): Mode[] {
  const modes: Mode[] = []
  const mass = (s.density * s.length) / 2
  for (let n = 1; ; n++) {
    const frequency = ((n - 0.5) * waveSpeed(s)) / (2 * s.length)
    if (frequency >= 0.45 * sampleRate || n > count) break
    modes.push({
      frequency,
      t60: loss ? Math.log(1000) / decayRate(loss, frequency) : Infinity,
      mass,
      shape: ports.map((x) => Math.sin((n - 0.5) * Math.PI * x)),
    })
  }
  return modes
}

/**
 * How much more the real string's bridge end gives under a slow force than
 * the kept modes do in the engine, m/N. The whole string gives L / T. The
 * kept modes give less because some are missing, but each gives a little
 * more in the engine than in reality: a mode at angle theta per sample has
 * static compliance dt^2 / (4 m sin^2(theta / 2)) there, not 1 / (m w^2)
 * (docs/WASM_ENGINE.md, section 6). The difference of the two effects is
 * what is left to make up, as a plain compliance in series with the bridge.
 */
export function residualCompliance(s: StringParams, modes: Mode[], sampleRate: number): number {
  let kept = 0
  for (const mode of modes) kept += 1 / (4 * mode.mass * sampleRate * sampleRate * Math.sin((Math.PI * mode.frequency) / sampleRate) ** 2)
  return s.length / s.tension - kept
}

/**
 * Stiffness to give the spring that joins the string's free end to a bridge
 * of stiffness `bridge` (N/m; Infinity for a rigid one), so that the residual
 * compliance is included: the two compliances add. (It may be negative, when
 * the kept modes give too much; the spring is then made a little stiffer.)
 */
export const bridgeStiffness = (bridge: number, residual: number) => 1 / (1 / bridge + residual)

/**
 * The force of a pluck at one point, sample by sample (N): the approved
 * string's excitation. An impulse rounded by the finger or pick (two
 * one-pole lowpasses at `cutoff` Hz), then integrated with a 20 Hz leak: a
 * force that steps to `force` and slowly relaxes. Applying it to the string
 * is, by linearity, the same as pulling the string aside and letting go.
 */
export function pluckForce(force: number, cutoff: number, sampleRate: number, samples: number): Float64Array {
  const out = new Float64Array(samples)
  const pole = Math.exp((-2 * Math.PI * Math.min(cutoff, 0.45 * sampleRate)) / sampleRate)
  const leak = Math.exp((-2 * Math.PI * 20) / sampleRate)
  let [a, b, sum] = [0, 0, 0]
  for (let n = 0; n < samples; n++) {
    a = (1 - pole) * (n === 0 ? 1 : 0) + pole * a
    b = (1 - pole) * a + pole * b
    sum = b + leak * sum
    out[n] = force * sum
  }
  return out
}

/** The approved string's pick cutoff for a softness and strength (Hz). */
export const pickCutoff = (softness = 0.3, strength = 0.8) => 8000 * (600 / 8000) ** softness * (0.4 + 0.6 * strength)
