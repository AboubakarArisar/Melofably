// EXPERIMENTAL (Phase 3B). Turns the builder's graph into the calls that
// build the same physical system in the WebAssembly engine, and into the
// calls for edits and strikes while it sounds. Pure functions; no audio.
import { barModeFrequencies, barModeShape, woodDecayTime } from '../audio/engine/physics.ts'
import { barContactTime } from '../experimental/physics/bar.ts'
import type { Mode } from '../experimental/physics/resonator.ts'
import { STRING_PLUCK } from '../experimental/string/instrument.ts'
import { bridgeSpring, buildPlayableStringBody, describeBody, fingerDamping, modesOfString, pluckCall, pullCalls, pullForce, radiation, releaseCalls, retriggerCalls, STRING_DENSITY, stringPitch, touchCall, type StringBody } from '../experimental/string/stringBody.ts'
import { BAR_STRIKE, buildStringBar, jointSpring } from '../experimental/string/stringBar.ts'
import { RAMP, type Call } from '../experimental/wasm/engine.ts'
import { CAPACITY, isBody, isExciter, isResonator, isString, TYPES, validateGraph, type Component, type Graph, type Issue } from './graph.ts'

/** Port numbers of a bar in the engine. */
export const STRIKE_PORT = 0
export const CONNECTION_PORT = 1

/**
 * The output is the sum of the bars' velocities at their strike points, in
 * m/s, times this. It leaves headroom: the engine's output saturates at 1,
 * which is 4 m/s.
 */
export const OUTPUT_GAIN = 0.25
/**
 * A string instrument's output is sound pressure at 1 m. The audio node carries it as a fraction of
 * this many pascals, so that the loudest pluck allowed (about 1 Pa) is not cut off. 2 Pa is 97 dB SPL.
 */
export const PRESSURE_FULL_SCALE = 2
/** Modes above this fraction of the sample rate are left out, as in the approved instruments. */
const HIGHEST_MODE = 0.45
/** Impulse strike: the push's impulse is this many newton-seconds at velocity 1. */
export const IMPULSE_AT_FULL_VELOCITY = 0.05
/** Mallet hardness 0..1 maps to a Hertz contact stiffness of 1e6..1e10 N/m^1.5. */
export const malletStiffness = (hardness: number) => 10 ** (6 + 4 * hardness)
/** Stiffness changes glide over this long, so a slider does not step. */
const STIFFNESS_GLIDE = 0.01 // s

/**
 * A bar's vibration modes as physical data, from the validated models:
 * frequencies and shapes of a uniform free-free beam (both approved bar
 * instruments), decay times by the approved metal bar's law or the approved
 * wooden bar's, and a modal mass equal to the bar's mass. The Damping
 * property divides every decay time.
 */
export function barModes(bar: Component, sampleRate: number): Mode[] {
  const material = TYPES[bar.type].materials![bar.material!]
  const { length, width, thickness, damping, strikePosition, connectionPosition } = bar.params
  const mass = material.density * length * (width / 1000) * (thickness / 1000)
  return barModeFrequencies({ length, thickness, density: material.density, youngsModulus: material.youngsModulus })
    .map((frequency, n) => ({
      frequency,
      t60: (bar.type === 'woodBar' ? woodDecayTime(frequency, material.lossFactor) : 1 / (1 / 6 + (material.lossFactor * frequency) / 2.2)) / damping,
      mass,
      shape: [barModeShape(n, strikePosition), barModeShape(n, connectionPosition)],
    }))
    .filter((mode) => mode.frequency < HIGHEST_MODE * sampleRate)
}

