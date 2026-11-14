// EXPERIMENTAL (Phase 3B). The instrument builder's data: what a user
// assembles on the canvas. Pure data and pure functions; no audio, no DOM.
// How it becomes sound: translate.ts. Design: docs/BUILDER.md.

export type ComponentType = 'mallet' | 'impulse' | 'metalBar' | 'woodBar' | 'steelString' | 'dampedBox'
/** 'strike' joins an exciter to the bar it hits; 'bridge' stands a string on a body; the others join two bars. */
export type ConnectionType = 'strike' | 'spring' | 'damper' | 'springDamper' | 'bridge'

export interface Component {
  /** Stable for the life of the component; never reused within a graph. */
  id: string
  type: ComponentType
  name: string
  /** Position on the canvas, px. No effect on the sound. */
  x: number
  y: number
  /** Bars only: a key of the type's materials. */
  material?: string
  params: Record<string, number>
}

export interface Connection {
  id: string
  type: ConnectionType
  /** Component ids. For 'strike': from = the exciter, to = the bar. */
  from: string
  to: string
  stiffness: number // N/m (spring, springDamper)
  damping: number // N s/m (damper, springDamper)
}

export interface Graph {
  version: 1
  nextId: number
  components: Component[]
  connections: Connection[]
}

export interface ParamSpec {
  key: string
  label: string
  unit: string
  min: number
  max: number
  step: number
  initial: number
  /** Slider moves in equal ratios rather than equal steps. */
  log?: boolean
  /** Can change while sounding. Otherwise a change rebuilds the instrument and its sound restarts. */
  live: boolean
  /** A switch: the value is 0 (off) or 1 (on) and nothing between. */
  toggle?: boolean
  hint: string
}

export interface Material {
  label: string
  density: number // kg/m^3
  youngsModulus: number // GPa
  /** Metal: loss factor of the approved bar's decay law. Wood: loss factor at 1 kHz of the approved wooden bar's. */
  lossFactor: number
}

interface TypeSpec {
  label: string
  /** 'resonator' is a bar. 'string' and 'body' are the experimental string instrument of Phase 3C.3. */
  kind: 'exciter' | 'resonator' | 'string' | 'body'
  description: string
  params: ParamSpec[]
  materials?: Record<string, Material>
}

const position = (key: string, label: string, initial: number, hint: string): ParamSpec => ({ key, label, unit: '', min: 0, max: 1, step: 0.01, initial, live: false, hint })

const barParams = (length: number, width: number, thickness: number, strike: number): ParamSpec[] => [
  { key: 'length', label: 'Length', unit: 'm', min: 0.05, max: 1.5, step: 0.005, initial: length, live: false, hint: 'Longer bars sound lower.' },
  { key: 'width', label: 'Width', unit: 'mm', min: 10, max: 200, step: 1, initial: width, live: false, hint: 'Changes the weight, not the pitch. A heavier bar is harder for a mallet or a neighbour to move.' },
  { key: 'thickness', label: 'Thickness', unit: 'mm', min: 2, max: 40, step: 0.5, initial: thickness, live: false, hint: 'Thicker bars sound higher.' },
  { key: 'damping', label: 'Damping', unit: 'x', min: 0.1, max: 10, step: 0.01, initial: 1, log: true, live: true, hint: "Multiplies the material's own losses. Higher rings for a shorter time." },
  position('strikePosition', 'Strike position', strike, 'Where it is hit and heard: 0 and 1 are the ends, 0.5 the middle.'),
  position('connectionPosition', 'Connection position', 0.1, 'Where springs and dampers attach: 0 and 1 are the ends.'),
]

