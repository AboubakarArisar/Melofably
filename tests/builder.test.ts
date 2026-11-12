// Phase 3B: the instrument builder's graph, its translation to the
// WebAssembly physics engine, and the audio session logic. The engine here
// is the same binary the browser loads; only the AudioContext is missing.
import { describe, expect, test } from 'vitest'
import { systemFrequencies } from '../analysis/experimental'
import { createEngine, render, run, type Engine } from '../analysis/wasm'
import { barModeFrequencies, barModeShape } from '../src/audio/engine/physics'
import { EXAMPLES } from '../src/builder/examples'
import {
  addComponent,
  cannotConnect,
  CAPACITY,
  commit,
  connect,
  CONNECTION_PARAMS,
  deserialize,
  emptyGraph,
  isExciter,
  isResonator,
  moveComponent,
  parseEntry,
  redo,
  removeComponent,
  removeConnection,
  restore,
  serialize,
  setConnection,
  setMaterial,
  setParam,
  startHistory,
  TYPES,
  undo,
  validateGraph,
  type ComponentType,
  type Graph,
  type History,
} from '../src/builder/graph'
import { barSize, CANVAS, componentAt, EXCITER_RADIUS, freeSpot, handle, HANDLE_REACH, onHandle } from '../src/builder/shapes'
import { Session, type Backend } from '../src/builder/session'
import { barCalls, barModes, CONNECTION_PORT, exciterCalls, instrumentCalls, malletStiffness, structureKey, translate, type Built } from '../src/builder/translate'
import type { Call } from '../src/experimental/wasm/engine'
import { spectralPeaks, SR } from './helpers'

const example = (id: string) => EXAMPLES.find((e) => e.id === id)!.make()
const byType = (graph: Graph, type: ComponentType) => graph.components.filter((c) => c.type === type)
const relativeError = (measured: number, expected: number) => Math.abs(measured / expected - 1)

/** Translate (must succeed) and build in a fresh engine. */
function build(graph: Graph): { engine: Engine; built: Built } {
  const translation = translate(graph, SR)
  if (!translation.ok) throw new Error(translation.issues.map((i) => i.message).join('; '))
  const engine = createEngine()
  run(engine, translation.built.calls)
  return { engine, built: translation.built }
}
/** Render `seconds`, running `calls` at the start. */
const play = (engine: Engine, calls: Call[], seconds = 1) => render(engine, new Float32Array(Math.round(seconds * SR)), (block) => block === 0 && run(engine, calls))

describe('Graph: creating, deleting and connecting components', () => {
  test('components get stable, unique identifiers that are never reused', () => {
    let graph = emptyGraph()
    const ids: string[] = []
    for (const type of ['metalBar', 'woodBar', 'mallet', 'impulse'] as ComponentType[]) {
      const added = addComponent(graph, type, 100, 100)
      graph = added.graph
      ids.push(added.id)
    }
    expect(new Set(ids).size).toBe(4)
    expect(validateGraph(graph)).toEqual([])
    // Remove one in the middle: the others keep their identifiers, and a new one gets a fresh identifier.
    graph = removeComponent(graph, ids[1])
    expect(graph.components.map((c) => c.id)).toEqual([ids[0], ids[2], ids[3]])
    const again = addComponent(graph, 'woodBar', 0, 0)
    expect(ids).not.toContain(again.id)
    // Every property starts at its documented initial value.
    for (const c of again.graph.components) for (const p of TYPES[c.type].params) expect(c.params[p.key]).toBe(p.initial)
  })

  test('moving and editing do not change identity or other components', () => {
    const graph = example('coupled')
    const [a, b] = byType(graph, 'metalBar')
    const edited = setParam(moveComponent(graph, a.id, 10, 20), a.id, 'length', 0.5)
    expect(edited.components.find((c) => c.id === a.id)).toMatchObject({ x: 10, y: 20, params: { length: 0.5 } })
    expect(edited.components.find((c) => c.id === b.id)).toBe(b)
    expect(graph.components.find((c) => c.id === a.id)!.params.length).toBe(0.3) // the original is untouched
  })

  test('removing a component removes its connections and nothing else', () => {
    const graph = example('coupled')
    const [a, b] = byType(graph, 'metalBar')
    const without = removeComponent(graph, a.id)
    expect(without.connections).toHaveLength(0) // the strike and the spring both touched bar A
    expect(without.components.map((c) => c.id)).toContain(b.id)
    expect(validateGraph(without)).toEqual([])
    const spring = graph.connections.find((c) => c.type === 'spring')!
    expect(removeConnection(graph, spring.id).connections.map((c) => c.type)).toEqual(['strike'])
  })

  test('connecting: an exciter strikes a bar, two bars get a spring and damper, in either drag direction', () => {
    let graph = emptyGraph()
    const add = (type: ComponentType) => {
      const added = addComponent(graph, type, 0, 0)
      graph = added.graph
      return added.id
    }
    const [barA, barB, mallet, pulse] = [add('metalBar'), add('woodBar'), add('mallet'), add('impulse')]
    graph = connect(graph, barA, mallet).graph // dragged from the bar to the mallet
    expect(graph.connections[0]).toMatchObject({ type: 'strike', from: mallet, to: barA })
    graph = connect(graph, barA, barB).graph
    expect(graph.connections[1]).toMatchObject({ type: 'springDamper', from: barA, to: barB, stiffness: CONNECTION_PARAMS.stiffness.initial })
    graph = connect(graph, pulse, barB).graph
    expect(validateGraph(graph)).toEqual([])

    // What is not allowed, with a reason a person can act on.
    expect(cannotConnect(graph, barA, barA)).toMatch(/itself/)
    expect(cannotConnect(graph, mallet, pulse)).toMatch(/Two exciters/)
    expect(cannotConnect(graph, barB, barA)).toMatch(/already connected/)
    expect(cannotConnect(graph, mallet, barB)).toMatch(/already strikes/)
    expect(cannotConnect(graph, barA, 'nope')).toMatch(/does not exist/)
    expect(() => connect(graph, mallet, barB)).toThrow(/already strikes/)
  })

  test('the engine capacity is enforced when connecting', () => {
    let graph = emptyGraph()
    const bars: string[] = []
    for (let i = 0; i < 18; i++) {
      const added = addComponent(graph, 'metalBar', 0, 0)
      graph = added.graph
      bars.push(added.id)
    }
    // A chain of spring-dampers: two solver connections each, 32 available.
    for (let i = 0; i < 16; i++) graph = connect(graph, bars[i], bars[i + 1]).graph
    expect(validateGraph(graph)).toEqual([])
    expect(cannotConnect(graph, bars[16], bars[17])).toMatch(/full/)
    expect(() => connect(graph, bars[16], bars[17])).toThrow(/at most 32/)
    // Forced in anyway (as a hand-edited file could): validation and translation both refuse.
    const forced: Graph = { ...graph, connections: [...graph.connections, { id: 'x1', type: 'springDamper', from: bars[16], to: bars[17], stiffness: 1e5, damping: 1 }] }
    expect(validateGraph(forced).map((i) => i.message).join()).toMatch(/Too many connections: they need 34/)
    expect(translate(forced, SR).ok).toBe(false)
    expect(CAPACITY.connections).toBe(32)
  })

  test('undo and redo; one drag of a slider is one step', () => {
    const start = example('single')
    const bar = byType(start, 'metalBar')[0]
    let h = startHistory(start)
    // A slider drag: many edits with the same key in quick succession.
    for (let i = 1; i <= 20; i++) h = commit(h, setParam(h.present, bar.id, 'length', 0.3 + 0.01 * i), `param:${bar.id}:length`, 1000 + 10 * i)
    h = commit(h, removeComponent(h.present, bar.id), '', 5000)
    expect(h.past).toHaveLength(2)
    h = undo(h)
    expect(h.present.components.find((c) => c.id === bar.id)!.params.length).toBeCloseTo(0.5)
    expect(h.present.connections).toHaveLength(1) // the strike came back with the bar
    h = undo(h)
    expect(h.present).toBe(start)
    expect(undo(h)).toBe(h) // nothing further
    h = redo(redo(h))
    expect(h.present.components).toHaveLength(1)
    expect(redo(h)).toBe(h)
    // A new edit after undoing discards the redo branch.
    h = commit(undo(h), setParam(undo(h).present, bar.id, 'width', 60), 'x', 9000)
    expect(h.future).toHaveLength(0)
  })
})

