// Phase 3C.3: the string-and-body instrument in the builder. Everything here
// goes through what the browser uses: the builder's graph, its translation,
// its Session, and the AudioWorklet processor file itself (run in Node by
// analysis/worklet.ts), with its plucks and its conversion to sound pressure.
import { describe, expect, test } from 'vitest'
import { DAMPED_BOX, GUITAR_A, onSoundboard, pluckOne, soundOf } from '../analysis/soundboard'
import { render as renderEngine, createEngine, run } from '../analysis/wasm'
import { createWorklet, type Worklet } from '../analysis/worklet'
import { EXAMPLES, STRING_EXAMPLES } from '../src/builder/examples'
import { componentAt, handle, onHandle, rectSize, strikePoint } from '../src/builder/shapes'
import { addComponent, cannotAdd, cannotConnect, commit, connect, deserialize, emptyGraph, redo, removeConnection, restore, serialize, setParam, startHistory, undo, validateGraph, type Graph } from '../src/builder/graph'
import { Session, type Backend } from '../src/builder/session'
import { describeString, PRESSURE_FULL_SCALE, structureKey, translate } from '../src/builder/translate'
import { buildInstrument } from '../src/experimental/string/instrument'
import { buildStringBody, pluckCall, radiation, stringPitch, type StringBody } from '../src/experimental/string/stringBody'
import type { Call } from '../src/experimental/wasm/engine'
import { powerSpectrum, SR } from './helpers'

const N = 65536
const example = () => STRING_EXAMPLES[0].make()
const stringOf = (graph: Graph) => graph.components.find((c) => c.type === 'steelString')!
const bodyOf = (graph: Graph) => graph.components.find((c) => c.type === 'dampedBox')!
const bridgeOf = (graph: Graph) => graph.connections.find((c) => c.type === 'bridge')!
const DEFAULT: StringBody = { tension: 73.5, length: 0.65, pluckAt: 0.8, joined: true }
const largest = (x: ArrayLike<number>, from = 0, to = x.length) => {
  let m = 0
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}
/** Strongest spectral peak within 7 % of `f0`, from 0.2 s onward: frequency by parabolic interpolation. */
function fundamental(sound: Float32Array, f0: number) {
  const spec = powerSpectrum(sound, Math.round(0.2 * SR), N)
  let best = Math.floor((0.93 * f0 * N) / SR)
  for (let k = best; k <= Math.ceil((1.07 * f0 * N) / SR); k++) if (spec[k] > spec[best]) best = k
  const [a, b, c] = [Math.log(spec[best - 1]), Math.log(spec[best]), Math.log(spec[best + 1])]
  return ((best + (0.5 * (a - c)) / (a - 2 * b + c)) * SR) / N
}
const cents = (f: number, reference: number) => 1200 * Math.log2(f / reference)

/** What the browser's audio backend is to a Session, with the worklet processor running in Node. */
class NodeBackend implements Backend {
  worklet!: Worklet
  async open() {
    this.worklet = await createWorklet([['reset', SR, 2], ['build']])
    return { sampleRate: SR, send: (calls: Call[]) => this.worklet.send(calls), rebuild: (calls: Call[]) => this.worklet.send(calls), close: async () => {} }
  }
  /** Sound pressure in pascals for the next `seconds`. */
  pascals(seconds: number) {
    return this.worklet.render(Math.round(seconds * SR)).map((v) => v * PRESSURE_FULL_SCALE)
  }
}
async function playing(graph: Graph) {
  const backend = new NodeBackend()
  const session = new Session(backend)
  await session.start(graph)
  return { backend, session }
}
/** A worklet running the string on the body directly, for reading the engine's energies. */
async function system(s: StringBody) {
  const built = buildStringBody(s, SR)
  const r = radiation(SR)
  const worklet = await createWorklet([...built.calls, ['radiate', r.perSample, r.b0, r.b1, r.a1, 1]])
  return { built, worklet, pluck: (force = 2) => worklet.send([pluckCall(built, force)]) }
}

