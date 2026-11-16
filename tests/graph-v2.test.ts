// Phase 3D.15: the version 2 instrument graph (src/experimental/graph2):
// its model, its four-tier validation, its canonical text, the reader of
// both versions, and the reference fixtures. Pure data: nothing here plays
// a note except the two parity checks at the end, which use the validated
// models and the lab's processor as they are.
import { describe, expect, test } from 'vitest'
import { createHybridWorklet } from '../analysis/hybrid-worklet'
import { EXAMPLES, RADIATION_EXAMPLES, STRING_EXAMPLES } from '../src/builder/examples'
import { deserialize as readV1, serialize as writeV1, TYPES, type Graph as GraphV1 } from '../src/builder/graph'
import { translate } from '../src/builder/translate'
import { describeAssembly } from '../src/experimental/graph2/assembly'
import { hybridFixture, stringOnBodyFixture } from '../src/experimental/graph2/fixtures'
import { canonical, readInstrument, readVersion2, sameInstrument, serialize } from '../src/experimental/graph2/io'
import { byId, cannotPlay, COMPONENTS, CONNECTIONS, emptyGraph, portOf, SCHEMA_VERSION, TARGETS, type Graph } from '../src/experimental/graph2/model'
import { checkBudget, checkNumerics, checkPhysics, checkStructure, ENGINE_CAPACITY, errorsOf, estimate, INITIAL_BUDGET, INITIAL_POLICY, validate, warningsOf, type Issue } from '../src/experimental/graph2/validate'
import { buildStringBarBody, dampable } from '../src/experimental/string/stringBarBody'
import { buildPlayableStringBody, pluckCall, radiation } from '../src/experimental/string/stringBody'
import type { Call } from '../src/experimental/wasm/engine'
import { SR } from './helpers'

