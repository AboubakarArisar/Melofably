// EXPERIMENTAL (Phase 3D.15). The version 2 instrument graph: what an
// instrument IS, as data. Pure types, tables and small pure functions. No
// audio, no DOM, no engine. Not used by the builder, the application or any
// page: see docs/GRAPH_V2_FOUNDATION.md.
//
// Three things are kept apart on purpose:
//
//   topology   components, the points on them where things attach (ports),
//              and the mechanical connections between ports. Saved.
//   targets    the places where a player may pluck, strike or lay a finger.
//              Saved, as configuration: they say WHERE playing can happen,
//              never that anything is being played.
//   playing    plucks, strokes, a finger going down or up (GestureEvent).
//              Never saved. Nothing in a saved graph says a finger is down.
//
// A pluck, a stroke and a finger apply forces only while they happen, so
// they are not connections of the instrument. A tie, a pad and a bridge are
// parts of it, and are.
import { TYPES } from '../../builder/graph.ts'

export const SCHEMA_VERSION = 2

// ---- Components --------------------------------------------------------------------------------------------

/**
 * 'steelString': the modal string. 'metalBar': a bar. 'dampedBox': the approved body, soundboard and
 * enclosed air together: one component because the validated model has them as one assembly whose plate,
 * cavity and hole are fixed, and nothing between the board and its air is the user's to connect.
 * A support pad is a connection (ConnectionKind 'pad'), not a component: in the validated model it has
 * no motion of its own, only a stiffness and a damping between two points.
 */
export type ComponentType = 'steelString' | 'metalBar' | 'dampedBox'

/** A point on a bar or a string is a fraction of its length (0 to 1); on a board, fractions along and across it. */
export type Place = number | [number, number]

/** A point the user has put on a component. Its `id` never changes; its place and its name may. */
export interface Port {
  id: string
  name: string
  at: Place
}

export interface Component {
  /** Stable for the life of the component; never reused within a graph. */
  id: string
  type: ComponentType
  name: string
  /** Bars only: a key of the type's materials. */
  material?: string
  /** Physical parameters, in the units PARAMS states for each. */
  params: Record<string, number>
  /** Ports the user has placed. A component also has the fixed ports of its type (COMPONENTS[type].fixedPorts). */
  ports: Port[]
  /** Where it is drawn, px. Nothing physical. */
  layout?: { x: number; y: number }
}

export interface ParamSpec {
  key: string
  label: string
  unit: string
  min: number
  max: number
}

/** A parameter of the present builder, by name: the same range and unit, so that the two cannot drift apart. */
const from = (type: keyof typeof TYPES, key: string): ParamSpec => {
  const p = TYPES[type].params.find((spec) => spec.key === key)
  if (!p) throw new Error(`the builder has no ${type}.${key}`)
  return { key, label: p.label, unit: p.unit, min: p.min, max: p.max }
}

export interface ComponentSpec {
  label: string
  params: ParamSpec[]
  materials?: Record<string, { density: number; youngsModulus: number; lossFactor: number }>
  /** Ports every component of this type has, by reserved identifier, and what each is. */
  fixedPorts: Record<string, string>
  /** How many numbers place a port on it: 1 along a line, 2 on a surface. */
  placeDimensions: 1 | 2
  /** The direction every port of it moves in. There is one in this model: perpendicular to the soundboard. */
  axis: 'normal'
}

export const COMPONENTS: Record<ComponentType, ComponentSpec> = {
  steelString: {
    label: 'String',
    params: [from('steelString', 'tension'), from('steelString', 'length')],
    fixedPorts: { end: 'its bridge end, where it is held' },
    placeDimensions: 1,
    axis: 'normal',
  },
  metalBar: {
    label: 'Metal bar',
    params: [from('metalBar', 'length'), from('metalBar', 'width'), from('metalBar', 'thickness')],
    materials: Object.fromEntries(Object.entries(TYPES.metalBar.materials!).map(([key, m]) => [key, { density: m.density, youngsModulus: m.youngsModulus, lossFactor: m.lossFactor }])),
    fixedPorts: {},
    placeDimensions: 1,
    axis: 'normal',
  },
  dampedBox: {
    label: 'Damped box body (soundboard and enclosed air)',
    params: [],
    fixedPorts: { bridge: 'the approved bridge point of the soundboard' },
    placeDimensions: 2,
    axis: 'normal',
  },
}