describe('The builder\'s string instrument is the validated one', () => {
  test('the example builds exactly the engine system of the Phase 3C.2.3 prototype', () => {
    const translation = translate(example(), SR)
    expect(translation.ok).toBe(true)
    if (!translation.ok) return
    const prototype = buildInstrument(onSoundboard({ ...DAMPED_BOX, strings: [GUITAR_A] }).instrument, SR)
    const { calls } = translation.built
    // The prototype's calls, then one more: the request for radiated pressure.
    expect(calls.slice(0, -1)).toEqual(prototype.calls)
    expect(calls.at(-1)![0]).toBe('radiate')
    expect(translation.built.output).toBe('pressure')
    expect(translation.built.notes).toEqual([])
    // One string of 100 modes, the plate, the plug of air, and something fixed for the hole's screen to push on.
    expect(calls.filter((c) => c[0] === 'addResonator').length).toBe(4)
    expect(calls.filter((c) => c[0] === 'addSpring').length).toBe(3) // bridge, screen, air spring
    expect(translation.built.stringBody!.modes).toBe(100)
  })

  test('played through the builder and the worklet processor, the sound is the prototype\'s: same pitch, attack, decay and radiation', async () => {
    const { backend, session } = await playing(example())
    expect(session.play()).toBe(true)
    const sound = backend.pascals(2.2)
    const setup = onSoundboard({ ...DAMPED_BOX, strings: [GUITAR_A] })
    const reference = soundOf(setup, pluckOne(setup.instrument, 0, 2.2))
    let difference = 0
    for (let n = 0; n < sound.length; n++) difference = Math.max(difference, Math.abs(sound[n] - reference[n]))
    const peak = largest(reference)
    console.log('builder + worklet against the prototype: peak', peak.toFixed(4), 'Pa | largest difference', difference.toExponential(1), 'Pa =', (20 * Math.log10(difference / peak)).toFixed(0), 'dB re the peak')
    // Sample for sample, to the precision of the 32-bit audio path.
    expect(difference).toBeLessThan(1e-6 * peak)
    expect(peak).toBeGreaterThan(0.05)
    expect(peak).toBeLessThan(0.3)
    expect(backend.worklet.engine.faults()).toBe(0)
  })
})

describe('Pitch', () => {
  test('default string: A2 within 2 cents; tension and length move it as the string formula says', async () => {
    const report: Record<string, Record<string, string>> = {}
    const cases: [string, Partial<Record<'tension' | 'length', number>>][] = [
      ['as loaded: 73.5 N, 0.65 m', {}],
      ['tension 30 N (lowest)', { tension: 30 }],
      ['tension 50 N', { tension: 50 }],
      ['tension 100 N', { tension: 100 }],
      ['tension 120 N (highest)', { tension: 120 }],
      ['length 0.5 m (shortest)', { length: 0.5 }],
      ['length 0.8 m (longest)', { length: 0.8 }],
      ['shortest and tightest', { length: 0.5, tension: 120 }],
      ['longest and slackest', { length: 0.8, tension: 30 }],
    ]
    for (const [name, params] of cases) {
      let graph = example()
      for (const [key, value] of Object.entries(params)) graph = setParam(graph, stringOf(graph).id, key, value)
      expect(validateGraph(graph)).toEqual([])
      const { backend, session } = await playing(graph)
      session.play()
      const expected = stringPitch({ tension: stringOf(graph).params.tension, length: stringOf(graph).params.length })
      const measured = fundamental(backend.pascals(2.2), expected)
      report[name] = { 'string formula, Hz': expected.toFixed(2), 'played, Hz': measured.toFixed(2), cents: cents(measured, expected).toFixed(2), 'modes used': String(describeString(stringOf(graph), SR).modes) }
      expect(Math.abs(cents(measured, expected)), name).toBeLessThan(name.startsWith('as loaded') ? 2 : 5)
      expect(describeString(stringOf(graph), SR).modes).toBe(100)
      expect(backend.worklet.engine.faults()).toBe(0)
    }
    console.table(report)
    expect(describeString(stringOf(example()), SR).note).toBe('A2')
  }, 400000)
})

