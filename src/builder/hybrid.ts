// The hybrid instrument in the builder (MVP): a version 2 graph of the one
// string-on-a-bar-bridge assembly a validated model exists for, the edits
// the builder allows on it, how it becomes engine calls, and how it is
// saved in this browser. Pure functions: no audio, no DOM.
//
// Nothing here is new physics. The graph is described by
// src/experimental/graph2, built by src/experimental/string/stringBarBody.ts
// and played with the Hybrid Lab's controls (src/experimental/hybrid).
import { describeAssembly } from '../experimental/graph2/assembly.ts'
import { hybridFixture } from '../experimental/graph2/fixtures.ts'
import { readInstrument, serialize } from '../experimental/graph2/io.ts'
import type { Graph, Place } from '../experimental/graph2/model.ts'
import { FULL_SCALE, type Lab } from '../experimental/hybrid/instrument.ts'
import { buildStringBarBody } from '../experimental/string/stringBarBody.ts'
import { BODY, radiation } from '../experimental/string/stringBody.ts'

export const HYBRID_STORAGE_KEY = 'sonicmatter.builder.hybrid'
export const MODE_STORAGE_KEY = 'sonicmatter.builder.mode'

/** Identifiers of the template's parts: fixed, so that a saved instrument always means the same things. */
export const IDS = { string: 'c1', bar: 'c2', body: 'c3', tie: 'c4', padA: 'c5', padB: 'c6', pluck: 'c7', mute: 'c8', strike: 'c9', contact: 'c10' }

/**
 * The validated hybrid as a starting point: the Phase 3D.15 reference graph, with the finger's place on
 * the bar given a port of its own so that it can be moved apart from where the bar is struck. Both are
 * at the middle, as in the reference, so it describes exactly the same instrument.
 */
export function hybridTemplate(tieAt: 0.2 | 0.18 = 0.2): Graph {
  const g = hybridFixture(tieAt)
  g.components[1].ports.push({ id: 'touch', name: 'Finger', at: 0.5 })
  g.targets[3].at = { component: IDS.bar, port: 'touch' }
  return g
}

// ---- Editing: every function returns a new graph ----------------------------------------------------------

const clone = (g: Graph): Graph => structuredClone(g)

/** The second pad stands on the board as far from the first as the two are apart on the bar: a bar does not stretch. */
function followPads(g: Graph): Graph {
  const bar = g.components.find((c) => c.id === IDS.bar)!
  const body = g.components.find((c) => c.id === IDS.body)!
  const at = (id: string) => bar.ports.find((p) => p.id === id)!.at as number
  body.ports.find((p) => p.id === 'pad-b')!.at = [BODY.bridgeAt[0] + (Math.abs(at('pad-b') - at('pad-a')) * bar.params.length) / BODY.plate.length, BODY.bridgeAt[1]]
  return g
}

export function setParam(graph: Graph, component: string, key: string, value: number): Graph {
  const g = clone(graph)
  g.components.find((c) => c.id === component)!.params[key] = value
  return followPads(g)
}
export function setMaterial(graph: Graph, material: string): Graph {
  const g = clone(graph)
  g.components.find((c) => c.id === IDS.bar)!.material = material
  return g
}
/** Moves a port. Whatever is attached to it, or plays at it, moves with it. */
export function setPort(graph: Graph, component: string, port: string, at: Place): Graph {
  const g = clone(graph)
  g.components.find((c) => c.id === component)!.ports.find((p) => p.id === port)!.at = at
  return followPads(g)
}
/** The tie's stiffness or damping. */
export function setTie(graph: Graph, values: { stiffness?: number; damping?: number }): Graph {
  const g = clone(graph)
  Object.assign(g.connections.find((c) => c.id === IDS.tie)!, values)
  return g
}
/** Both pads together: the validated model has them alike. */
export function setPads(graph: Graph, values: { stiffness?: number; damping?: number }): Graph {
  const g = clone(graph)
  for (const id of [IDS.padA, IDS.padB]) Object.assign(g.connections.find((c) => c.id === id)!, values)
  return g
}
export function setStriker(graph: Graph, values: { mass?: number; hardness?: number }): Graph {
  const g = clone(graph)
  Object.assign(g.targets.find((t) => t.id === IDS.strike)!.striker!, values)
  return g
}
export function rename(graph: Graph, name: string): Graph {
  const g = clone(graph)
  g.meta.name = name
  return g
}

// ---- To the engine -----------------------------------------------------------------------------------------

/**
 * The instrument as the engine builds it and as the Hybrid Lab's controls play it. Throws, with every
 * reason, if the graph is not valid or is not the supported assembly. The model and its calls are the
 * validated ones, unchanged.
 */
export function compileHybrid(graph: Graph, sampleRate: number): Lab {
  const a = describeAssembly(graph)
  if (a.kind !== 'barBridge' || !a.ids.strike || a.ids.contacts.length !== 1 || !a.ids.pluck || !a.ids.mute) throw new Error('This builder plays one kind of hybrid: a string tied to a metal bar on two pads on the body, with a place to pluck, to mute, to strike and to damp.')
  const built = buildStringBarBody(a.spec, sampleRate)
  const r = radiation(sampleRate)
  return {
    choice: 'tie-0.20', // (a label the lab's controls do not use)
    sampleRate,
    calls: [...built.calls, ['radiate', r.perSample, r.b0, r.b1, r.a1, FULL_SCALE]],
    string: built.string,
    // One place to pluck: wherever the string's pluck port is.
    pluckPorts: Array.from({ length: 6 }, () => built.pluckPort),
    stringFinger: built.finger,
    bar: built.bar,
    striker: built.mallet,
    barFingers: [built.barFinger!],
  }
}

// ---- Saving in this browser ------------------------------------------------------------------------------------

/** The instrument as text for storage: the version 2 canonical form. Throws if it holds a number that cannot be written. */
export const saveText = (graph: Graph): string => serialize(graph)

/** A saved hybrid, or why it cannot be used. Never throws, and never changes what was saved. */
export function openText(text: string | null): { graph: Graph | null; problem?: string } {
  if (text === null) return { graph: null }
  try {
    const read = readInstrument(text)
    if (read.version !== 2) return { graph: null, problem: 'The saved instrument is in the older format, which the classic builder reads.' }
    compileHybrid(read.graph, 48000) // it must also be the assembly this builder can play
    return { graph: read.graph }
  } catch (error) {
    return { graph: null, problem: error instanceof Error ? error.message : String(error) }
  }
}