describe('Graph validation', () => {
  const base = example('mixed')
  const wood = byType(base, 'woodBar')[0]
  const mallet = byType(base, 'mallet')[0]
  const joint = base.connections.find((c) => c.type !== 'strike')!
  const messages = (graph: Graph) => validateGraph(graph).map((i) => i.message).join('\n')

  test('the three examples are valid', () => {
    for (const e of EXAMPLES) expect(validateGraph(e.make()), e.label).toEqual([])
  })

  test('every parameter is checked against its documented range, and rejected rather than clamped', () => {
    for (const c of base.components) {
      for (const p of TYPES[c.type].params) {
        for (const bad of [p.min - Math.max(p.step, 1e-6), p.max + p.step, NaN, Infinity, -Infinity]) {
          const issues = validateGraph(setParam(base, c.id, p.key, bad))
          expect(issues, `${c.name} ${p.key} = ${bad}`).toHaveLength(1)
          expect(issues[0]).toMatchObject({ id: c.id })
          expect(issues[0].message).toContain(p.label)
        }
        for (const good of [p.min, p.max]) expect(validateGraph(setParam(base, c.id, p.key, good))).toEqual([])
      }
    }
    for (const [key, spec] of Object.entries(CONNECTION_PARAMS)) {
      expect(messages(setConnection(base, joint.id, { [key]: spec.max * 1.01 }))).toContain(spec.label)
      expect(messages(setConnection(base, joint.id, { [key]: -1 }))).toContain(spec.label)
      expect(messages(setConnection(base, joint.id, { [key]: NaN }))).toContain('must be a number')
    }
  })

  test('unknown types, materials, properties and broken connections are reported', () => {
    expect(messages({ ...base, components: [...base.components, { ...wood, id: 'z9', type: 'string' as ComponentType }] })).toMatch(/Unknown component type "string"/)
    expect(messages(setMaterial(base, wood.id, 'unobtainium'))).toMatch(/unknown material "unobtainium"/)
    expect(messages(setParam(base, wood.id, 'tension', 5))).toMatch(/unknown property "tension"/)
    expect(messages({ ...base, components: [...base.components, { ...wood }] })).toMatch(/identifiers must be unique/)
    expect(messages({ ...base, version: 2 as 1 })).toMatch(/format version 2/)
    const link = (values: object) => ({ ...base, connections: [...base.connections, { id: 'z1', type: 'spring', from: wood.id, to: 'gone', stiffness: 1e5, damping: 0, ...values }] }) as Graph
    expect(messages(link({}))).toMatch(/does not exist/)
    expect(messages(link({ to: wood.id }))).toMatch(/itself/)
    expect(messages(link({ to: mallet.id }))).toMatch(/joins two bars/)
    expect(messages(link({ type: 'strike', from: wood.id, to: mallet.id }))).toMatch(/from an exciter to a bar/)
    expect(messages(link({ type: 'glue', to: joint.to }))).toMatch(/unknown connection type "glue"/)
    expect(messages(link({ to: joint.to }))).toMatch(/already connected/)
  })
})

describe('Graph serialization', () => {
  test('every example survives a round trip exactly', () => {
    for (const e of EXAMPLES) {
      const graph = e.make()
      const text = serialize(graph)
      expect(deserialize(text)).toEqual(graph)
      expect(serialize(deserialize(text))).toBe(text)
      // And builds the same engine calls.
      expect(translate(deserialize(text), SR)).toEqual(translate(graph, SR))
    }
  })

  test('identifiers continue after loading without colliding', () => {
    const loaded = deserialize(serialize(example('coupled')))
    const added = addComponent(loaded, 'woodBar', 0, 0)
    expect(loaded.components.map((c) => c.id)).not.toContain(added.id)
    expect(validateGraph(added.graph)).toEqual([])
  })

  test('anything that is not a valid instrument is refused with the reason', () => {
    const good = example('single')
    expect(() => deserialize('not json')).toThrow(/not valid JSON/)
    expect(() => deserialize('42')).toThrow(/Not a saved instrument/)
    expect(() => deserialize('{"components":[]}')).toThrow(/Not a saved instrument/)
    expect(() => deserialize(JSON.stringify({ ...good, components: [null] }))).toThrow(/not an object/)
    expect(() => deserialize(serialize(setParam(good, good.components[0].id, 'length', 99)))).toThrow(/Length must be between 0.05 and 1.5 m/)
    expect(() => deserialize(serialize({ ...good, nextId: 1 }))).toThrow(/identifier counter/)
    // JSON has no NaN: it arrives as null and is rejected as not a number.
    expect(() => deserialize(serialize(setParam(good, good.components[0].id, 'width', NaN)))).toThrow(/Width must be a number/)
  })
})

