// Phase 3D.2: the smallest hybrid. One modal string whose end is tied by a
// spring to one metal bar (src/experimental/string/stringBar.ts), first as an
// isolated system and then as the builder plays it. Everything runs through
// the AudioWorklet processor file itself (analysis/worklet.ts).
import { describe, expect, test } from 'vitest'
import { createEngine, render as renderEngine, run } from '../analysis/wasm'
import { createWorklet, type Worklet } from '../analysis/worklet'
import { EXAMPLES, STRING_EXAMPLES } from '../src/builder/examples'
import { addComponent, cannotAdd, cannotConnect, commit, connect, deserialize, emptyGraph, redo, removeConnection, restore, serialize, setConnection, setParam, startHistory, undo, validateGraph, type Component, type Graph } from '../src/builder/graph'
import { Session, type Backend } from '../src/builder/session'
import { barModes, instrumentCalls, malletStiffness, OUTPUT_GAIN, PRESSURE_FULL_SCALE, structureKey, translate } from '../src/builder/translate'
import { BAR_STRIKE, buildStringBar, type StringBar } from '../src/experimental/string/stringBar'
import { buildPlayableStringBody, pluckCall, radiation, stringPitch } from '../src/experimental/string/stringBody'
import type { Call } from '../src/experimental/wasm/engine'
import { powerSpectrum, SR } from './helpers'

const hybrid = () => STRING_EXAMPLES.find((x) => x.id === 'string-bar')!.make()
const part = (graph: Graph, type: Component['type']) => graph.components.find((c) => c.type === type)!
const jointOf = (graph: Graph) => graph.connections.find((c) => c.type !== 'strike')!
const largest = (x: ArrayLike<number>, from = 0, to = x.length) => {
  let m = 0
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}
/** Strongest spectral peak within 12 % of `f0`, from 0.2 s on. */
function pitchNear(x: Float32Array, f0: number) {
  const N = 65536
  const spec = powerSpectrum(x, 9600, N)
  let best = Math.floor((0.88 * f0 * N) / SR)
  for (let k = best; k <= Math.ceil((1.12 * f0 * N) / SR); k++) if (spec[k] > spec[best]) best = k
  const [a, b, c] = [Math.log(spec[best - 1]), Math.log(spec[best]), Math.log(spec[best + 1])]
  return ((best + (0.5 * (a - c)) / (a - 2 * b + c)) * SR) / N
}
const cents = (f: number, reference: number) => 1200 * Math.log2(f / reference)

/** A builder metal bar as the string model takes it: ports [joint, strike]. */
function barOf(params: Record<string, number> = {}, lossless = false) {
  let made = addComponent(emptyGraph(), 'metalBar', 0, 0)
  for (const [key, value] of Object.entries(params)) made = { graph: setParam(made.graph, made.id, key, value), id: made.id }
  return barModes(made.graph.components[0], SR).map((mode) => ({ ...mode, t60: lossless ? Infinity : mode.t60, shape: [mode.shape[1], mode.shape[0]] }))
}
/** The pair of the builder's example: A2 string, aluminium bar 0.40 m x 40 x 10 mm, joined by 1e6 N/m. */
const pair = (o: Partial<StringBar> = {}): StringBar => ({ tension: 73.5, length: 0.65, pluckAt: 0.8, bar: barOf({ length: 0.4 }), joint: { stiffness: 1e6, damping: 0 }, mallet: { mass: 0.02, stiffness: malletStiffness(0.5) }, outputGain: 1, ...o })
async function system(o: Partial<StringBar> = {}) {
  const built = buildStringBar(pair(o), SR)
  const worklet = await createWorklet(built.calls)
  const engine = worklet.engine
  return {
    built,
    worklet,
    engine,
    pluck: (force = 2) => worklet.send([pluckCall(built, force)]),
    strike: (velocity = 1.5) => worklet.send([['launch', built.mallet!, velocity]]),
    /** Runs for `seconds`, returning the bar's velocity and the largest share of the energy `resonator` held. */
    run(seconds: number, resonator?: number) {
      let share = 0
      const out = worklet.render(Math.round(seconds * SR), () => {
        const total = engine.energy()
        if (resonator !== undefined && total > 0) share = Math.max(share, engine.resonatorEnergy(resonator) / total)
      })
      return { out, share }
    },
  }
}

