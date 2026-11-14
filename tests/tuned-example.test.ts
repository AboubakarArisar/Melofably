// Phase 3D.5.1: the tuned candidate of Phase 3D.5 as a separate experimental
// example in the builder. It must be exactly the configuration that was
// validated, play as the research measured, and leave every other example
// as it was.
import { describe, expect, test } from 'vitest'
import { levels, pitchNear, withoutListener } from '../analysis/hybrid-study'
import { frequenciesOf, pressureByRadiator } from '../analysis/radiation'
import { createWorklet, type Worklet } from '../analysis/worklet'
import { EXAMPLES, RADIATION_EXAMPLES, STRING_EXAMPLES } from '../src/builder/examples'
import { addComponent, commit, redo, removeComponent, removeConnection, restore, serialize, setConnection, setParam, startHistory, undo, validateGraph, type Component, type Graph } from '../src/builder/graph'
import { Session, type Backend } from '../src/builder/session'
import { instrumentCalls, LISTENER, LISTENER_FULL_SCALE, OUTPUT_GAIN, structureKey, translate } from '../src/builder/translate'
import { CANDIDATES, design } from '../src/experimental/radiation/hybridCandidates'
import { stringPitch } from '../src/experimental/string/stringBody'
import type { Call } from '../src/experimental/wasm/engine'
import { SR } from './helpers'

const tuned = () => RADIATION_EXAMPLES.find((x) => x.id === 'string-bar-pressure-tuned')!.make()
const original = () => RADIATION_EXAMPLES.find((x) => x.id === 'string-bar-pressure')!.make()
const part = (graph: Graph, type: Component['type']) => graph.components.find((c) => c.type === type)!
const jointOf = (graph: Graph) => graph.connections.find((c) => c.type !== 'strike')!
const largest = (x: ArrayLike<number>) => {
  let m = 0
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}
const built = (graph: Graph) => {
  const translation = translate(graph, SR)
  if (!translation.ok) throw new Error(translation.issues[0].message)
  return translation.built
}
const F0 = stringPitch({ tension: 73.5, length: 0.65 })

class NodeBackend implements Backend {
  worklet!: Worklet
  async open() {
    this.worklet = await createWorklet([['reset', SR, 2], ['build']])
    return { sampleRate: SR, send: (calls: Call[]) => this.worklet.send(calls), rebuild: (calls: Call[]) => this.worklet.send(calls), close: async () => {} }
  }
  /** The node's output: pascals over LISTENER_FULL_SCALE. */
  out(seconds: number) {
    return this.worklet.render(Math.round(seconds * SR))
  }
  pascals(seconds: number) {
    return this.out(seconds).map((v) => v * LISTENER_FULL_SCALE)
  }
  get engine() {
    return this.worklet.engine
  }
}
async function playing(graph: Graph) {
  const backend = new NodeBackend()
  const session = new Session(backend)
  await session.start(graph)
  return { backend, session }
}