describe('Graph-to-engine translation', () => {
  test('one bar and a mallet: the calls describe exactly that system', () => {
    const graph = example('single')
    const [bar, mallet] = [byType(graph, 'metalBar')[0], byType(graph, 'mallet')[0]]
    const translation = translate(graph, SR)
    expect(translation.ok).toBe(true)
    const { built } = translation as { ok: true; built: Built }
    const names = built.calls.map((c) => c[0])
    expect(names[0]).toBe('reset')
    expect(names.at(-1)).toBe('build')
    expect(built.calls.filter((c) => c[0] === 'addResonator')).toEqual([['addResonator', 2, 8], ['addResonator', 1, 1]])
    expect(built.calls.filter((c) => c[0] === 'setMode')).toHaveLength(9)
    // The mallet: a free mass of the stated mass, a Hertz contact of the stated hardness, a metre away.
    expect(built.calls).toContainEqual(['setMode', 1, 0, 0, Infinity, mallet.params.mass])
    expect(built.calls).toContainEqual(['addContact', 1, 0, 0, 0, malletStiffness(mallet.params.hardness), 1.5, -1])
    expect(built.bars).toEqual({ [bar.id]: 0 })
    expect(built.mallets).toEqual({ [mallet.id]: 0 })
    expect(built.targets).toEqual({ [mallet.id]: bar.id })
    expect(built.notes).toEqual([])
    // The bar's modal data is the validated model's.
    const modes = barModes(bar, SR)
    expect(modes.map((m) => m.frequency)).toEqual(barModeFrequencies({ length: 0.3, thickness: 10, density: 2700, youngsModulus: 70 }))
    expect(modes[0].mass).toBeCloseTo(2700 * 0.3 * 0.04 * 0.01, 12)
    expect(modes[0].t60).toBeCloseTo(1 / (1 / 6 + (0.001 * modes[0].frequency) / 2.2), 12)
    expect(modes[3].shape).toEqual([barModeShape(3, 0.35), barModeShape(3, 0.1)])
  })

  test('every physical connection becomes a solver connection between the two bars: never a mix', () => {
    const graph = example('mixed')
    const joint = graph.connections.find((c) => c.type === 'springDamper')!
    const { built } = translate(graph, SR) as { ok: true; built: Built }
    const [a, b] = [built.bars[joint.from], built.bars[joint.to]]
    // A corrected spring and an uncorrected damper, both between the connection ports.
    expect(built.calls.filter((c) => c[0] === 'addSpring')).toEqual([
      ['addSpring', a, CONNECTION_PORT, b, CONNECTION_PORT, joint.stiffness, 0, 0, 1],
      ['addSpring', a, CONNECTION_PORT, b, CONNECTION_PORT, 0, joint.damping, 0, 0],
    ])
    expect(built.links[joint.id]).toEqual({ spring: 0, damper: 1 })
    expect(built.mallets[byType(graph, 'mallet')[0].id]).toBe(2)
    for (const [type, expected] of [['spring', { spring: 0 }], ['damper', { damper: 0 }]] as const) {
      const one = translate(setConnection(graph, joint.id, { type }), SR) as { ok: true; built: Built }
      expect(one.built.links[joint.id]).toEqual(expected)
      expect(one.built.calls.filter((c) => c[0] === 'addSpring')).toHaveLength(1)
    }
  })

  test('disconnected components are handled and explained', () => {
    let graph = emptyGraph()
    expect(translate(graph, SR)).toMatchObject({ ok: true, built: { bars: {}, notes: [] } }) // an empty canvas is a valid, silent instrument
    const bar = addComponent(graph, 'woodBar', 0, 0)
    const loose = addComponent(bar.graph, 'mallet', 0, 0)
    graph = loose.graph
    const { built } = translate(graph, SR) as { ok: true; built: Built }
    expect(built.notes.map((n) => n.id)).toEqual([loose.id, undefined])
    expect(built.notes[0].message).toMatch(/not attached to a bar/)
    expect(built.notes[1].message).toMatch(/Wooden bar 1 has nothing attached/)
    expect(built.calls.filter((c) => c[0] === 'addResonator')).toHaveLength(1) // the loose mallet is not in the engine
    expect(exciterCalls(graph, built, loose.id)).toEqual([])
    // The lone bar can still be tapped, and the instrument's trigger falls back to that.
    expect(barCalls(graph, built, bar.id)).toHaveLength(1)
    expect(instrumentCalls(graph, built)).toEqual(barCalls(graph, built, bar.id))
  })

  test('a bar that cannot sound at the sample rate is refused, with a way out', () => {
    const graph = example('single')
    const bar = byType(graph, 'metalBar')[0]
    const tiny = setParam(setParam(graph, bar.id, 'length', 0.05), bar.id, 'thickness', 40)
    expect(validateGraph(tiny)).toEqual([]) // each value is within its own range
    const translation = translate(tiny, SR) as { ok: false; issues: { id?: string; message: string }[] }
    expect(translation.ok).toBe(false)
    expect(translation.issues[0].id).toBe(bar.id)
    expect(translation.issues[0].message).toMatch(/too short and thick to sound.*Make it longer or thinner/)
    // A bar with only some overtones in range is built, with a note.
    const short = translate(setParam(graph, bar.id, 'length', 0.12), SR) as { ok: true; built: Built }
    expect(short.built.notes[0].message).toMatch(/only its lowest \d of 8 overtones/)
  })

  test('what needs a rebuild and what does not', () => {
    const graph = example('mixed')
    const [wood, mallet] = [byType(graph, 'woodBar')[0], byType(graph, 'mallet')[0]]
    const joint = graph.connections.find((c) => c.type !== 'strike')!
    const key = structureKey(graph)
    const same = [moveComponent(graph, wood.id, 5, 5), setParam(graph, wood.id, 'damping', 3), setParam(graph, mallet.id, 'velocity', 4), setConnection(graph, joint.id, { stiffness: 1e6 }), setConnection(graph, joint.id, { damping: 9 }), addComponent(graph, 'impulse', 0, 0).graph]
    for (const g of same) expect(structureKey(g)).toBe(key)
    const different = [setParam(graph, wood.id, 'length', 0.4), setParam(graph, wood.id, 'width', 60), setParam(graph, wood.id, 'strikePosition', 0.2), setMaterial(graph, wood.id, 'maple'), setParam(graph, mallet.id, 'mass', 0.05), setParam(graph, mallet.id, 'hardness', 0.9), setConnection(graph, joint.id, { type: 'spring' }), removeConnection(graph, joint.id), addComponent(graph, 'metalBar', 0, 0).graph]
    for (const g of different) expect(structureKey(g)).not.toBe(key)
    // The declared "live" flags are exactly the properties that leave the key alone.
    for (const c of graph.components) for (const p of TYPES[c.type].params) expect(structureKey(setParam(graph, c.id, p.key, (p.min + p.max) / 2)) === key, `${c.type}.${p.key}`).toBe(p.live)
  })

  test('mode shapes are valid along the whole bar, so a position can be anywhere from end to end', () => {
    for (let n = 0; n < 8; n++) {
      for (const x of [0, 0.1, 0.35, 0.5]) {
        // Even modes are symmetric about the middle, odd ones antisymmetric.
        expect(barModeShape(n, 1 - x)).toBeCloseTo((n % 2 ? -1 : 1) * barModeShape(n, x), 6)
      }
    }
  })
})