/** Everything the builder can place, with the limits of every parameter. Values outside a range are rejected, never clamped. */
export const TYPES: Record<ComponentType, TypeSpec> = {
  mallet: {
    label: 'Mallet',
    kind: 'exciter',
    description: 'A weight thrown at a bar. It touches, pushes and bounces off, as a real mallet does.',
    params: [
      { key: 'mass', label: 'Mass', unit: 'kg', min: 0.002, max: 0.5, step: 0.001, initial: 0.02, log: true, live: false, hint: 'A heavier mallet stays on the bar longer and sounds duller and louder.' },
      { key: 'hardness', label: 'Hardness', unit: '', min: 0, max: 1, step: 0.01, initial: 0.5, live: false, hint: '0 is soft felt, 1 is hard plastic. Harder is brighter.' },
      { key: 'velocity', label: 'Strike velocity', unit: 'm/s', min: 0.1, max: 5, step: 0.05, initial: 1.5, live: true, hint: 'How fast it arrives. Faster is louder and a little brighter.' },
    ],
  },
  impulse: {
    label: 'Impulse strike',
    kind: 'exciter',
    description: 'A brief push of a fixed shape, as the four built-in instruments use. Cheaper than a mallet; it does not feel the bar move.',
    params: [
      { key: 'velocity', label: 'Strike velocity', unit: '', min: 0.05, max: 1, step: 0.01, initial: 0.8, live: true, hint: 'Strength of the push, 0 to 1.' },
      { key: 'hardness', label: 'Hardness', unit: '', min: 0, max: 1, step: 0.01, initial: 0.6, live: true, hint: 'Harder makes the push shorter, which is brighter.' },
    ],
  },
  metalBar: {
    label: 'Metal bar',
    kind: 'resonator',
    description: 'A free bar of metal, as in a glockenspiel or vibraphone.',
    params: barParams(0.3, 40, 10, 0.35),
    materials: {
      aluminium: { label: 'Aluminium', density: 2700, youngsModulus: 70, lossFactor: 0.001 },
      steel: { label: 'Steel', density: 7850, youngsModulus: 200, lossFactor: 0.0005 },
      brass: { label: 'Brass', density: 8500, youngsModulus: 100, lossFactor: 0.001 },
      bronze: { label: 'Bronze', density: 8800, youngsModulus: 110, lossFactor: 0.0007 },
    },
  },
  woodBar: {
    label: 'Wooden bar',
    kind: 'resonator',
    description: 'A free bar of wood, as in a xylophone or marimba (without the tube underneath).',
    params: barParams(0.38, 50, 19, 0.45),
    materials: {
      rosewood: { label: 'Rosewood', density: 950, youngsModulus: 18, lossFactor: 0.006 },
      padauk: { label: 'Padauk', density: 750, youngsModulus: 12.5, lossFactor: 0.008 },
      maple: { label: 'Maple', density: 700, youngsModulus: 12, lossFactor: 0.012 },
      spruce: { label: 'Spruce', density: 450, youngsModulus: 10, lossFactor: 0.015 },
    },
  },
  // Ranges keep all 100 of the string's modes below the highest playable frequency at 44.1 kHz and above.
  steelString: {
    label: 'String',
    kind: 'string',
    description: 'Experimental. A steel string, 3.6 grams a metre, stretched between a fixed end and a bridge. On its own it moves almost no air: it is heard through the body its bridge stands on.',
    params: [
      { key: 'tension', label: 'Tension', unit: 'N', min: 30, max: 120, step: 0.5, initial: 73.5, live: true, hint: 'Tighter is higher: pitch goes as the square root of the tension. It changes while the string rings, as turning a tuning peg does.' },
      { key: 'length', label: 'Length', unit: 'm', min: 0.5, max: 0.8, step: 0.005, initial: 0.65, live: false, hint: 'Longer is lower.' },
      { key: 'pluckPosition', label: 'Pluck position', unit: '', min: 0.05, max: 0.95, step: 0.01, initial: 0.8, live: true, hint: 'Where the finger plucks: 0 is the fixed end, 1 the bridge. Nearer the bridge is brighter. It applies from the next pluck.' },
      { key: 'pluckStrength', label: 'Pluck strength', unit: 'N', min: 0.2, max: 8, step: 0.1, initial: 2, live: true, hint: 'How hard the finger pulls before it lets go. Twice the force is twice the sound pressure. It applies from the next pluck.' },
      { key: 'pluckSoftness', label: 'Pluck softness', unit: '', min: 0, max: 1, step: 0.01, initial: 0.3, live: true, hint: 'How the finger lets go: 0 is a nail or a pick, sharp and bright; 1 is soft flesh, which rounds off the high overtones. 0.3 is the approved pluck. It applies from the next pluck.' },
      { key: 'retrigger', label: 'Touch before plucking', unit: '', min: 0, max: 1, step: 1, initial: 0, live: true, toggle: true, hint: 'Off: a pluck adds to whatever the string is already doing. On: the finger first rests on the string for 30 ms, which damps what it was doing, and plucks as it leaves, so that a repeated note starts the same way each time.' },
    ],
  },
  dampedBox: {
    label: 'Damped box body',
    kind: 'body',
    description: 'Experimental. A spruce soundboard on a closed box of air with a screened hole: the body validated in Phase 3C.2.3. Its size, bridge position and hole are fixed in this version.',
    params: [],
  },
}

