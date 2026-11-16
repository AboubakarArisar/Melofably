// EXPERIMENTAL (Phase 3D.14). A PROOF OF CONCEPT, not part of the builder
// and not used by any page. It exists to test the assumptions of
// docs/HYBRID_BUILDER_DESIGN.md with running code:
//
//   - that the bar-as-bridge instrument can be written down as a graph of
//     components with named mechanical ports and typed connections between
//     ports (the builder's present graph has neither);
//   - that such a description can be checked, saved and restored with stable
//     identities;
//   - that it compiles, through the model already validated
//     (stringBarBody.ts), to exactly the engine calls of the standalone
//     reference;
//   - and that instruments saved by the present builder stay readable beside
//     it, unchanged.
//
// It recognises one assembly and nothing else. It is deliberately not a
// general compiler and not a second builder.
import { deserialize, type Graph } from '../../builder/graph.ts'
import { ALUMINIUM, buildStringBarBody, type BuiltStringBarBody, type StringBarBody } from '../string/stringBarBody.ts'
import { BODY } from '../string/stringBody.ts'
import type { Call } from '../wasm/engine.ts'

/** A point on a component where something can be attached: along a bar or string (0 to 1), or on a board ([along, across], 0 to 1 each). */
export type PortPlace = number | [number, number]
export interface DraftComponent {
  id: string
  type: 'steelString' | 'metalBar' | 'dampedBox' | 'mallet'
  name: string
  x: number
  y: number
  material?: string
  params: Record<string, number>
  /** Ports the user has placed, by name. A component also has the fixed ports of its type (FIXED_PORTS). */
  ports?: Record<string, PortPlace>
}
export interface PortRef {
  component: string
  port: string
}
/**
 * 'tie': a string's end held by a point of a bar (a spring, perhaps a damper).
 * 'pad': a point of a bar standing on a point of a board (a spring and a damper).
 * 'strike': a mallet's head against a point of a bar (a contact).
 * 'contact': a place where a finger can be laid, against the hand, which does not move. Its strength is a
 *            matter of playing, not of the instrument, and is not stored.
 */
export type DraftConnectionType = 'tie' | 'pad' | 'strike' | 'contact'
export interface DraftConnection {
  id: string
  type: DraftConnectionType
  from: PortRef
  /** Absent for a contact: its other side is the player's hand. */
  to?: PortRef
  stiffness?: number // N/m
  damping?: number // N s/m
}
export interface DraftGraph {
  version: 2
  nextId: number
  components: DraftComponent[]
  connections: DraftConnection[]
}

/** Ports every component of a type has, and where: the string's ends and pluck point, the board's approved bridge point, the mallet's head. */
export const FIXED_PORTS: Record<DraftComponent['type'], string[]> = { steelString: ['end', 'pluck'], metalBar: [], dampedBox: ['bridge'], mallet: ['head'] }
/** Which kinds of port each connection may join: [from, to]. Anything else is refused. */
export const ALLOWED: Record<DraftConnectionType, { from: [DraftComponent['type'], 'fixed' | 'placed' | 'any', string?]; to?: [DraftComponent['type'], 'fixed' | 'placed' | 'any'] }> = {
  tie: { from: ['steelString', 'fixed', 'end'], to: ['metalBar', 'placed'] },
  pad: { from: ['metalBar', 'placed'], to: ['dampedBox', 'any'] },
  strike: { from: ['mallet', 'fixed', 'head'], to: ['metalBar', 'placed'] },
  contact: { from: ['metalBar', 'placed'] }, // (the string's own finger is always at its pluck point and needs no port)
}
/** Limits of what a connection may be given, as the builder's are stated: outside them a value is refused, never clamped. */
export const LIMITS = { tieStiffness: [1e4, 1e8], padStiffness: [1e4, 1e8], padDamping: [0, 100], tieDamping: [0, 100] } as const

export interface DraftIssue {
  id?: string
  kind: 'structure' | 'physics' | 'numerics' | 'budget'
  message: string
}

const placeOf = (c: DraftComponent, port: string): PortPlace | 'fixed' | undefined => (FIXED_PORTS[c.type].includes(port) ? 'fixed' : c.ports?.[port])

