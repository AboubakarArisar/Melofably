// Phase 3D.14: feasibility checks for the design in
// docs/HYBRID_BUILDER_DESIGN.md. They establish facts about the builder as
// it is (which this phase does not change) and about a proof of concept
// (src/experimental/hybrid/assembly.ts) that no page uses. Nothing here
// integrates anything.
import { describe, expect, test } from 'vitest'
import { createHybridWorklet } from '../analysis/hybrid-worklet'
import { EXAMPLES, RADIATION_EXAMPLES, STRING_EXAMPLES } from '../src/builder/examples'
import { addComponent, cannotAdd, cannotConnect, connect, deserialize, emptyGraph, serialize, TYPES, validateGraph, type Graph } from '../src/builder/graph'
import { translate } from '../src/builder/translate'
import { compileDraft, readInstrument, referenceDraft, validateDraft, type DraftGraph } from '../src/experimental/hybrid/assembly'
import { BAR_TOUCH, barTouchCalls, buildStringBarBody, dampable } from '../src/experimental/string/stringBarBody'
import { fingerDamping, pluckCall, radiation, touchCall } from '../src/experimental/string/stringBody'
import type { Call } from '../src/experimental/wasm/engine'
import { SR } from './helpers'

const radiate = (): Call => {
  const r = radiation(SR)
  return ['radiate', r.perSample, r.b0, r.b1, r.a1, 8]
}
const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const kinds = (g: DraftGraph) => validateDraft(g).map((i) => i.kind)

describe('The builder as it is (not changed by this phase)', () => {
  test('its graph cannot say what the hybrid is: a body and a bar may not share an instrument, and a connection has no ports', () => {
    // A string on its box: a metal bar cannot be added, in words.
    const string = addComponent(emptyGraph(), 'steelString', 100, 100)
    const box = addComponent(string.graph, 'dampedBox', 300, 100)
    const onBox = connect(box.graph, string.id, box.id).graph
    expect(cannotAdd(onBox, 'metalBar')).toMatch(/cannot be added to a string instrument/)
    expect(cannotAdd(onBox, 'mallet')).toMatch(/cannot be added to a string instrument/)
    // A string tied to a bar: the box cannot be added either.
    const bar = addComponent(string.graph, 'metalBar', 300, 100)
    const onBar = connect(bar.graph, string.id, bar.id).graph
    expect(cannotAdd(onBar, 'dampedBox')).toMatch(/cannot share an instrument with bars/)
    // Written by hand, the three together are refused by validation, and so never reach the engine.
    const forced: Graph = { ...onBar, nextId: 9, components: [...onBar.components, { id: 'c8', type: 'dampedBox', name: 'Damped box body 1', x: 0, y: 0, params: {} }] }
    expect(validateGraph(forced).map((i) => i.message).join(' ')).toMatch(/cannot share an instrument with bars/)
    expect(translate(forced, SR).ok).toBe(false)
    expect(cannotConnect(forced, 'c8', bar.id)).toMatch(/Nothing else can be attached/)
    // A connection joins two components, not two points: it has no field for where, and two components can be joined once.
    expect(Object.keys(onBar.connections[0]).sort()).toEqual(['damping', 'from', 'id', 'stiffness', 'to', 'type'])
    expect(cannotConnect(onBar, string.id, bar.id)).toMatch(/already connected/)
    // A bar has two places, a strike point and one connection point; the body has no property at all (its bridge point is fixed).
    expect(TYPES.metalBar.params.filter((p) => /Position/.test(p.key)).map((p) => p.key)).toEqual(['strikePosition', 'connectionPosition'])
    expect(TYPES.dampedBox.params).toEqual([])
  })

  test('its saved instruments are version 1, it refuses any other version, and it refuses properties it does not know', () => {
    const text = serialize(EXAMPLES[0].make())
    expect(JSON.parse(text).version).toBe(1)
    expect(() => deserialize(JSON.stringify(referenceDraft()))).toThrow(/Unknown instrument format version 2/)
    const extra = JSON.parse(text)
    extra.components[0].params.supportPosition = 0.2
    expect(() => deserialize(JSON.stringify(extra))).toThrow(/unknown property "supportPosition"/)
    // So a new kind of instrument cannot be slipped into version 1 files without old builders refusing it: it needs its own version.
  })
})