export const CONNECTION_LABELS: Record<ConnectionType, string> = {
  strike: 'Strikes',
  spring: 'Spring',
  damper: 'Damper',
  springDamper: 'Spring and damper',
  bridge: 'Bridge',
}

/** Stiffness of a bridge, N/m: fixed, the value the string and body were validated with. */
export const BRIDGE_STIFFNESS = 1e6

/** Limits of a connection's own values. */
export const CONNECTION_PARAMS: Record<'stiffness' | 'damping', ParamSpec> = {
  stiffness: { key: 'stiffness', label: 'Stiffness', unit: 'N/m', min: 100, max: 1e8, step: 1, initial: 4e5, log: true, live: true, hint: 'How hard the spring pulls the two bars together. Stiffer makes them act more like one object.' },
  damping: { key: 'damping', label: 'Damping', unit: 'N s/m', min: 0, max: 100, step: 0.1, initial: 1, live: true, hint: 'Friction between the two bars. It takes energy out of both.' },
}

/** What the physics engine has room for (assembly/engine.ts). */
export const CAPACITY = { resonators: 128, connections: 32 }

export const isResonator = (c: Component) => TYPES[c.type].kind === 'resonator'
export const isExciter = (c: Component) => TYPES[c.type].kind === 'exciter'
export const isString = (c: Component) => TYPES[c.type].kind === 'string'
export const isBody = (c: Component) => TYPES[c.type].kind === 'body'
/** Part of the experimental string instrument, which cannot yet share a canvas with bars. */
const isStringPart = (c: Component) => isString(c) || isBody(c)
/** Solver connections a builder connection takes: a spring and damper are solved as two. */
export const engineConnections = (c: Connection) => (c.type === 'springDamper' ? 2 : 1)

export const emptyGraph = (): Graph => ({ version: 1, nextId: 1, components: [], connections: [] })
export const component = (graph: Graph, id: string) => graph.components.find((c) => c.id === id)

// ---- Validation -------------------------------------------------------------------

export interface Issue {
  message: string
  /** The component or connection it concerns, if any. */
  id?: string
}

function checkNumber(issues: Issue[], id: string, who: string, spec: ParamSpec, value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) issues.push({ id, message: `${who}: ${spec.label} must be a number.` })
  else if (value < spec.min || value > spec.max) issues.push({ id, message: `${who}: ${spec.label} must be between ${spec.min} and ${spec.max}${spec.unit ? ` ${spec.unit}` : ''} (it is ${value}).` })
  else if (spec.toggle && value !== 0 && value !== 1) issues.push({ id, message: `${who}: ${spec.label} is either off (0) or on (1) (it is ${value}).` })
}

/** Why `from` and `to` cannot be joined (ignoring what is already connected), or null if they can. */
function incompatible(a: Component | undefined, b: Component | undefined): string | null {
  if (!a || !b) return 'One end of the connection does not exist.'
  if (a.id === b.id) return 'A component cannot be connected to itself.'
  if (isExciter(a) && isExciter(b)) return 'Two exciters cannot be connected: attach each one to a bar.'
  if (isStringPart(a) || isStringPart(b)) {
    if ((isString(a) && isBody(b)) || (isBody(a) && isString(b))) return null
    if (isStringAndMetalBar(a, b)) return null
    return 'A string is joined to a damped box body by its bridge, or to one metal bar by a spring. Nothing else can be attached to a string or a body in this version.'
  }
  return null
}