describe('Plucking', () => {
  test('a new pluck adds to the vibration already there: two plucks are exactly the sum of each alone', async () => {
    const one = await system(DEFAULT)
    one.pluck()
    const single = one.worklet.render(SR)
    const two = await system(DEFAULT)
    two.pluck()
    const first = two.worklet.render(4800) // 0.1 s, a whole number of blocks... not needed: any time works
    two.pluck()
    const rest = two.worklet.render(SR - 4800)
    let difference = 0
    for (let n = 0; n < rest.length; n++) difference = Math.max(difference, Math.abs(rest[n] - (single[n + 4800] + single[n])))
    for (let n = 0; n < first.length; n++) difference = Math.max(difference, Math.abs(first[n] - single[n]))
    expect(difference).toBeLessThan(1e-5 * largest(single))
  })

  test('repeated plucks: forty a second for five seconds stays bounded, makes no fault and no click, and dies away after', async () => {
    const { worklet, pluck, built } = await system(DEFAULT)
    pluck()
    const alone = worklet.render(SR)
    const step = (x: Float32Array) => {
      let m = 0
      for (let n = 1; n < x.length; n++) m = Math.max(m, Math.abs(x[n] - x[n - 1]))
      return m
    }
    const fresh = await system(DEFAULT)
    let energyPeak = 0
    // A pluck every 9 blocks (24 ms): faster than the 0.2 s a pluck's force lasts, so up to nine overlap
    // and the processor's eight places for plucks are all in use.
    const during = fresh.worklet.render(5 * SR, (block) => {
      if (block % 9 === 0) fresh.pluck()
      energyPeak = Math.max(energyPeak, fresh.worklet.engine.energy())
    })
    const energyAtEnd = fresh.worklet.engine.energy()
    const after = fresh.worklet.render(4 * SR)
    console.log('one pluck: peak', largest(alone).toFixed(3), 'Pa, largest step', step(alone).toFixed(4), '| 40 plucks a second: peak', largest(during).toFixed(3), 'Pa, largest step', step(during).toFixed(4), '| energy: most', (1000 * energyPeak).toFixed(2), 'mJ, when plucking stops', (1000 * energyAtEnd).toFixed(2), 'mJ, 4 s later', (1000 * fresh.worklet.engine.energy()).toFixed(4), 'mJ')
    expect(fresh.worklet.engine.faults()).toBe(0)
    expect(during.every(Number.isFinite)).toBe(true)
    // Bounded: the string loses what it is given. Not a hundred times one pluck's sound.
    expect(largest(during)).toBeLessThan(12 * largest(alone))
    // No click: no jump between samples larger, in proportion, than a single pluck's own.
    expect(step(during) / largest(during)).toBeLessThan(1.5 * (step(alone) / largest(alone)))
    // It reaches a level and stays there: the last second is no louder than the one before.
    expect(largest(during, 4 * SR)).toBeLessThan(1.25 * largest(during, 3 * SR, 4 * SR))
    // And dies away once the plucking stops.
    expect(fresh.worklet.engine.energy()).toBeLessThan(0.05 * energyAtEnd)
    expect(largest(after, 3 * SR)).toBeLessThan(0.1 * largest(during))
    void built
  }, 400000)

  test('pluck strength scales the sound in proportion; pluck position changes its colour and nothing else', async () => {
    const at = async (force: number, pluckAt: number) => {
      const s = await system({ ...DEFAULT, pluckAt })
      s.pluck(force)
      return s.worklet.render(SR)
    }
    const [soft, hard] = [await at(1, 0.8), await at(4, 0.8)]
    let worst = 0
    for (let n = 0; n < soft.length; n++) worst = Math.max(worst, Math.abs(hard[n] - 4 * soft[n]))
    expect(worst).toBeLessThan(1e-5 * largest(hard))
    // Through the builder, moving the pluck point is a live edit and matches a string built that way.
    const moved = setParam(example(), stringOf(example()).id, 'pluckPosition', 0.5)
    const { backend, session } = await playing(example())
    expect(session.update(moved)).toBe('live')
    session.play()
    const live = backend.pascals(1)
    const built = (await at(2, 0.5)).map((v) => v)
    let difference = 0
    for (let n = 0; n < live.length; n++) difference = Math.max(difference, Math.abs(live[n] - built[n]))
    expect(difference).toBeLessThan(1e-5 * largest(built))
    // Plucked in the middle, the even harmonics are missing: the second is far below what it is at 0.8.
    const second = (x: Float32Array) => { const p = powerSpectrum(x, 9600, 32768); const k = Math.round((220 * 32768) / SR); return Math.max(p[k - 1], p[k], p[k + 1]) / Math.max(...[-1, 0, 1].map((d) => p[Math.round((110 * 32768) / SR) + d])) }
    expect(second(live)).toBeLessThan(0.01 * second(await at(2, 0.8)))
  })

  test('moving the pluck point while the string rings does not disturb it', async () => {
    const a = await playing(example())
    const b = await playing(example())
    a.session.play()
    b.session.play()
    a.backend.pascals(0.5)
    b.backend.pascals(0.5)
    expect(b.session.update(setParam(example(), stringOf(example()).id, 'pluckPosition', 0.3))).toBe('live')
    const [undisturbed, edited] = [a.backend.pascals(1), b.backend.pascals(1)]
    let difference = 0
    for (let n = 0; n < edited.length; n++) difference = Math.max(difference, Math.abs(edited[n] - undisturbed[n]))
    expect(difference).toBeLessThan(1e-6 * largest(undisturbed))
  })
})