describe('The tuned hybrid example', () => {
  test('it is exactly the configuration validated in Phase 3D.5', () => {
    const graph = tuned()
    expect(graph).toEqual(design(CANDIDATES.tuned))
    expect(validateGraph(graph)).toEqual([])
    expect(graph.components.map((c) => c.type)).toEqual(['steelString', 'metalBar', 'mallet', 'listener'])
    // The bar: aluminium, 0.485 m x 40 mm x 10 mm, struck at 0.35, and the string tied at its very end.
    expect(part(graph, 'metalBar').material).toBe('aluminium')
    expect(part(graph, 'metalBar').params).toEqual({ length: 0.485, width: 40, thickness: 10, damping: 1, strikePosition: 0.35, connectionPosition: 0 })
    // The string, its pluck, the mallet and the joint: those of the hybrid.
    expect(part(graph, 'steelString').params).toEqual({ tension: 73.5, length: 0.65, pluckPosition: 0.8, pluckStrength: 4, pluckSoftness: 0.3, retrigger: 0 })
    expect(part(graph, 'mallet').params).toEqual({ mass: 0.02, hardness: 0.5, velocity: 1.5 })
    expect(jointOf(graph)).toMatchObject({ type: 'spring', stiffness: 1e6, from: part(graph, 'steelString').id, to: part(graph, 'metalBar').id })
    expect(LISTENER).toEqual({ distance: 1, angle: 45 })
    // The bar's modes lie beside the string's harmonics 2, 11, 18 and 27.
    const ratios = frequenciesOf(part(graph, 'metalBar')).map((f) => f / F0)
    expect(ratios.slice(0, 5).map((x) => Number(x.toFixed(2)))).toEqual([2.02, 5.58, 10.94, 18.08, 27.01])
  })

  test('it differs from the original radiated example in the bar\'s length and where the string is tied, and in no gain', () => {
    const [a, b] = [tuned(), original()]
    const bar = part(b, 'metalBar')
    expect(setParam(setParam(b, bar.id, 'length', 0.485), bar.id, 'connectionPosition', 0)).toEqual(a)
    const [now, was] = [built(a), built(b)]
    expect(now.output).toBe('pressure')
    // Call for call the same system: only numbers that follow from the bar's length and the tie differ.
    expect(now.calls.map((call) => call[0])).toEqual(was.calls.map((call) => call[0]))
    const differing = new Set(now.calls.filter((call, i) => JSON.stringify(call) !== JSON.stringify(was.calls[i])).map((call) => call[0]))
    expect([...differing].sort()).toEqual(['radiator', 'setMode', 'setShape'])
    // The engine's own output gain, the pressure ceiling, the pluck and the stroke are the same.
    expect(now.calls.filter((call) => call[0] === 'addOutput')).toEqual(was.calls.filter((call) => call[0] === 'addOutput'))
    expect(now.calls.find((call) => call[0] === 'addOutput')![3]).toBe(OUTPUT_GAIN)
    expect(now.calls.at(-1)![1]).toBe(LISTENER_FULL_SCALE)
    expect(was.calls.at(-1)![1]).toBe(LISTENER_FULL_SCALE)
    expect(instrumentCalls(a, now)).toEqual(instrumentCalls(b, was))
  })

  test('the examples that were there are the ones that were there', () => {
    expect(EXAMPLES.map((x) => x.id)).toEqual(['single', 'coupled', 'mixed'])
    expect(STRING_EXAMPLES.map((x) => x.id)).toEqual(['string', 'string-bar'])
    expect(RADIATION_EXAMPLES.map((x) => x.id)).toEqual(['string-bar-pressure', 'string-bar-pressure-tuned'])
    // The original radiated example is the original hybrid plus a listener; the original hybrid has no listener and its own bar.
    const hybrid = STRING_EXAMPLES[1].make()
    expect(removeComponent(original(), part(original(), 'listener').id)).toEqual({ ...hybrid, nextId: original().nextId })
    expect(part(hybrid, 'metalBar').params).toMatchObject({ length: 0.4, connectionPosition: 0.1 })
    expect(part(original(), 'metalBar').params).toMatchObject({ length: 0.4, connectionPosition: 0.1 })
    expect(RADIATION_EXAMPLES.every((x) => /sound pressure/.test(x.label))).toBe(true)
  })

  test('what it plays is what the research measured: pluck 0.119 Pa and 64.8 dB, stroke 1.68 Pa, string in tune', async () => {
    const graph = tuned()
    const a = await playing(graph)
    expect(a.session.strikeBar(part(graph, 'steelString').id)).toBe(true)
    const pluck = a.backend.pascals(3)
    const b = await playing(graph)
    expect(b.session.strikeExciter(part(graph, 'mallet').id)).toBe(true)
    const stroke = b.backend.pascals(3)
    const [lp, ls] = [levels(pluck), levels(stroke)]
    expect(lp.peakPa).toBeGreaterThan(0.115)
    expect(lp.peakPa).toBeLessThan(0.123)
    expect(Math.abs(lp.lafMax_dB - 64.8)).toBeLessThan(0.3)
    expect(Math.abs(lp.selA_dB - 58.6)).toBeLessThan(0.3)
    expect(ls.peakPa).toBeGreaterThan(1.63)
    expect(ls.peakPa).toBeLessThan(1.73)
    expect(Math.abs(ls.lafMax_dB - 85.9)).toBeLessThan(0.3)
    // Against the original radiated example, the same pluck: 25 dB more by the meter, 22 dB in peak.
    const c = await playing(original())
    c.session.strikeBar(part(original(), 'steelString').id)
    const before = levels(c.backend.pascals(3))
    expect(lp.lafMax_dB - before.lafMax_dB).toBeGreaterThan(24.5)
    expect(lp.lafMax_dB - before.lafMax_dB).toBeLessThan(25.7)
    expect(20 * Math.log10(lp.peakPa / before.peakPa)).toBeGreaterThan(21)
    for (const x of [a, b, c]) expect(x.backend.engine.faults()).toBe(0)
    expect(largest(stroke) / LISTENER_FULL_SCALE).toBeLessThan(0.2) // far from the node's ceiling
  }, 400000)

  test('and it is the validated radiator on that bar: sample for sample the prototype route, and the string keeps its pitch', async () => {
    const graph = tuned()
    const { backend, session } = await playing(graph)
    expect(session.play()).toBe(true) // plucked and struck together
    const sound = backend.out(2)
    // The same instrument built the research way: the plain hybrid's calls with ports and taps added by the analysis harness.
    const plain = withoutListener(graph)
    const prototype = await pressureByRadiator({ graph: plain, bar: part(plain, 'metalBar'), listener: LISTENER, seconds: 2 }, LISTENER_FULL_SCALE)
    expect(Array.from(sound, (v) => v * LISTENER_FULL_SCALE)).toEqual(Array.from(prototype.pressure))
    // The string's own pitch, read from the string: within 2 cents of the string between fixed ends.
    const worklet = await createWorklet([...built(graph).calls, ['addTap', 0, 2]])
    worklet.send(instrumentCalls(graph, built(graph)).slice(0, 1))
    const taps = new Float64Array(worklet.engine.memory.buffer, worklet.engine.tapPointer(), 32 * 128)
    const string = new Float32Array(3 * SR)
    for (let i = 0; i < string.length; i++) {
      worklet.render(1)
      string[i] = taps[16 * 128]
    }
    expect(Math.abs(1200 * Math.log2(pitchNear(string, F0) / F0))).toBeLessThan(2) // measured -1.36
  }, 400000)

  test('played as the hybrid is: pluck, mallet, mute, pull and release; the joint is live; the same playing gives the same samples', async () => {
    const graph = tuned()
    const [stringId, barId, malletId] = [part(graph, 'steelString').id, part(graph, 'metalBar').id, part(graph, 'mallet').id]
    const run = async () => {
      const { backend, session } = await playing(graph)
      const heard: number[] = []
      expect(session.strikeBar(stringId)).toBe(true)
      heard.push(largest(backend.pascals(0.5)))
      expect(session.strikeExciter(malletId)).toBe(true)
      heard.push(largest(backend.pascals(0.5)))
      expect(session.strikeBar(barId)).toBe(true) // the same stroke, asked of the bar
      backend.out(0.2)
      // Mute: a finger on the string takes the string's energy, and the bar is left holding far more than the string.
      // This bar is tied more closely to the string than the original's, so the finger also drains it faster
      // through the joint: after 0.3 s it keeps 3.6 % of its energy (the original hybrid's bar keeps more than 5 %).
      const [stringBefore, barBefore] = [backend.engine.resonatorEnergy(0), backend.engine.resonatorEnergy(1)]
      expect(session.touch(true)).toBe(true)
      backend.out(0.3)
      expect(backend.engine.resonatorEnergy(0)).toBeLessThan(0.2 * stringBefore)
      expect(backend.engine.resonatorEnergy(1)).toBeGreaterThan(0.02 * barBefore)
      expect(backend.engine.resonatorEnergy(1)).toBeLessThan(0.06 * barBefore)
      expect(backend.engine.resonatorEnergy(1)).toBeGreaterThan(5 * backend.engine.resonatorEnergy(0))
      expect(session.touch(false)).toBe(true)
      // Pulled aside 4 mm and released.
      expect(session.pull(0.004)).toBeGreaterThan(2)
      backend.out(0.4)
      expect(session.release()).toBe(true)
      heard.push(largest(backend.pascals(0.5)))
      // The joint, the bar's damping and the string's tension change while it rings.
      const joint = jointOf(graph)
      expect(session.update(setConnection(graph, joint.id, { stiffness: 3e5 }))).toBe('live')
      const damped = setConnection(graph, joint.id, { type: 'springDamper', damping: 5 })
      expect(session.update(damped)).toBe('rebuilt') // a damper is another kind of joint
      expect(session.update(setConnection(damped, joint.id, { damping: 20, stiffness: 2e6 }))).toBe('live')
      expect(session.update(setParam(damped, barId, 'damping', 2))).toBe('live')
      expect(session.update(setParam(damped, stringId, 'tension', 74))).toBe('live')
      expect(session.update(setParam(damped, barId, 'length', 0.48))).toBe('rebuilt')
      // Untied, the string cannot be heard and the builder says so.
      expect(session.update(removeConnection(graph, joint.id))).toBe('rebuilt')
      expect(session.state.notes.map((n) => n.message).join(' ')).toMatch(/is not tied to/)
      expect(session.update(graph)).toBe('rebuilt')
      session.play()
      const again = backend.out(1)
      expect(backend.engine.faults()).toBe(0)
      return { heard, again }
    }
    const [a, b] = [await run(), await run()]
    // Pascals: the pluck about 0.12, the stroke about 1.7, the released string between.
    expect(a.heard[0]).toBeGreaterThan(0.1)
    expect(a.heard[1]).toBeGreaterThan(1.5)
    expect(a.heard[2]).toBeGreaterThan(0.02)
    expect(b.heard).toEqual(a.heard)
    expect(Array.from(b.again)).toEqual(Array.from(a.again))
  }, 400000)

  test('undo and redo, saving and restoring, and taking the listener away', async () => {
    const graph = tuned()
    const joint = jointOf(graph)
    let history = startHistory(graph)
    history = commit(history, setConnection(history.present, joint.id, { stiffness: 2e5 }), 'stiffness', 0)
    history = commit(history, setParam(history.present, part(graph, 'metalBar').id, 'length', 0.4), '', 1000)
    history = commit(history, removeComponent(history.present, part(graph, 'listener').id), '', 2000)
    const { backend, session } = await playing(history.present)
    expect(built(history.present).output).toBe('velocity') // without a listener it is an ordinary hybrid
    history = undo(history)
    expect(session.update(history.present)).toBe('rebuilt')
    history = undo(history)
    expect(part(history.present, 'metalBar').params.length).toBe(0.485)
    expect(session.update(history.present)).toBe('rebuilt')
    history = undo(history)
    expect(history.present).toEqual(graph)
    expect(session.update(history.present)).toBe('live')
    history = redo(redo(redo(history)))
    expect(history.present.components.some((c) => c.type === 'listener')).toBe(false)
    // Saved and restored: the same instrument, the same engine calls, the same sound.
    const back = restore(serialize(graph))
    expect(back.problem).toBeUndefined()
    expect(back.graph).toEqual(graph)
    expect(structureKey(back.graph!)).toBe(structureKey(graph))
    expect(built(back.graph!).calls).toEqual(built(graph).calls)
    expect(session.update(history.present)).toBe('rebuilt') // the listener-less hybrid the history ended on
    expect(session.update(back.graph!)).toBe('rebuilt')
    session.play()
    const restored = backend.out(1)
    const fresh = await playing(graph)
    fresh.session.play()
    expect(Array.from(restored)).toEqual(Array.from(fresh.backend.out(1)))
    // A listener put back by hand gives the example again.
    const without = removeComponent(graph, part(graph, 'listener').id)
    const added = addComponent(without, 'listener', 160, 420)
    expect(built(added.graph).calls).toEqual(built(graph).calls)
  }, 400000)
})