/** Every problem with a draft graph, each marked with what kind of problem it is. Empty: it is the assembly this proof of concept can compile. */
export function validateDraft(g: DraftGraph): DraftIssue[] {
  const issues: DraftIssue[] = []
  const say = (kind: DraftIssue['kind'], message: string, id?: string) => void issues.push({ kind, message, id })
  if (g.version !== 2) return [{ kind: 'structure', message: `Unknown instrument format version ${String(g.version)}.` }]
  const seen = new Set<string>()
  for (const item of [...g.components, ...g.connections]) {
    if (typeof item.id !== 'string' || item.id === '' || seen.has(item.id)) say('structure', `Identifiers must be unique and not empty ("${String(item.id)}").`, item.id)
    seen.add(item.id)
  }
  const by = (id: string) => g.components.find((c) => c.id === id)
  for (const c of g.components) {
    if (!(c.type in FIXED_PORTS)) say('structure', `Unknown component type "${String(c.type)}".`, c.id)
    for (const [name, at] of Object.entries(c.ports ?? {})) {
      if (FIXED_PORTS[c.type]?.includes(name)) say('structure', `${c.name}: "${name}" is a port every ${c.type} has; it cannot be placed again.`, c.id)
      const numbers = Array.isArray(at) ? at : [at]
      if (numbers.length !== (c.type === 'dampedBox' ? 2 : 1) || !numbers.every((v) => typeof v === 'number' && v >= 0 && v <= 1)) say('structure', `${c.name}: port "${name}" is not a place on it.`, c.id)
    }
  }
  // Connections: only the kinds of port each type may join.
  for (const link of g.connections) {
    const rule = ALLOWED[link.type]
    if (!rule) {
      say('structure', `Connection ${link.id}: unknown connection type "${String(link.type)}".`, link.id)
      continue
    }
    const check = (ref: PortRef | undefined, want: [DraftComponent['type'], 'fixed' | 'placed' | 'any', string?] | undefined, side: string) => {
      if (!want) return ref ? say('structure', `Connection ${link.id}: a ${link.type} has no ${side} end; its other side is the hand.`, link.id) : undefined
      const c = ref && by(ref.component)
      if (!ref || !c) return say('structure', `Connection ${link.id}: its ${side} end does not exist.`, link.id)
      const place = placeOf(c, ref.port)
      if (place === undefined) return say('structure', `Connection ${link.id}: ${c.name} has no port "${ref.port}".`, link.id)
      if (c.type !== want[0] || (want[1] === 'fixed' && place !== 'fixed') || (want[1] === 'placed' && place === 'fixed') || (want[2] && ref.port !== want[2])) say('structure', `Connection ${link.id}: a ${link.type} cannot go ${side} ${c.name}'s "${ref.port}".`, link.id)
    }
    check(link.from, rule.from, 'from')
    check(link.to, rule.to, 'to')
    const range = (value: number | undefined, [low, high]: readonly [number, number], what: string) => {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) say('numerics', `Connection ${link.id}: ${what} must be between ${low} and ${high} (it is ${String(value)}).`, link.id)
    }
    if (link.type === 'tie') {
      range(link.stiffness, LIMITS.tieStiffness, 'stiffness (N/m)')
      range(link.damping ?? 0, LIMITS.tieDamping, 'damping (N s/m)')
    }
    if (link.type === 'pad') {
      range(link.stiffness, LIMITS.padStiffness, 'stiffness (N/m)')
      range(link.damping, LIMITS.padDamping, 'damping (N s/m)')
    }
  }
  if (issues.length) return issues
  // The one assembly: a string tied to a bar that stands on a board on two pads.
  const count = (type: DraftComponent['type']) => g.components.filter((c) => c.type === type).length
  const links = (type: DraftConnectionType) => g.connections.filter((c) => c.type === type)
  if (count('steelString') !== 1 || count('metalBar') !== 1 || count('dampedBox') !== 1 || count('mallet') > 1) say('structure', 'This proof of concept builds one instrument: one string, one metal bar, one damped box body, and at most one mallet.')
  if (links('tie').length !== 1) say('structure', 'The string\'s end must be tied to the bar, once.')
  if (links('pad').length !== 2) say('physics', `A bar stands on two pads: with one it would spin about it, with none nothing reaches the board (there are ${links('pad').length}).`)
  if (links('strike').length > 1) say('structure', 'A mallet strikes the bar at one place.')
  if (links('contact').length > 1) say('budget', 'This proof of concept gives the bar one place for a finger (the hybrid lab shows three).')
  if (issues.length) return issues
  const bar = g.components.find((c) => c.type === 'metalBar')!
  const box = g.components.find((c) => c.type === 'dampedBox')!
  const pads = links('pad')
  if (new Set(pads.map((p) => p.from.port)).size !== 2 || new Set(pads.map((p) => p.to!.port)).size !== 2) say('physics', 'The two pads must stand under two different points of the bar and on two different points of the board.')
  else {
    const onBar = pads.map((p) => bar.ports![p.from.port] as number)
    const onBoard = pads.map((p) => (placeOf(box, p.to!.port) === 'fixed' ? BODY.bridgeAt : (box.ports![p.to!.port] as [number, number])))
    const apart = Math.hypot((onBoard[1][0] - onBoard[0][0]) * BODY.plate.length, (onBoard[1][1] - onBoard[0][1]) * BODY.plate.width)
    const under = Math.abs(onBar[1] - onBar[0]) * bar.params.length
    // A bar is rigid along its length: its pads are as far apart on the board as they are on the bar.
    if (Math.abs(apart - under) > 0.002) say('physics', `The pads are ${(1000 * under).toFixed(1)} mm apart on the bar and ${(1000 * apart).toFixed(1)} mm apart on the board: the bar would have to stretch.`, bar.id)
    if (pads[0].stiffness !== pads[1].stiffness || pads[0].damping !== pads[1].damping) say('budget', 'This proof of concept gives both pads the same stiffness and damping.')
  }
  return issues
}