/** What a built system's parts are called in the engine, by the graph's identifiers. */
export interface Built {
  calls: Call[]
  sampleRate: number
  /** Engine resonator index of each bar. */
  bars: Record<string, number>
  /** Engine connection indices of each spring / damper connection. */
  links: Record<string, { spring?: number; damper?: number }>
  /** Engine contact index of each attached mallet. */
  mallets: Record<string, number>
  /** The bar each attached exciter strikes. */
  targets: Record<string, string>
  /** Things the user should know that do not stop it working. */
  notes: Issue[]
  /**
   * The experimental string instrument, when the graph is one: the graph's identifiers, the engine's
   * resonator and port for plucking, its bridge connection, and how many string modes were built.
   */
  stringBody?: {
    stringId: string
    /** What the string is joined to: the damped box, or (Phase 3D.2) a metal bar. */
    bodyId: string
    on: 'box' | 'bar'
    string: number
    pluckPort: number
    bridge: number
    joined: boolean
    modes: number
    /** The finger's damper (Phase 3D.1). */
    finger: number
  }
  /** Engine port at which each bar is struck and heard, where it is not STRIKE_PORT (a bar a string is tied to). */
  strikePorts?: Record<string, number>
  /** What the output is: the bars' velocities (m/s) or, for a string on a body, sound pressure (Pa). */
  output: 'velocity' | 'pressure'
}

export type Translation = { ok: true; built: Built } | { ok: false; issues: Issue[] }

/** The engine calls that build the instrument, or every reason it cannot be built. */
export function translate(graph: Graph, sampleRate: number): Translation {
  const issues = validateGraph(graph)
  if (issues.length) return { ok: false, issues }
  if (graph.components.some(isString) && graph.components.some(isResonator)) return translateStringBar(graph, sampleRate)
  if (graph.components.some((c) => isString(c) || isBody(c))) return { ok: true, built: translateStringBody(graph, sampleRate) }
  const built: Built = { calls: [['reset', sampleRate, 2]], sampleRate, bars: {}, links: {}, mallets: {}, targets: {}, notes: [], output: 'velocity' }
  const { calls } = built
  let resonators = 0
  let connections = 0
  let modeCount = 0

  for (const bar of graph.components.filter(isResonator)) {
    const modes = barModes(bar, sampleRate)
    if (modes.length === 0) {
      const lowest = barModeFrequencies({ length: bar.params.length, thickness: bar.params.thickness, ...TYPES[bar.type].materials![bar.material!] })[0]
      issues.push({ id: bar.id, message: `${bar.name} is too short and thick to sound: its lowest note would be ${Math.round(lowest)} Hz, above what can be played at ${sampleRate} Hz (${Math.round(HIGHEST_MODE * sampleRate)} Hz). Make it longer or thinner.` })
      continue
    }
    const r = resonators++
    built.bars[bar.id] = r
    modeCount += modes.length
    calls.push(['addResonator', 2, modes.length])
    modes.forEach((mode, n) => {
      mode.shape.forEach((value, port) => calls.push(['setShape', r, port, n, value]))
      calls.push(['setMode', r, n, mode.frequency, mode.t60, mode.mass])
    })
    calls.push(['addOutput', r, STRIKE_PORT, OUTPUT_GAIN])
    if (modes.length < 8) built.notes.push({ id: bar.id, message: `${bar.name}: only its lowest ${modes.length} of 8 overtones are below the highest playable frequency; the rest are left out.` })
  }
  if (issues.length) return { ok: false, issues }

  for (const link of graph.connections) {
    if (link.type === 'strike') continue
    const [a, b] = [built.bars[link.from], built.bars[link.to]]
    const entry: { spring?: number; damper?: number } = {}
    // A spring is corrected for the time step; a damper must not be (docs/WASM_ENGINE.md, section 6), so they are separate.
    if (link.type !== 'damper') {
      entry.spring = connections++
      calls.push(['addSpring', a, CONNECTION_PORT, b, CONNECTION_PORT, link.stiffness, 0, 0, 1])
    }
    if (link.type !== 'spring') {
      entry.damper = connections++
      calls.push(['addSpring', a, CONNECTION_PORT, b, CONNECTION_PORT, 0, link.damping, 0, 0])
    }
    built.links[link.id] = entry
  }

  for (const exciter of graph.components.filter(isExciter)) {
    const strike = graph.connections.find((c) => c.type === 'strike' && c.from === exciter.id)
    if (!strike) {
      built.notes.push({ id: exciter.id, message: `${exciter.name} is not attached to a bar, so it does nothing. Drag from its dot to a bar.` })
      continue
    }
    built.targets[exciter.id] = strike.to
    if (exciter.type !== 'mallet') continue
    // A free mass with one port, resting a metre from the bar until it is thrown.
    const r = resonators++
    calls.push(['addResonator', 1, 1], ['setShape', r, 0, 0, 1], ['setMode', r, 0, 0, Infinity, exciter.params.mass])
    calls.push(['addContact', r, 0, built.bars[strike.to], STRIKE_PORT, malletStiffness(exciter.params.hardness), 1.5, -1])
    built.mallets[exciter.id] = connections++
  }

  // validateGraph has already counted these; checked again against what was actually emitted.
  if (resonators > CAPACITY.resonators || connections > CAPACITY.connections || modeCount > 16384) {
    return { ok: false, issues: [{ message: `The instrument is too large for the physics engine (${resonators} of ${CAPACITY.resonators} bodies, ${connections} of ${CAPACITY.connections} connections).` }] }
  }
  // One note for all of them: a canvas of new bars should not fill the page with messages.
  const alone = graph.components.filter((bar) => isResonator(bar) && !graph.connections.some((c) => c.from === bar.id || c.to === bar.id))
  if (alone.length) {
    const names = alone.map((bar) => bar.name)
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)} have` : `${names[0]} has`
    built.notes.push({ message: `${list} nothing attached. Double-click a bar, or use Strike, to tap it directly.` })
  }
  calls.push(['build'])
  return { ok: true, built }
}

/** The string component's properties as the string-and-body model takes them. */
const stringBodyOf = (string: Component, joined: boolean): StringBody => ({ tension: string.params.tension, length: string.params.length, pluckAt: string.params.pluckPosition, joined })

/**
 * The experimental string instrument (Phase 3C.3): one string, the damped box, and the bridge between
 * them if the graph has one. The engine system is the one validated in Phase 3C.2.3
 * (src/experimental/string/stringBody.ts); the processor turns its output into sound pressure.
 */
function translateStringBody(graph: Graph, sampleRate: number): Built {
  const built: Built = { calls: [['reset', sampleRate, 2], ['build']], sampleRate, bars: {}, links: {}, mallets: {}, targets: {}, notes: [], output: 'pressure' }
  const [string, body] = [graph.components.find(isString), graph.components.find(isBody)]
  if (!string || !body) {
    built.notes.push({ id: (string ?? body)!.id, message: string ? `${string.name} has no body to stand on, so there is nothing to hear. Add the damped box body and drag from the string's dot to it.` : `${body!.name} has no string. Add a string and drag from its dot to the body.` })
    return built
  }
  const joined = graph.connections.some((c) => c.type === 'bridge')
  const system = buildPlayableStringBody(stringBodyOf(string, joined), sampleRate)
  const r = radiation(sampleRate)
  built.calls = [...system.calls, ['radiate', r.perSample, r.b0, r.b1, r.a1, PRESSURE_FULL_SCALE]]
  built.stringBody = { stringId: string.id, bodyId: body.id, on: 'box', string: system.string, pluckPort: system.pluckPort, bridge: system.bridge, joined, modes: system.modes.strings[0], finger: system.finger }
  if (!joined) built.notes.push({ id: string.id, message: `${string.name} is not standing on ${body.name}: plucking moves the string, but nothing pushes the body, so there is nothing to hear. Drag from the string's dot to the body to add the bridge.` })
  return built
}