/** The one hybrid this version allows (Phase 3D.2): a string and a metal bar, in either order. */
const isStringAndMetalBar = (a: Component, b: Component) => (isString(a) && b.type === 'metalBar') || (a.type === 'metalBar' && isString(b))

/**
 * Whether the parts that are not a string or a body are ones a string may
 * share an instrument with: at most one metal bar and at most one mallet.
 */
const besideAString = (types: ComponentType[]) => types.every((t) => t === 'metalBar' || t === 'mallet') && types.filter((t) => t === 'metalBar').length <= 1 && types.filter((t) => t === 'mallet').length <= 1

/**
 * Whether a new connection between two components is allowed, as a reason it
 * is not (to show the user) or null. The order of the two does not matter.
 */
export function cannotConnect(graph: Graph, aId: string, bId: string): string | null {
  const [a, b] = [component(graph, aId), component(graph, bId)]
  const reason = incompatible(a, b)
  if (reason) return reason
  const joined = graph.connections.some((c) => (c.from === aId && c.to === bId) || (c.from === bId && c.to === aId))
  if (joined) return 'These two are already connected. Select the connection to change it.'
  const exciter = isExciter(a!) ? a! : isExciter(b!) ? b! : null
  if (exciter && graph.connections.some((c) => c.type === 'strike' && c.from === exciter.id)) return `${exciter.name} already strikes a bar. Remove that connection first, or add another exciter.`
  const used = graph.connections.reduce((n, c) => n + engineConnections(c), 0)
  if (used + (exciter ? 1 : 2) > CAPACITY.connections) return `The instrument is full: the physics engine solves at most ${CAPACITY.connections} connections at once.`
  return null
}

/**
 * Why a component of this type cannot be added, or null if it can. A string
 * makes one of two instruments: with a damped box body (and nothing else), or
 * with one metal bar and at most one mallet (Phase 3D.2). Bars without a
 * string are as free as they always were.
 */
export function cannotAdd(graph: Graph, type: ComponentType): string | null {
  const part = (t: ComponentType) => TYPES[t].kind === 'string' || TYPES[t].kind === 'body'
  const others = graph.components.filter((c) => !part(c.type)).map((c) => c.type)
  const [hasString, hasBody] = [graph.components.some(isString), graph.components.some(isBody)]
  if (part(type)) {
    if (graph.components.some((c) => c.type === type)) return `This version supports one ${TYPES[type].label.toLowerCase()} in an instrument.`
    if (type === 'dampedBox' && others.length) return 'A string and its body cannot share an instrument with bars yet. Clear the canvas first, or load the string example.'
    if (type === 'steelString' && !hasBody && !besideAString(others)) return 'A string cannot share an instrument with bars other than one metal bar and its mallet. Clear the canvas first, or load a string example.'
    if (type === 'steelString' && hasBody && others.length) return 'A string and its body cannot share an instrument with bars yet. Clear the canvas first, or load the string example.'
    return null
  }
  if (hasBody) return 'Bars, mallets and impulse strikes cannot be added to a string instrument yet.'
  if (hasString && !besideAString([...others, type])) return 'A string can share an instrument with one metal bar and one mallet, and nothing else, in this version.'
  return null
}

