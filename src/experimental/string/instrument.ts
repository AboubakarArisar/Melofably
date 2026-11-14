// EXPERIMENTAL (Phase 3C.2 prototype). Not used by the application or the
// builder. One or more modal strings, each joined by its own bridge spring
// to one body, as calls for the WebAssembly physics engine.
import type { Mode } from '../physics/resonator.ts'
import { Design, type Call } from '../wasm/engine.ts'
import { bridgeStiffness, residualCompliance, stringModes, type StringLoss, type StringParams } from './modalString.ts'

/** Ports of each string in the engine. */
export const STRING_END = 0 // the bridge end
export const STRING_PLUCK = 1 // where it is plucked
export const STRING_WATCH = 2 // a point along it whose motion can be read (0.3 of its length from the nut)

export interface Instrument {
  strings: StringParams[]
  loss: StringLoss | null
  /** Most modes kept per string. */
  stringModes: number
  /** Where each string is plucked, as a fraction of its length from the nut. */
  pluckAt: number
  /**
   * The body: its first `strings.length` ports are where the strings'
   * bridges stand, in order; any further ports are for reading or striking.
   */
  body: Mode[]
  /** Each bridge: a spring (N/m) and optional damper (N s/m) between a string's end and the body. */
  bridge: { stiffness: number; damping?: number }
  /** Mass of the bridge itself, kg: a lump the strings stand on, fixed to the body's first port. 0 or absent: none. */
  bridgeMass?: number
  /** Body port whose velocity is the engine's output (for example the radiation port), with its gain. */
  output?: { port: number; gain: number }
  /**
   * Enclosed air behind the body (airCavity.ts): a spring from the output port to a plug of air, whose
   * own flow is added to the output. Needs `output`. Absent: none, and the calls are as before.
   */
  air?: { stiffness: number; damping: number; plug: Mode; resistance?: number }
}

/** Stiffness of the joint between a bridge mass and the body, N/m: rigid for audio purposes. */
export const GLUE = 1e9

export interface BuiltInstrument {
  calls: Call[]
  /** Engine resonator index of each string, and of the body. */
  strings: number[]
  body: number
  /** Engine connection index of each bridge spring. */
  bridges: number[]
  /** Modes in use: per string, and in the body. */
  modes: { strings: number[]; body: number }
  /** Engine resonator of something that does not move (the screen over the hole pushes on it), if there is one. */
  ground?: number
}

/**
 * The engine calls that build the instrument. Bridge springs are plain (not
 * frequency-corrected) and carry each string's residual compliance, as
 * Phase 3C.1 found necessary.
 */
export function buildInstrument(inst: Instrument, sampleRate: number): BuiltInstrument {
  const design = new Design(sampleRate, false)
  const kept = inst.strings.map((s) => stringModes(s, [1, inst.pluckAt, 0.3], sampleRate, inst.loss, inst.stringModes))
  const strings = kept.map((modes) => design.modal(modes))
  const body = design.modal(inst.body)
  // With a bridge mass, every string stands on that mass, and the mass is fixed to the body's first
  // port by a spring far stiffer than anything else here (its own resonance is above the audio range).
  const mass = inst.bridgeMass ? design.mass(inst.bridgeMass) : -1
  const bridges = inst.strings.map((s, i) => {
    const stiffness = inst.bridge.stiffness > 0 ? bridgeStiffness(inst.bridge.stiffness, residualCompliance(s, kept[i], sampleRate)) : 0
    design.calls.push(['addSpring', strings[i], STRING_END, mass >= 0 ? mass : body, mass >= 0 ? 0 : i, stiffness, inst.bridge.damping ?? 0, 0, 0])
    return i
  })
  if (mass >= 0) design.calls.push(['addSpring', mass, 0, body, 0, GLUE, 0, 0, 0])
  if (inst.output) design.output([body, inst.output.port], inst.output.gain)
  let ground: number | undefined
  if (inst.air && inst.output) {
    // The plug's port moves by -(hole area / plate area) times the plug: see airCavity().
    // A screen over the hole: a damper from the plug itself (a second port, shape 1) to something that does not move.
    const screened = (inst.air.resistance ?? 0) > 0
    const plug = design.modal([screened ? { ...inst.air.plug, shape: [inst.air.plug.shape[0], 1] } : inst.air.plug])
    if (screened) design.calls.push(['addSpring', plug, 1, (ground = design.mass(1e12)), 0, 0, inst.air.resistance!, 0, 0])
    design.calls.push(['addSpring', body, inst.output.port, plug, 0, inst.air.stiffness, inst.air.damping, 0, 0])
    design.output([plug, 0], -inst.output.gain)
  }
  return { calls: design.build(), strings, body, bridges, modes: { strings: kept.map((m) => m.length), body: inst.body.length }, ground }
}