class NodeBackend implements Backend {
  worklet!: Worklet
  async open() {
    this.worklet = await createWorklet([['reset', SR, 2], ['build']])
    return { sampleRate: SR, send: (calls: Call[]) => this.worklet.send(calls), rebuild: (calls: Call[]) => this.worklet.send(calls), close: async () => {} }
  }
  /** The node's output for the next `seconds`: for a bar instrument, the bar's velocity in m/s times OUTPUT_GAIN. */
  out(seconds: number, each?: (block: number) => void) {
    return this.worklet.render(Math.round(seconds * SR), each)
  }
  get engine() {
    return this.worklet.engine
  }
}
async function playing(graph: Graph = hybrid()) {
  const backend = new NodeBackend()
  const session = new Session(backend)
  await session.start(graph)
  return { backend, session }
}

describe('A string tied to a metal bar: the isolated system', () => {
  test('energy goes both ways through the joint: the plucked string rings the bar, the struck bar rings the string', async () => {
    const plucked = await system()
    plucked.pluck()
    const fromString = plucked.run(2.5, plucked.built.bar)
    const struck = await system()
    struck.strike()
    const fromBar = struck.run(2.5, struck.built.string)
    console.log('string plucked (2 N): the bar holds up to', (100 * fromString.share).toFixed(2), '% of the energy and moves at up to', largest(fromString.out).toExponential(2), 'm/s | bar struck (20 g at 1.5 m/s): the string holds up to', (100 * fromBar.share).toFixed(2), '%, the bar moves at up to', largest(fromBar.out).toFixed(3), 'm/s')
    expect(fromString.share).toBeGreaterThan(0.05)
    expect(largest(fromString.out)).toBeGreaterThan(0.01)
    expect(fromBar.share).toBeGreaterThan(0.03)
    // The string keeps its pitch on the bar: within 2 cents of A2.
    expect(Math.abs(cents(pitchNear(fromString.out, 110), stringPitch({ tension: 73.5, length: 0.65 })))).toBeLessThan(2)
    expect(plucked.engine.faults() + struck.engine.faults()).toBe(0)
  })

  test('nothing lost anywhere: energy is kept to parts in a hundred billion while it passes back and forth', async () => {
    const free = await system({ bar: barOf({ length: 0.4 }, true), loss: null, mallet: undefined })
    free.pluck()
    free.run(0.3) // until the pluck's force has gone
    const start = free.engine.energy()
    let [drift, least, most] = [0, 1, 0]
    free.worklet.render(3 * SR, () => {
      drift = Math.max(drift, Math.abs(free.engine.energy() / start - 1))
      const share = free.engine.resonatorEnergy(free.built.bar) / free.engine.energy()
      least = Math.min(least, share)
      most = Math.max(most, share)
    })
    console.log('no losses: energy drift over 3 s', drift.toExponential(1), '| the bar\'s share swings between', (100 * least).toFixed(2), 'and', (100 * most).toFixed(2), '%')
    expect(drift).toBeLessThan(1e-9)
    // It is exchange, not a one-way leak: the bar's share goes up and comes back down.
    expect(most).toBeGreaterThan(0.05)
    expect(least).toBeLessThan(0.2 * most)
  })

  test('a damper in the joint only takes energy, and more of it the stronger it is', async () => {
    const left: Record<number, number> = {}
    for (const damping of [0, 10, 100]) {
      const s = await system({ joint: { stiffness: 1e6, damping }, mallet: undefined })
      s.pluck()
      s.run(0.25)
      const start = s.engine.energy()
      let [previous, rises] = [start, 0]
      s.worklet.render(2 * SR, () => {
        const energy = s.engine.energy()
        if (energy > previous * (1 + 1e-12)) rises++
        previous = energy
      })
      left[damping] = 10 * Math.log10(s.engine.energy() / start)
      expect(rises, `damper ${damping}`).toBe(0)
      expect(s.engine.faults()).toBe(0)
    }
    console.log('energy 2 s later, dB: no damper', left[0].toFixed(1), '| 10 N s/m', left[10].toFixed(1), '| 100 N s/m', left[100].toFixed(1))
    expect(left[10]).toBeLessThan(left[0] - 2)
    expect(left[100]).toBeLessThan(left[10] - 5)
  })

  test('with the joint removed, neither hears the other: exactly nothing crosses', async () => {
    const apart = await system({ joint: null })
    apart.pluck()
    const silent = apart.run(1)
    expect(apart.engine.resonatorEnergy(apart.built.string)).toBeGreaterThan(1e-5) // the string is moving
    expect(apart.engine.resonatorEnergy(apart.built.bar)).toBe(0)
    expect(largest(silent.out)).toBe(0)
    const again = await system({ joint: null })
    again.strike()
    const ringing = again.run(1)
    expect(largest(ringing.out)).toBeGreaterThan(0.1) // the bar is ringing
    expect(again.engine.resonatorEnergy(again.built.string)).toBe(0)
  })

  test('joint stiffness: stiff, the string keeps its pitch; soft, its end gives and the pitch falls', async () => {
    const report: Record<string, Record<string, string>> = {}
    const results: Record<number, { cents: number; share: number }> = {}
    for (const stiffness of [1e3, 1e4, 1e5, 1e6, 1e8]) {
      const s = await system({ joint: { stiffness, damping: 0 }, mallet: undefined })
      s.pluck()
      const { out, share } = s.run(2.5, s.built.bar)
      results[stiffness] = { cents: cents(pitchNear(out, stiffness < 5e3 ? 99 : 110), 109.91), share }
      report[`${stiffness.toExponential(0)} N/m`] = { 'string pitch, cents from A2': results[stiffness].cents.toFixed(1), 'most of the energy in the bar, %': (100 * share).toFixed(2), 'Newton iterations at most': String(s.engine.worstIterations()) }
      expect(s.engine.faults()).toBe(0)
      expect(s.engine.worstIterations()).toBeLessThanOrEqual(3)
    }
    console.table(report)
    for (const stiffness of [1e5, 1e6, 1e8]) expect(Math.abs(results[stiffness].cents)).toBeLessThan(3)
    expect(results[1e4].cents).toBeLessThan(-10)
    expect(results[1e3].cents).toBeLessThan(-100)
    // Too soft a joint passes almost nothing: the string's end is nearly free.
    expect(results[1e3].share).toBeLessThan(0.01)
    expect(results[1e6].share).toBeGreaterThan(0.05)
  }, 400000)

  test('tuning matters: a bar whose note is far from every harmonic of the string takes a hundredth as much', async () => {
    const tuned = await system({ mallet: undefined })
    tuned.pluck()
    const near = tuned.run(2, tuned.built.bar)
    // The builder's own metal bar, 0.30 m: its lowest note is 582 Hz, between the string's fifth and sixth harmonics.
    const untuned = await system({ bar: barOf(), mallet: undefined })
    untuned.pluck()
    const far = untuned.run(2, untuned.built.bar)
    console.log('bar at 327 Hz (beside the string\'s third harmonic, 330 Hz):', (100 * near.share).toFixed(2), '% of the energy,', largest(near.out).toExponential(2), 'm/s | bar at 582 Hz:', (100 * far.share).toFixed(3), '%,', largest(far.out).toExponential(2), 'm/s')
    expect(near.share).toBeGreaterThan(20 * far.share)
    expect(largest(far.out)).toBeGreaterThan(0)
  })

  test('played hard from both ends for five seconds: no fault, bounded, and it dies away', async () => {
    const s = await system({ outputGain: OUTPUT_GAIN }) // as the builder hears it: the output's ceiling is then 4 m/s
    let loudest = 0
    for (let i = 0; i < 100; i++) {
      s.pluck(8)
      if (i % 2 === 0) s.strike(5) // the hardest mallet stroke the builder allows
      const out = s.worklet.render(2400) // 50 ms
      loudest = Math.max(loudest, largest(out) / OUTPUT_GAIN)
      expect(out.every(Number.isFinite)).toBe(true)
    }
    expect(s.engine.faults()).toBe(0)
    expect(loudest).toBeLessThan(4) // not cut off
    const stopped = s.engine.energy()
    let [previous, rises] = [Infinity, 0]
    s.run(0.5) // the last pluck's force and the last mallet contact are over
    s.worklet.render(6 * SR, () => {
      const energy = s.engine.energy()
      if (energy > previous * (1 + 1e-12)) rises++
      previous = energy
    })
    console.log('100 plucks of 8 N and 50 mallet strokes at 5 m/s in 5 s: bar velocity up to', loudest.toFixed(2), 'm/s | Newton iterations at most', s.engine.worstIterations())
    expect(rises).toBe(0)
    // What is left is the mallet, which bounced off and flies on for ever with nothing to stop it; the
    // string and the bar themselves have died away.
    expect(s.engine.resonatorEnergy(s.built.string) + s.engine.resonatorEnergy(s.built.bar)).toBeLessThan(1e-3 * stopped)
  }, 400000)

  test('what is heard is the bar: the output is its velocity where it is struck, and nothing of the string is added', async () => {
    const s = await system({ outputGain: OUTPUT_GAIN })
    expect(s.built.calls.some((call) => call[0] === 'radiate')).toBe(false)
    // One output, on the bar's strike port.
    expect(s.built.calls.filter((call) => call[0] === 'addOutput')).toEqual([['addOutput', s.built.bar, BAR_STRIKE, OUTPUT_GAIN]])
    s.pluck()
    for (let i = 0; i < 40; i++) {
      const block = s.worklet.render(128)
      // The last sample of each block against the engine's own reading of the bar, in m/s.
      expect(block[127]).toBeCloseTo(OUTPUT_GAIN * s.engine.velocity(s.built.bar, BAR_STRIKE), 9)
    }
    expect(Math.abs(s.engine.velocity(s.built.string, 2))).toBeGreaterThan(0) // the string is moving, and is not in the output
  })
})