/** The joint between a string and a bar as the model takes it: a damper only if the connection has one. */
const jointOf = (link: { type: string; stiffness: number; damping: number }) => ({ stiffness: link.stiffness, damping: link.type === 'springDamper' ? link.damping : 0 })

/**
 * The hybrid of Phase 3D.2: one string whose end is tied to one metal bar by a spring (and perhaps a
 * damper), with at most one mallet for the bar. One engine system (src/experimental/string/stringBar.ts);
 * each pushes the other through the joint. What is heard is the bar, as for every bar instrument: its
 * velocity where it is struck. The string is heard through the bar and in no other way.
 */
function translateStringBar(graph: Graph, sampleRate: number): Translation {
  const [string, bar] = [graph.components.find(isString)!, graph.components.find(isResonator)!]
  const built: Built = { calls: [], sampleRate, bars: {}, links: {}, mallets: {}, targets: {}, notes: [], output: 'velocity' }
  const modes = barModes(bar, sampleRate)
  if (modes.length === 0) {
    const lowest = barModeFrequencies({ length: bar.params.length, thickness: bar.params.thickness, ...TYPES[bar.type].materials![bar.material!] })[0]
    return { ok: false, issues: [{ id: bar.id, message: `${bar.name} is too short and thick to sound: its lowest note would be ${Math.round(lowest)} Hz, above what can be played at ${sampleRate} Hz (${Math.round(HIGHEST_MODE * sampleRate)} Hz). Make it longer or thinner.` }] }
  }
  const link = graph.connections.find((c) => c.from === string.id && c.to === bar.id)
  const mallet = graph.components.find((c) => c.type === 'mallet')
  const struck = mallet && graph.connections.some((c) => c.type === 'strike' && c.from === mallet.id && c.to === bar.id)
  const system = buildStringBar(
    {
      tension: string.params.tension,
      length: string.params.length,
      pluckAt: string.params.pluckPosition,
      // The builder's bars carry their ports as [strike, connection]; the string model wants the joint first.
      bar: modes.map((mode) => ({ ...mode, shape: [mode.shape[CONNECTION_PORT], mode.shape[STRIKE_PORT]] })),
      joint: link ? jointOf(link) : null,
      mallet: mallet && struck ? { mass: mallet.params.mass, stiffness: malletStiffness(mallet.params.hardness) } : undefined,
      outputGain: OUTPUT_GAIN,
    },
    sampleRate,
  )
  built.calls = system.calls
  built.bars[bar.id] = system.bar
  built.strikePorts = { [bar.id]: BAR_STRIKE }
  built.stringBody = { stringId: string.id, bodyId: bar.id, on: 'bar', string: system.string, pluckPort: system.pluckPort, bridge: system.joint, joined: !!link, modes: system.modes.string, finger: system.finger }
  if (mallet && struck) {
    built.mallets[mallet.id] = system.mallet!
    built.targets[mallet.id] = bar.id
  } else if (mallet) built.notes.push({ id: mallet.id, message: `${mallet.name} is not attached to a bar, so it does nothing. Drag from its dot to a bar.` })
  if (!link) built.notes.push({ id: string.id, message: `${string.name} is not tied to ${bar.name}: plucking moves the string, but nothing reaches the bar, which is all that is heard. Drag from the string's dot to the bar to tie them with a spring.` })
  if (modes.length < 8) built.notes.push({ id: bar.id, message: `${bar.name}: only its lowest ${modes.length} of 8 overtones are below the highest playable frequency; the rest are left out.` })
  return { ok: true, built }
}

