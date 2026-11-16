// EXPERIMENTAL (Phase 3D.15). Checking a version 2 graph, in four tiers
// that answer four different questions:
//
//   structure  is it a graph at all: do its references resolve, and are its
//              connections between things that may be connected?
//   physics    could the thing exist, and is it likely to be an instrument?
//   numerics   are its numbers ones the solver has a meaning for?
//   budget     is it within what has been run in real time?
//
// Each issue says which tier it is, whether it is an error (the graph must
// not be compiled) or a warning (it may be, and the user should know), and
// which component, port, connection or target it concerns. Pure functions;
// nothing here builds or plays anything. docs/GRAPH_V2_FOUNDATION.md.
import { barModeFrequencies } from '../../audio/engine/physics.ts'
import { plateModes } from '../string/soundboard.ts'
import { BODY, STRING_DENSITY, STRING_MODES } from '../string/stringBody.ts'
import { COMPONENTS, CONNECTIONS, LISTENING_DISTANCE, portOf, TARGETS, type Component, type Connection, type Graph, type ParamSpec, type Place, type PortRef } from './model.ts'

export type Tier = 'structure' | 'physics' | 'numerics' | 'budget'
export interface Issue {
  tier: Tier
  severity: 'error' | 'warning'
  /** A short fixed name for the rule, for tests and for telling issues apart. */
  code: string
  message: string
  component?: string
  port?: string
  connection?: string
  target?: string
}

/** What the physics engine has room for (assembly/engine.ts). A fact about the engine, not a recommendation. */
export const ENGINE_CAPACITY = { resonators: 128, solverConnections: 32, modes: 16384 }

/**
 * The initial integration budget of Phase 3D.14: what has actually been run in real time, with one step
 * of margin. It is deliberately far inside ENGINE_CAPACITY. It is a statement of what has been tried on
 * one machine, not a guarantee that anything within it is safe in real time.
 */
export const INITIAL_BUDGET = { strings: 1, bars: 1, bodies: 1, solverConnections: 12, fingerContacts: 4, modes: 200 }

export interface Policy {
  /** The rate the estimates are made for, Hz: how many modes fall below the highest playable frequency depends on it. */
  sampleRate: number
  budget: typeof INITIAL_BUDGET
  /** Whether a graph over the budget (but within the engine) is refused or only warned about. */
  overBudget: 'error' | 'warning'
  engine: typeof ENGINE_CAPACITY
}
export const INITIAL_POLICY: Policy = { sampleRate: 48000, budget: INITIAL_BUDGET, overBudget: 'error', engine: ENGINE_CAPACITY }

/** Modes above this fraction of the sample rate are left out of every model, as in the approved instruments. */
const HIGHEST_MODE = 0.45
/** Where the lowest bending mode of a free bar does not move, as fractions of its length. */
const NOTE_NODES = [0.224, 0.776]
const ID = /^[A-Za-z][A-Za-z0-9_-]*$/

const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const nearestNode = (xi: number) => Math.min(...NOTE_NODES.map((node) => Math.abs(xi - node)))
const metres = (at: [number, number]) => [at[0] * BODY.plate.length, at[1] * BODY.plate.width] as const
const onBoard = (graph: Graph, ref: PortRef): [number, number] => {
  const at = portOf(graph, ref)!.at
  return at === null ? [BODY.bridgeAt[0], BODY.bridgeAt[1]] : (at as [number, number])
}
const barMass = (bar: Component) => COMPONENTS.metalBar.materials![bar.material!].density * bar.params.length * (bar.params.width / 1000) * (bar.params.thickness / 1000)
const bendingBelow = (bar: Component, sampleRate: number) => barModeFrequencies({ length: bar.params.length, thickness: bar.params.thickness, ...COMPONENTS.metalBar.materials![bar.material!] }).filter((f) => f < HIGHEST_MODE * sampleRate)

// ---- Tier A: structure ---------------------------------------------------------------------------------------------