describe('Physics through the builder', () => {
  test('modal frequencies: a built bar sounds at the beam frequencies of its material and size', () => {
    const cases: [ComponentType, string, Record<string, number>, number][] = [
      // Struck near the end, where no mode has a node, and lightly damped, so every mode rings long enough to be measured.
      ['metalBar', 'aluminium', { strikePosition: 0.03, damping: 0.1 }, 8],
      ['metalBar', 'steel', { length: 0.4, thickness: 6, width: 30, strikePosition: 0.03, damping: 0.1 }, 8],
      ['metalBar', 'bronze', { length: 0.25, thickness: 12, strikePosition: 0.97, damping: 0.1 }, 6],
      // Wood's upper modes die within milliseconds (that is its character), so only the lowest are measurable.
      ['woodBar', 'rosewood', { strikePosition: 0.03, damping: 0.1 }, 3],
      ['woodBar', 'spruce', { length: 0.5, thickness: 25, strikePosition: 0.03, damping: 0.1 }, 2],
    ]
    const report: Record<string, string>[] = []
    for (const [type, material, params, count] of cases) {
      const added = addComponent(emptyGraph(), type, 0, 0)
      let graph = setMaterial(added.graph, added.id, material)
      for (const [key, value] of Object.entries(params)) graph = setParam(graph, added.id, key, value)
      const { engine, built } = build(graph)
      const bar = graph.components[0]
      expect(barCalls(graph, built, bar.id)).toHaveLength(1) // the tap the interface would use
      const out = play(engine, [['strike', built.bars[bar.id], 0, 0.03, 0.0001]], 1.5) // a shorter one here, to reach the top modes
      const peaks = spectralPeaks(out, 65536, type === 'woodBar' ? 70 : 100).map((p) => p.freq)
      const expected = barModeFrequencies({ length: bar.params.length, thickness: bar.params.thickness, ...TYPES[type].materials![material] }).filter((f) => f < 0.45 * SR)
      expected.slice(0, count).forEach((f, n) => {
        const measured = peaks.reduce((best, p) => (Math.abs(p - f) < Math.abs(best - f) ? p : best), Infinity)
        report.push({ bar: `${material} ${type}`, mode: String(n + 1), theoryHz: f.toFixed(2), measuredHz: measured.toFixed(2), errorPct: (100 * (measured / f - 1)).toFixed(4) })
        expect(relativeError(measured, f), `${material} mode ${n + 1}`).toBeLessThan(type === 'woodBar' ? 2e-3 : 5e-4)
      })
      expect(engine.faults()).toBe(0)
    }
    console.table(report)
  })

  test('the Damping property shortens the ring, by the stated factor', () => {
    const graph = example('single')
    const bar = byType(graph, 'metalBar')[0]
    const [plain, damped] = [barModes(bar, SR), barModes({ ...bar, params: { ...bar.params, damping: 4 } }, SR)]
    plain.forEach((mode, n) => expect(damped[n].t60).toBeCloseTo(mode.t60 / 4, 12))
    const level = (g: Graph) => {
      const { engine, built } = build(g)
      const out = play(engine, barCalls(g, built, bar.id), 1)
      return Math.hypot(...out.subarray(0.9 * SR)) // what is left after 0.9 s
    }
    expect(level(setParam(graph, bar.id, 'damping', 4))).toBeLessThan(0.5 * level(graph))
  })

  test('bidirectional coupling: the spring moves the second bar, the frequencies are those of the joined system, and it works both ways', () => {
    // The example, with both bars lightly damped so that every coupled mode rings long enough to be measured.
    const graph = byType(example('coupled'), 'metalBar').reduce((g, bar) => setParam(g, bar.id, 'damping', 0.1), example('coupled'))
    const [a, b] = byType(graph, 'metalBar')
    const spring = graph.connections.find((c) => c.type === 'spring')!
    const run1 = (g: Graph, struck: string) => {
      const { engine, built } = build(g)
      const energyOther = new Float64Array(SR)
      const other = built.bars[struck === a.id ? b.id : a.id]
      const out = new Float32Array(563 * 128)
      run(engine, [['strike', built.bars[struck], 0, 0.03, 0.0004]])
      for (let n = 0; n < out.length; n += 128) {
        engine.process(128)
        out.set(new Float32Array(engine.memory.buffer, engine.outputPointer(), 128), n)
        if (n < SR) energyOther.fill(engine.resonatorEnergy(other), n, n + 128)
      }
      return { out, peakEnergyOfOther: Math.max(...energyOther), faults: engine.faults() }
    }
    // Without the spring the other bar never moves: the output is one bar, not a mix that happens to include it.
    expect(run1(removeConnection(graph, spring.id), a.id).peakEnergyOfOther).toBe(0)
    const fromA = run1(graph, a.id)
    const fromB = run1(graph, b.id)
    expect(fromA.peakEnergyOfOther).toBeGreaterThan(0)
    expect(fromB.peakEnergyOfOther).toBeGreaterThan(0)
    // Frequencies: continuous-time eigenvalues of the two bars joined at their connection points.
    const modes = [barModes(a, SR), barModes(b, SR)]
    const theory = systemFrequencies(modes, [{ a: [0, CONNECTION_PORT], b: [1, CONNECTION_PORT], stiffness: spring.stiffness }])
    const uncoupled = modes.flat().map((m) => m.frequency).sort((x, y) => x - y)
    const found = [...spectralPeaks(fromA.out, 65536, 110), ...spectralPeaks(fromB.out, 65536, 110)].map((p) => p.freq)
    const errors = theory.map((f) => relativeError(found.reduce((best, p) => (Math.abs(p - f) < Math.abs(best - f) ? p : best), Infinity), f)).sort((x, y) => y - x)
    console.log('two coupled bars through the builder: worst coupled-frequency error (two closest-pair misses allowed), %:', (100 * errors[2]).toFixed(4), '| largest shift from uncoupled, Hz:', Math.max(...theory.map((f, i) => Math.abs(f - uncoupled[i]))).toFixed(1))
    expect(errors[2]).toBeLessThan(2e-4)
    expect(Math.max(...theory.map((f, i) => Math.abs(f - uncoupled[i])))).toBeGreaterThan(5) // the spring did change the system
    expect(fromA.faults + fromB.faults).toBe(0)
  })

  test('energy: a mallet strike only ever loses energy, and never has more than the mallet brought', () => {
    for (const e of EXAMPLES) {
      const graph = e.make()
      const mallet = byType(graph, 'mallet')[0]
      const { engine, built } = build(graph)
      run(engine, exciterCalls(graph, built, mallet.id))
      const brought = 0.5 * mallet.params.mass * mallet.params.velocity ** 2
      let previous = engine.energy()
      expect(relativeError(previous, brought)).toBeLessThan(1e-12)
      let rises = 0
      for (let n = 0; n < SR; n++) {
        engine.step()
        const energy = engine.energy()
        if (energy > previous * (1 + 1e-12)) rises++
        previous = energy
      }
      expect(rises, e.label).toBe(0)
      expect(previous).toBeLessThan(brought)
      expect(engine.worstIterations()).toBeLessThan(12)
    }
  })

  test('mallet contact stays stable at every corner of its ranges, struck repeatedly', () => {
    const report: Record<string, Record<string, string | number>> = {}
    const spec = Object.fromEntries(TYPES.mallet.params.map((p) => [p.key, p]))
    for (const mass of [spec.mass.min, spec.mass.max]) {
      for (const hardness of [0, 1]) {
        for (const velocity of [spec.velocity.min, spec.velocity.max]) {
          let graph = example('single')
          const mallet = byType(graph, 'mallet')[0]
          for (const [key, value] of Object.entries({ mass, hardness, velocity })) graph = setParam(graph, mallet.id, key, value)
          const { engine, built } = build(graph)
          const strike = exciterCalls(graph, built, mallet.id)
          // Thrown again every 50 ms, whether or not it has left the bar.
          const out = render(engine, new Float32Array(2 * SR), (block) => block % 19 === 0 && block < 400 && run(engine, strike))
          const name = `mass ${mass} kg, hardness ${hardness}, ${velocity} m/s`
          report[name] = { peak: Math.max(...out.map(Math.abs)).toExponential(2), newtonWorst: engine.worstIterations(), faults: engine.faults() }
          expect(out.every(Number.isFinite), name).toBe(true)
          expect(engine.faults(), name).toBe(0)
          // One throw on a fresh instrument: stored energy never rises, whatever the solver had to do.
          const single = build(graph)
          run(single.engine, strike)
          const brought = single.engine.energy()
          let [previous, rise] = [brought, 0]
          for (let n = 0; n < SR; n++) {
            single.engine.step()
            const energy = single.engine.energy()
            rise = Math.max(rise, energy - previous)
            previous = energy
          }
          report[name].largestEnergyRise = (rise / brought).toExponential(1)
          expect(rise, name).toBeLessThan(1e-9 * brought)
        }
      }
    }
    console.table(report)
  })

  test('extreme values: every property at its lowest and at its highest gives finite sound or a clear refusal', () => {
    const outcomes: Record<string, string> = {}
    for (const e of EXAMPLES) {
      for (const end of ['min', 'max'] as const) {
        for (const stiffEnd of ['min', 'max'] as const) {
          let graph = e.make()
          for (const c of graph.components) for (const p of TYPES[c.type].params) graph = setParam(graph, c.id, p.key, p[end])
          for (const link of graph.connections) graph = setConnection(graph, link.id, { stiffness: CONNECTION_PARAMS.stiffness[stiffEnd], damping: CONNECTION_PARAMS.damping[stiffEnd] })
          const name = `${e.id}: components at ${end}, connections at ${stiffEnd}`
          expect(validateGraph(graph)).toEqual([])
          const translation = translate(graph, SR)
          if (!translation.ok) {
            outcomes[name] = `refused: ${translation.issues[0].message.slice(0, 60)}...`
            expect(translation.issues[0].message).toMatch(/too short and thick/)
            continue
          }
          const engine = createEngine()
          run(engine, translation.built.calls)
          const strike = instrumentCalls(graph, translation.built)
          const out = render(engine, new Float32Array(SR), (block) => block % 40 === 0 && run(engine, strike))
          outcomes[name] = `plays: peak ${Math.max(...out.map(Math.abs)).toExponential(2)}, faults ${engine.faults()}`
          expect(out.every(Number.isFinite), name).toBe(true)
          expect(engine.faults(), name).toBe(0)
        }
      }
    }
    console.table(outcomes)
    expect(Object.values(outcomes).some((o) => o.startsWith('plays'))).toBe(true)
  })

  test('numerical overflow is caught and counted, not passed on and not hidden', () => {
    const graph = example('coupled')
    const { engine, built } = build(graph)
    const bar = built.bars[byType(graph, 'metalBar')[0].id]
    // Far outside anything the builder can ask for: a force that overflows 64-bit arithmetic.
    const out = render(engine, new Float32Array(4800), (block) => block === 3 && engine.applyForce(bar, 0, 1e308))
    expect(out.every(Number.isFinite)).toBe(true) // the listener gets silence, not a burst
    expect(engine.faults()).toBeGreaterThan(0) // and the fault is on record for the interface to show
    // It recovers: after the fault the system is silent and can be played again.
    const after = play(engine, barCalls(graph, built, byType(graph, 'metalBar')[0].id), 0.2)
    expect(Math.max(...after.map(Math.abs))).toBeGreaterThan(0.001)
    expect(after.every(Number.isFinite)).toBe(true)
  })
})