const copy = <T>(x: T): T => structuredClone(x)
const edit = (change: (g: Graph) => void, base: Graph = hybridFixture()): Graph => {
  const g = copy(base)
  change(g)
  return g
}
const codes = (issues: Issue[]) => issues.map((i) => `${i.tier}:${i.severity}:${i.code}`)
const first = (g: Graph) => validate(g)[0]
/** A small repeatable random number generator, so that generated cases are the same on every run. */
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const shuffled = <T>(list: T[], next: () => number) => {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
const fixtures: [string, () => Graph][] = [['hybrid tied at 0.20', () => hybridFixture(0.2)], ['hybrid tied at 0.18', () => hybridFixture(0.18)], ['string on its body', stringOnBodyFixture]]

describe('The model', () => {
  test('the three reference instruments are valid version 2 graphs with no issue of any tier', () => {
    for (const [name, make] of fixtures) {
      const g = make()
      expect(g.version).toBe(SCHEMA_VERSION)
      expect(validate(g), name).toEqual([])
    }
    // An empty graph is well formed; it is only told that it is not an instrument yet.
    expect(codes(validate(emptyGraph()))).toEqual(['physics:warning:nothing-to-play', 'physics:warning:no-output'])
  })

  test('the hybrid is three components, three connections and four targets: a pad is a connection, and a pluck, a stroke and a finger are not', () => {
    const g = hybridFixture()
    expect(g.components.map((c) => c.type)).toEqual(['steelString', 'metalBar', 'dampedBox'])
    expect(g.connections.map((c) => c.kind)).toEqual(['tie', 'pad', 'pad'])
    expect(g.targets.map((t) => t.kind)).toEqual(['pluck', 'mute', 'strike', 'contact'])
    // No kind of connection is a way of playing, and there is no general connection.
    expect(Object.keys(CONNECTIONS).sort()).toEqual(['bridge', 'pad', 'tie'])
    expect(Object.keys(TARGETS).sort()).toEqual(['contact', 'mute', 'pluck', 'strike'])
    expect(Object.keys(COMPONENTS).sort()).toEqual(['dampedBox', 'metalBar', 'steelString'])
    // Its parameter ranges and units are the builder's own, by reference, not copies.
    const length = TYPES.metalBar.params.find((p) => p.key === 'length')!
    expect(COMPONENTS.metalBar.params.find((p) => p.key === 'length')).toEqual({ key: 'length', label: length.label, unit: 'm', min: length.min, max: length.max })
    expect(COMPONENTS.steelString.params.map((p) => [p.key, p.unit])).toEqual([['tension', 'N'], ['length', 'm']])
    expect(CONNECTIONS.pad.params.map((p) => [p.key, p.unit, p.min, p.max])).toEqual([['stiffness', 'N/m', 1e4, 1e8], ['damping', 'N s/m', 0, 100]])
    expect(CONNECTIONS.bridge.params).toEqual([]) // the approved bridge has no stiffness of its own to set
  })

  test('one component takes several connections and targets at different ports; a port is found by its identifier, fixed or placed', () => {
    const g = hybridFixture()
    const onBar = [...g.connections.flatMap((c) => [c.from, c.to]), ...g.targets.map((t) => t.at)].filter((r) => r.component === 'c2')
    expect(onBar.map((r) => r.port)).toEqual(['tie', 'pad-a', 'pad-b', 'middle', 'middle'])
    expect(portOf(g, { component: 'c2', port: 'tie' })).toMatchObject({ fixed: false, at: 0.2 })
    expect(portOf(g, { component: 'c1', port: 'end' })).toMatchObject({ fixed: true, at: null })
    expect(portOf(g, { component: 'c3', port: 'bridge' })).toMatchObject({ fixed: true })
    expect(portOf(g, { component: 'c3', port: 'pad-b' })!.at).toEqual([0.08 + (Math.abs(0.785 - 0.215) * 0.1994) / 0.5, 1 / 3])
    expect(portOf(g, { component: 'c2', port: 'nowhere' })).toBeNull()
    expect(portOf(g, { component: 'c99', port: 'tie' })).toBeNull()
    // Two components may each have a port of the same name: a port's identity is within its component.
    expect(portOf(g, { component: 'c2', port: 'pad-b' })!.at).toBe(0.785)
  })

  test('port identities are stable: changing a parameter, a place, a name or the order of things leaves every reference pointing where it did', () => {
    const before = hybridFixture()
    const after = edit((g) => {
      g.components[1].params.length = 0.21
      g.components[1].name = 'Bar'
      g.components[1].ports.reverse()
      g.components[1].ports.find((p) => p.id === 'tie')!.at = 0.19
      g.components[1].ports.find((p) => p.id === 'tie')!.name = 'Where the string is tied'
      g.components.reverse()
    })
    expect(after.connections).toEqual(before.connections)
    expect(after.targets).toEqual(before.targets)
    expect(portOf(after, { component: 'c2', port: 'tie' })!.at).toBe(0.19)
    // No identifier is an index into anything: the canonical text names components and ports only by their identifiers.
    expect(serialize(after)).not.toMatch(/"(index|resonator|engine)"/)
  })

  test('identifiers sort by their letters and then their number, whatever order they were made in', () => {
    expect(['c10', 'c2', 'pad-b', 'c1', 'pad-a', 'a', 'c'].sort(byId)).toEqual(['a', 'c', 'c1', 'c2', 'c10', 'pad-a', 'pad-b'])
  })
})

describe('Playing is not part of the graph', () => {
  test('a gesture addresses a target by its identifier; each finger is its own target; nothing about playing can be saved', () => {
    const g = hybridFixture()
    const before = serialize(g)
    expect(cannotPlay(g, { target: 'c7', action: 'pluck', force: 2 })).toBeNull()
    expect(cannotPlay(g, { target: 'c9', action: 'strike', speed: 1 })).toBeNull()
    // Two fingers, two targets: both may be down at once, and neither names the other.
    expect(cannotPlay(g, { target: 'c8', action: 'touch' })).toBeNull()
    expect(cannotPlay(g, { target: 'c10', action: 'touch', stiffness: 2000, damping: 6 })).toBeNull()
    expect(cannotPlay(g, { target: 'c8', action: 'release' })).toBeNull()
    expect(new Set(g.targets.map((t) => t.id)).size).toBe(4)
    // What cannot be played says why, naming the target.
    expect(cannotPlay(g, { target: 'c7', action: 'strike', speed: 1 })).toMatch(/c7 \(Pluck\) is a pluck/)
    expect(cannotPlay(g, { target: 'c10', action: 'pluck', force: 2 })).toMatch(/c10/)
    expect(cannotPlay(g, { target: 'c4', action: 'touch' })).toMatch(/no target "c4"/) // a connection is not something to play
    expect(cannotPlay(g, { target: 'c7', action: 'pluck', force: Number.NaN })).toMatch(/positive number/)
    // Asking changes nothing.
    expect(serialize(g)).toBe(before)
    // A graph that has picked up state of playing is written without it, and a file that carries any is refused.
    const playing = Object.assign(copy(g), { fingers: { c10: 'down' } })
    Object.assign(playing.targets[3], { down: true, damping: 6 })
    expect(serialize(playing)).toBe(before)
    const file = JSON.parse(before)
    file.targets[3].down = true
    expect(() => readInstrument(JSON.stringify(file))).toThrow(/a field this version does not know \(targets\[c10\]\.down\)/)
  })

  test('a strike or a finger written as a connection is refused: they are not parts of the instrument', () => {
    for (const kind of ['strike', 'contact', 'spring', 'springDamper']) {
      const g = edit((x) => void x.connections.push({ id: 'c11', kind: kind as never, from: { component: 'c2', port: 'middle' }, to: { component: 'c3', port: 'bridge' } }))
      g.nextId = 12
      expect(first(g), kind).toMatchObject({ tier: 'structure', code: 'unknown-connection-kind', connection: 'c11' })
      expect(first(g).message).toMatch(/no general connection between ports/)
    }
  })
})

describe('Tier A: structure', () => {
  const cases: [string, (g: Graph) => void, string, Partial<Issue>][] = [
    ['a repeated identifier', (g) => void (g.connections[1].id = 'c4'), 'duplicate-identifier', { connection: 'c4' }],
    ['a component and a target with one identifier', (g) => void (g.targets[0].id = 'c2'), 'duplicate-identifier', { target: 'c2' }],
    ['an identifier that is not a name', (g) => void (g.components[0].id = '7 up'), 'bad-identifier', {}],
    ['a counter behind the identifiers in use', (g) => void (g.nextId = 5), 'next-id-behind', {}],
    ['two ports of one name on a component', (g) => void g.components[1].ports.push({ id: 'tie', name: 'Again', at: 0.3 }), 'duplicate-port', { component: 'c2', port: 'tie' }],
    ['a placed port that takes a fixed port\'s name', (g) => void g.components[0].ports.push({ id: 'end', name: 'End', at: 1 }), 'reserved-port', { component: 'c1', port: 'end' }],
    ['a port on a bar placed with two numbers', (g) => void (g.components[1].ports[2].at = [0.2, 0.5]), 'port-place', { component: 'c2', port: 'tie' }],
    ['a port on the board placed with one number', (g) => void (g.components[2].ports[0].at = 0.3), 'port-place', { component: 'c3', port: 'pad-b' }],
    ['a connection to a component that does not exist', (g) => void (g.connections[0].to.component = 'c77'), 'missing-component', { connection: 'c4', component: 'c77' }],
    ['a connection to a port that does not exist', (g) => void (g.connections[0].to.port = 'nowhere'), 'missing-port', { connection: 'c4', component: 'c2', port: 'nowhere' }],
    ['a kind of component nobody knows', (g) => void (g.components[1].type = 'gong' as never), 'unknown-component-type', { component: 'c2' }],
    ['a string tied to the board', (g) => void (g.connections[0].to = { component: 'c3', port: 'bridge' }), 'incompatible-end', { connection: 'c4', component: 'c3' }],
    ['a string tied by its pluck point', (g) => void (g.connections[0].from.port = 'pluck'), 'incompatible-end', { connection: 'c4', port: 'pluck' }],
    ['a pad from the board to the bar', (g) => void ([g.connections[1].from, g.connections[1].to] = [g.connections[1].to, g.connections[1].from]), 'incompatible-end', { connection: 'c5' }],
    ['a pad between two points of one bar', (g) => void (g.connections[1].to = { component: 'c2', port: 'middle' }), 'incompatible-end', { connection: 'c5' }],
    ['a tie with no stiffness', (g) => void delete g.connections[0].stiffness, 'missing-parameter', { connection: 'c4' }],
    ['the same two ports connected twice', (g) => void g.connections.push({ ...copy(g.connections[1]), id: 'c11' }), 'duplicate-connection', { connection: 'c11' }],
    ['a pluck on a bar', (g) => void (g.targets[0].at = { component: 'c2', port: 'middle' }), 'incompatible-target', { target: 'c7', component: 'c2' }],
    ['a finger on the string\'s end', (g) => void (g.targets[1].at.port = 'end'), 'incompatible-target', { target: 'c8' }],
    ['a strike with no striker', (g) => void delete g.targets[2].striker, 'striker', { target: 'c9' }],
    ['a pluck with a striker', (g) => void (g.targets[0].striker = { mass: 0.01, hardness: 0.5 }), 'striker', { target: 'c7' }],
    ['a target at a port that does not exist', (g) => void (g.targets[3].at.port = 'far-end'), 'missing-port', { target: 'c10', port: 'far-end' }],
    ['an output that names a bar', (g) => void (g.output!.component = 'c2'), 'output-not-a-body', { component: 'c2' }],
    ['an output that names nothing', (g) => void (g.output!.component = 'c50'), 'output-missing-component', { component: 'c50' }],
    ['a bar with no material', (g) => void delete g.components[1].material, 'material', { component: 'c2' }],
    ['a parameter the type does not have', (g) => void (g.components[1].params.strikePosition = 0.5), 'unknown-parameter', { component: 'c2' }],
    ['a missing parameter', (g) => void delete g.components[0].params.tension, 'missing-parameter', { component: 'c1' }],
  ]
  test.each(cases)('%s is a structural error that names what it concerns', (_name, change, code, where) => {
    const g = edit(change)
    if (g.nextId < 12 && code !== 'next-id-behind') g.nextId = Math.max(g.nextId, 12)
    const issues = checkStructure(g)
    const found = issues.find((i) => i.code === code)
    expect(found, `expected ${code}, got ${codes(issues).join(', ')}`).toBeDefined()
    expect(found).toMatchObject({ tier: 'structure', severity: 'error', ...where })
    expect(found!.message.length).toBeGreaterThan(20)
    expect(errorsOf(validate(g)).length).toBeGreaterThan(0)
  })

  test('a string\'s end is held by one thing: a tie and a bridge together conflict', () => {
    const g = edit((x) => {
      x.connections.push({ id: 'c11', kind: 'bridge', from: { component: 'c1', port: 'end' }, to: { component: 'c3', port: 'bridge' } })
      x.nextId = 12
    })
    expect(checkStructure(g).map((i) => i.code)).toEqual(['string-end-held-twice'])
    expect(checkStructure(g)[0]).toMatchObject({ connection: 'c11', component: 'c1', port: 'end' })
    expect(checkStructure(g)[0].message).toMatch(/already held by connection c4/)
  })

  test('a bridge has no stiffness to set, and a pad on a bridge is not a bridge', () => {
    const g = edit((x) => void (x.connections[0].stiffness = 5e5), stringOnBodyFixture())
    expect(checkStructure(g)[0]).toMatchObject({ code: 'unexpected-parameter', connection: 'c3' })
    const hybrid = edit((x) => void (x.connections[1].kind = 'bridge'))
    expect(checkStructure(hybrid).map((i) => i.code)).toContain('incompatible-end')
  })

  test('something that is not a graph is said to be so, and nothing further is attempted', () => {
    expect(validate(null as never).map((i) => i.code)).toEqual(['not-a-graph'])
    expect(validate({ version: 2, meta: { name: 'x' }, nextId: 1 } as never).map((i) => i.code)).toEqual(['missing-list', 'missing-list', 'missing-list'])
    expect(checkStructure({ ...hybridFixture(), version: 1 as never }).map((i) => i.code)).toEqual(['version'])
  })
})

describe('Tier C: numerics', () => {
  const cases: [string, (g: Graph) => void, string, Partial<Issue>][] = [
    ['a tension that is not a number', (g) => void (g.components[0].params.tension = Number.NaN), 'not-a-number', { component: 'c1' }],
    ['an infinite length', (g) => void (g.components[1].params.length = Infinity), 'not-a-number', { component: 'c2' }],
    ['a bar of no thickness', (g) => void (g.components[1].params.thickness = 0), 'out-of-range', { component: 'c2' }],
    ['a negative width', (g) => void (g.components[1].params.width = -20), 'out-of-range', { component: 'c2' }],
    ['a string too slack for the range', (g) => void (g.components[0].params.tension = 5), 'out-of-range', { component: 'c1' }],
    ['a pad with no stiffness at all', (g) => void (g.connections[1].stiffness = 0), 'out-of-range', { connection: 'c5' }],
    ['a pad softer than has a meaning', (g) => void (g.connections[1].stiffness = 100), 'out-of-range', { connection: 'c5' }],
    ['a tie stiffer than has a meaning', (g) => void (g.connections[0].stiffness = 1e12), 'out-of-range', { connection: 'c4' }],
    ['a negative damping', (g) => void (g.connections[2].damping = -1), 'out-of-range', { connection: 'c6' }],
    ['a damping that is not a number', (g) => void (g.connections[2].damping = Number.NaN), 'not-a-number', { connection: 'c6' }],
    ['a stiffness that is a word', (g) => void (g.connections[0].stiffness = 'firm' as never), 'not-a-number', { connection: 'c4' }],
    ['a port beyond the end of the bar', (g) => void (g.components[1].ports[2].at = 1.2), 'port-off-component', { component: 'c2', port: 'tie' }],
    ['a port off the edge of the board', (g) => void (g.components[2].ports[0].at = [0.5, -0.1]), 'port-off-component', { component: 'c3', port: 'pad-b' }],
    ['a port at no place', (g) => void (g.components[1].ports[0].at = Number.NaN), 'not-a-number', { component: 'c2', port: 'pad-a' }],
    ['a striker of no mass', (g) => void (g.targets[2].striker!.mass = 0), 'out-of-range', { target: 'c9' }],
    ['a striker harder than hard', (g) => void (g.targets[2].striker!.hardness = 3), 'out-of-range', { target: 'c9' }],
    ['a listener somewhere the radiation model was not validated', (g) => void (g.output!.distance = 3), 'unsupported-distance', { component: 'c3' }],
    ['a bar too short and thick to sound at this sample rate', (g) => void Object.assign(g.components[1].params, { length: 0.05, thickness: 40 }), 'bar-above-playable', { component: 'c2' }],
  ]
  test.each(cases)('%s is a numerical error that names what it concerns', (_name, change, code, where) => {
    const g = edit(change)
    const issues = checkNumerics(g)
    expect(codes(issues)).toEqual([`numerics:error:${code}`])
    expect(issues[0]).toMatchObject(where)
    // It is not a structural problem, and it stops the later tiers being run on numbers that have no meaning.
    expect(checkStructure(g)).toEqual([])
    expect(validate(g).every((i) => i.tier === 'numerics')).toBe(true)
  })

  test('the message gives the value, the range and the unit', () => {
    const g = edit((x) => void (x.connections[1].stiffness = 100))
    expect(checkNumerics(g)[0].message).toBe('Connection c5 (support pad): Stiffness must be between 10000 and 100000000 N/m (it is 100).')
  })
})

describe('Tier B: physics', () => {
  test('errors: a bar that could not stand, or would have to stretch', () => {
    const noPads = edit((g) => void (g.connections = g.connections.filter((c) => c.kind !== 'pad')))
    expect(codes(checkPhysics(noPads))).toContain('physics:error:bar-unsupported')
    const onePad = edit((g) => void g.connections.pop())
    expect(checkPhysics(onePad).find((i) => i.severity === 'error')).toMatchObject({ code: 'bar-needs-two-pads', component: 'c2', connection: 'c5' })
    const stretched = edit((g) => void (g.components[2].ports[0].at = [0.6, 1 / 3]))
    expect(checkPhysics(stretched)[0]).toMatchObject({ severity: 'error', code: 'pads-would-stretch-bar', component: 'c2' })
    expect(checkPhysics(stretched)[0].message).toMatch(/113\.7 mm apart on the bar and 260\.0 mm apart on the board/)
    const samePoint = edit((g) => void (g.connections[2].to = { component: 'c3', port: 'bridge' }))
    expect(checkPhysics(samePoint)[0]).toMatchObject({ severity: 'error', code: 'pads-share-a-point' })
    const three = edit((g) => {
      g.components[1].ports.push({ id: 'pad-c', name: 'Third pad', at: 0.5 })
      g.components[2].ports.push({ id: 'pad-c', name: 'Third pad', at: [0.2, 1 / 3] })
      g.connections.push({ id: 'c11', kind: 'pad', from: { component: 'c2', port: 'pad-c' }, to: { component: 'c3', port: 'pad-c' }, stiffness: 1e6, damping: 5 })
      g.nextId = 12
    })
    expect(checkPhysics(three)[0]).toMatchObject({ severity: 'error', code: 'bar-too-many-pads' })
    // All of them are structurally sound and numerically fine: the tiers are separate questions.
    for (const g of [noPads, onePad, stretched, samePoint, three]) expect([...checkStructure(g), ...checkNumerics(g)]).toEqual([])
  })

  test('warnings: unusual but meaningful instruments are allowed, and the user is told what was found about them', () => {
    const farTie = edit((g) => void (g.components[1].ports[2].at = 0.1))
    expect(codes(validate(farTie))).toEqual(['physics:warning:tie-far-from-node'])
    expect(validate(farTie)[0]).toMatchObject({ component: 'c2', connection: 'c4', port: 'tie' })
    // A bar on pads at its ends: its note is damped. It can be built.
    const endPads = edit((g) => {
      g.components[1].ports[0].at = 0.05
      g.components[1].ports[1].at = 0.95
      g.components[2].ports[0].at = [0.08 + (0.9 * 0.1994) / 0.5, 1 / 3]
    })
    expect(codes(validate(endPads))).toEqual(['physics:warning:pad-far-from-node', 'physics:warning:pad-far-from-node'])
    const fingerOnNode = edit((g) => {
      g.components[1].ports.push({ id: 'node', name: 'Node', at: 0.224 })
      g.targets[3].at.port = 'node'
    })
    expect(codes(validate(fingerOnNode))).toEqual(['physics:warning:contact-on-node'])
    expect(validate(fingerOnNode)[0]).toMatchObject({ target: 'c10', component: 'c2', port: 'node' })
    const struckOnNode = edit((g) => {
      g.components[1].ports.push({ id: 'node', name: 'Node', at: 0.776 })
      g.targets[2].at.port = 'node'
    })
    expect(codes(validate(struckOnNode))).toEqual(['physics:warning:strike-on-node'])
    const heavy = edit((g) => void Object.assign(g.components[2].params, { length: 1.4, width: 200, thickness: 40 }), stringOnBodyFixtureWithLooseBar())
    expect(codes(validate(heavy))).toContain('physics:warning:unusual-mass')
    // None of these stops the instrument being read.
    for (const g of [farTie, endPads, fingerOnNode, struckOnNode]) {
      expect(errorsOf(validate(g))).toEqual([])
      expect(readInstrument(serialize(g))).toMatchObject({ version: 2, warnings: warningsOf(validate(g)) })
    }
    // Other bars than the reference's are simply valid: another length (another note), another metal, softer pads.
    const other = edit((g) => {
      Object.assign(g.components[1].params, { length: 0.2437, width: 16.4 })
      g.components[1].material = 'brass'
      g.components[2].ports[0].at = [0.08 + (0.57 * 0.2437) / 0.5, 1 / 3]
      g.connections[1].stiffness = g.connections[2].stiffness = 5e5
    })
    expect(validate(other)).toEqual([])
  })

  test('a radiator nothing reaches, a string held by nothing and an instrument with no way to play it are each said, as warnings', () => {
    const loose = edit((g) => void (g.connections = []), stringOnBodyFixture())
    expect(codes(validate(loose))).toEqual(['physics:warning:string-end-free', 'physics:warning:radiator-disconnected'])
    expect(validate(loose)[1]).toMatchObject({ component: 'c2' })
    const mute = edit((g) => void (g.targets = []), stringOnBodyFixture())
    expect(codes(validate(mute))).toEqual(['physics:warning:nothing-to-play'])
    const unheard = edit((g) => void (g.output = null), stringOnBodyFixture())
    expect(codes(validate(unheard))).toEqual(['physics:warning:no-output'])
  })
})

/** The string on its body with a bar lying beside it, attached to nothing: valid, and useless. */
function stringOnBodyFixtureWithLooseBar(): Graph {
  const g = stringOnBodyFixture()
  g.components.push({ id: 'c6', type: 'metalBar', name: 'Loose bar', material: 'steel', params: { length: 0.3, width: 40, thickness: 10 }, ports: [] })
  g.nextId = 7
  return g
}

describe('Tier D: budget', () => {
  test('the estimate made from the graph agrees with what the validated models actually build', () => {
    const count = (calls: Call[]) => ({ resonators: calls.filter((c) => c[0] === 'addResonator').length, modes: calls.filter((c) => c[0] === 'addResonator').reduce((sum, c) => sum + (c[2] as number), 0), solverConnections: calls.filter((c) => c[0] === 'addSpring' || c[0] === 'addContact').length })
    for (const rate of [44100, 48000, 96000]) {
      expect(estimate(hybridFixture(), rate), `hybrid at ${rate}`).toMatchObject(count(buildStringBarBody(dampable(0.5), rate).calls))
      expect(estimate(stringOnBodyFixture(), rate), `string at ${rate}`).toMatchObject(count(buildPlayableStringBody({ tension: 73.5, length: 0.65, pluckAt: 0.8, joined: true }, rate).calls))
    }
    expect(estimate(hybridFixture())).toEqual({ strings: 1, bars: 1, bodies: 1, resonators: 6, modes: 189, solverConnections: 9, fingerContacts: 2 })
    expect(estimate(stringOnBodyFixture())).toMatchObject({ resonators: 4, modes: 178, solverConnections: 4, fingerContacts: 1 })
  })

  test('the initial budget is a stated policy, far inside the engine\'s capacity, and both are named for what they are', () => {
    expect(INITIAL_BUDGET).toEqual({ strings: 1, bars: 1, bodies: 1, solverConnections: 12, fingerContacts: 4, modes: 200 })
    expect(ENGINE_CAPACITY).toEqual({ resonators: 128, solverConnections: 32, modes: 16384 })
    expect(INITIAL_POLICY).toMatchObject({ sampleRate: 48000, overBudget: 'error', budget: INITIAL_BUDGET, engine: ENGINE_CAPACITY })
    expect(INITIAL_BUDGET.solverConnections).toBeLessThan(ENGINE_CAPACITY.solverConnections)
    expect(INITIAL_BUDGET.modes).toBeLessThan(ENGINE_CAPACITY.modes)
  })

  test('over the budget is refused by the initial policy, only warned of by a laxer one, and the message says it is not the engine\'s limit', () => {
    // Five places for a finger on the bar: with the string's, six fingers and thirteen connections.
    const fingers = edit((g) => {
      for (let i = 0; i < 4; i++) g.targets.push({ id: `c${11 + i}`, kind: 'contact', name: `Finger ${i + 2}`, at: { component: 'c2', port: 'middle' } })
      g.nextId = 15
    })
    expect([...checkStructure(fingers), ...checkNumerics(fingers), ...checkPhysics(fingers)]).toEqual([])
    expect(estimate(fingers)).toMatchObject({ solverConnections: 13, fingerContacts: 6 })
    expect(codes(checkBudget(fingers))).toEqual(['budget:error:over-budget-solverConnections', 'budget:error:over-budget-fingerContacts'])
    expect(checkBudget(fingers)[0].message).toMatch(/needs 13 mechanical connections for the solver; the initial budget is 12\. That is what has been run in real time so far, not the engine's limit/)
    expect(() => readInstrument(serialize(fingers))).toThrow(/\[budget\]/)
    // The same graph under a policy that only warns, and under one with a larger budget.
    const lax = { ...INITIAL_POLICY, overBudget: 'warning' as const }
    expect(codes(checkBudget(fingers, lax))).toEqual(['budget:warning:over-budget-solverConnections', 'budget:warning:over-budget-fingerContacts'])
    expect(readInstrument(serialize(fingers), lax)).toMatchObject({ version: 2 })
    expect(checkBudget(fingers, { ...INITIAL_POLICY, budget: { ...INITIAL_BUDGET, solverConnections: 16, fingerContacts: 8 } })).toEqual([])
    // A second string is over the budget of one.
    const two = edit((g) => {
      g.components.push({ ...copy(g.components[0]), id: 'c11' })
      g.nextId = 12
    })
    expect(codes(checkBudget(two))).toEqual(['budget:error:over-budget-strings', 'budget:error:over-budget-modes'])
    // What the engine cannot hold is an error under any policy.
    expect(codes(checkBudget(fingers, { ...lax, engine: { ...ENGINE_CAPACITY, solverConnections: 10 } }))).toContain('budget:error:over-engine-solverConnections')
  })
})

describe('Canonical text', () => {
  test('the same instrument is the same text, however its parts are listed and whatever else is on the objects', () => {
    for (const [name, make] of fixtures) {
      const g = make()
      const text = serialize(g)
      const next = random(7)
      for (let i = 0; i < 25; i++) {
        const other = copy(g)
        other.components = shuffled(other.components, next)
        other.connections = shuffled(other.connections, next)
        other.targets = shuffled(other.targets, next)
        for (const c of other.components) {
          c.ports = shuffled(c.ports, next)
          // Fields in another order.
          c.params = Object.fromEntries(shuffled(Object.entries(c.params), next))
        }
        expect(serialize(other), `${name}, shuffle ${i}`).toBe(text)
        expect(sameInstrument(other, g)).toBe(true)
      }
      expect(text.endsWith('}\n')).toBe(true)
      expect(JSON.parse(text).version).toBe(2)
      expect(Object.keys(JSON.parse(text))).toEqual(['version', 'meta', 'nextId', 'components', 'connections', 'targets', 'output'])
    }
  })

  test('saved and read back it is the same graph, to the last digit, and reading it again changes nothing', () => {
    for (const [name, make] of fixtures) {
      const g = make()
      const text = serialize(g)
      const read = readInstrument(text)
      expect(read.version, name).toBe(2)
      expect(read.graph).toEqual(canonical(g))
      expect(serialize(read.graph as Graph)).toBe(text)
      expect((read as { warnings: Issue[] }).warnings).toEqual([])
    }
    // Numbers are written as they are: nothing is rounded or tidied.
    const awkward = edit((g) => {
      g.components[1].params.length = 0.1 + 0.2 // 0.30000000000000004
      g.components[1].ports[2].at = 1 / 3
      g.components[2].ports[0].at = [0.08 + (0.57 * (0.1 + 0.2)) / 0.5, 1 / 3]
      g.connections[0].stiffness = 123456.789
      g.connections[0].damping = -0
    })
    const back = readInstrument(serialize(awkward)).graph as Graph
    expect(back.components[1].params.length).toBe(0.30000000000000004)
    expect(back.components[1].ports.find((p) => p.id === 'tie')!.at).toBe(1 / 3)
    expect(back.connections[0].stiffness).toBe(123456.789)
    expect(Object.is(back.connections[0].damping, 0)).toBe(true) // minus zero is zero
    expect(serialize(awkward)).toContain('"length": 0.30000000000000004')
  })

  test('a number that cannot be written is refused, by name, rather than saved as something else', () => {
    const g = edit((x) => void (x.connections[1].stiffness = Number.NaN))
    expect(() => serialize(g)).toThrow(/c5\.stiffness is NaN/)
    expect(() => serialize(edit((x) => void (x.components[1].ports[0].at = Infinity)))).toThrow(/c2\.ports\.pad-a\.at is Infinity/)
  })

  test('generated instruments: every valid variation round-trips exactly, and every broken one is refused with a reason that names something', () => {
    const next = random(20251116)
    const between = (low: number, high: number) => low + next() * (high - low)
    let [valid, refused] = [0, 0]
    for (let i = 0; i < 200; i++) {
      // A hybrid with its own string, bar, pads and tie, always physically consistent: the second pad's place on the board follows the bar.
      const tie = between(0.16, 0.26)
      const g = edit((x) => {
        const [string, bar, body] = x.components
        string.params.tension = between(40, 110)
        string.params.length = between(0.52, 0.78)
        string.ports[0].at = between(0.1, 0.9)
        bar.params.length = between(0.15, 0.3)
        bar.params.width = between(12, 40)
        bar.params.thickness = between(3, 8)
        bar.material = ['aluminium', 'steel', 'brass', 'bronze'][Math.floor(next() * 4)]
        const pads = [between(0.18, 0.26), between(0.74, 0.82)]
        bar.ports[0].at = pads[0]
        bar.ports[1].at = pads[1]
        bar.ports[2].at = tie
        bar.ports[3].at = between(0.35, 0.65)
        body.ports[0].at = [0.08 + ((pads[1] - pads[0]) * bar.params.length) / 0.5, 1 / 3]
        x.connections[0].stiffness = 10 ** between(4.5, 7.5)
        x.connections[1].stiffness = x.connections[2].stiffness = 10 ** between(4.5, 7.5)
        x.connections[1].damping = x.connections[2].damping = between(0, 50)
        x.targets[2].striker = { mass: between(0.002, 0.05), hardness: between(0, 1) }
      })
      expect(errorsOf(validate(g)), `case ${i}: ${validate(g).map((x) => x.message).join(' | ')}`).toEqual([])
      const text = serialize(g)
      expect(serialize(readInstrument(text).graph as Graph)).toBe(text)
      expect(describeAssembly(g).kind).toBe('barBridge')
      valid++
      // Now break it in one of several ways; it must be refused, and the refusal must point at something.
      const breaks: ((x: Graph) => void)[] = [
        (x) => void (x.connections[Math.floor(next() * 3)].to.port = 'gone'),
        (x) => void (x.components[1].ports[Math.floor(next() * 4)].at = between(1.01, 3)),
        (x) => void (x.connections[1 + Math.floor(next() * 2)].stiffness = -between(1, 1e6)),
        (x) => void x.connections.splice(1 + Math.floor(next() * 2), 1),
        (x) => void (x.targets[Math.floor(next() * 4)].at.component = 'c999'),
        (x) => void (x.components[2].ports[0].at = [between(0.5, 0.9), 1 / 3]),
        (x) => void (x.components[0].params.tension = Number.NaN),
        (x) => void (x.targets[1].id = x.targets[0].id),
      ]
      const broken = edit(breaks[Math.floor(next() * breaks.length)], g)
      const issues = errorsOf(validate(broken))
      expect(issues.length, `case ${i}`).toBeGreaterThan(0)
      expect(issues.every((x) => x.component || x.connection || x.target || x.port)).toBe(true)
      let text2: string | null = null
      try {
        text2 = serialize(broken)
      } catch {
        // a number that cannot be written: refused already
      }
      if (text2 !== null) expect(() => readInstrument(text2!)).toThrow(/cannot be loaded/)
      refused++
    }
    expect([valid, refused]).toEqual([200, 200])
  })
})

describe('Reading a saved instrument', () => {
  test('malformed and unknown files fail in words and are never half-read', () => {
    expect(() => readInstrument('')).toThrow(/not valid JSON/)
    expect(() => readInstrument('{"version": 2,')).toThrow(/not valid JSON/)
    expect(() => readInstrument('[1, 2, 3]')).toThrow(/not an object/)
    expect(() => readInstrument('"version 2"')).toThrow(/not an object/)
    expect(() => readInstrument('{}')).toThrow(/format version is missing/)
    expect(() => readInstrument('{"version": "2"}')).toThrow(/format version is "2"/)
    expect(() => readInstrument('{"version": 0}')).toThrow(/format version is 0/)
    expect(() => readInstrument(JSON.stringify({ ...hybridFixture(), version: 3 }))).toThrow(/saved by a newer version of SonicMatter \(format 3; this one reads formats 1 and 2\)\. It has not been changed/)
    expect(() => readInstrument('{"version": 2}')).toThrow(/has no name \(meta\.name\)/)
    expect(() => readInstrument('{"version": 2, "meta": {"name": "x"}, "nextId": 1}')).toThrow(/no list of components/)
    expect(() => readVersion2(null)).toThrow(/not an object/)
  })

  test('a component, connection or target of a kind nobody knows is refused, not dropped', () => {
    const file = (change: (g: Graph) => void) => JSON.stringify(edit(change))
    expect(() => readInstrument(file((g) => void (g.components[2].type = 'drumSkin' as never)))).toThrow(/unknown component type "drumSkin"\. It has not been left out or guessed at/)
    expect(() => readInstrument(file((g) => void (g.connections[0].kind = 'weld' as never)))).toThrow(/unknown kind of connection "weld"/)
    expect(() => readInstrument(file((g) => void (g.targets[0].kind = 'bow' as never)))).toThrow(/unknown kind of target "bow"/)
    // Every problem is listed, each with its tier.
    const several = file((g) => {
      g.connections[0].to.port = 'gone'
      g.connections[1].stiffness = -1
    })
    expect(() => readInstrument(several)).toThrow(/\[structure\].*has no port "gone"[\s\S]*\[numerics\].*Stiffness must be between/)
  })

  test('version 1: every example the builder ships is read by the builder\'s own loader, comes back exactly as it gives it, and builds the same engine calls', () => {
    const examples = [...EXAMPLES, ...STRING_EXAMPLES, ...RADIATION_EXAMPLES]
    expect(examples.map((x) => x.id)).toHaveLength(7)
    for (const example of examples) {
      const graph = example.make()
      const text = writeV1(graph)
      const read = readInstrument(text)
      expect(read.version, example.id).toBe(1)
      expect(read.graph).toEqual(readV1(text))
      expect(read.graph).toEqual(graph)
      expect(writeV1(read.graph as GraphV1)).toBe(text) // not converted, not reordered, not renamed
      expect(translate(read.graph as GraphV1, SR)).toEqual(translate(graph, SR))
      expect(translate(graph, SR).ok).toBe(true)
      // And it is not a version 2 graph by any reading.
      expect(checkStructure(graph as never).map((i) => i.code)).toContain('version')
    }
    // A broken version 1 file is refused in the version 1 loader's own words.
    const broken = JSON.parse(writeV1(EXAMPLES[0].make()))
    broken.components[0].params.length = 99
    expect(() => readInstrument(JSON.stringify(broken))).toThrow(/Length must be between/)
    // The builder itself still refuses a version 2 file by name: the two formats cannot be mistaken for each other.
    expect(() => readV1(serialize(hybridFixture()))).toThrow(/Unknown instrument format version 2/)
  })
})

describe('The reference fixtures', () => {
  test('each describes exactly the mechanical assembly of its standalone reference', () => {
    for (const tie of [0.2, 0.18] as const) {
      const a = describeAssembly(hybridFixture(tie))
      expect(a.kind).toBe('barBridge')
      expect(a.spec, `tie ${tie}`).toEqual(dampable(0.5, tie))
      expect(a.ids).toEqual({ string: 'c1', bar: 'c2', body: 'c3', pluck: 'c7', mute: 'c8', strike: 'c9', contacts: ['c10'] })
    }
    const s = describeAssembly(stringOnBodyFixture())
    expect(s).toEqual({ kind: 'stringOnBody', spec: { tension: 73.5, length: 0.65, pluckAt: 0.8, joined: true }, ids: { string: 'c1', body: 'c2', pluck: 'c4', mute: 'c5' } })
    // The fixtures hold the validated numbers and no others.
    const g = hybridFixture()
    expect(g.components[1]).toMatchObject({ material: 'aluminium', params: { length: 0.1994, width: 20, thickness: 5 } })
    expect(g.connections.map((c) => [c.kind, c.stiffness, c.damping])).toEqual([['tie', 1e6, 0], ['pad', 1e6, 5], ['pad', 1e6, 5]])
    expect(g.targets[2].striker).toEqual({ mass: 0.005, hardness: 0.5 })
    expect(hybridFixture(0.18).components[1].ports.find((p) => p.id === 'tie')!.at).toBe(0.18)
    // Saved and read back, the description is the same.
    expect(describeAssembly(readInstrument(serialize(g)).graph as Graph)).toEqual(describeAssembly(g))
  })

  test('built from those descriptions by the validated models, they are the references: the same engine calls and the same samples', async () => {
    const radiate = (): Call => {
      const r = radiation(SR)
      return ['radiate', r.perSample, r.b0, r.b1, r.a1, 8]
    }
    for (const tie of [0.2, 0.18] as const) {
      const a = describeAssembly(hybridFixture(tie))
      if (a.kind !== 'barBridge') throw new Error('not the hybrid')
      const [mine, reference] = [buildStringBarBody(a.spec, SR), buildStringBarBody(dampable(0.5, tie), SR)]
      expect(mine.calls).toEqual(reference.calls)
      const [x, y] = [await createHybridWorklet([...mine.calls, radiate()]), await createHybridWorklet([...reference.calls, radiate()])]
      x.send([pluckCall(mine, 2), ['launch', mine.mallet!, 1]])
      y.send([pluckCall(reference, 2), ['launch', reference.mallet!, 1]])
      const [p, q] = [x.render(SR / 2), y.render(SR / 2)]
      let differ = 0
      for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) differ++
      expect(differ, `tie ${tie}`).toBe(0)
      expect(Math.max(...p.map(Math.abs))).toBeGreaterThan(0.05)
    }
    const s = describeAssembly(stringOnBodyFixture())
    if (s.kind !== 'stringOnBody') throw new Error('not the string')
    expect(buildPlayableStringBody(s.spec, SR).calls).toEqual(buildPlayableStringBody({ tension: 73.5, length: 0.65, pluckAt: 0.8, joined: true }, SR).calls)
  }, 400000)

  test('a valid graph that is not one of the two assemblies is described as such, not forced into one', () => {
    const loose = stringOnBodyFixtureWithLooseBar()
    expect(errorsOf(validate(loose))).toEqual([])
    expect(() => describeAssembly(loose)).toThrow(/is valid, but it is not an assembly a validated model exists for/)
    const mutedElsewhere = edit((g) => {
      g.components[0].ports.push({ id: 'near-nut', name: 'Near the nut', at: 0.2 })
      g.targets[1].at.port = 'near-nut'
    })
    expect(errorsOf(validate(mutedElsewhere))).toEqual([])
    expect(() => describeAssembly(mutedElsewhere)).toThrow(/a mute elsewhere has not been validated/)
    expect(() => describeAssembly(edit((g) => void g.connections.pop()))).toThrow(/\[physics\].*stands on one pad/)
  })
})

describe('The saved form of the reference instruments', () => {
  test('the three fixture files are the canonical text of the fixtures, byte for byte, and read back as them', async () => {
    const { readFileSync } = await import('node:fs')
    const files: [string, Graph][] = [['hybrid-tie-0.20', hybridFixture(0.2)], ['hybrid-tie-0.18', hybridFixture(0.18)], ['string-on-body', stringOnBodyFixture()]]
    for (const [name, graph] of files) {
      // (Git may check the files out with either line ending; the format itself uses "\n".)
      const text = readFileSync(new URL(`./fixtures/graph-v2/${name}.json`, import.meta.url), 'utf8').replaceAll('\r\n', '\n')
      expect(text, name).toBe(serialize(graph))
      const read = readInstrument(text)
      expect(read).toMatchObject({ version: 2, warnings: [] })
      expect(read.graph).toEqual(canonical(graph))
    }
  })
})
