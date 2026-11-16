// EXPERIMENTAL (Phase 3D.15). Writing a version 2 graph and reading a saved
// instrument of either version. Pure functions. The builder's own loading
// and saving (src/builder/graph.ts) are not changed and do not use this.
//
// The order in which components, ports, connections and targets are listed
// has NO meaning: identity is the identifier. The canonical form therefore
// lists each in identifier order, with every object's fields in one fixed
// order, so that two graphs that are the same instrument are the same text.
import { deserialize as readVersion1, type Graph as GraphV1 } from '../../builder/graph.ts'
import { byId, SCHEMA_VERSION, type Component, type Connection, type Graph, type Place, type Port, type PortRef, type Target } from './model.ts'
import { describeIssue, errorsOf, INITIAL_POLICY, validate, warningsOf, type Issue, type Policy } from './validate.ts'

/** A number as it is, or the reason it cannot be saved. Nothing is rounded: what was set is what is written. */
function number(x: number, path: string): number {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`Cannot save this instrument: ${path} is ${String(x)}, which is not a number that can be written down.`)
  return Object.is(x, -0) ? 0 : x
}
const place = (at: Place, path: string): Place => (Array.isArray(at) ? [number(at[0], `${path}[0]`), number(at[1], `${path}[1]`)] : number(at, path))
const ref = (r: PortRef): PortRef => ({ component: r.component, port: r.port })

/**
 * The same instrument in canonical form: a new object holding only what a saved instrument holds, every
 * list in identifier order, every object's fields in a fixed order. Anything else that was on the graph
 * (a field this version does not know, any state of playing) is not carried over. Physical values are
 * copied exactly. Throws if a number is not finite.
 */
export function canonical(graph: Graph): Graph {
  const port = (p: Port, path: string): Port => ({ id: p.id, name: p.name, at: place(p.at, `${path}.at`) })
  const component = (c: Component): Component => ({
    id: c.id,
    type: c.type,
    name: c.name,
    ...(c.material !== undefined ? { material: c.material } : {}),
    params: Object.fromEntries(Object.keys(c.params).sort().map((key) => [key, number(c.params[key], `${c.id}.params.${key}`)])),
    ports: [...c.ports].sort((a, b) => byId(a.id, b.id)).map((p) => port(p, `${c.id}.ports.${p.id}`)),
    ...(c.layout ? { layout: { x: number(c.layout.x, `${c.id}.layout.x`), y: number(c.layout.y, `${c.id}.layout.y`) } } : {}),
  })
  const connection = (c: Connection): Connection => ({
    id: c.id,
    kind: c.kind,
    from: ref(c.from),
    to: ref(c.to),
    ...(c.stiffness !== undefined ? { stiffness: number(c.stiffness, `${c.id}.stiffness`) } : {}),
    ...(c.damping !== undefined ? { damping: number(c.damping, `${c.id}.damping`) } : {}),
  })
  const target = (t: Target): Target => ({
    id: t.id,
    kind: t.kind,
    name: t.name,
    at: ref(t.at),
    ...(t.striker ? { striker: { mass: number(t.striker.mass, `${t.id}.striker.mass`), hardness: number(t.striker.hardness, `${t.id}.striker.hardness`) } } : {}),
  })
  const sorted = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => byId(a.id, b.id))
  return {
    version: SCHEMA_VERSION,
    meta: { name: graph.meta.name, ...(graph.meta.notes !== undefined ? { notes: graph.meta.notes } : {}) },
    nextId: graph.nextId,
    components: sorted(graph.components).map(component),
    connections: sorted(graph.connections).map(connection),
    targets: sorted(graph.targets).map(target),
    output: graph.output ? { kind: graph.output.kind, component: graph.output.component, distance: number(graph.output.distance, 'output.distance') } : null,
  }
}

/** The instrument as text: the canonical form, indented, ending in a newline. Deterministic. */
export const serialize = (graph: Graph): string => `${JSON.stringify(canonical(graph), null, 2)}\n`

/** Whether two graphs are the same instrument, whatever order their parts are listed in. */
export const sameInstrument = (a: Graph, b: Graph) => serialize(a) === serialize(b)

// ---- Reading ----------------------------------------------------------------------------------------------------------