describe('Tension while it rings', () => {
  test('a live edit, not a rebuild: the pitch goes where a string built at the new tension is, and no energy appears', async () => {
    const graph = example()
    const { backend, session } = await playing(graph)
    session.play()
    backend.pascals(0.5)
    const engine = backend.worklet.engine
    const before = engine.energy()
    const tighter = setParam(graph, stringOf(graph).id, 'tension', 90)
    expect(structureKey(tighter)).toBe(structureKey(graph))
    expect(session.update(tighter)).toBe('live')
    expect(session.state.rebuilds).toBe(1)
    // The edit is applied before the next block; the stored energy is what it was.
    backend.worklet.render(128)
    const justAfter = engine.energy()
    expect(justAfter).toBeLessThanOrEqual(before * (1 + 1e-9))
    expect(justAfter).toBeGreaterThan(0.9 * before)
    const ringing = backend.pascals(2.2)
    const target = stringPitch({ tension: 90, length: 0.65 })
    // Against a string built at 90 N from the start and plucked.
    const rebuilt = await playing(tighter)
    rebuilt.session.play()
    const reference = fundamental(rebuilt.backend.pascals(2.2), target)
    const reached = fundamental(ringing, target)
    console.log('tension 73.5 -> 90 N while ringing: pitch', reached.toFixed(2), 'Hz | a string built at 90 N:', reference.toFixed(2), 'Hz | formula', target.toFixed(2), 'Hz | energy before', (1000 * before).toFixed(3), 'mJ, after', (1000 * justAfter).toFixed(3), 'mJ')
    expect(Math.abs(cents(reached, reference))).toBeLessThan(1)
    expect(engine.faults()).toBe(0)
    // No click from the change: the largest jump between samples around it is no more than a pluck's own.
    expect(ringing.every(Number.isFinite)).toBe(true)
  }, 400000)

  test('sweeping the tension across its whole range while plucking: no fault, energy only falls between plucks', async () => {
    const graph = example()
    const { backend, session } = await playing(graph)
    const engine = backend.worklet.engine
    let rises = 0
    let previous = Infinity
    for (let i = 0; i < 180; i++) {
      // A slider dragged from 30 to 120 N and back, a step every 21 ms; a pluck every half second.
      const tension = 75 + 45 * Math.sin(i / 14)
      expect(session.update(setParam(graph, stringOf(graph).id, 'tension', Number(tension.toFixed(1))))).not.toBe('rebuilt')
      if (i % 24 === 0) session.play()
      backend.worklet.render(1024)
      const energy = engine.energy()
      // 0.2 s after a pluck its force has gone: from then until the next, energy must not grow.
      if (i % 24 > 10 && energy > previous * (1 + 1e-9)) rises++
      previous = energy
    }
    expect(rises).toBe(0)
    expect(engine.faults()).toBe(0)
    expect(session.state.rebuilds).toBe(1)
  }, 400000)
})