describe('The hybrid in the builder', () => {
  test('the example is that system: the same engine calls as the isolated one, and the same sound', async () => {
    const graph = hybrid()
    expect(validateGraph(graph)).toEqual([])
    const translation = translate(graph, SR)
    if (!translation.ok) throw new Error('the hybrid example does not translate')
    const { built } = translation
    const direct = buildStringBar(pair({ outputGain: OUTPUT_GAIN }), SR)
    expect(built.calls).toEqual(direct.calls)
    expect(built.output).toBe('velocity')
    expect(built.notes).toEqual([])
    expect(built.stringBody).toMatchObject({ on: 'bar', joined: true, modes: 100, stringId: part(graph, 'steelString').id, bodyId: part(graph, 'metalBar').id })
    expect(built.bars[part(graph, 'metalBar').id]).toBe(direct.bar)
    expect(built.mallets[part(graph, 'mallet').id]).toBe(direct.mallet)
    // String, bar, something fixed for the finger, the mallet's head; joint, finger, mallet contact.
    expect(built.calls.filter((c) => c[0] === 'addResonator').length).toBe(4)
    expect(built.calls.filter((c) => c[0] === 'addSpring').length + built.calls.filter((c) => c[0] === 'addContact').length).toBe(3)
    // Play instrument plucks the string and throws the mallet.
    expect(instrumentCalls(graph, built).map((c) => c[0])).toEqual(['pluck', 'launch'])
    const { backend, session } = await playing(graph)
    expect(session.strikeBar(part(graph, 'steelString').id)).toBe(true) // the string alone: a pluck of its 4 N
    const sound = backend.out(1)
    const reference = await createWorklet(direct.calls)
    reference.send([pluckCall(direct, 4)])
    expect(Array.from(sound)).toEqual(Array.from(reference.render(SR)))
    expect(largest(sound)).toBeGreaterThan(0.005)
  })

  test('either part can be played: the string plucked, the bar struck by its mallet or tapped without one; each rings the other', async () => {
    const graph = hybrid()
    const [stringId, barId, malletId] = [part(graph, 'steelString').id, part(graph, 'metalBar').id, part(graph, 'mallet').id]
    const a = await playing(graph)
    a.session.strikeBar(stringId)
    a.backend.out(0.5)
    expect(a.backend.engine.resonatorEnergy(1)).toBeGreaterThan(1e-6) // the bar (engine resonator 1) has energy from the string
    const b = await playing(graph)
    expect(b.session.strikeExciter(malletId)).toBe(true)
    const struck = b.backend.out(0.5)
    expect(largest(struck)).toBeGreaterThan(0.05)
    expect(b.backend.engine.resonatorEnergy(0)).toBeGreaterThan(1e-5) // the string has energy from the bar
    const c = await playing(graph)
    c.session.strikeBar(barId) // the same thing, asked of the bar
    expect(Array.from(c.backend.out(0.5))).toEqual(Array.from(struck))
    // Without a mallet the bar is tapped where it is struck and heard, as a bar on its own is.
    const bare = { ...graph, components: graph.components.filter((x) => x.id !== malletId), connections: graph.connections.filter((x) => x.from !== malletId) }
    expect(validateGraph(bare)).toEqual([])
    const d = await playing(bare)
    expect(d.session.strikeBar(barId)).toBe(true)
    expect(largest(d.backend.out(0.5))).toBeGreaterThan(0.01)
    expect(d.backend.engine.resonatorEnergy(0)).toBeGreaterThan(1e-7)
    for (const x of [a, b, c, d]) expect(x.backend.engine.faults()).toBe(0)
  })

  test('removing the joint: both can still be played, neither moves the other, and the builder says so', async () => {
    const graph = hybrid()
    const { backend, session } = await playing(graph)
    const apart = removeConnection(graph, jointOf(graph).id)
    expect(validateGraph(apart)).toEqual([])
    expect(session.update(apart)).toBe('rebuilt')
    expect(session.state.notes.map((n) => n.message).join(' ')).toMatch(/is not tied to/)
    session.strikeBar(part(graph, 'steelString').id)
    expect(largest(backend.out(0.5))).toBe(0)
    expect(backend.engine.resonatorEnergy(1)).toBe(0)
    session.strikeBar(part(graph, 'metalBar').id)
    expect(largest(backend.out(0.5))).toBeGreaterThan(0.05)
    // The string still holds only what its own pluck gave it: the bar gave it nothing.
    const stringAlone = await playing(apart)
    stringAlone.session.strikeBar(part(graph, 'steelString').id)
    stringAlone.backend.out(1)
    expect(backend.engine.resonatorEnergy(0)).toBeCloseTo(stringAlone.backend.engine.resonatorEnergy(0), 12)
    // Tied again, by dragging either way.
    const again = connect(apart, part(graph, 'metalBar').id, part(graph, 'steelString').id)
    expect(jointOf(again.graph)).toMatchObject({ type: 'spring', from: part(graph, 'steelString').id, to: part(graph, 'metalBar').id, stiffness: 1e6 })
    expect(session.update(again.graph)).toBe('rebuilt')
    expect(session.state.notes).toEqual([])
  })

  test('the joint is live: its stiffness and damping change while it rings; its kind, and the bar\'s size, rebuild', async () => {
    const graph = hybrid()
    const joint = jointOf(graph)
    const { backend, session } = await playing(graph)
    session.strikeBar(part(graph, 'steelString').id)
    backend.out(0.3)
    const softer = setConnection(graph, joint.id, { stiffness: 1e4 })
    expect(session.update(softer)).toBe('live')
    const ringing = backend.out(2.5)
    // The pitch goes to where a string built on that spring is.
    const built = await playing(softer)
    built.session.strikeBar(part(graph, 'steelString').id)
    const reference = pitchNear(built.backend.out(2.5), 108.7)
    expect(Math.abs(cents(pitchNear(ringing, 108.7), reference))).toBeLessThan(1)
    expect(cents(reference, 109.91)).toBeLessThan(-10)
    // A damper is a different kind of joint: a rebuild. Its strength is then live.
    const damped = setConnection(graph, joint.id, { type: 'springDamper', damping: 10 })
    expect(session.update(damped)).toBe('rebuilt')
    expect(session.update(setConnection(damped, joint.id, { damping: 50 }))).toBe('live')
    expect(session.update(setParam(damped, part(graph, 'metalBar').id, 'damping', 3))).toBe('live')
    expect(session.update(setParam(damped, part(graph, 'steelString').id, 'tension', 80))).toBe('live')
    const longer = setParam(damped, part(graph, 'metalBar').id, 'length', 0.5)
    expect(session.update(longer)).toBe('rebuilt')
    expect(session.update(setParam(longer, part(graph, 'mallet').id, 'velocity', 3))).toBe('unchanged') // read when it is thrown
    expect(backend.engine.faults()).toBe(0)
  }, 400000)

  test('the string\'s playing gestures work on the bar: a finger stops the string and leaves the bar ringing', async () => {
    const graph = hybrid()
    const { backend, session } = await playing(graph)
    session.strikeBar(part(graph, 'metalBar').id) // the mallet: bar and, through the joint, string
    backend.out(0.5)
    const [stringBefore, barBefore] = [backend.engine.resonatorEnergy(0), backend.engine.resonatorEnergy(1)]
    expect(session.touch(true)).toBe(true)
    let [previous, rises] = [backend.engine.energy(), 0]
    backend.out(0.3, () => {
      const energy = backend.engine.energy()
      if (energy > previous * (1 + 1e-12)) rises++
      previous = energy
    })
    expect(rises).toBe(0)
    // The finger is on the string, not on the bar: the bar rings on, losing only what it feeds the damped string.
    expect(backend.engine.resonatorEnergy(1)).toBeGreaterThan(0.05 * barBefore)
    expect(backend.engine.resonatorEnergy(0)).toBeLessThan(0.2 * stringBefore)
    session.touch(false)
    // Pulled aside and released: a pluck, heard through the bar.
    const force = session.pull(0.004)!
    expect(force).toBeGreaterThan(2)
    backend.out(0.4)
    session.release()
    expect(largest(backend.out(0.5))).toBeGreaterThan(0.005)
    // Touch before plucking is the string's own property and works here too.
    expect(session.update(setParam(graph, part(graph, 'steelString').id, 'retrigger', 1))).toBe('unchanged')
    expect(backend.engine.faults()).toBe(0)
  })

  test('only this hybrid: one string, one metal bar, at most one mallet, tied by a spring', () => {
    const graph = hybrid()
    const [string, bar, mallet] = [part(graph, 'steelString'), part(graph, 'metalBar'), part(graph, 'mallet')]
    // Nothing more can be added to it.
    for (const type of ['steelString', 'metalBar', 'woodBar', 'mallet', 'impulse', 'dampedBox'] as const) expect(cannotAdd(graph, type), type).not.toBeNull()
    // Built up from nothing, in any order.
    const alone = addComponent(emptyGraph(), 'steelString', 200, 200)
    expect(cannotAdd(alone.graph, 'metalBar')).toBeNull()
    expect(cannotAdd(alone.graph, 'mallet')).toBeNull()
    expect(cannotAdd(alone.graph, 'woodBar')).toMatch(/one metal bar and one mallet/)
    expect(cannotAdd(alone.graph, 'impulse')).toMatch(/one metal bar and one mallet/)
    const withBar = addComponent(alone.graph, 'metalBar', 400, 400)
    expect(cannotAdd(withBar.graph, 'metalBar')).toMatch(/one metal bar and one mallet/)
    expect(cannotAdd(withBar.graph, 'dampedBox')).toMatch(/cannot share an instrument with bars/)
    expect(cannotAdd(addComponent(emptyGraph(), 'metalBar', 0, 0).graph, 'steelString')).toBeNull()
    expect(cannotAdd(addComponent(emptyGraph(), 'woodBar', 0, 0).graph, 'steelString')).toMatch(/cannot share an instrument with bars/)
    expect(cannotAdd(STRING_EXAMPLES[0].make(), 'metalBar')).toMatch(/cannot be added to a string instrument/)
    // Connections: the string ties to the bar; a mallet strikes the bar, never the string.
    expect(cannotConnect(withBar.graph, alone.id, withBar.id)).toBeNull()
    expect(cannotConnect(graph, mallet.id, string.id)).toMatch(/joined to a damped box body by its bridge, or to one metal bar by a spring/)
    expect(cannotConnect(graph, string.id, bar.id)).toMatch(/already connected/)
    // A damper alone cannot hold the end of a string; nor can a bridge, which is the box's.
    const joint = jointOf(graph)
    expect(validateGraph(setConnection(graph, joint.id, { type: 'damper' }))[0].message).toMatch(/must be held by a spring/)
    expect(validateGraph(setConnection(graph, joint.id, { type: 'bridge' as never }))[0].message).toMatch(/a bridge goes from a string to a body/)
    expect(validateGraph(setConnection(graph, joint.id, { stiffness: 10 }))[0].message).toMatch(/Stiffness must be between 100 and/)
    expect(validateGraph(setConnection(graph, joint.id, { type: 'springDamper', damping: 500 }))[0].message).toMatch(/Damping must be between 0 and 100/)
    // Saved instruments that go beyond it are refused: a wooden bar, two bars, a bar and a box.
    const extra = (type: Component['type']) => ({ ...graph, nextId: graph.nextId + 1, components: [...graph.components, { ...addComponent(emptyGraph(), type, 0, 0).graph.components[0], id: `c${graph.nextId}` }] })
    expect(() => deserialize(serialize(extra('woodBar')))).toThrow(/one metal bar and one mallet/)
    expect(() => deserialize(serialize(extra('metalBar')))).toThrow(/one metal bar and one mallet/)
    expect(() => deserialize(serialize(extra('dampedBox')))).toThrow(/cannot share an instrument with bars/)
    // Bars without a string are as free as they always were.
    for (const bars of EXAMPLES) for (const type of ['metalBar', 'woodBar', 'mallet', 'impulse'] as const) expect(cannotAdd(bars.make(), type)).toBeNull()
  })

  test('undo and redo, and saving and restoring, cover the hybrid', async () => {
    const graph = hybrid()
    const joint = jointOf(graph)
    let history = startHistory(graph)
    history = commit(history, setConnection(history.present, joint.id, { stiffness: 2e5 }), 'stiffness', 0)
    history = commit(history, setConnection(history.present, joint.id, { type: 'springDamper', damping: 5 }), '', 1000)
    history = commit(history, removeConnection(history.present, joint.id), '', 2000)
    const { session } = await playing(history.present)
    history = undo(history)
    expect(jointOf(history.present)).toMatchObject({ type: 'springDamper', damping: 5, stiffness: 2e5 })
    expect(session.update(history.present)).toBe('rebuilt')
    history = undo(history)
    expect(session.update(history.present)).toBe('rebuilt') // back to a plain spring
    history = undo(history)
    expect(history.present).toEqual(graph)
    expect(session.update(history.present)).toBe('live') // only its stiffness differs
    history = redo(redo(redo(history)))
    expect(jointOf(history.present)).toBeUndefined()
    const saved = setConnection(setParam(graph, part(graph, 'steelString').id, 'tension', 88), joint.id, { type: 'springDamper', stiffness: 3e5, damping: 2 })
    const back = restore(serialize(saved))
    expect(back.problem).toBeUndefined()
    expect(back.graph).toEqual(saved)
    expect(structureKey(back.graph!)).toBe(structureKey(saved))
  })
})