export interface Compiled {
  /** The validated model's own description of the instrument: what stringBarBody.ts builds. */
  spec: StringBarBody
  built: BuiltStringBarBody
  /** Engine calls, without the conversion to sound pressure. */
  calls: Call[]
  /** Where each graph identifier lives in the engine, so that playing and gestures can be addressed by identifier. */
  where: { string: string; bar: string; body: string; strike?: { id: string; contact: number }; fingers: Record<string, number> }
}

/** The instrument a draft graph describes, through the validated model. Throws with every problem if the graph is not valid. */
export function compileDraft(g: DraftGraph, sampleRate: number): Compiled {
  const issues = validateDraft(g)
  if (issues.length) throw new Error(`This instrument cannot be built:\n${issues.map((i) => `- [${i.kind}] ${i.message}`).join('\n')}`)
  const one = (type: DraftComponent['type']) => g.components.find((c) => c.type === type)
  const [string, bar, box, mallet] = [one('steelString')!, one('metalBar')!, one('dampedBox')!, one('mallet')]
  const links = (type: DraftConnectionType) => g.connections.filter((c) => c.type === type)
  const [tie, strike, contact] = [links('tie')[0], links('strike')[0], links('contact')[0]]
  // The pads in the order they lie along the bar.
  const pads = links('pad').sort((a, b) => (bar.ports![a.from.port] as number) - (bar.ports![b.from.port] as number))
  const onBoard = (port: string): [number, number] => (FIXED_PORTS.dampedBox.includes(port) ? [BODY.bridgeAt[0], BODY.bridgeAt[1]] : (box.ports![port] as [number, number]))
  const at = (port: string) => bar.ports![port] as number
  const spec: StringBarBody = {
    tension: string.params.tension,
    length: string.params.length,
    pluckAt: string.params.pluckPosition,
    stringOn: true,
    bar: { ...ALUMINIUM, length: bar.params.length, width: bar.params.width, thickness: bar.params.thickness, strikeAt: strike ? at(strike.to!.port) : 0.5, supports: [at(pads[0].from.port), at(pads[1].from.port)] },
    barAt: [0.5, 0.65], // not used: the pads say where the bar stands
    mount: { stiffness: pads[0].stiffness!, damping: pads[0].damping! },
    mallet: mallet && strike ? { mass: mallet.params.mass, stiffness: 10 ** (6 + 4 * mallet.params.hardness) } : undefined,
    padsAt: [onBoard(pads[0].to!.port), onBoard(pads[1].to!.port)],
    stringOnBar: { at: at(tie.to!.port), stiffness: tie.stiffness!, damping: tie.damping ?? 0 },
    ...(contact ? { touchBar: { at: at(contact.from.port) } } : {}),
  }
  const built = buildStringBarBody(spec, sampleRate)
  return {
    spec,
    built,
    calls: built.calls,
    where: { string: string.id, bar: bar.id, body: box.id, ...(mallet && strike ? { strike: { id: strike.id, contact: built.mallet! } } : {}), fingers: { [string.id]: built.finger, ...(contact ? { [contact.id]: built.barFinger! } : {}) } },
  }
}