/**
 * Everything about a graph that cannot change while sounding. Two graphs with
 * the same key differ only in live properties (and canvas positions), so the
 * running engine can be edited instead of rebuilt.
 */
export function structureKey(graph: Graph): string {
  const attached = new Set(graph.connections.filter((c) => c.type === 'strike').map((c) => c.from))
  const fixed = (c: Component) => TYPES[c.type].params.filter((p) => !p.live).map((p) => c.params[p.key])
  return JSON.stringify([
    graph.components.filter((c) => isResonator(c) || isString(c) || isBody(c) || attached.has(c.id)).map((c) => [c.id, c.type, c.material, ...fixed(c)]),
    graph.connections.map((c) => [c.id, c.type, c.from, c.to]),
  ])
}

/** Engine calls that take a running system from `before` to `after`. The two must have the same structureKey. */
export function liveCalls(before: Graph, after: Graph, built: Built): Call[] {
  const calls: Call[] = []
  const part = built.stringBody
  const [string, was] = [after.components.find(isString), before.components.find(isString)]
  if (part && string && was) {
    const model = stringBodyOf(string, part.joined)
    if (was.params.tension !== string.params.tension) {
      // As turning a tuning peg: every mode of the string is retuned where it is, keeping its energy, and the
      // bridge spring's allowance for the string's missing modes follows.
      modesOfString(model, built.sampleRate).slice(0, part.modes).forEach((mode, n) => calls.push(['tune', part.string, n, mode.frequency, mode.t60]))
      if (part.joined && part.on === 'box') calls.push(['setStiffness', part.bridge, bridgeSpring(model, built.sampleRate), RAMP, Math.round(STIFFNESS_GLIDE * built.sampleRate)])
    }
    // Tied to a bar: the joint's spring and damper are the user's, and live. The spring the engine holds
    // also carries the allowance for the string's missing modes, which follows the tension.
    const [link, old] = [after.connections.find((c) => c.from === string.id), before.connections.find((c) => c.from === string.id)]
    if (part.on === 'bar' && part.joined && link && old) {
      if (old.stiffness !== link.stiffness || was.params.tension !== string.params.tension) calls.push(['setStiffness', part.bridge, jointSpring({ ...model, loss: undefined }, link.stiffness, built.sampleRate), RAMP, Math.round(STIFFNESS_GLIDE * built.sampleRate)])
      if (jointOf(old).damping !== jointOf(link).damping) calls.push(['setDamping', part.bridge, jointOf(link).damping])
    }
    // The pluck point is only where the next pluck's force goes: moving it does not disturb the string.
    if (was.params.pluckPosition !== string.params.pluckPosition) modesOfString(model, built.sampleRate).slice(0, part.modes).forEach((mode, n) => calls.push(['setShape', part.string, STRING_PLUCK, n, mode.shape[STRING_PLUCK]]))
  }
  for (const bar of after.components.filter(isResonator)) {
    const old = before.components.find((c) => c.id === bar.id)
    if (old?.params.damping === bar.params.damping) continue
    barModes(bar, built.sampleRate).forEach((mode, n) => calls.push(['tune', built.bars[bar.id], n, mode.frequency, mode.t60]))
  }
  for (const link of after.connections) {
    const old = before.connections.find((c) => c.id === link.id)
    const entry = built.links[link.id]
    if (!old || !entry) continue
    if (entry.spring !== undefined && old.stiffness !== link.stiffness) calls.push(['setStiffness', entry.spring, link.stiffness, RAMP, Math.round(STIFFNESS_GLIDE * built.sampleRate)])
    if (entry.damper !== undefined && old.damping !== link.damping) calls.push(['setDamping', entry.damper, link.damping])
  }
  return calls
}