describe('What was approved is still what plays', () => {
  test('the string on its box: the same samples as before the hybrid existed', async () => {
    const { backend, session } = await playing(STRING_EXAMPLES[0].make())
    session.play()
    const now = backend.out(2)
    const built = buildPlayableStringBody({ tension: 73.5, length: 0.65, pluckAt: 0.8, joined: true }, SR)
    const r = radiation(SR)
    const reference = await createWorklet([...built.calls, ['radiate', r.perSample, r.b0, r.b1, r.a1, PRESSURE_FULL_SCALE]])
    reference.send([pluckCall(built, 2)])
    expect(Array.from(now)).toEqual(Array.from(reference.render(2 * SR)))
  })

  test('the three bar instruments after a hybrid has been playing: bit for bit a bare engine\'s', async () => {
    const { backend, session } = await playing(hybrid())
    session.play()
    session.touch(true)
    backend.out(0.2)
    for (const bars of EXAMPLES) {
      const graph = bars.make()
      expect(session.update(graph)).toBe('rebuilt')
      session.play()
      const fromWorklet = backend.out(1)
      const translation = translate(graph, SR)
      if (!translation.ok) throw new Error('bars example does not translate')
      const engine = createEngine()
      run(engine, translation.built.calls)
      run(engine, instrumentCalls(graph, translation.built))
      const bare = renderEngine(engine, new Float32Array(SR)).map((v) => Math.max(-1, Math.min(1, v)))
      expect(Array.from(fromWorklet), bars.label).toEqual(Array.from(bare))
    }
    expect(EXAMPLES.map((x) => x.id)).toEqual(['single', 'coupled', 'mixed'])
    expect(STRING_EXAMPLES.map((x) => x.id)).toEqual(['string', 'string-bar'])
  }, 400000)
})