describe('A proof of concept: the hybrid as a graph with ports', () => {
  test('the reference instrument, written as a graph, compiles to exactly the engine calls of the standalone reference, and so to the same samples', async () => {
    for (const tie of [0.2, 0.18]) {
      const compiled = compileDraft(referenceDraft(tie), SR)
      const reference = buildStringBarBody(dampable(0.5, tie), SR)
      expect(compiled.spec).toEqual(dampable(0.5, tie))
      expect(compiled.calls, `tie ${tie}`).toEqual(reference.calls)
      // Played through the lab's processor: sample for sample.
      const [a, b] = [await createHybridWorklet([...compiled.calls, radiate()]), await createHybridWorklet([...reference.calls, radiate()])]
      a.send([pluckCall(compiled.built, 2), ['launch', compiled.where.strike!.contact, 1]])
      b.send([pluckCall(reference, 2), ['launch', reference.mallet!, 1]])
      const [x, y] = [a.render(SR / 2), b.render(SR / 2)]
      let differ = 0
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) differ++
      expect(differ).toBe(0)
      expect(Math.max(...x.map(Math.abs))).toBeGreaterThan(0.05)
    }
  }, 400000)

  test('it is small: the resonators, modes and connections it asks of the engine, against what the engine has room for', () => {
    const { calls } = compileDraft(referenceDraft(), SR)
    const resonators = calls.filter((c) => c[0] === 'addResonator')
    const modes = resonators.reduce((sum, c) => sum + (c[2] as number), 0)
    const connections = calls.filter((c) => c[0] === 'addSpring' || c[0] === 'addContact').length
    // String, board, the plug of air, the fixed body, the bar, the mallet's head.
    expect(resonators.length).toBe(6)
    expect(connections).toBe(9)
    expect(modes).toBeGreaterThan(100)
    expect(modes).toBeLessThan(400)
    // The engine: 128 resonators, 32 connections, 16384 modes.
    expect([resonators.length / 128, connections / 32].every((share) => share < 0.3)).toBe(true)
  })

  test('saved and restored it is the same graph with the same identities, and compiles to the same calls', () => {
    const g = referenceDraft()
    const text = JSON.stringify(g)
    const back = readInstrument(text)
    expect(back.version).toBe(2)
    expect(back.graph).toEqual(g)
    expect(JSON.stringify(back.graph)).toBe(text)
    expect(compileDraft(back.graph as DraftGraph, SR).calls).toEqual(compileDraft(g, SR).calls)
    // The order components or connections are listed in does not change the instrument: identities do the work, not positions.
    const shuffled: DraftGraph = { ...g, components: [...g.components].reverse(), connections: [...g.connections].reverse() }
    expect(compileDraft(shuffled, SR).calls).toEqual(compileDraft(g, SR).calls)
    expect(compileDraft(shuffled, SR).where).toEqual(compileDraft(g, SR).where)
  })

  test('graphs that are not an instrument are refused in words, and each refusal says what kind of problem it is', () => {
    const base = referenceDraft()
    expect(validateDraft(base)).toEqual([])
    const without = (id: string): DraftGraph => ({ ...copy(base), connections: copy(base).connections.filter((c) => c.id !== id) })
    // Structure: a port that does not exist; a connection between kinds of port that may not be joined.
    const ghost = copy(base)
    ghost.connections[0].to!.port = 'nowhere'
    expect(validateDraft(ghost)[0]).toMatchObject({ kind: 'structure', message: expect.stringMatching(/has no port "nowhere"/) })
    const wrong = copy(base)
    wrong.connections[0].to = { component: 'c3', port: 'bridge' } // the string tied to the board
    expect(validateDraft(wrong)[0]).toMatchObject({ kind: 'structure', message: expect.stringMatching(/a tie cannot go to/) })
    const handOnBoard = copy(base)
    handOnBoard.connections[4].from = { component: 'c3', port: 'bridge' }
    expect(validateDraft(handOnBoard)[0].kind).toBe('structure')
    expect(kinds(without('c5'))).toEqual(['structure']) // the string tied to nothing
    // Physics: a bar on one pad; pads that are not as far apart on the board as on the bar.
    expect(validateDraft(without('c7'))[0]).toMatchObject({ kind: 'physics', message: expect.stringMatching(/stands on two pads/) })
    const stretched = copy(base)
    stretched.components[2].ports!.padB = [0.6, 1 / 3]
    expect(validateDraft(stretched)[0]).toMatchObject({ kind: 'physics', message: expect.stringMatching(/would have to stretch/) })
    // Numerics: a stiffness outside what has been tried.
    const soft = copy(base)
    soft.connections[1].stiffness = 10
    expect(validateDraft(soft)[0]).toMatchObject({ kind: 'numerics', message: expect.stringMatching(/between 10000 and 100000000/) })
    const nan = copy(base)
    nan.connections[0].stiffness = Number.NaN
    expect(kinds(nan)).toEqual(['numerics'])
    // Identity: a repeated identifier.
    const twin = copy(base)
    twin.connections[1].id = 'c5'
    expect(validateDraft(twin)[0].message).toMatch(/unique/)
    // None of these compiles; the reason is given.
    expect(() => compileDraft(stretched, SR)).toThrow(/\[physics\]/)
    // The mallet and the place for a finger are optional: without them it is still an instrument.
    const plain = without('c8')
    plain.connections = plain.connections.filter((c) => c.id !== 'c9')
    plain.components = plain.components.filter((c) => c.type !== 'mallet')
    expect(validateDraft(plain)).toEqual([])
    const built = compileDraft(plain, SR)
    expect([built.where.strike, built.built.mallet, built.built.barFinger]).toEqual([undefined, undefined, undefined])
  })

  test('gestures are addressed by the graph\'s own identifiers, one finger per contact, with no ambiguity between them', async () => {
    const compiled = compileDraft(referenceDraft(), SR)
    // The string's finger belongs to the string component; the bar's to the contact the user placed.
    expect(Object.keys(compiled.where.fingers)).toEqual(['c1', 'c9'])
    expect(new Set(Object.values(compiled.where.fingers)).size).toBe(2)
    const w = await createHybridWorklet([...compiled.calls, radiate()])
    w.send([pluckCall(compiled.built, 2), ['launch', compiled.where.strike!.contact, 1]])
    w.render(4800)
    // Both at once, each by its identifier.
    w.send([touchCall({ finger: compiled.where.fingers.c1 }, { tension: 73.5 }, true), ...barTouchCalls({ barFinger: compiled.where.fingers.c9 }, BAR_TOUCH.medium, SR)])
    w.render(960)
    const fingers = (w.diag().fingers as { connection: number; damping: number }[]).map((f) => [f.connection, f.damping])
    expect(fingers).toEqual([[compiled.where.fingers.c1, fingerDamping({ tension: 73.5 })], [compiled.where.fingers.c9, 6]])
  }, 400000)
})