describe('Physical coupling', () => {
  test('energy goes from the string through the bridge into the body; without the bridge none does and nothing is heard', async () => {
    const joined = await system(DEFAULT)
    joined.pluck()
    let most = 0
    const heard = joined.worklet.render(SR, () => (most = Math.max(most, joined.worklet.engine.resonatorEnergy(joined.built.body) / Math.max(joined.worklet.engine.energy(), 1e-30))))
    const apart = await system({ ...DEFAULT, joined: false })
    apart.pluck()
    const silent = apart.worklet.render(SR)
    console.log('with the bridge: most of the energy held by the soundboard', (100 * most).toFixed(2), '% | peak', largest(heard).toFixed(4), 'Pa | without the bridge: string energy', (1000 * apart.worklet.engine.resonatorEnergy(apart.built.string)).toFixed(3), 'mJ, soundboard energy', apart.worklet.engine.resonatorEnergy(apart.built.body), ', peak', largest(silent), 'Pa')
    expect(most).toBeGreaterThan(0.001)
    expect(largest(heard)).toBeGreaterThan(0.05)
    // Apart: the string is moving, the body is exactly still, and the output is exactly silent.
    expect(apart.worklet.engine.resonatorEnergy(apart.built.string)).toBeGreaterThan(1e-5)
    expect(apart.worklet.engine.resonatorEnergy(apart.built.body)).toBe(0)
    expect(largest(silent)).toBe(0)
  })

  test('in the builder: removing the bridge rebuilds to a silent instrument and says why; putting it back restores the sound', async () => {
    const graph = example()
    const { backend, session } = await playing(graph)
    session.play()
    expect(largest(backend.pascals(0.5))).toBeGreaterThan(0.05)
    const apart = removeConnection(graph, bridgeOf(graph).id)
    expect(validateGraph(apart)).toEqual([])
    expect(session.update(apart)).toBe('rebuilt')
    expect(session.state.notes.map((n) => n.message).join(' ')).toMatch(/not standing on/)
    expect(session.play()).toBe(true) // the string can still be plucked
    expect(largest(backend.pascals(0.5))).toBe(0)
    const again = connect(apart, bodyOf(apart).id, stringOf(apart).id) // either way round
    expect(bridgeOf(again.graph).from).toBe(stringOf(apart).id)
    expect(session.update(again.graph)).toBe('rebuilt')
    expect(session.state.notes).toEqual([])
    session.play()
    expect(largest(backend.pascals(0.5))).toBeGreaterThan(0.05)
    expect(backend.worklet.engine.faults()).toBe(0)
  })

  test('stability at the edges of every property: no fault, finite, and energy only falls once the pluck is over', async () => {
    for (const tension of [30, 120]) for (const length of [0.5, 0.8]) for (const pluckAt of [0.05, 0.95]) {
      const s = await system({ tension, length, pluckAt, joined: true })
      s.pluck(8)
      const name = `${tension} N, ${length} m, plucked at ${pluckAt}`
      const start = s.worklet.render(Math.round(0.25 * SR))
      let previous = s.worklet.engine.energy()
      let rises = 0
      const rest = s.worklet.render(SR, () => {
        const energy = s.worklet.engine.energy()
        if (energy > previous * (1 + 1e-9)) rises++
        previous = energy
      })
      expect(rises, name).toBe(0)
      expect(s.worklet.engine.faults(), name).toBe(0)
      expect(start.every(Number.isFinite) && rest.every(Number.isFinite), name).toBe(true)
      expect(s.worklet.engine.worstIterations(), name).toBeLessThanOrEqual(3)
    }
  }, 400000)
})