describe('Audio session: lifecycle and parameter updates', () => {
  /** The session's audio side, with the real engine and no AudioContext. */
  function fake() {
    const log = { opens: 0, closes: 0, rebuilds: 0, sends: 0 }
    let engine: Engine | null = null
    const backend: Backend = {
      async open() {
        log.opens++
        engine = createEngine()
        run(engine, [['reset', SR, 2], ['build']])
        const mine = engine
        return {
          sampleRate: SR,
          send: (calls) => (log.sends++, run(mine, calls)),
          rebuild: (calls) => (log.rebuilds++, run(mine, calls)),
          close: async () => void log.closes++,
        }
      },
    }
    const listen = (seconds = 0.3) => render(engine!, new Float32Array(Math.round(seconds * SR)))
    return { backend, log, listen, engine: () => engine! }
  }
  const peak = (x: Float32Array) => Math.max(...x.map(Math.abs))

  test('start, play, stop: one engine, nothing left behind, safe to repeat', async () => {
    const { backend, log, listen } = fake()
    const session = new Session(backend)
    const graph = example('single')
    expect(session.play()).toBe(false) // nothing happens before audio starts
    expect(session.update(graph)).toBe('stopped')
    await Promise.all([session.start(graph), session.start(graph), session.start(graph)])
    await session.start(graph)
    expect(log).toMatchObject({ opens: 1, rebuilds: 1 }) // three simultaneous starts and one more: still one engine, built once
    expect(session.state).toMatchObject({ running: true, issues: [], rebuilds: 1 })
    expect(peak(listen())).toBe(0) // silent until played
    expect(session.play()).toBe(true)
    expect(peak(listen(1))).toBeGreaterThan(0.01)
    await Promise.all([session.stop(), session.stop()])
    expect(log).toMatchObject({ opens: 1, closes: 1 })
    expect(session.state.running).toBe(false)
    expect(session.play()).toBe(false)
    expect(session.strikeBar(byType(graph, 'metalBar')[0].id)).toBe(false)
    for (let i = 0; i < 3; i++) {
      await session.start(graph)
      await session.stop()
    }
    expect(log).toMatchObject({ opens: 4, closes: 4 })
  })

  test('a failed start leaves nothing running and can be retried', async () => {
    let fail = true
    const { backend, log } = fake()
    const flaky: Backend = { open: () => (fail ? Promise.reject(new Error('no audio device')) : backend.open()) }
    const session = new Session(flaky)
    await expect(session.start(example('single'))).rejects.toThrow('no audio device')
    expect(session.state.running).toBe(false)
    fail = false
    await session.start(example('single'))
    expect(session.state.running).toBe(true)
    expect(log.opens).toBe(1)
  })

  test('live properties are applied to the running engine; structural ones rebuild it', async () => {
    const { backend, log, engine } = fake()
    const session = new Session(backend)
    let graph = example('mixed')
    const [wood, metal, mallet] = [byType(graph, 'woodBar')[0], byType(graph, 'metalBar')[0], byType(graph, 'mallet')[0]]
    const joint = graph.connections.find((c) => c.type === 'springDamper')!
    await session.start(graph)
    const edit = (next: Graph) => session.update((graph = next))

    expect(edit(moveComponent(graph, wood.id, 400, 400))).toBe('unchanged') // moving it on the canvas is not a physical change
    expect(edit(setConnection(graph, joint.id, { stiffness: 1e6 }))).toBe('live')
    for (let n = 0; n < 600; n++) engine().step() // the 10 ms glide
    expect(engine().stiffness(0)).toBe(1e6)
    expect(edit(setConnection(graph, joint.id, { damping: 7 }))).toBe('live')
    expect(edit(setParam(graph, metal.id, 'damping', 5))).toBe('live')
    expect(edit(setParam(graph, mallet.id, 'velocity', 3))).toBe('unchanged') // used at the next strike; nothing to send now
    expect(session.needsRebuild(graph)).toBe(false)
    expect(log.rebuilds).toBe(1)

    for (const next of [setParam(graph, wood.id, 'length', 0.45), setMaterial(graph, metal.id, 'steel'), setParam(graph, mallet.id, 'hardness', 0.8), setConnection(graph, joint.id, { type: 'spring' })]) {
      expect(session.needsRebuild(next)).toBe(true)
      expect(edit(next)).toBe('rebuilt')
    }
    expect(log.rebuilds).toBe(5)
    expect(log.opens).toBe(1) // rebuilding reuses the one engine: no second audio node
    expect(session.state.rebuilds).toBe(5)
    await session.stop()
  })

  test('a live edit leaves the engine in the same state as building the edited instrument from scratch', async () => {
    const graph = example('mixed')
    const metal = byType(graph, 'metalBar')[0]
    const joint = graph.connections.find((c) => c.type === 'springDamper')!
    const edited = setParam(setConnection(graph, joint.id, { stiffness: 3e6, damping: 4 }), metal.id, 'damping', 2.5)
    const live = fake()
    const a = new Session(live.backend)
    await a.start(graph)
    a.update(edited)
    for (let n = 0; n < 600; n++) live.engine().step() // let the stiffness glide finish while silent
    const fresh = fake()
    const b = new Session(fresh.backend)
    await b.start(edited)
    for (let n = 0; n < 600; n++) fresh.engine().step()
    a.play()
    b.play()
    const [x, y] = [live.listen(1), fresh.listen(1)]
    let worst = 0
    for (let n = 0; n < x.length; n++) worst = Math.max(worst, Math.abs(x[n] - y[n]))
    console.log('live-edited against rebuilt, largest sample difference relative to peak:', (worst / peak(y)).toExponential(1))
    expect(worst / peak(y)).toBeLessThan(1e-9)
  })

  test('strike velocity is read at each strike: louder without rebuilding', async () => {
    const { backend, log, listen } = fake()
    const session = new Session(backend)
    let graph = example('single')
    const [bar, mallet] = [byType(graph, 'metalBar')[0], byType(graph, 'mallet')[0]]
    await session.start(graph)
    session.strikeExciter(mallet.id)
    const soft = peak(listen(1.2))
    session.update((graph = setParam(graph, mallet.id, 'velocity', 4.5)))
    session.strikeBar(bar.id) // striking the bar uses the mallet attached to it
    const hard = peak(listen(1.2))
    expect(hard).toBeGreaterThan(2 * soft)
    expect(log.rebuilds).toBe(1)
  })

  test('an invalid instrument silences the engine, says why, and recovers when fixed', async () => {
    const { backend, log, listen } = fake()
    const states: boolean[] = []
    const session = new Session(backend, (s) => states.push(s.issues.length > 0))
    const graph = example('single')
    const bar = byType(graph, 'metalBar')[0]
    await session.start(graph)
    session.play()
    listen(0.1)
    expect(session.update(setParam(graph, bar.id, 'length', 7))).toBe('invalid')
    expect(session.state.issues[0]).toMatchObject({ id: bar.id })
    expect(session.state.issues[0].message).toMatch(/Length must be between/)
    expect(peak(listen(0.1))).toBe(0) // the old instrument is not left ringing under an invalid design
    expect(session.play()).toBe(false)
    expect(session.update(graph)).toBe('rebuilt')
    expect(session.state.issues).toEqual([])
    expect(session.play()).toBe(true)
    expect(peak(listen(1))).toBeGreaterThan(0.01)
    expect(states).toContain(true)
    expect(log.opens).toBe(1)
  })

  test('adding and deleting components while running keeps the engine and the graph in step', async () => {
    const { backend, listen, engine } = fake()
    const session = new Session(backend)
    let graph = example('single')
    await session.start(graph)
    const second = addComponent(graph, 'woodBar', 0, 0)
    expect(session.update((graph = second.graph))).toBe('rebuilt')
    expect(session.state.notes.map((n) => n.message)).toEqual(['Wooden bar 1 has nothing attached. Double-click a bar, or use Strike, to tap it directly.'])
    const joined = connect(graph, graph.components[0].id, second.id)
    expect(session.update((graph = joined.graph))).toBe('rebuilt')
    expect(session.state.notes).toEqual([])
    session.play()
    listen(0.5)
    expect(engine().resonatorEnergy(1)).toBeGreaterThan(0) // the new bar is being driven through the new connection
    expect(session.update((graph = removeComponent(graph, second.id)))).toBe('rebuilt')
    expect(session.strikeBar(second.id)).toBe(false) // it is gone from the engine too
    expect(session.play()).toBe(true)
    expect(session.update((graph = emptyGraph()))).toBe('rebuilt')
    expect(session.play()).toBe(false)
    expect(peak(listen(0.1))).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Phase 3B.1: regression tests for the problems found while using the builder,
// and randomised tests that the engine, the graph, undo/redo and saving stay
// in step with each other.

/** A repeatable source of random numbers in [0, 1). */
function seeded(seed: number) {
  let s = seed
  return () => (s = (s * 48271) % 2147483647) / 2147483647
}

/** One random edit of the kind a user can make. `structural` false keeps to edits that do not rebuild. */
function randomEdit(graph: Graph, random: () => number): Graph {
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)]
  const types: ComponentType[] = ['metalBar', 'woodBar', 'mallet', 'impulse']
  const roll = random()
  if (graph.components.length === 0 || (roll < 0.14 && graph.components.length < 7)) return addComponent(graph, pick(types), 100 + 700 * random(), 80 + 400 * random()).graph
  if (roll < 0.17) return removeComponent(graph, pick(graph.components).id)
  if (roll < 0.36) {
    const [a, b] = [pick(graph.components), pick(graph.components)]
    return cannotConnect(graph, a.id, b.id) ? graph : connect(graph, a.id, b.id).graph
  }
  if (roll < 0.42 && graph.connections.length) return removeConnection(graph, pick(graph.connections).id)
  if (roll < 0.56 && graph.connections.some((c) => c.type !== 'strike')) {
    const link = pick(graph.connections.filter((c) => c.type !== 'strike'))
    const choice = random()
    if (choice < 0.3) return setConnection(graph, link.id, { type: pick(['spring', 'damper', 'springDamper'] as const) })
    if (choice < 0.65) return setConnection(graph, link.id, { stiffness: 10 ** (2 + 6 * random()) })
    return setConnection(graph, link.id, { damping: 100 * random() })
  }
  if (roll < 0.62) {
    const c = pick(graph.components)
    return moveComponent(graph, c.id, 100 + 700 * random(), 80 + 400 * random())
  }
  const c = pick(graph.components)
  if (TYPES[c.type].materials && random() < 0.15) return setMaterial(graph, c.id, pick(Object.keys(TYPES[c.type].materials!)))
  const p = pick(TYPES[c.type].params)
  // Bars are kept long enough to sound, so that the walk stays on buildable instruments.
  const low = p.key === 'length' ? 0.2 : p.min
  const high = p.key === 'thickness' ? 20 : p.max
  return setParam(graph, c.id, p.key, p.log ? low * (high / low) ** random() : low + (high - low) * random())
}

describe('Phase 3B.1 regressions: interaction', () => {
  test('pressing near a component\'s dot starts a connection; pressing its body moves it', () => {
    // Found in use: the dot was a 16-unit target, so a press a few pixels off it moved the bar instead of connecting it.
    for (const e of EXAMPLES) {
      for (const c of e.make().components) {
        const dot = handle(c)
        for (const [dx, dy] of [[0, 0], [8, 0], [-10, 6], [0, 14], [12, -12]]) expect(onHandle(c, { x: dot.x + dx, y: dot.y + dy }), `${c.name} +${dx},${dy}`).toBe(true)
        expect(onHandle(c, { x: dot.x + HANDLE_REACH + 1, y: dot.y })).toBe(false)
        // The far end of a bar, and the top of an exciter, are the body.
        const far = isResonator(c) ? { x: c.x + barSize(c).w / 2 - 4, y: c.y } : { x: c.x, y: c.y - EXCITER_RADIUS + 3 }
        expect(onHandle(c, far)).toBe(false)
        expect(componentAt(e.make(), far)).toBe(c.id)
      }
    }
    expect(HANDLE_REACH).toBeGreaterThanOrEqual(16)
  })

  test('a new component never lands on top of an existing one, also after deletions', () => {
    // Found in use: placement depended on how many components there were, so after a deletion a new one covered an old one.
    const apart = (graph: Graph) => {
      const boxes = graph.components.map((c) => {
        const [w, h] = isResonator(c) ? [barSize(c).w, barSize(c).h] : [2 * EXCITER_RADIUS, 2 * EXCITER_RADIUS]
        return { l: c.x - w / 2, r: c.x + w / 2, t: c.y - h / 2, b: c.y + h / 2 }
      })
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const [p, q] = [boxes[i], boxes[j]]
          if (!(p.r < q.l || p.l > q.r || p.b < q.t || p.t > q.b)) return false
        }
      }
      return true
    }
    const place = (graph: Graph, type: ComponentType) => {
      const spot = freeSpot(graph, TYPES[type].kind === 'exciter')
      expect(spot.x).toBeGreaterThanOrEqual(40)
      expect(spot.x).toBeLessThanOrEqual(CANVAS.width - 40)
      expect(spot.y).toBeLessThanOrEqual(CANVAS.height - 40)
      return addComponent(graph, type, spot.x, spot.y)
    }
    let graph = emptyGraph()
    const order: ComponentType[] = ['mallet', 'metalBar', 'woodBar', 'metalBar', 'impulse', 'woodBar', 'mallet', 'metalBar']
    for (const type of order) graph = place(graph, type).graph
    expect(apart(graph)).toBe(true)
    // Delete from the middle, add again: still nothing covered.
    graph = removeComponent(removeComponent(graph, graph.components[1].id), graph.components[4].id)
    for (const type of ['woodBar', 'metalBar', 'mallet'] as ComponentType[]) graph = place(graph, type).graph
    expect(apart(graph)).toBe(true)
    // And on top of each example.
    for (const e of EXAMPLES) expect(apart(place(place(e.make(), 'metalBar').graph, 'impulse').graph), e.label).toBe(true)
  })

  test('a value being typed is used only when it is a number in range', () => {
    // Found in review: every keystroke was applied, so typing "0.35" passed through "0", silenced the
    // instrument and saved an unloadable one.
    const length = TYPES.metalBar.params.find((p) => p.key === 'length')!
    for (const text of ['', ' ', '-', '.', 'abc', '1e', '0', '0.0', '0.04', '1.51', '9999', 'NaN', 'Infinity', '-0.3']) {
      const entry = parseEntry(text, length)
      expect('error' in entry, `"${text}"`).toBe(true)
      expect((entry as { error: string }).error).toMatch(/between 0.05 and 1.5 m/)
    }
    for (const [text, value] of [['0.3', 0.3], [' 0.30 ', 0.3], ['3e-1', 0.3], ['.5', 0.5], ['0.05', 0.05], ['1.5', 1.5]] as const) expect(parseEntry(text, length)).toEqual({ value })
    // Typing 0.35 one key at a time: only the last two states are applied, and both are valid.
    const applied = ['0', '0.', '0.3', '0.35'].map((text) => parseEntry(text, length)).filter((entry) => 'value' in entry)
    expect(applied).toEqual([{ value: 0.3 }, { value: 0.35 }])
    expect(parseEntry('500', CONNECTION_PARAMS.damping)).toEqual({ error: 'Must be between 0 and 100 N s/m. The instrument keeps the last valid value.' })
  })

  test('a saved instrument that cannot be read is reported, never silently replaced', () => {
    const good = example('mixed')
    expect(restore(null)).toEqual({ graph: null })
    expect(restore(serialize(good))).toEqual({ graph: good })
    for (const text of ['', 'not json', '{}', serialize(setParam(good, good.components[0].id, 'length', NaN)), serialize({ ...good, version: 7 as 1 })]) {
      const result = restore(text)
      expect(result.graph).toBeNull()
      expect(result.problem).toMatch(/Not a saved instrument|cannot be loaded/)
    }
  })

  test('bars with nothing attached are mentioned once, not once each', () => {
    let graph = emptyGraph()
    for (const type of ['metalBar', 'woodBar', 'metalBar'] as ComponentType[]) graph = addComponent(graph, type, 0, 0).graph
    const { built } = translate(graph, SR) as { ok: true; built: Built }
    expect(built.notes).toHaveLength(1)
    expect(built.notes[0].message).toBe('Metal bar 1, Wooden bar 1 and Metal bar 2 have nothing attached. Double-click a bar, or use Strike, to tap it directly.')
    const one = translate(addComponent(emptyGraph(), 'woodBar', 0, 0).graph, SR) as { ok: true; built: Built }
    expect(one.built.notes[0].message).toMatch(/^Wooden bar 1 has nothing attached/)
  })
})

