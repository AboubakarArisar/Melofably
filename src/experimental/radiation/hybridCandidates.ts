// EXPERIMENTAL (Phase 3D.5). Research candidates: not builder examples, and
// not used by the builder or the application. Each is the experimental
// radiated hybrid of Phase 3D.4 (one string tied to one metal bar, heard as
// sound pressure) with a few of its ordinary properties changed, every one
// inside the range the builder already allows. Nothing here adds gain,
// filtering or any new physics: a candidate is a different instrument built
// from the same parts. See docs/HYBRID_PLAYABILITY.md.
import { RADIATION_EXAMPLES } from '../../builder/examples.ts'
import { setConnection, setMaterial, setParam, type Component, type Graph } from '../../builder/graph.ts'

export interface Design {
  string?: Partial<Record<'tension' | 'length' | 'pluckPosition' | 'pluckStrength' | 'pluckSoftness', number>>
  bar?: Partial<Record<'length' | 'width' | 'thickness' | 'damping' | 'strikePosition' | 'connectionPosition', number>>
  material?: string
  mallet?: Partial<Record<'mass' | 'hardness' | 'velocity', number>>
  joint?: { stiffness?: number; damping?: number }
}

export const part = (graph: Graph, type: Component['type']) => graph.components.find((c) => c.type === type)!
export const jointOf = (graph: Graph) => graph.connections.find((c) => c.type !== 'strike')!

/** The experimental radiated hybrid of Phase 3D.4 with some properties changed. */
export function design(d: Design = {}): Graph {
  let graph = RADIATION_EXAMPLES[0].make()
  for (const [type, values] of [['steelString', d.string], ['metalBar', d.bar], ['mallet', d.mallet]] as const) for (const [key, value] of Object.entries(values ?? {})) graph = setParam(graph, part(graph, type).id, key, value as number)
  if (d.material) graph = setMaterial(graph, part(graph, 'metalBar').id, d.material)
  if (d.joint) graph = setConnection(graph, jointOf(graph).id, { ...(d.joint.damping ? { type: 'springDamper' as const, damping: d.joint.damping } : {}), ...(d.joint.stiffness ? { stiffness: d.joint.stiffness } : {}) })
  return graph
}

/**
 * The two candidates the study ends with.
 *
 * endTied  The string is tied at the very end of the bar instead of a tenth
 *          of the way along. Every bending mode of a free bar moves most at
 *          its ends, so the string can push all of them, including the high
 *          ones that make sound. Nothing else is changed.
 * tuned    The same, with the bar 0.485 m long instead of 0.40 m: its modes
 *          then lie beside harmonics of the string (at 2.02, 10.94, 18.08
 *          and 27.01 times its pitch), so the string's harmonics drive the
 *          bar where it responds.
 */
export const CANDIDATES: Record<'endTied' | 'tuned', Design> = {
  endTied: { bar: { connectionPosition: 0 } },
  tuned: { bar: { connectionPosition: 0, length: 0.485 } },
}

/** Two ways of playing, as properties: a sharper pluck (a nail, not flesh) and a soft, slower mallet. */
export const SHARP_PLUCK: Design['string'] = { pluckSoftness: 0 }
export const SOFT_MALLET: Design['mallet'] = { hardness: 0.15, velocity: 1 }