// ---- Connections: parts of the instrument --------------------------------------------------------------------

export interface PortRef {
  component: string
  port: string
}

/**
 * 'bridge': a string's end standing on the body's bridge point, by the approved bridge (its stiffness is
 *           the approved one and is not a parameter).
 * 'tie':    a string's end held by a point of a bar: a spring, and a damper beside it (which may be zero).
 * 'pad':    a point of a bar standing on a point of the soundboard: a spring and a damper side by side.
 */
export type ConnectionKind = 'bridge' | 'tie' | 'pad'

export interface Connection {
  id: string
  kind: ConnectionKind
  from: PortRef
  to: PortRef
  /** N/m. Owned by the connection. Required by 'tie' and 'pad'; absent on a 'bridge'. */
  stiffness?: number
  /** N s/m. Owned by the connection. Required by 'tie' and 'pad'; absent on a 'bridge'. */
  damping?: number
}

type End = { type: ComponentType; port: 'fixed' | 'placed' | 'any'; id?: string }
export interface ConnectionSpec {
  label: string
  from: End
  to: End
  /** The parameters it must have, each with its unit and the range that has a meaning for the solver. Any other is refused. */
  params: ParamSpec[]
}

const STIFFNESS: ParamSpec = { key: 'stiffness', label: 'Stiffness', unit: 'N/m', min: 1e4, max: 1e8 }
const DAMPING: ParamSpec = { key: 'damping', label: 'Damping', unit: 'N s/m', min: 0, max: 100 }

/** Which ports each kind may join, and nothing else may be joined: there is no general "connect" between ports. */
export const CONNECTIONS: Record<ConnectionKind, ConnectionSpec> = {
  bridge: { label: 'Bridge', from: { type: 'steelString', port: 'fixed', id: 'end' }, to: { type: 'dampedBox', port: 'fixed', id: 'bridge' }, params: [] },
  tie: { label: 'Tie', from: { type: 'steelString', port: 'fixed', id: 'end' }, to: { type: 'metalBar', port: 'placed' }, params: [STIFFNESS, DAMPING] },
  pad: { label: 'Support pad', from: { type: 'metalBar', port: 'placed' }, to: { type: 'dampedBox', port: 'any' }, params: [STIFFNESS, DAMPING] },
}

// ---- Targets: where playing can happen ------------------------------------------------------------------------

/**
 * 'pluck':   a place on a string where a finger plucks it.
 * 'mute':    a place on a string where a finger can be laid to damp it.
 * 'strike':  a place on a bar where a striker lands, and what the striker is (a tool, not a part of the instrument).
 * 'contact': a place on a bar where a finger can be laid to damp it.
 */
export type TargetKind = 'pluck' | 'mute' | 'strike' | 'contact'

export interface Target {
  id: string
  kind: TargetKind
  name: string
  at: PortRef
  /** 'strike' only: the striker's mass, kg, and hardness, 0 (soft felt) to 1 (hard plastic). */
  striker?: { mass: number; hardness: number }
}

export const TARGETS: Record<TargetKind, { label: string; on: ComponentType; held: boolean; striker?: ParamSpec[] }> = {
  pluck: { label: 'Pluck', on: 'steelString', held: false },
  mute: { label: 'Finger on the string', on: 'steelString', held: true },
  strike: { label: 'Strike', on: 'metalBar', held: false, striker: [from('mallet', 'mass'), from('mallet', 'hardness')] },
  contact: { label: 'Finger on the bar', on: 'metalBar', held: true },
}

