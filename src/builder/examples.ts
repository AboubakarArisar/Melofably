// EXPERIMENTAL (Phase 3B). Starting points for the builder. Each is an
// ordinary graph made with the same editing functions the interface uses:
// nothing about them is fixed, and nothing here is audio.
import { addComponent, connect, setConnection, setMaterial, setParam, emptyGraph, type ComponentType, type Graph } from './graph.ts'

/** Small helper: add a component and set some of its properties. */
function place(graph: Graph, type: ComponentType, x: number, y: number, params: Record<string, number> = {}, material?: string) {
  const added = addComponent(graph, type, x, y)
  let next = added.graph
  for (const [key, value] of Object.entries(params)) next = setParam(next, added.id, key, value)
  if (material) next = setMaterial(next, added.id, material)
  return { graph: next, id: added.id }
}

function singleBar(): Graph {
  const bar = place(emptyGraph(), 'metalBar', 380, 300)
  const mallet = place(bar.graph, 'mallet', 330, 140)
  return connect(mallet.graph, mallet.id, bar.id).graph
}

function twoBars(): Graph {
  const a = place(emptyGraph(), 'metalBar', 250, 220)
  const b = place(a.graph, 'metalBar', 560, 400, { length: 0.32, connectionPosition: 0.3 })
  const mallet = place(b.graph, 'mallet', 200, 80, { hardness: 0.6 })
  const struck = connect(mallet.graph, mallet.id, a.id).graph
  const joined = connect(struck, a.id, b.id)
  return setConnection(joined.graph, joined.id, { type: 'spring', stiffness: 4e5 })
}

function woodAndMetal(): Graph {
  const wood = place(emptyGraph(), 'woodBar', 260, 220)
  const metal = place(wood.graph, 'metalBar', 560, 400, { length: 0.26, thickness: 8 })
  const mallet = place(metal.graph, 'mallet', 230, 80, { hardness: 0.4, velocity: 2 })
  const struck = connect(mallet.graph, mallet.id, wood.id).graph
  const joined = connect(struck, wood.id, metal.id)
  return setConnection(joined.graph, joined.id, { type: 'springDamper', stiffness: 2e5, damping: 0.5 })
}

/** Phase 3C.3: one string on the damped box of Phase 3C.2.3, joined by its bridge. */
function stringOnBox(): Graph {
  const string = place(emptyGraph(), 'steelString', 330, 170)
  const body = place(string.graph, 'dampedBox', 560, 380)
  return connect(body.graph, string.id, body.id).graph
}

export const EXAMPLES: { id: string; label: string; make: () => Graph }[] = [
  { id: 'single', label: 'One metal bar and a mallet', make: singleBar },
  { id: 'coupled', label: 'Two metal bars joined by a spring', make: twoBars },
  { id: 'mixed', label: 'A wooden bar joined to a metal bar', make: woodAndMetal },
]

/**
 * Experimental instruments that are not made of bars. Kept apart from EXAMPLES: those three are the
 * approved bar examples, and everything that is checked for every bar example runs over that list.
 */
export const STRING_EXAMPLES: { id: string; label: string; make: () => Graph }[] = [{ id: 'string', label: 'A string on a damped box body', make: stringOnBox }]