export function checkStructure(graph: Graph): Issue[] {
  const issues: Issue[] = []
  const say = (code: string, message: string, where: Partial<Issue> = {}) => void issues.push({ tier: 'structure', severity: 'error', code, message, ...where })
  if (!isObject(graph)) return [{ tier: 'structure', severity: 'error', code: 'not-a-graph', message: 'Not an instrument: it is not an object.' }]
  if (graph.version !== 2) say('version', `This is not a version 2 instrument (its version is ${JSON.stringify(graph.version)}).`)
  if (!isObject(graph.meta) || typeof graph.meta.name !== 'string') say('meta', 'The instrument has no name (meta.name).')
  if (!Number.isInteger(graph.nextId) || graph.nextId < 1) say('next-id', 'The identifier counter (nextId) is missing or is not a positive whole number.')
  for (const list of ['components', 'connections', 'targets'] as const) if (!Array.isArray(graph[list])) say('missing-list', `The instrument has no list of ${list}.`)
  if (issues.length) return issues

  // Identities: one namespace for components, connections and targets, so that an identifier means one thing.
  const seen = new Map<string, string>()
  const claim = (id: unknown, what: string, where: Partial<Issue>) => {
    if (typeof id !== 'string' || !ID.test(id)) return say('bad-identifier', `A ${what} has an identifier that cannot be used (${JSON.stringify(id)}): letters, digits, "-" and "_", starting with a letter.`, where)
    if (seen.has(id)) say('duplicate-identifier', `The identifier "${id}" is used twice: by a ${seen.get(id)} and by a ${what}.`, where)
    seen.set(id, what)
    const number = /(\d+)$/.exec(id)
    if (number && Number(number[1]) >= graph.nextId) say('next-id-behind', `The identifier counter (${graph.nextId}) is behind the identifier "${id}": a new part could be given a name already in use.`, where)
  }

  for (const c of graph.components) {
    if (!isObject(c)) {
      say('not-an-object', 'A component is not an object.')
      continue
    }
    const where = { component: c.id }
    claim(c.id, 'component', where)
    const spec = COMPONENTS[c.type]
    if (!spec) {
      say('unknown-component-type', `Component ${String(c.id)}: unknown component type ${JSON.stringify(c.type)}. It has not been left out or guessed at.`, where)
      continue
    }
    if (typeof c.name !== 'string') say('name', `Component ${c.id}: it has no name.`, where)
    if (!isObject(c.params)) say('params', `Component ${c.id}: its parameters are missing.`, where)
    else {
      for (const p of spec.params) if (!(p.key in c.params)) say('missing-parameter', `${c.name} (${c.id}): ${p.label} (${p.key}, ${p.unit}) is missing.`, where)
      for (const key of Object.keys(c.params)) if (!spec.params.some((p) => p.key === key)) say('unknown-parameter', `${c.name} (${c.id}): unknown parameter "${key}".`, where)
    }
    if (spec.materials ? !(typeof c.material === 'string' && Object.hasOwn(spec.materials, c.material)) : c.material !== undefined) say('material', spec.materials ? `${c.name} (${c.id}): unknown material ${JSON.stringify(c.material)}.` : `${c.name} (${c.id}): a ${spec.label.toLowerCase()} has no material.`, where)
    if (!Array.isArray(c.ports)) {
      say('ports', `${c.name} (${c.id}): its list of ports is missing.`, where)
      continue
    }
    const ports = new Set<string>()
    for (const port of c.ports) {
      const at = { ...where, port: isObject(port) ? (port.id as string) : undefined }
      if (!isObject(port) || typeof port.id !== 'string' || !ID.test(port.id)) {
        say('bad-identifier', `${c.name} (${c.id}): a port has an identifier that cannot be used.`, at)
        continue
      }
      if (Object.hasOwn(spec.fixedPorts, port.id)) say('reserved-port', `${c.name} (${c.id}): "${port.id}" is a port every ${spec.label.toLowerCase()} has (${spec.fixedPorts[port.id]}); it cannot be placed again.`, at)
      if (ports.has(port.id)) say('duplicate-port', `${c.name} (${c.id}): it has two ports called "${port.id}".`, at)
      ports.add(port.id)
      if (typeof port.name !== 'string') say('name', `${c.name} (${c.id}): port "${port.id}" has no name.`, at)
      const numbers = Array.isArray(port.at) ? port.at : [port.at]
      if (numbers.length !== spec.placeDimensions || (spec.placeDimensions === 2) !== Array.isArray(port.at) || !numbers.every((v) => typeof v === 'number')) {
        say('port-place', `${c.name} (${c.id}): port "${port.id}" needs ${spec.placeDimensions === 1 ? 'one number (a fraction of its length)' : 'two numbers (fractions along and across the board)'} to say where it is.`, at)
      }
    }
  }

  const resolve = (ref: unknown, what: string, where: Partial<Issue>) => {
    if (!isObject(ref) || typeof ref.component !== 'string' || typeof ref.port !== 'string') return void say('bad-reference', `${what}: it does not say which component and which port.`, where)
    const component = graph.components.find((c) => isObject(c) && c.id === ref.component)
    if (!component) return void say('missing-component', `${what}: there is no component "${ref.component}".`, { ...where, component: ref.component })
    if (!COMPONENTS[component.type]) return null // already reported as an unknown type
    const found = Array.isArray(component.ports) ? portOf(graph, ref as unknown as PortRef) : null
    if (!found) return void say('missing-port', `${what}: ${component.name} (${component.id}) has no port "${ref.port}".`, { ...where, component: component.id, port: ref.port })
    return found
  }

  const pairs = new Set<string>()
  const held = new Map<string, string>()
  for (const link of graph.connections) {
    if (!isObject(link)) {
      say('not-an-object', 'A connection is not an object.')
      continue
    }
    const where = { connection: link.id }
    claim(link.id, 'connection', where)
    const spec = CONNECTIONS[link.kind]
    if (!spec) {
      say('unknown-connection-kind', `Connection ${String(link.id)}: unknown kind of connection ${JSON.stringify(link.kind)}. There is no general connection between ports: only ${Object.keys(CONNECTIONS).join(', ')}.`, where)
      continue
    }
    const ends = (['from', 'to'] as const).map((side) => {
      const found = resolve(link[side], `Connection ${link.id} (${spec.label.toLowerCase()}), its "${side}" end`, where)
      const want = spec[side]
      if (found && (found.component.type !== want.type || (want.port === 'fixed' && !found.fixed) || (want.port === 'placed' && found.fixed) || (want.id && link[side].port !== want.id))) {
        say('incompatible-end', `Connection ${link.id}: a ${spec.label.toLowerCase()} goes from ${describeEnd(spec.from)} to ${describeEnd(spec.to)}; its "${side}" end is "${link[side].port}" of ${found.component.name} (${found.component.id}), a ${COMPONENTS[found.component.type].label.toLowerCase()}.`, { ...where, component: found.component.id, port: link[side].port })
      }
      return found
    })
    if (ends[0] && ends[1] && ends[0].component.id === ends[1].component.id) say('self-connection', `Connection ${link.id}: both its ends are on ${ends[0].component.name} (${ends[0].component.id}).`, where)
    for (const p of spec.params) if (!(p.key in link)) say('missing-parameter', `Connection ${link.id}: a ${spec.label.toLowerCase()} needs ${p.label.toLowerCase()} (${p.key}, ${p.unit}).`, where)
    for (const key of ['stiffness', 'damping'] as const) if (key in link && !spec.params.some((p) => p.key === key)) say('unexpected-parameter', `Connection ${link.id}: a ${spec.label.toLowerCase()} has no ${key} of its own to set.`, where)
    if (ends[0] && ends[1]) {
      const pair = `${link.from.component}.${link.from.port}>${link.to.component}.${link.to.port}`
      if (pairs.has(pair)) say('duplicate-connection', `Connection ${link.id}: these two ports are already connected.`, where)
      pairs.add(pair)
      // A string's end is one point: it is held by one thing.
      if (ends[0].component.type === 'steelString') {
        if (held.has(link.from.component)) say('string-end-held-twice', `Connection ${link.id}: the end of ${ends[0].component.name} (${link.from.component}) is already held by connection ${held.get(link.from.component)}. It can be held by one bridge or one tie.`, { ...where, component: link.from.component, port: 'end' })
        held.set(link.from.component, link.id)
      }
    }
  }

  for (const target of graph.targets) {
    if (!isObject(target)) {
      say('not-an-object', 'A target is not an object.')
      continue
    }
    const where = { target: target.id }
    claim(target.id, 'target', where)
    const spec = TARGETS[target.kind]
    if (!spec) {
      say('unknown-target-kind', `Target ${String(target.id)}: unknown kind of target ${JSON.stringify(target.kind)}.`, where)
      continue
    }
    if (typeof target.name !== 'string') say('name', `Target ${target.id}: it has no name.`, where)
    const found = resolve(target.at, `Target ${target.id} (${spec.label.toLowerCase()})`, where)
    if (found && (found.component.type !== spec.on || found.fixed)) say('incompatible-target', `Target ${target.id}: a ${spec.label.toLowerCase()} is at a port placed on a ${COMPONENTS[spec.on].label.toLowerCase()}; this one is at "${target.at.port}" of ${found.component.name} (${found.component.id}).`, { ...where, component: found.component.id, port: target.at.port })
    if (spec.striker ? !isObject(target.striker) : target.striker !== undefined) say('striker', spec.striker ? `Target ${target.id}: a strike needs its striker (mass and hardness).` : `Target ${target.id}: a ${spec.label.toLowerCase()} has no striker.`, where)
  }

  if (graph.output !== null) {
    const out = graph.output
    if (!isObject(out) || out.kind !== 'bodyRadiation' || typeof out.component !== 'string') say('output', 'The acoustic output must be a body\'s radiation (kind "bodyRadiation") and name the body.')
    else {
      const body = graph.components.find((c) => isObject(c) && c.id === out.component)
      if (!body) say('output-missing-component', `The acoustic output names a component that does not exist ("${out.component}").`, { component: out.component })
      else if (body.type !== 'dampedBox') say('output-not-a-body', `The acoustic output names ${body.name} (${body.id}), which does not radiate: only a body does.`, { component: body.id })
    }
  }
  return issues
}