// ---- Output and the graph ---------------------------------------------------------------------------------------

/**
 * What is heard. One kind exists: the sound pressure a body radiates (its soundboard's motion and its
 * hole's flow), at a point straight in front of it, `distance` metres away. It names the component that
 * radiates; nothing else in the graph makes sound, and there is no audio connection of any kind.
 */
export interface AcousticOutput {
  kind: 'bodyRadiation'
  component: string
  distance: number // m
}
/** The listening distance the radiation model was validated at, m. */
export const LISTENING_DISTANCE = 1

/** About the instrument as a document. Nothing physical, nothing about playing. */
export interface Meta {
  name: string
  notes?: string
}

export interface Graph {
  version: 2
  meta: Meta
  /** The next identifier to give out, so that none is ever reused. */
  nextId: number
  components: Component[]
  connections: Connection[]
  targets: Target[]
  /** null: nothing is heard yet (an instrument being assembled). */
  output: AcousticOutput | null
}

// ---- Playing: never saved ---------------------------------------------------------------------------------------

/**
 * Something a player does, addressed to a target by its identifier. Several may be in flight at once on
 * different targets; each held target (a finger) is down or up on its own. This is not part of a graph
 * and is never written to a file.
 */
export type GestureEvent =
  | { target: string; action: 'pluck'; force: number } // N
  | { target: string; action: 'strike'; speed: number } // m/s
  | { target: string; action: 'touch'; stiffness?: number; damping?: number } // a finger goes down (how hard: N/m, N s/m)
  | { target: string; action: 'release' } // and comes up

const ACTIONS: Record<GestureEvent['action'], TargetKind[]> = { pluck: ['pluck'], strike: ['strike'], touch: ['mute', 'contact'], release: ['mute', 'contact'] }

/** Why a gesture cannot be played on this graph, or null. It reads the graph and changes nothing. */
export function cannotPlay(graph: Graph, event: GestureEvent): string | null {
  const target = graph.targets.find((t) => t.id === event.target)
  if (!target) return `There is no target "${event.target}" on this instrument.`
  if (!ACTIONS[event.action]?.includes(target.kind)) return `Target ${target.id} (${target.name}) is a ${TARGETS[target.kind].label.toLowerCase()}: it cannot be given "${event.action}".`
  const amount = event.action === 'pluck' ? event.force : event.action === 'strike' ? event.speed : 1
  if (!(typeof amount === 'number' && Number.isFinite(amount) && amount > 0)) return `Target ${target.id}: the strength of a ${event.action} must be a positive number.`
  return null
}

// ---- Looking things up ----------------------------------------------------------------------------------------------

export const emptyGraph = (name = 'Untitled instrument'): Graph => ({ version: 2, meta: { name }, nextId: 1, components: [], connections: [], targets: [], output: null })
export const componentOf = (graph: Graph, id: string) => graph.components.find((c) => c.id === id)

/** What a port reference points at: a fixed port of the component's type, a port the user placed, or nothing. */
export function portOf(graph: Graph, ref: PortRef): { component: Component; fixed: boolean; at: Place | null } | null {
  const component = componentOf(graph, ref.component)
  if (!component || !COMPONENTS[component.type]) return null
  if (Object.hasOwn(COMPONENTS[component.type].fixedPorts, ref.port)) return { component, fixed: true, at: null }
  const port = component.ports.find((p) => p.id === ref.port)
  return port ? { component, fixed: false, at: port.at } : null
}

/** Identifiers in a stable order that does not depend on how they were listed: by their letters, then by their number. */
export function byId(a: string, b: string): number {
  const [, pa = a, na = ''] = /^(.*?)(\d*)$/.exec(a) ?? []
  const [, pb = b, nb = ''] = /^(.*?)(\d*)$/.exec(b) ?? []
  return pa < pb ? -1 : pa > pb ? 1 : Number(na || -1) - Number(nb || -1) || (a < b ? -1 : a > b ? 1 : 0)
}