describe('Phase 3B.1: the graph, the engine, undo/redo and saving stay in step', () => {
  function fake() {
    const log = { opens: 0, closes: 0, rebuilds: 0, sends: 0 }
    let engine: Engine | null = null
    const backend: Backend = {
      async open() {
        log.opens++
        engine = createEngine()
        run(engine, [['reset', SR, 2], ['build']])
        const mine = engine
        return { sampleRate: SR, send: (calls) => (log.sends++, run(mine, calls)), rebuild: (calls) => (log.rebuilds++, run(mine, calls)), close: async () => void log.closes++ }
      },
    }
    return { backend, log, engine: () => engine!, listen: (seconds: number) => render(engine!, new Float32Array(Math.round(seconds * SR))) }
  }
  const peak = (x: Float32Array) => Math.max(...x.map(Math.abs))

  test('after 400 random edits, undos and redos, the running engine is exactly what a fresh build of the final graph would be', async () => {
    for (const seed of [11, 2024, 77777]) {
      const random = seeded(seed)
      const walked = fake()
      const session = new Session(walked.backend)
      let history: History = startHistory(example('single'))
      await session.start(history.present)
      const outcomes: Record<string, number> = {}
      for (let step = 0; step < 400; step++) {
        const roll = random()
        history = roll < 0.12 ? undo(history) : roll < 0.2 ? redo(history) : commit(history, randomEdit(history.present, random), '', step)
        const graph = history.present
        expect(validateGraph(graph), `seed ${seed} step ${step}`).toEqual([])
        // What is saved at this step loads back as exactly this graph.
        expect(restore(serialize(graph)).graph).toEqual(graph)
        const outcome = session.update(graph)
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
        expect(outcome).not.toBe('invalid')
        expect(session.needsRebuild(graph)).toBe(false)
        expect(session.state.issues).toEqual([])
      }
      // Let any stiffness glide finish, then play both and compare sample for sample.
      const fresh = fake()
      const reference = new Session(fresh.backend)
      await reference.start(history.present)
      for (const e of [walked.engine(), fresh.engine()]) for (let n = 0; n < 600; n++) e.step()
      const played = [session.play(), reference.play()]
      expect(played[0]).toBe(played[1])
      const [a, b] = [walked.listen(0.5), fresh.listen(0.5)]
      let worst = 0
      for (let n = 0; n < a.length; n++) worst = Math.max(worst, Math.abs(a[n] - b[n]))
      console.log(`seed ${seed}:`, JSON.stringify(outcomes), '| components', history.present.components.length, 'connections', history.present.connections.length, '| played', played[0], '| largest difference from a fresh build', worst)
      expect(worst).toBeLessThanOrEqual(1e-9 * Math.max(peak(b), 1e-12))
      expect(walked.log.opens).toBe(1) // one engine throughout
      expect(walked.engine().faults()).toBe(0)
      expect(outcomes.rebuilt).toBeGreaterThan(50)
      expect(outcomes.live).toBeGreaterThan(10)
    }
  })

  test('undo returns exactly to every earlier state and redo to every later one', () => {
    const random = seeded(5)
    let history: History = startHistory(example('coupled'))
    const states = [history.present]
    while (states.length < 60) {
      const next = randomEdit(history.present, random)
      if (next === history.present) continue
      history = commit(history, next, '', states.length * 1000)
      states.push(next)
    }
    for (let i = states.length - 2; i >= 0; i--) {
      history = undo(history)
      expect(history.present).toBe(states[i])
    }
    expect(undo(history)).toBe(history)
    for (let i = 1; i < states.length; i++) {
      history = redo(history)
      expect(history.present).toBe(states[i])
    }
    expect(redo(history)).toBe(history)
    // Deleting a component and undoing brings back its connections with their own values.
    const graph = example('mixed')
    const wood = byType(graph, 'woodBar')[0]
    const edited = setConnection(graph, graph.connections[1].id, { stiffness: 12345, damping: 6.5 })
    const after = undo(commit(startHistory(edited), removeComponent(edited, wood.id), '', 1))
    expect(after.present.connections).toEqual(edited.connections)
    expect(isExciter(after.present.components[2])).toBe(true)
  })

  test('repeated structural edits while playing: 300 rebuilds, one engine, fixed memory, no faults', async () => {
    const { backend, log, engine, listen } = fake()
    const session = new Session(backend)
    let graph = example('mixed')
    const [wood, metal, mallet] = [byType(graph, 'woodBar')[0], byType(graph, 'metalBar')[0], byType(graph, 'mallet')[0]]
    const joint = graph.connections.find((c) => c.type === 'springDamper')!
    await session.start(graph)
    const memory = engine().memory.buffer.byteLength
    const random = seeded(99)
    let finite = true
    let loudest = 0
    const started = performance.now()
    for (let i = 0; i < 300; i++) {
      // Each of these rebuilds: a slider dragged through structural values, materials and connection kinds switched.
      const edits = [
        () => setParam(graph, wood.id, 'length', 0.25 + 0.5 * random()),
        () => setParam(graph, metal.id, 'thickness', 4 + 12 * random()),
        () => setMaterial(graph, metal.id, ['aluminium', 'steel', 'brass', 'bronze'][i % 4]),
        () => setParam(graph, mallet.id, 'hardness', random()),
        () => setConnection(graph, joint.id, { type: (['spring', 'damper', 'springDamper'] as const)[Math.floor(i / 6) % 3] }),
        () => setParam(graph, wood.id, 'connectionPosition', random()),
      ]
      graph = edits[i % edits.length]()
      session.play() // into the instrument that is about to be replaced
      listen(0.01)
      expect(session.update(graph), `edit ${i}`).toBe('rebuilt')
      expect(peak(listen(0.005))).toBe(0) // a rebuild starts from rest
      session.play()
      const out = listen(0.03)
      finite &&= out.every(Number.isFinite)
      loudest = Math.max(loudest, peak(out))
    }
    const ms = performance.now() - started
    console.log('300 rebuilds with playing between them:', Math.round(ms), 'ms in all |', log, '| faults', engine().faults(), '| loudest', loudest.toFixed(3))
    expect(finite).toBe(true)
    expect(loudest).toBeGreaterThan(0.01)
    expect(log).toMatchObject({ opens: 1, rebuilds: 301 })
    expect(engine().faults()).toBe(0)
    expect(engine().memory.buffer.byteLength).toBe(memory)
    expect(session.state).toMatchObject({ running: true, issues: [], rebuilds: 301 })
  })

  test('a rebuild takes a fraction of an audio block', () => {
    const graph = example('mixed')
    const { built } = translate(graph, SR) as { ok: true; built: Built }
    const engine = createEngine()
    const times: number[] = []
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now()
      const translation = translate(graph, SR) as { ok: true; built: Built }
      const t1 = performance.now()
      run(engine, translation.built.calls)
      times.push(performance.now() - t1, t1 - t0)
    }
    const median = (v: number[]) => [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)]
    const [inEngine, translating] = [median(times.filter((_, i) => i % 2 === 0)), median(times.filter((_, i) => i % 2 === 1))]
    console.log('rebuild of the wood + metal + mallet example: engine calls', built.calls.length, '| median ms in the engine', inEngine.toFixed(3), '| median ms translating', translating.toFixed(3), '(one audio block is 2.667 ms)')
    expect(inEngine).toBeLessThan(1) // it runs on the audio thread, between two blocks
  })
})