const describeEnd = (end: { type: keyof typeof COMPONENTS; port: string; id?: string }) => `${end.id ? `the "${end.id}" port` : end.port === 'placed' ? 'a placed port' : 'a port'} of a ${COMPONENTS[end.type].label.toLowerCase()}`

// ---- Tier C: numerics ------------------------------------------------------------------------------------------------

/** Runs on whatever is well enough formed to be read; it never needs a reference to resolve. */
export function checkNumerics(graph: Graph, policy: Policy = INITIAL_POLICY): Issue[] {
  const issues: Issue[] = []
  const say = (code: string, message: string, where: Partial<Issue> = {}) => void issues.push({ tier: 'numerics', severity: 'error', code, message, ...where })
  const number = (value: unknown, spec: ParamSpec, who: string, where: Partial<Issue>) => {
    if (!isNumber(value)) say('not-a-number', `${who}: ${spec.label} must be a finite number (it is ${String(value)}).`, where)
    else if (value < spec.min || value > spec.max) say('out-of-range', `${who}: ${spec.label} must be between ${spec.min} and ${spec.max}${spec.unit ? ` ${spec.unit}` : ''} (it is ${value}).`, where)
  }
  for (const c of Array.isArray(graph.components) ? graph.components : []) {
    const spec = isObject(c) ? COMPONENTS[c.type] : undefined
    if (!spec) continue
    const who = `${c.name} (${c.id})`
    for (const p of spec.params) if (isObject(c.params) && p.key in c.params) number(c.params[p.key], p, who, { component: c.id })
    for (const port of Array.isArray(c.ports) ? c.ports : []) {
      if (!isObject(port)) continue
      const numbers = (Array.isArray(port.at) ? port.at : [port.at]) as unknown[]
      if (!numbers.every(isNumber)) say('not-a-number', `${who}: the place of port "${port.id}" is not a finite number.`, { component: c.id, port: port.id })
      else if (numbers.some((v) => (v as number) < 0 || (v as number) > 1)) say('port-off-component', `${who}: port "${port.id}" is at ${JSON.stringify(port.at)}, which is not on it (0 and 1 are its edges).`, { component: c.id, port: port.id })
    }
    if (c.type === 'metalBar' && spec.params.every((p) => isNumber(c.params?.[p.key]) && c.params[p.key] > 0) && c.material && spec.materials?.[c.material]) {
      const lowest = barModeFrequencies({ length: c.params.length, thickness: c.params.thickness, ...spec.materials[c.material] })[0]
      if (!(lowest < HIGHEST_MODE * policy.sampleRate)) say('bar-above-playable', `${who}: its lowest note would be ${Math.round(lowest)} Hz, above what can be played at ${policy.sampleRate} Hz (${Math.round(HIGHEST_MODE * policy.sampleRate)} Hz).`, { component: c.id })
    }
  }
  for (const link of Array.isArray(graph.connections) ? graph.connections : []) {
    const spec = isObject(link) ? CONNECTIONS[link.kind] : undefined
    if (!spec) continue
    for (const p of spec.params) if (p.key in link) number(link[p.key as 'stiffness' | 'damping'], p, `Connection ${link.id} (${spec.label.toLowerCase()})`, { connection: link.id })
  }
  for (const target of Array.isArray(graph.targets) ? graph.targets : []) {
    const spec = isObject(target) ? TARGETS[target.kind] : undefined
    if (!spec?.striker || !isObject(target.striker)) continue
    for (const p of spec.striker) number((target.striker as Record<string, unknown>)[p.key], p, `Target ${target.id} (${spec.label.toLowerCase()}), its striker`, { target: target.id })
  }
  if (isObject(graph.output) && graph.output.distance !== LISTENING_DISTANCE) {
    say(isNumber(graph.output.distance) ? 'unsupported-distance' : 'not-a-number', `The acoustic output is heard ${String(graph.output.distance)} m away; the radiation model is validated at ${LISTENING_DISTANCE} m and nowhere else.`, { component: graph.output.component })
  }
  return issues
}