/** Every problem with a graph. An empty list means it can be translated for the engine. */
export function validateGraph(graph: Graph): Issue[] {
  const issues: Issue[] = []
  if (graph.version !== 1) issues.push({ message: `Unknown instrument format version ${String(graph.version)}.` })
  const seen = new Set<string>()
  for (const c of graph.components) {
    const spec = TYPES[c.type]
    if (!spec) {
      issues.push({ id: c.id, message: `Unknown component type "${String(c.type)}".` })
      continue
    }
    if (typeof c.id !== 'string' || c.id === '' || seen.has(c.id)) issues.push({ id: c.id, message: `Component identifiers must be unique and not empty ("${String(c.id)}").` })
    seen.add(c.id)
    for (const p of spec.params) checkNumber(issues, c.id, c.name, p, c.params?.[p.key])
    for (const key of Object.keys(c.params ?? {})) if (!spec.params.some((p) => p.key === key)) issues.push({ id: c.id, message: `${c.name}: unknown property "${key}".` })
    if (spec.materials && !(c.material! in spec.materials)) issues.push({ id: c.id, message: `${c.name}: unknown material "${String(c.material)}".` })
    if (![c.x, c.y].every(Number.isFinite)) issues.push({ id: c.id, message: `${c.name}: its position on the canvas is not a number.` })
  }
  const parts = graph.components.filter((c) => TYPES[c.type] && isStringPart(c))
  if (parts.filter(isString).length > 1) issues.push({ message: 'This version supports one string in an instrument.' })
  if (parts.filter(isBody).length > 1) issues.push({ message: 'This version supports one body in an instrument.' })
  const beside = graph.components.filter((c) => TYPES[c.type] && !isStringPart(c)).map((c) => c.type)
  if (parts.some(isBody) && beside.length) issues.push({ message: 'A string and its body cannot share an instrument with bars, mallets or impulse strikes yet.' })
  else if (parts.length && !besideAString(beside)) issues.push({ message: 'A string can share an instrument with one metal bar and one mallet, and nothing else, in this version.' })
  const strikers = new Set<string>()
  const pairs = new Set<string>()
  let used = 0
  for (const link of graph.connections) {
    const who = `Connection ${link.id}`
    if (typeof link.id !== 'string' || link.id === '' || seen.has(link.id)) issues.push({ id: link.id, message: `Connection identifiers must be unique and not empty ("${String(link.id)}").` })
    seen.add(link.id)
    if (!(link.type in CONNECTION_LABELS)) {
      issues.push({ id: link.id, message: `${who}: unknown connection type "${String(link.type)}".` })
      continue
    }
    const [a, b] = [component(graph, link.from), component(graph, link.to)]
    const reason = incompatible(a, b)
    if (reason) {
      issues.push({ id: link.id, message: `${who}: ${reason}` })
      continue
    }
    if (link.type === 'bridge') {
      if (!isString(a!) || !isBody(b!)) issues.push({ id: link.id, message: `${who}: a bridge goes from a string to a body.` })
    } else if (isStringAndMetalBar(a!, b!)) {
      // The string's end is free until something holds it: the joint needs a spring. A damper may be added to it.
      if (!isString(a!)) issues.push({ id: link.id, message: `${who}: the connection goes from the string to the bar.` })
      if (link.type !== 'spring' && link.type !== 'springDamper') issues.push({ id: link.id, message: `${who}: the end of a string must be held by a spring: choose Spring, or Spring and damper.` })
      else {
        checkNumber(issues, link.id, who, CONNECTION_PARAMS.stiffness, link.stiffness)
        if (link.type === 'springDamper') checkNumber(issues, link.id, who, CONNECTION_PARAMS.damping, link.damping)
      }
    } else if (isStringPart(a!) || isStringPart(b!)) {
      issues.push({ id: link.id, message: `${who}: a string and a body are joined by a bridge, not by a ${CONNECTION_LABELS[link.type].toLowerCase()}.` })
    } else if (link.type === 'strike') {
      if (!isExciter(a!) || !isResonator(b!)) issues.push({ id: link.id, message: `${who}: a strike goes from an exciter to a bar.` })
      if (strikers.has(link.from)) issues.push({ id: link.id, message: `${who}: ${a!.name} already strikes another bar.` })
      strikers.add(link.from)
    } else {
      if (!isResonator(a!) || !isResonator(b!)) issues.push({ id: link.id, message: `${who}: a ${CONNECTION_LABELS[link.type].toLowerCase()} joins two bars. An exciter is attached with a strike.` })
      if (link.type !== 'damper') checkNumber(issues, link.id, who, CONNECTION_PARAMS.stiffness, link.stiffness)
      if (link.type !== 'spring') checkNumber(issues, link.id, who, CONNECTION_PARAMS.damping, link.damping)
    }
    const pair = [link.from, link.to].sort().join('|')
    if (pairs.has(pair)) issues.push({ id: link.id, message: `${who}: these two components are already connected.` })
    pairs.add(pair)
    used += engineConnections(link)
  }
  if (used > CAPACITY.connections) issues.push({ message: `Too many connections: they need ${used} of the physics engine's ${CAPACITY.connections}. A spring and damper together count as two.` })
  if (graph.components.length > CAPACITY.resonators) issues.push({ message: `Too many components: the physics engine has room for ${CAPACITY.resonators}.` })
  return issues
}