/** The Phase 3D.11 reference instrument (`dampable(0.5)`), written as a draft graph, as a user might have assembled it. */
export function referenceDraft(tieAt = 0.2): DraftGraph {
  const length = 0.1994
  return {
    version: 2,
    nextId: 12,
    components: [
      { id: 'c1', type: 'steelString', name: 'String 1', x: 120, y: 200, params: { tension: 73.5, length: 0.65, pluckPosition: 0.8 } },
      { id: 'c2', type: 'metalBar', name: 'Metal bar 1', x: 420, y: 200, material: 'aluminium', params: { length, width: 20, thickness: 5 }, ports: { padA: 0.215, padB: 0.785, tie: tieAt, strike: 0.5, touch: 0.5 } },
      { id: 'c3', type: 'dampedBox', name: 'Damped box body 1', x: 420, y: 380, params: {}, ports: { padB: [BODY.bridgeAt[0] + ((0.785 - 0.215) * length) / BODY.plate.length, BODY.bridgeAt[1]] } },
      { id: 'c4', type: 'mallet', name: 'Mallet 1', x: 420, y: 60, params: { mass: 0.005, hardness: 0.5 } },
    ],
    connections: [
      { id: 'c5', type: 'tie', from: { component: 'c1', port: 'end' }, to: { component: 'c2', port: 'tie' }, stiffness: 1e6, damping: 0 },
      { id: 'c6', type: 'pad', from: { component: 'c2', port: 'padA' }, to: { component: 'c3', port: 'bridge' }, stiffness: 1e6, damping: 5 },
      { id: 'c7', type: 'pad', from: { component: 'c2', port: 'padB' }, to: { component: 'c3', port: 'padB' }, stiffness: 1e6, damping: 5 },
      { id: 'c8', type: 'strike', from: { component: 'c4', port: 'head' }, to: { component: 'c2', port: 'strike' } },
      { id: 'c9', type: 'contact', from: { component: 'c2', port: 'touch' } },
    ],
  }
}

/**
 * A saved instrument of either format. Version 1 is read by the builder's own loader, untouched, and
 * comes back exactly as that loader gives it: nothing of it is reinterpreted. Version 2 is checked as a
 * draft. Anything else is refused.
 */
export function readInstrument(text: string): { version: 1; graph: Graph } | { version: 2; graph: DraftGraph } {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Not a saved instrument: the text is not valid JSON.')
  }
  const version = (data as { version?: unknown } | null)?.version
  if (version === 1) return { version: 1, graph: deserialize(text) }
  if (version !== 2) throw new Error(`This instrument was saved in a format this version does not know (${String(version)}). It has not been changed.`)
  const g = data as DraftGraph
  if (!Array.isArray(g.components) || !Array.isArray(g.connections) || !Number.isInteger(g.nextId)) throw new Error('Not a saved instrument: components, connections or the identifier counter are missing.')
  const issues = validateDraft(g)
  if (issues.length) throw new Error(`This instrument cannot be loaded:\n${issues.map((i) => `- ${i.message}`).join('\n')}`)
  return { version: 2, graph: g }
}