const FIELDS = {
  graph: ['version', 'meta', 'nextId', 'components', 'connections', 'targets', 'output'],
  meta: ['name', 'notes'],
  component: ['id', 'type', 'name', 'material', 'params', 'ports', 'layout'],
  port: ['id', 'name', 'at'],
  layout: ['x', 'y'],
  connection: ['id', 'kind', 'from', 'to', 'stiffness', 'damping'],
  ref: ['component', 'port'],
  target: ['id', 'kind', 'name', 'at', 'striker'],
  striker: ['mass', 'hardness'],
  output: ['kind', 'component', 'distance'],
}
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** Every field a version 2 file has that this version does not know, by where it is. A saved instrument holds nothing else: in particular, no state of playing. */
function unknownFields(data: Record<string, unknown>): string[] {
  const found: string[] = []
  const look = (x: unknown, kind: keyof typeof FIELDS, path: string) => {
    if (!isObject(x)) return
    for (const key of Object.keys(x)) if (!FIELDS[kind].includes(key)) found.push(`${path}${key}`)
  }
  const each = (list: unknown, visit: (item: Record<string, unknown>, path: string) => void, name: string) => {
    if (Array.isArray(list)) list.forEach((item, i) => isObject(item) && visit(item, `${name}[${typeof item.id === 'string' ? item.id : i}].`))
  }
  look(data, 'graph', '')
  look(data.meta, 'meta', 'meta.')
  look(data.output, 'output', 'output.')
  each(data.components, (c, path) => {
    look(c, 'component', path)
    look(c.layout, 'layout', `${path}layout.`)
    each(c.ports, (p, inner) => look(p, 'port', inner), `${path}ports`)
  }, 'components')
  each(data.connections, (c, path) => {
    look(c, 'connection', path)
    look(c.from, 'ref', `${path}from.`)
    look(c.to, 'ref', `${path}to.`)
  }, 'connections')
  each(data.targets, (t, path) => {
    look(t, 'target', path)
    look(t.at, 'ref', `${path}at.`)
    look(t.striker, 'striker', `${path}striker.`)
  }, 'targets')
  return found
}

const refusal = (issues: Issue[]) => `This instrument cannot be loaded:\n${issues.map((i) => `- ${describeIssue(i)}`).join('\n')}`

/**
 * A version 2 instrument from already-parsed data: refused if it carries a field this version does not
 * know, or if any tier of validation finds an error. What comes back is the canonical form, with the
 * warnings (which do not stop it loading).
 */
export function readVersion2(data: unknown, policy: Policy = INITIAL_POLICY): { graph: Graph; warnings: Issue[] } {
  if (!isObject(data)) throw new Error('Not a saved instrument: it is not an object.')
  const extra = unknownFields(data)
  if (extra.length) throw new Error(`This instrument cannot be loaded: it has ${extra.length === 1 ? 'a field' : 'fields'} this version does not know (${extra.join(', ')}). Nothing has been left out or guessed at.`)
  const issues = validate(data as unknown as Graph, policy)
  if (errorsOf(issues).length) throw new Error(refusal(errorsOf(issues)))
  return { graph: canonical(data as unknown as Graph), warnings: warningsOf(issues) }
}

export type Read = { version: 1; graph: GraphV1 } | { version: 2; graph: Graph; warnings: Issue[] }

/**
 * A saved instrument of either version.
 *
 * Version 1 is read by the builder's own loader, called as it is: it comes back exactly as the builder
 * reads it, and is not converted, renamed or reinterpreted. Version 2 is read by its own rules. A newer
 * version, or no version, is refused in words. The text is never changed.
 */
export function readInstrument(text: string, policy: Policy = INITIAL_POLICY): Read {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    throw new Error(`Not a saved instrument: the text is not valid JSON (${error instanceof Error ? error.message : String(error)}).`, { cause: error })
  }
  if (!isObject(data)) throw new Error('Not a saved instrument: it is not an object.')
  const version = data.version
  if (version === 1) return { version: 1, graph: readVersion1(text) }
  if (version === SCHEMA_VERSION) return { version: 2, ...readVersion2(data, policy) }
  if (typeof version === 'number' && version > SCHEMA_VERSION) throw new Error(`This instrument was saved by a newer version of SonicMatter (format ${version}; this one reads formats 1 and ${SCHEMA_VERSION}). It has not been changed.`)
  throw new Error(`Not a saved instrument this version can read: its format version is ${JSON.stringify(version) ?? 'missing'} (this one reads formats 1 and ${SCHEMA_VERSION}).`)
}
