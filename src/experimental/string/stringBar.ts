// EXPERIMENTAL (Phase 3D.2). One modal string whose bridge end is tied to a
// point on one bar by a spring (and, if wanted, a damper): the smallest
// hybrid of the two kinds of resonator the builder has. The same pieces as
// the string on its box (stringBody.ts): the string's modes, the bridge
// spring with its allowance for the string's missing modes, the engine's own
// coupling solver. Nothing is mixed: each pushes the other through the joint.
import type { Mode } from '../physics/resonator.ts'
import type { Call } from '../wasm/engine.ts'
import { buildInstrument, STRING_PLUCK } from './instrument.ts'
import { bridgeStiffness, DEFAULT_LOSS, residualCompliance, stringModes, type StringLoss } from './modalString.ts'
import { STRING_DENSITY, STRING_MODES, type Playing } from './stringBody.ts'

/** Ports of the bar as this file gives it to the engine. (The builder's bars have them the other way round.) */
export const BAR_JOINT = 0 // where the string is tied
export const BAR_STRIKE = 1 // where it is struck, and where it is listened to

export interface StringBar {
  /** Tension (N), length (m) and pluck point (fraction of its length from the fixed end) of the string. */
  tension: number
  length: number
  pluckAt: number
  /** The bar's modes, each with its shape at the joint and at the strike point, in that order. */
  bar: Mode[]
  /** The joint between the string's end and the bar: a spring (N/m) and a damper (N s/m). null: not joined. */
  joint: { stiffness: number; damping: number } | null
  /** A mallet for the bar: a mass (kg) and the stiffness of its Hertz contact (N/m^1.5). */
  mallet?: { mass: number; stiffness: number }
  /** The engine's output is the bar's velocity at its strike point, m/s, times this. */
  outputGain: number
  /** The string's own losses. null: none (for checks of energy). */
  loss?: StringLoss | null
}

export interface BuiltStringBar extends Playing {
  calls: Call[]
  /** Engine resonator of the bar. */
  bar: number
  /** Engine connection of the joint. */
  joint: number
  /** Engine contact of the mallet, if there is one. */
  mallet?: number
  /** Modes in use: of the string, and of the bar. */
  modes: { string: number; bar: number }
}

const stringOf = (s: Pick<StringBar, 'tension' | 'length'>) => ({ length: s.length, tension: s.tension, density: STRING_DENSITY })
/** The string's modes as the engine holds them: ports are its tied end, the pluck point, and a point 0.3 along. */
export const stringBarModes = (s: Pick<StringBar, 'tension' | 'length' | 'pluckAt' | 'loss'>, sampleRate: number) =>
  stringModes(stringOf(s), [1, s.pluckAt, 0.3], sampleRate, s.loss === undefined ? DEFAULT_LOSS : s.loss, STRING_MODES)

/**
 * Stiffness the engine's spring is given for a joint of stiffness `joint`:
 * the joint's own compliance and that of the string's missing modes add.
 */
export const jointSpring = (s: Pick<StringBar, 'tension' | 'length' | 'pluckAt' | 'loss'>, joint: number, sampleRate: number) =>
  bridgeStiffness(joint, residualCompliance(stringOf(s), stringBarModes(s, sampleRate), sampleRate))

/**
 * Engine calls that build the string tied to the bar, with a finger for the
 * string (a damper of no strength until asked for, as in
 * buildPlayableStringBody) and, if given, a mallet resting a metre from the bar.
 */
export function buildStringBar(s: StringBar, sampleRate: number): BuiltStringBar {
  const built = buildInstrument(
    {
      strings: [stringOf(s)],
      loss: s.loss === undefined ? DEFAULT_LOSS : s.loss,
      stringModes: STRING_MODES,
      pluckAt: s.pluckAt,
      body: s.bar,
      bridge: { stiffness: s.joint?.stiffness ?? 0, damping: s.joint?.damping ?? 0 },
      output: { port: BAR_STRIKE, gain: s.outputGain },
    },
    sampleRate,
  )
  const calls = built.calls.slice(0, -1)
  let resonators = calls.filter((call) => call[0] === 'addResonator').length
  let connections = calls.filter((call) => call[0] === 'addSpring' || call[0] === 'addContact').length
  // Something that does not move, for the finger to rest against.
  const ground = resonators++
  calls.push(['addResonator', 1, 1], ['setShape', ground, 0, 0, 1], ['setMode', ground, 0, 0, Infinity, 1e12])
  const finger = connections++
  calls.push(['addSpring', built.strings[0], STRING_PLUCK, ground, 0, 0, 0, 0, 0])
  let mallet: number | undefined
  if (s.mallet) {
    const head = resonators++
    calls.push(['addResonator', 1, 1], ['setShape', head, 0, 0, 1], ['setMode', head, 0, 0, Infinity, s.mallet.mass])
    calls.push(['addContact', head, 0, built.body, BAR_STRIKE, s.mallet.stiffness, 1.5, -1])
    mallet = connections++
  }
  calls.push(['build'])
  return { calls, string: built.strings[0], pluckPort: STRING_PLUCK, finger, bar: built.body, joint: built.bridges[0], mallet, modes: { string: built.modes.strings[0], bar: built.modes.body } }
}