const impulse = (bar: number, velocity: number, hardness: number, port = STRIKE_PORT): Call => ['strike', bar, port, IMPULSE_AT_FULL_VELOCITY * velocity, barContactTime(hardness, velocity)]

/** Calls that make one exciter strike. Empty if it is not attached. */
export function exciterCalls(graph: Graph, built: Built, exciterId: string): Call[] {
  const exciter = graph.components.find((c) => c.id === exciterId)
  if (!exciter || !(exciterId in built.targets)) return []
  if (exciter.type === 'mallet') return [['launch', built.mallets[exciterId], exciter.params.velocity]]
  return [impulse(built.bars[built.targets[exciterId]], exciter.params.velocity, exciter.params.hardness)]
}

/** Calls that strike one bar: with every exciter attached to it, or a plain tap if it has none. */
export function barCalls(graph: Graph, built: Built, barId: string): Call[] {
  // The string, or the box it stands on: pluck the string. (A bar the string is tied to is struck, as any bar is.)
  if (built.stringBody && (barId === built.stringBody.stringId || (built.stringBody.on === 'box' && barId === built.stringBody.bodyId))) return pluckCalls(graph, built)
  if (!(barId in built.bars)) return []
  const exciters = Object.keys(built.targets).filter((id) => built.targets[id] === barId)
  if (exciters.length === 0) return [impulse(built.bars[barId], 0.6, 0.6, built.strikePorts?.[barId])]
  return exciters.flatMap((id) => exciterCalls(graph, built, id))
}

/** Calls that pluck the string, as its own properties say. Empty if there is no string. */
function pluckCalls(graph: Graph, built: Built): Call[] {
  const string = built.stringBody && graph.components.find((c) => c.id === built.stringBody!.stringId)
  if (!string) return []
  const { pluckStrength, pluckSoftness, retrigger } = string.params
  // Touch first, or add to what is there: the string's own property says which.
  return retrigger ? retriggerCalls(built.stringBody!, string.params as { tension: number }, pluckStrength, pluckSoftness) : [pluckCall(built.stringBody!, pluckStrength, pluckSoftness)]
}