// ---- Tier B: physics -------------------------------------------------------------------------------------------------

/** Needs a structurally valid graph with usable numbers (it follows references and measures distances). */
export function checkPhysics(graph: Graph): Issue[] {
  const issues: Issue[] = []
  const error = (code: string, message: string, where: Partial<Issue> = {}) => void issues.push({ tier: 'physics', severity: 'error', code, message, ...where })
  const warn = (code: string, message: string, where: Partial<Issue> = {}) => void issues.push({ tier: 'physics', severity: 'warning', code, message, ...where })
  const kind = (k: Connection['kind']) => graph.connections.filter((c) => c.kind === k)
  const along = (ref: PortRef) => portOf(graph, ref)!.at as number

  for (const bar of graph.components.filter((c) => c.type === 'metalBar')) {
    const who = `${bar.name} (${bar.id})`
    const pads = kind('pad').filter((p) => p.from.component === bar.id)
    const ties = kind('tie').filter((t) => t.to.component === bar.id)
    const mass = barMass(bar)
    if (mass < 0.005 || mass > 2) warn('unusual-mass', `${who} weighs ${(1000 * mass).toFixed(1)} g. Bars from 5 g to 2 kg have a meaning here; outside that the model has not been tried.`, { component: bar.id })
    if (pads.length === 0 && ties.length === 0) {
      warn('unconnected', `${who} is not connected to anything: it will not be heard.`, { component: bar.id })
      continue
    }
    if (pads.length === 0) error('bar-unsupported', `${who} has a string tied to it and nothing under it: it must stand on two pads.`, { component: bar.id })
    else if (pads.length === 1) error('bar-needs-two-pads', `${who} stands on one pad (${pads[0].id}): it would spin about it. A bar stands on two.`, { component: bar.id, connection: pads[0].id })
    else if (pads.length > 2) error('bar-too-many-pads', `${who} stands on ${pads.length} pads. The validated model has two; a bar on three is held in a way it has no meaning for.`, { component: bar.id })
    else {
      const [a, b] = pads
      if (a.to.component !== b.to.component) error('pads-on-two-bodies', `${who}: its two pads stand on two different bodies.`, { component: bar.id })
      else if (a.from.port === b.from.port || (a.to.component === b.to.component && a.to.port === b.to.port)) error('pads-share-a-point', `${who}: its two pads (${a.id}, ${b.id}) are under the same point of the bar or on the same point of the board.`, { component: bar.id })
      else {
        const [pa, pb] = [metres(onBoard(graph, a.to)), metres(onBoard(graph, b.to))]
        const apart = Math.hypot(pb[0] - pa[0], pb[1] - pa[1])
        const under = Math.abs(along(b.from) - along(a.from)) * bar.params.length
        // A bar does not stretch along its length: its pads are as far apart on the board as they are on the bar.
        if (Math.abs(apart - under) > 0.002) error('pads-would-stretch-bar', `${who}: its pads are ${(1000 * under).toFixed(1)} mm apart on the bar and ${(1000 * apart).toFixed(1)} mm apart on the board. The bar would have to stretch.`, { component: bar.id })
        else if (under > 0) {
          // Where the bar's two ends come to, along the line of its pads, in metres on the board.
          const [first, second] = along(a.from) < along(b.from) ? [a, b] : [b, a]
          const [p0, p1] = [metres(onBoard(graph, first.to)), metres(onBoard(graph, second.to))]
          const per = [(p1[0] - p0[0]) / (along(second.from) - along(first.from)), (p1[1] - p0[1]) / (along(second.from) - along(first.from))]
          const end = (xi: number) => [p0[0] + (xi - along(first.from)) * per[0], p0[1] + (xi - along(first.from)) * per[1]]
          const beyond = Math.max(...[end(0), end(1)].flatMap(([x, y]) => [-x, x - BODY.plate.length, -y, y - BODY.plate.width]))
          if (beyond > 0.1 * bar.params.length) warn('bar-overhangs-board', `${who} reaches ${(1000 * beyond).toFixed(0)} mm beyond the edge of the soundboard.`, { component: bar.id })
        }
      }
      for (const pad of pads) if (nearestNode(along(pad.from)) > 0.1) warn('pad-far-from-node', `${who}: pad ${pad.id} is at ${along(pad.from)} of its length. A bar rings longest held near where its note does not move (0.224 and 0.776); further away the pad damps the note.`, { component: bar.id, connection: pad.id, port: pad.from.port })
    }
    for (const tie of ties) {
      if (nearestNode(along(tie.to)) > 0.075) warn('tie-far-from-node', `${who}: the string is tied at ${along(tie.to)} of its length. That far from where the bar's note does not move (0.224 and 0.776), the string was found to lose its fundamental and drift in pitch.`, { component: bar.id, connection: tie.id, port: tie.to.port })
    }
    for (const target of graph.targets.filter((t) => t.at.component === bar.id)) {
      const xi = along(target.at)
      if (target.kind === 'contact' && nearestNode(xi) < 0.02) warn('contact-on-node', `Target ${target.id} (${target.name}): a finger at ${xi} of ${bar.name} rests where its note does not move, and will hardly damp it.`, { target: target.id, component: bar.id, port: target.at.port })
      if (target.kind === 'strike' && nearestNode(xi) < 0.03) warn('strike-on-node', `Target ${target.id} (${target.name}): struck at ${xi} of its length, ${bar.name} sounds its knock more than its note.`, { target: target.id, component: bar.id, port: target.at.port })
    }
  }

  for (const string of graph.components.filter((c) => c.type === 'steelString')) {
    if (!graph.connections.some((c) => c.from.component === string.id)) warn('string-end-free', `${string.name} (${string.id}): its end is not held by a bridge or a tie. Plucked, it will move and nothing will hear it.`, { component: string.id, port: 'end' })
  }
  if (!graph.targets.some((t) => t.kind === 'pluck' || t.kind === 'strike')) warn('nothing-to-play', 'The instrument has no place to pluck or to strike.')
  if (graph.output === null) warn('no-output', 'The instrument has no acoustic output: nothing will be heard.')
  else if (!graph.connections.some((c) => c.to.component === graph.output!.component)) warn('radiator-disconnected', `Nothing is connected to the body that is heard (${graph.output.component}): it will be silent.`, { component: graph.output.component })
  return issues
}