describe('Instruments saved by the present builder, beside a new format', () => {
  test('every example the builder ships is read back exactly as the builder itself reads it, and builds the same engine calls', () => {
    const examples = [...EXAMPLES, ...STRING_EXAMPLES, ...RADIATION_EXAMPLES]
    expect(examples.length).toBe(7)
    for (const example of examples) {
      const graph = example.make()
      const text = serialize(graph)
      const read = readInstrument(text)
      expect(read.version, example.id).toBe(1)
      expect(read.graph).toEqual(deserialize(text))
      expect(read.graph).toEqual(graph)
      const [was, is] = [translate(graph, SR), translate(read.graph as Graph, SR)]
      expect(is).toEqual(was)
      expect(was.ok).toBe(true)
    }
  })

  test('a file of a version nobody knows is refused and left alone; a version 1 file is never read as version 2', () => {
    expect(() => readInstrument(JSON.stringify({ ...referenceDraft(), version: 3 }))).toThrow(/format this version does not know \(3\)/)
    expect(() => readInstrument('{')).toThrow(/not valid JSON/)
    // A version 1 file with something wrong is refused by the version 1 loader's own words, not reinterpreted.
    const broken = JSON.parse(serialize(EXAMPLES[0].make()))
    broken.components[0].params.length = 99
    expect(() => readInstrument(JSON.stringify(broken))).toThrow(/Length must be between/)
  })
})