// ---- Editing: every function returns a new graph ------------------------------------

export function addComponent(graph: Graph, type: ComponentType, x: number, y: number): { graph: Graph; id: string } {
  const spec = TYPES[type]
  const id = `c${graph.nextId}`
  const sameType = graph.components.filter((c) => c.type === type).length
  const added: Component = {
    id,
    type,
    name: `${spec.label} ${sameType + 1}`,
    x,
    y,
    params: Object.fromEntries(spec.params.map((p) => [p.key, p.initial])),
    ...(spec.materials ? { material: Object.keys(spec.materials)[0] } : {}),
  }
  return { graph: { ...graph, nextId: graph.nextId + 1, components: [...graph.components, added] }, id }
}

/** Removes a component and every connection to it. */
export const removeComponent = (graph: Graph, id: string): Graph => ({
  ...graph,
  components: graph.components.filter((c) => c.id !== id),
  connections: graph.connections.filter((c) => c.from !== id && c.to !== id),
})

const change = (graph: Graph, id: string, edit: (c: Component) => Component): Graph => ({ ...graph, components: graph.components.map((c) => (c.id === id ? edit(c) : c)) })
export const moveComponent = (graph: Graph, id: string, x: number, y: number) => change(graph, id, (c) => ({ ...c, x, y }))
export const setParam = (graph: Graph, id: string, key: string, value: number) => change(graph, id, (c) => ({ ...c, params: { ...c.params, [key]: value } }))
export const setMaterial = (graph: Graph, id: string, material: string) => change(graph, id, (c) => ({ ...c, material }))

/**
 * Joins two components: an exciter and a bar by a strike, two bars by a spring
 * and damper. Throws with the reason if they cannot be joined.
 */
export function connect(graph: Graph, aId: string, bId: string): { graph: Graph; id: string } {
  const reason = cannotConnect(graph, aId, bId)
  if (reason) throw new Error(reason)
  const [a, b] = [component(graph, aId)!, component(graph, bId)!]
  const id = `c${graph.nextId}`
  const strike = isExciter(a) || isExciter(b)
  const [from, to] = isExciter(b) || isString(b) ? [bId, aId] : [aId, bId]
  const added: Connection = isStringAndMetalBar(a, b)
    ? // A spring as stiff as the box's bridge, so that the string keeps its pitch; softer or damped is the user's to try.
      { id, type: 'spring', from, to, stiffness: BRIDGE_STIFFNESS, damping: 0 }
    : isStringPart(a)
      ? { id, type: 'bridge', from, to, stiffness: BRIDGE_STIFFNESS, damping: 0 }
      : { id, type: strike ? 'strike' : 'springDamper', from, to, stiffness: CONNECTION_PARAMS.stiffness.initial, damping: CONNECTION_PARAMS.damping.initial }
  return { graph: { ...graph, nextId: graph.nextId + 1, connections: [...graph.connections, added] }, id }
}

export const removeConnection = (graph: Graph, id: string): Graph => ({ ...graph, connections: graph.connections.filter((c) => c.id !== id) })
export const setConnection = (graph: Graph, id: string, values: Partial<Pick<Connection, 'type' | 'stiffness' | 'damping'>>): Graph => ({
  ...graph,
  connections: graph.connections.map((c) => (c.id === id ? { ...c, ...values } : c)),
})