// ---- Tier D: budget --------------------------------------------------------------------------------------------------

/**
 * What the graph would ask of the engine, counted the way the validated models build it (one solver
 * connection for a tie, a pad, a striker and each finger place; two for a string, its bridge place and
 * its finger; two inside a body). An estimate made from the graph alone: the compiler's own count is the
 * authority, and tests hold the two together for the reference instruments.
 */
export function estimate(graph: Graph, sampleRate = INITIAL_POLICY.sampleRate) {
  const of = (type: Component['type']) => graph.components.filter((c) => c.type === type)
  const [strings, bars, bodies] = [of('steelString'), of('metalBar'), of('dampedBox')]
  const strikes = graph.targets.filter((t) => t.kind === 'strike').length
  const contacts = graph.targets.filter((t) => t.kind === 'contact').length
  const mutes = graph.targets.filter((t) => t.kind === 'mute').length
  const stringModes = (s: Component) => Math.min(STRING_MODES, Math.floor((HIGHEST_MODE * sampleRate * 2 * s.params.length) / Math.sqrt(s.params.tension / STRING_DENSITY) + 0.5))
  const boardModes = bodies.length ? plateModes(BODY.plate, [BODY.bridgeAt], sampleRate, BODY.limit).length : 0
  return {
    strings: strings.length,
    bars: bars.length,
    bodies: bodies.length,
    // Each body is its board, the plug of air in its hole, and the fixed thing a finger rests against.
    resonators: strings.length + bars.length + 3 * bodies.length + strikes,
    modes: strings.reduce((sum, s) => sum + stringModes(s), 0) + bodies.length * (boardModes + 2) + bars.reduce((sum, b) => sum + 2 + bendingBelow(b, sampleRate).length, 0) + strikes,
    solverConnections: 2 * strings.length + 2 * bodies.length + graph.connections.filter((c) => c.kind !== 'bridge').length + strikes + contacts,
    /** Fingers that can be down at once: one per string that can be muted, one per finger place on a bar. */
    fingerContacts: Math.min(mutes, strings.length) + contacts,
  }
}