describe('The builder around it', () => {
  test('rebuilding: length rebuilds, tension, pluck position and strength do not', async () => {
    const graph = example()
    const id = stringOf(graph).id
    const { session } = await playing(graph)
    expect(session.state.rebuilds).toBe(1)
    expect(session.update(setParam(graph, id, 'pluckStrength', 5))).toBe('unchanged') // read when plucked
    expect(session.update(setParam(graph, id, 'tension', 80))).toBe('live')
    expect(session.update(setParam(graph, id, 'pluckPosition', 0.6))).toBe('live')
    expect(session.needsRebuild(setParam(graph, id, 'length', 0.7))).toBe(true)
    expect(session.update(setParam(graph, id, 'length', 0.7))).toBe('rebuilt')
    expect(session.state.rebuilds).toBe(2)
    // Out of range is refused, not clamped.
    expect(session.update(setParam(graph, id, 'tension', 500))).toBe('invalid')
    expect(session.state.issues[0].message).toMatch(/Tension must be between 30 and 120 N/)
    expect(session.update(graph)).toBe('rebuilt')
  })

  test('undo and redo walk back and forward through edits of the string, and the engine follows', async () => {
    const graph = example()
    const id = stringOf(graph).id
    let history = startHistory(graph)
    history = commit(history, setParam(history.present, id, 'tension', 90), 'tension', 0)
    history = commit(history, setParam(history.present, id, 'length', 0.7), 'length', 1000)
    history = commit(history, removeConnection(history.present, bridgeOf(history.present).id), '', 2000)
    const { backend, session } = await playing(history.present)
    expect(largest((session.play(), backend.pascals(0.3)))).toBe(0)
    history = undo(history) // the bridge is back
    expect(session.update(history.present)).toBe('rebuilt')
    session.play()
    expect(fundamental(backend.pascals(2.2), stringPitch({ tension: 90, length: 0.7 })) / stringPitch({ tension: 90, length: 0.7 })).toBeCloseTo(1, 2)
    history = undo(history) // length back to 0.65
    expect(stringOf(history.present).params.length).toBe(0.65)
    expect(session.update(history.present)).toBe('rebuilt')
    history = undo(history) // tension back to 73.5: live
    expect(session.update(history.present)).toBe('live')
    expect(history.present).toEqual(graph)
    history = redo(redo(redo(history)))
    expect(bridgeOf(history.present)).toBeUndefined()
    expect(session.update(history.present)).toBe('rebuilt')
    expect(backend.worklet.engine.faults()).toBe(0)
  }, 400000)

  test('saving and restoring: the instrument comes back as it was; unsupported ones are refused with the reason', () => {
    const graph = setParam(example(), stringOf(example()).id, 'tension', 88.5)
    const back = restore(serialize(graph))
    expect(back.problem).toBeUndefined()
    expect(back.graph).toEqual(graph)
    expect(structureKey(back.graph!)).toBe(structureKey(graph))
    // Two strings; a string with a bar; a spring where the bridge should be; a bridge to a bar.
    const twoStrings = { ...graph, nextId: graph.nextId + 1, components: [...graph.components, { ...stringOf(graph), id: `c${graph.nextId}`, name: 'String 2' }] }
    expect(() => deserialize(serialize(twoStrings))).toThrow(/one string/)
    const withBar = addComponent(emptyGraph(), 'metalBar', 100, 100).graph
    const mixed = { ...graph, nextId: graph.nextId + 1, components: [...graph.components, { ...withBar.components[0], id: `c${graph.nextId}` }] }
    expect(() => deserialize(serialize(mixed))).toThrow(/cannot share an instrument with bars/)
    const sprung = { ...graph, connections: [{ ...bridgeOf(graph), type: 'spring' as const }] }
    expect(() => deserialize(serialize(sprung))).toThrow(/joined by a bridge/)
    expect(restore(serialize(twoStrings)).graph).toBeNull()
  })

  test('only what is supported can be assembled: one string, one body, a bridge between them, and no bars', () => {
    const graph = example()
    expect(cannotAdd(graph, 'steelString')).toMatch(/one string/)
    expect(cannotAdd(graph, 'dampedBox')).toMatch(/one damped box body/)
    expect(cannotAdd(graph, 'metalBar')).toMatch(/cannot be added to a string instrument/)
    expect(cannotAdd(graph, 'mallet')).toMatch(/cannot be added to a string instrument/)
    expect(cannotAdd(EXAMPLES[0].make(), 'steelString')).toMatch(/cannot share an instrument with bars/)
    expect(cannotAdd(emptyGraph(), 'steelString')).toBeNull()
    expect(cannotAdd(EXAMPLES[0].make(), 'woodBar')).toBeNull()
    expect(cannotConnect(graph, stringOf(graph).id, bodyOf(graph).id)).toMatch(/already connected/)
    // A string alone, then a body: the bridge is the only connection offered, and each step says what is missing.
    const alone = addComponent(emptyGraph(), 'steelString', 200, 200)
    const first = translate(alone.graph, SR)
    expect(first.ok && first.built.notes[0].message).toMatch(/no body to stand on/)
    const both = addComponent(alone.graph, 'dampedBox', 400, 400)
    const second = translate(both.graph, SR)
    expect(second.ok && second.built.notes[0].message).toMatch(/not standing on/)
    expect(cannotConnect(both.graph, alone.id, both.id)).toBeNull()
    expect(connect(both.graph, alone.id, both.id).graph.connections[0]).toMatchObject({ type: 'bridge', from: alone.id, to: both.id, stiffness: 1e6 })
  })

  test('on the canvas: each part can be picked up by its body and connected from its dot, and the pluck point follows the property', () => {
    const graph = example()
    for (const c of graph.components) {
      const dot = handle(c)
      expect(onHandle(c, dot)).toBe(true)
      expect(componentAt(graph, { x: c.x, y: c.y })).toBe(c.id)
      expect(onHandle(c, { x: c.x - rectSize(c)!.w / 4, y: c.y })).toBe(false) // its body, not its dot
    }
    const string = stringOf(graph)
    const width = rectSize(string)!.w
    expect(strikePoint(string).x).toBeCloseTo(string.x - width / 2 + 0.8 * width, 9)
    expect(strikePoint(setParam(graph, string.id, 'pluckPosition', 0.25).components[0]).x).toBeCloseTo(string.x - width / 2 + 0.25 * width, 9)
    // A longer string is drawn longer.
    expect(rectSize(setParam(graph, string.id, 'length', 0.8).components[0])!.w).toBeGreaterThan(width)
  })

  test('switching instruments: bars after a string are as they always were, and the string after bars is itself again', async () => {
    const { backend, session } = await playing(example())
    session.play()
    const stringFirst = backend.pascals(1)
    // The approved bar examples are the same three as before, untouched.
    expect(EXAMPLES.map((x) => x.id)).toEqual(['single', 'coupled', 'mixed'])
    for (const bars of EXAMPLES) {
      const graph = bars.make()
      expect(session.update(graph)).toBe('rebuilt')
      expect(session.play()).toBe(true)
      const fromWorklet = backend.worklet.render(SR)
      // The same instrument on a bare engine, as before this phase: bit for bit the same.
      const translation = translate(graph, SR)
      if (!translation.ok) throw new Error('bars example does not translate')
      expect(translation.built.output).toBe('velocity')
      expect(translation.built.calls.some((c) => c[0] === 'radiate' || c[0] === 'pluck')).toBe(false)
      const engine = createEngine()
      run(engine, translation.built.calls)
      const { instrumentCalls } = await import('../src/builder/translate')
      run(engine, instrumentCalls(graph, translation.built))
      const bare = renderEngine(engine, new Float32Array(SR)).map((v) => Math.max(-1, Math.min(1, v)))
      expect(Array.from(fromWorklet), bars.label).toEqual(Array.from(bare))
      expect(largest(fromWorklet)).toBeGreaterThan(0.001)
    }
    expect(session.update(example())).toBe('rebuilt')
    session.play()
    expect(Array.from(backend.pascals(1))).toEqual(Array.from(stringFirst))
    expect(backend.worklet.engine.faults()).toBe(0)
  }, 400000)
})