// ---- Saving and loading ---------------------------------------------------------------

export const serialize = (graph: Graph): string => JSON.stringify(graph)

/** Parses and validates a saved instrument. Throws with every problem found. */
export function deserialize(text: string): Graph {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Not a saved instrument: the text is not valid JSON.')
  }
  const g = data as Graph
  if (typeof g !== 'object' || g === null || !Array.isArray(g.components) || !Array.isArray(g.connections) || !Number.isInteger(g.nextId)) {
    throw new Error('Not a saved instrument: components, connections or the identifier counter are missing.')
  }
  if (![...g.components, ...g.connections].every((item) => typeof item === 'object' && item !== null)) throw new Error('Not a saved instrument: a component or connection is not an object.')
  // An instrument saved before a property existed is given that property's starting value, which is
  // what it had then. (Phase 3D.1 added two to the string.) Nothing that is present is changed.
  g.components = g.components.map((c) => {
    const missing = (TYPES[c.type]?.params ?? []).filter((p) => typeof c.params === 'object' && c.params !== null && !(p.key in c.params))
    return missing.length ? { ...c, params: { ...c.params, ...Object.fromEntries(missing.map((p) => [p.key, p.initial])) } } : c
  })
  const issues = validateGraph(g)
  // New identifiers must not collide with existing ones.
  const taken = [...g.components, ...g.connections].map((item) => Number(String(item.id).slice(1))).filter(Number.isFinite)
  if (taken.some((n) => n >= g.nextId)) issues.push({ message: 'The identifier counter is behind the identifiers in use.' })
  if (issues.length) throw new Error(`This instrument cannot be loaded:\n${issues.map((i) => `- ${i.message}`).join('\n')}`)
  return { version: 1, nextId: g.nextId, components: g.components, connections: g.connections }
}

// ---- Undo and redo ------------------------------------------------------------------------

export interface History {
  past: Graph[]
  present: Graph
  future: Graph[]
  /** What the last edit was and when, so that one drag of a slider is one step. */
  last?: { key: string; time: number }
}

export const startHistory = (present: Graph): History => ({ past: [], present, future: [] })

/** Records an edit. Edits with the same `key` within 0.6 s of each other merge into one undo step. */
export function commit(h: History, next: Graph, key = '', time = 0): History {
  if (next === h.present) return h
  const merge = key !== '' && h.last?.key === key && time - h.last.time < 600
  return { past: merge ? h.past : [...h.past, h.present].slice(-100), present: next, future: [], last: { key, time } }
}
export const undo = (h: History): History => (h.past.length ? { past: h.past.slice(0, -1), present: h.past.at(-1)!, future: [h.present, ...h.future] } : h)
export const redo = (h: History): History => (h.future.length ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h)

// ---- Typing a value, and restoring a saved instrument ---------------------------------------

/**
 * What a typed value means for a property: the number, or why it cannot be
 * used. Text that is not yet a number ("", "-", "1e") is an error, not zero.
 */
export function parseEntry(text: string, spec: ParamSpec): { value: number } | { error: string } {
  const value = text.trim() === '' ? NaN : Number(text)
  const range = `between ${spec.min} and ${spec.max}${spec.unit ? ` ${spec.unit}` : ''}`
  if (!Number.isFinite(value)) return { error: `Enter a number ${range}.` }
  if (value < spec.min || value > spec.max) return { error: `Must be ${range}. The instrument keeps the last valid value.` }
  return { value }
}

/**
 * The instrument saved in the browser, or the reason it could not be used.
 * `null` text means nothing was saved.
 */
export function restore(text: string | null): { graph: Graph | null; problem?: string } {
  if (text === null) return { graph: null }
  try {
    return { graph: deserialize(text) }
  } catch (error) {
    return { graph: null, problem: error instanceof Error ? error.message : String(error) }
  }
}