/** Needs a structurally valid graph with usable numbers. */
export function checkBudget(graph: Graph, policy: Policy = INITIAL_POLICY): Issue[] {
  const issues: Issue[] = []
  const e = estimate(graph, policy.sampleRate)
  const rows: [keyof typeof INITIAL_BUDGET, string][] = [['strings', 'strings'], ['bars', 'metal bars'], ['bodies', 'bodies'], ['solverConnections', 'mechanical connections for the solver'], ['fingerContacts', 'places a finger can be down at once'], ['modes', 'vibration modes']]
  for (const [key, what] of rows) {
    if (e[key] > policy.budget[key]) issues.push({ tier: 'budget', severity: policy.overBudget, code: `over-budget-${key}`, message: `The instrument needs ${e[key]} ${what}; the initial budget is ${policy.budget[key]}. That is what has been run in real time so far, not the engine's limit.` })
  }
  for (const key of ['resonators', 'solverConnections', 'modes'] as const) {
    if (e[key] > policy.engine[key]) issues.push({ tier: 'budget', severity: 'error', code: `over-engine-${key}`, message: `The instrument needs ${e[key]} ${key}; the physics engine has room for ${policy.engine[key]}.` })
  }
  return issues
}

// ---- All four ----------------------------------------------------------------------------------------------------------

/**
 * Every problem with a graph, structure first. Numerics is always checked. Physics and budget follow
 * references and measure things, so they are checked only once structure and numerics have no errors;
 * until then their absence means "not looked at", not "fine".
 */
export function validate(graph: Graph, policy: Policy = INITIAL_POLICY): Issue[] {
  const structure = checkStructure(graph)
  if (structure.some((i) => i.code === 'not-a-graph' || i.code === 'missing-list')) return structure
  const first = [...structure, ...checkNumerics(graph, policy)]
  if (first.some((i) => i.severity === 'error')) return first
  return [...first, ...checkPhysics(graph), ...checkBudget(graph, policy)]
}
export const errorsOf = (issues: Issue[]) => issues.filter((i) => i.severity === 'error')
export const warningsOf = (issues: Issue[]) => issues.filter((i) => i.severity === 'warning')
export const describeIssue = (i: Issue) => `[${i.tier}${i.severity === 'warning' ? ', warning' : ''}] ${i.message}`

// For callers that hold a Place and want metres: along a line of `length` m, or on the approved board.
export const placeInMetres = (at: Place, length?: number): number | readonly [number, number] => (Array.isArray(at) ? metres(at) : at * (length ?? 1))