/**
 * Calls that play the whole instrument: the string plucked and every attached exciter, or a tap on every
 * bar if there is nothing to play it with.
 */
export function instrumentCalls(graph: Graph, built: Built): Call[] {
  // A string plays by being plucked; a bar it is tied to is struck too if it has a mallet.
  if (built.stringBody) return [...pluckCalls(graph, built), ...Object.keys(built.targets).flatMap((id) => exciterCalls(graph, built, id))]
  const exciters = Object.keys(built.targets)
  if (exciters.length) return exciters.flatMap((id) => exciterCalls(graph, built, id))
  return Object.keys(built.bars).flatMap((id) => barCalls(graph, built, id))
}

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** Nearest note name, e.g. 440 -> "A4". */
export function noteName(frequency: number): string {
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440))
  return `${NOTES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}

/** Plain facts about a bar for the inspector. */
export function describeBar(bar: Component, sampleRate: number) {
  const material = TYPES[bar.type].materials![bar.material!]
  const [lowest] = barModeFrequencies({ length: bar.params.length, thickness: bar.params.thickness, ...material })
  const modes = barModes(bar, sampleRate)
  return { lowest, note: noteName(lowest), massKg: modes[0]?.mass ?? material.density * bar.params.length * (bar.params.width / 1000) * (bar.params.thickness / 1000), overtones: modes.length, ringSeconds: modes[0]?.t60 }
}

/** Plain facts about a string for the inspector. */
export function describeString(string: Component, sampleRate: number) {
  const model = stringBodyOf(string, true)
  const pitch = stringPitch(model)
  const modes = modesOfString(model, sampleRate)
  return {
    pitch,
    note: noteName(pitch),
    centsFromNote: 1200 * Math.log2(pitch / (440 * 2 ** (Math.round(12 * Math.log2(pitch / 440)) / 12))),
    massGrams: 1000 * STRING_DENSITY * string.params.length,
    /** Wave impedance, kg/s: how hard the string pushes on what it is tied to. */
    impedance: Math.sqrt(string.params.tension * STRING_DENSITY),
    modes: modes.length,
    highestMode: modes.at(-1)?.frequency ?? 0,
    ringSeconds: modes[0]?.t60,
  }
}

export { describeBody }
// ---- Playing gestures on the string (Phase 3D.1) ------------------------------------------------------

const playable = (graph: Graph, built: Built) => {
  const string = built.stringBody && graph.components.find((c) => c.id === built.stringBody!.stringId)
  return string ? { part: built.stringBody!, string, model: stringBodyOf(string, built.stringBody!.joined) } : null
}

/** A finger comes to rest on the string and stays (`on`), or leaves it. Empty if there is no string. */
export function touchCalls(graph: Graph, built: Built, on: boolean): Call[] {
  const p = playable(graph, built)
  return p ? [touchCall(p.part, p.model, on)] : []
}

/**
 * A finger holds the string `displacement` metres aside at its pluck point.
 * Returns the force that takes, capped at the largest pluck strength allowed.
 */
export function pullCallsFor(graph: Graph, built: Built, displacement: number): { calls: Call[]; force: number } {
  const p = playable(graph, built)
  if (!p) return { calls: [], force: 0 }
  const most = TYPES[p.string.type].params.find((spec) => spec.key === 'pluckStrength')!.max
  const force = Math.sign(displacement) * Math.min(most, pullForce(p.model, p.model.pluckAt, Math.abs(displacement)))
  return { calls: pullCalls(p.part, p.model, force), force }
}

/** The finger lets go of the string. */
export function releaseCallsFor(graph: Graph, built: Built): Call[] {
  const p = playable(graph, built)
  return p ? releaseCalls(p.part, p.string.params.pluckSoftness) : []
}

/** What a finger's touch is, for display. */
export const describeFinger = (string: Component) => ({ damping: fingerDamping({ tension: string.params.tension }), displacementPerNewton: 1 / pullForce(stringBodyOf(string, true), string.params.pluckPosition, 1) })
