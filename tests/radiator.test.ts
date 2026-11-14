// Phase 3D.4: several outputs from the engine (observation taps) and the
// experimental 16-point bar radiator in the AudioWorklet processor, checked
// against the Phase 3D.3 references and against the engine as it was before
// (tests/fixtures/engine-phase-3d3.wasm, the binary of tag phase-3d3-approved).
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { frequenciesOf, geometryOf, modalVelocities, partial, pointVelocities, pressureByPoints, pressureByRadiator, pressureByTransfer, velocityOutput, withPorts, type Radiating } from '../analysis/radiation'
import { createEngine, engineBytes, render as renderEngine, run } from '../analysis/wasm'
import { createWorklet, type Worklet } from '../analysis/worklet'
import { barModeShape } from '../src/audio/engine/physics'
import { EXAMPLES, RADIATION_EXAMPLES, STRING_EXAMPLES } from '../src/builder/examples'
import { addComponent, cannotAdd, cannotConnect, commit, connect, deserialize, emptyGraph, redo, removeComponent, restore, serialize, setConnection, setParam, startHistory, undo, validateGraph, type Component, type Graph } from '../src/builder/graph'
import { Session, type Backend } from '../src/builder/session'
import { instrumentCalls, LISTENER, LISTENER_FULL_SCALE, OUTPUT_GAIN, structureKey, translate } from '../src/builder/translate'
import { pointAt, RADIATOR_POINTS, radiatorArguments, radiatorCalls, radiatorDelay } from '../src/experimental/radiation/barRadiation'
import { instantiate, outputBuffer, type Call } from '../src/experimental/wasm/engine'
import { SR } from './helpers'

const before = readFileSync(new URL('./fixtures/engine-phase-3d3.wasm', import.meta.url))
const dB = (ratio: number) => 20 * Math.log10(ratio)
const largest = (x: ArrayLike<number>, from = 0, to = x.length) => {
  let m = 0
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}
const part = (graph: Graph, type: Component['type']) => graph.components.find((c) => c.type === type)!
const barOf = (graph: Graph) => graph.components.find((c) => c.type === 'metalBar' || c.type === 'woodBar')!
const hybridGraph = () => STRING_EXAMPLES.find((x) => x.id === 'string-bar')!.make()
const heardGraph = () => RADIATION_EXAMPLES[0].make()
const built = (graph: Graph) => {
  const translation = translate(graph, SR)
  if (!translation.ok) throw new Error(translation.issues[0].message)
  return translation.built
}
const metalBar = (seconds = 1.5, listener = LISTENER, strikePosition?: number): Radiating => {
  let graph = EXAMPLES[0].make()
  if (strikePosition !== undefined) graph = setParam(graph, barOf(graph).id, 'strikePosition', strikePosition)
  return { graph, bar: barOf(graph), listener, seconds }
}
function woodenBar(seconds = 1): Radiating {
  const bar = addComponent(emptyGraph(), 'woodBar', 300, 300)
  const mallet = addComponent(bar.graph, 'mallet', 300, 100)
  const graph = connect(mallet.graph, mallet.id, bar.id).graph
  return { graph, bar: barOf(graph), listener: LISTENER, seconds }
}
const hybrid = (seconds: number, play: (calls: Call[]) => Call[]): Radiating => ({ graph: hybridGraph(), bar: barOf(hybridGraph()), listener: LISTENER, seconds, play })
const plucked = (calls: Call[]) => calls.slice(0, 1)
const struck = (calls: Call[]) => calls.slice(1)
/** The radiator's output is late by this many whole samples (and a fraction) for this bar. */
const lateBy = (o: Radiating) => Math.round(radiatorDelay(geometryOf(o.bar)) * SR)

class NodeBackend implements Backend {
  worklet!: Worklet
  async open() {
    this.worklet = await createWorklet([['reset', SR, 2], ['build']])
    return { sampleRate: SR, send: (calls: Call[]) => this.worklet.send(calls), rebuild: (calls: Call[]) => this.worklet.send(calls), close: async () => {} }
  }
  out(seconds: number, each?: (block: number) => void) {
    return this.worklet.render(Math.round(seconds * SR), each)
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

/** The metal bar example with the 16 observation points as extra ports of the bar, and a tap on each. */
function tapped(strikePosition?: number) {
  const o = metalBar(1, LISTENER, strikePosition)
  const b = built(o.graph)
  const modes = frequenciesOf(o.bar).length
  const shapes = Array.from({ length: RADIATOR_POINTS }, (_, j) => Array.from({ length: modes }, (_, n) => barModeShape(n, pointAt(j))))
  const { calls, first } = withPorts(b.calls, b.bars[o.bar.id], shapes)
  const taps: Call[] = shapes.map((_, j) => ['addTap', b.bars[o.bar.id], first + j])
  return { calls: [...calls, ...taps], play: instrumentCalls(o.graph, b), bar: b.bars[o.bar.id], first, modes }
}
const tapBuffer = (engine: ReturnType<typeof createEngine>) => new Float64Array(engine.memory.buffer, engine.tapPointer(), 32 * 128)

describe('The engine has several outputs: observation taps', () => {
  test('sixteen taps give the velocity of sixteen ports at every sample of a block, in m/s, exactly as velocity() reports it', () => {
    const t = tapped()
    const [blocks, single] = [createEngine(), createEngine()]
    for (const engine of [blocks, single]) {
      run(engine, t.calls)
      run(engine, t.play)
    }
    const taps = tapBuffer(blocks)
    let [compared, peak] = [0, 0]
    for (let block = 0; block < 40; block++) {
      blocks.process(128)
      for (let i = 0; i < 128; i++) {
        single.process(1)
        for (let j = 0; j < RADIATOR_POINTS; j++) {
          const v = single.velocity(t.bar, t.first + j)
          if (taps[j * 128 + i] !== v) throw new Error(`tap ${j} at sample ${block * 128 + i}: ${taps[j * 128 + i]} is not ${v}`)
          peak = Math.max(peak, Math.abs(v))
          compared++
        }
      }
    }
    expect(compared).toBe(40 * 128 * 16)
    expect(peak).toBeGreaterThan(0.05) // m/s: the bar is really moving
    expect(blocks.faults()).toBe(0)
  })

  test('the taps are where they are said to be: on a bar struck at its middle, point j moves exactly as point 15 - j', () => {
    // Positions: point j is the middle of the j-th sixteenth of the bar.
    expect(Array.from({ length: 16 }, (_, j) => pointAt(j))).toEqual(Array.from({ length: 16 }, (_, j) => (j + 0.5) / 16))
    const t = tapped(0.5)
    const engine = createEngine()
    run(engine, t.calls)
    run(engine, t.play)
    const taps = tapBuffer(engine)
    let [asymmetry, peak, endOverMiddle] = [0, 0, 0]
    for (let block = 0; block < 60; block++) {
      engine.process(128)
      for (let i = 0; i < 128; i++) {
        for (let j = 0; j < 8; j++) {
          asymmetry = Math.max(asymmetry, Math.abs(taps[j * 128 + i] - taps[(15 - j) * 128 + i]))
          peak = Math.max(peak, Math.abs(taps[j * 128 + i]))
        }
        endOverMiddle = Math.max(endOverMiddle, Math.abs(taps[i]) - Math.abs(taps[7 * 128 + i]))
      }
    }
    // Struck in the middle, only the modes that are the same either side of it move.
    expect(asymmetry / peak).toBeLessThan(1e-12)
    // And the free ends move more than the middle: the points really are spread along the bar.
    expect(endOverMiddle).toBeGreaterThan(0)
  })

  test('there are 32 taps; a 33rd is refused; reset removes them; and the memory is the size it was', () => {
    const engine = createEngine()
    const size = engine.memory.buffer.byteLength
    expect(size).toBe(instantiate(before).memory.buffer.byteLength)
    expect(size).toBe(3145728)
    const t = tapped()
    run(engine, t.calls)
    for (let k = 16; k < 32; k++) expect(engine.addTap(t.bar, 0)).toBe(k)
    expect(engine.addTap(t.bar, 0)).toBe(-1)
    run(engine, t.play)
    for (let block = 0; block < 400; block++) engine.process(128)
    expect(engine.memory.buffer.byteLength).toBe(size)
    // After a reset there are none: a system built without taps leaves the tap buffer alone.
    const plain = built(EXAMPLES[0].make())
    run(engine, plain.calls)
    const taps = tapBuffer(engine)
    taps.fill(123)
    run(engine, instrumentCalls(EXAMPLES[0].make(), plain))
    engine.process(128)
    expect(taps.every((v) => v === 123)).toBe(true)
    expect(engine.addTap(0, 0)).toBe(0)
  })

  test('a tap changes nothing it watches: with sixteen taps the first output, the energy and the solver\'s work are bit for bit those without', () => {
    const t = tapped()
    const plainCalls = t.calls.filter((call) => call[0] !== 'addTap')
    const [withTaps, without] = [createEngine(), createEngine()]
    run(withTaps, t.calls)
    run(without, plainCalls)
    for (const engine of [withTaps, without]) run(engine, t.play)
    const [a, b] = [outputBuffer(withTaps), outputBuffer(without)]
    for (let block = 0; block < 375; block++) {
      withTaps.process(128)
      without.process(128)
      expect(Array.from(a.subarray(0, 128))).toEqual(Array.from(b.subarray(0, 128)))
      expect(withTaps.energy()).toBe(without.energy())
      expect(withTaps.dissipated()).toBe(without.dissipated())
    }
    expect(withTaps.worstIterations()).toBe(without.worstIterations())
    expect(largest(a)).toBeGreaterThan(0)
  })
})

describe('What played before plays the same', () => {
  test('every example of earlier phases: sample for sample what the engine of Phase 3D.3 gives', async () => {
    for (const example of [...EXAMPLES, ...STRING_EXAMPLES]) {
      const graph = example.make()
      const b = built(graph)
      expect(b.calls.some((call) => call[0] === 'addTap' || call[0] === 'radiator'), example.label).toBe(false)
      const [now, then] = [await createWorklet(b.calls), await createWorklet(b.calls, before)]
      const play = instrumentCalls(graph, b)
      const outputs = [now, then].map((worklet) => {
        worklet.send(play)
        const first = worklet.render(SR)
        // Played again while ringing, with a finger on the string where there is one.
        worklet.send(b.stringBody ? [['touch', b.stringBody.finger, 30, 0.002, 0.026, 0.002], ...play] : play)
        return [...first, ...worklet.render(SR)]
      })
      expect(largest(outputs[0]), example.label).toBeGreaterThan(0.001)
      expect(outputs[0], example.label).toEqual(outputs[1])
      expect(now.engine.energy()).toBe(then.engine.energy())
    }
    // The approved examples are the ones they were.
    expect(EXAMPLES.map((x) => x.id)).toEqual(['single', 'coupled', 'mixed'])
    expect(STRING_EXAMPLES.map((x) => x.id)).toEqual(['string', 'string-bar'])
  }, 400000)

  test('with the radiator on, the engine\'s own output is still made, and is bit for bit the approved hybrid\'s', async () => {
    const heard = built(heardGraph())
    const plain = built(hybridGraph())
    const play = instrumentCalls(hybridGraph(), plain)
    expect(instrumentCalls(heardGraph(), heard)).toEqual(play)
    const [a, b] = [await createWorklet(heard.calls), await createWorklet(plain.calls)]
    a.send(play)
    b.send(play)
    const own = outputBuffer(a.engine)
    let pressure = 0
    // A sample at a time, so that the engine's own output can be read whatever the processor is doing.
    for (let i = 0; i < SR; i++) {
      pressure = Math.max(pressure, Math.abs(a.render(1)[0]))
      const velocity = b.render(1)[0]
      if (own[0] !== velocity) throw new Error(`sample ${i}: ${own[0]} is not ${velocity}`)
      if (i % 4800 === 0) expect(a.engine.energy()).toBe(b.engine.energy())
    }
    expect(pressure).toBeGreaterThan(0.01)
    expect(a.engine.faults() + b.engine.faults()).toBe(0)
  }, 400000)

  test('the radiator is off until asked for, and a new system turns it off: the bar examples after it are a bare engine\'s', async () => {
    const { backend, session } = await playing(heardGraph())
    session.play()
    backend.out(0.3)
    for (const bars of EXAMPLES) {
      const graph = bars.make()
      expect(session.update(graph)).toBe('rebuilt')
      session.play()
      const fromWorklet = backend.out(1)
      const engine = createEngine()
      run(engine, built(graph).calls)
      run(engine, instrumentCalls(graph, built(graph)))
      const bare = renderEngine(engine, new Float32Array(SR)).map((v) => Math.max(-1, Math.min(1, v)))
      expect(Array.from(fromWorklet), bars.label).toEqual(Array.from(bare))
    }
  }, 400000)
})

describe('The real-time radiator against the references of Phase 3D.3', () => {
  test('it is the 16-point method: the same pressure as the offline calculation from recorded motion, to rounding', async () => {
    for (const [name, o] of [['struck', hybrid(1, struck)], ['plucked', hybrid(1, plucked)]] as const) {
      const realTime = await pressureByRadiator(o)
      const recorded = await modalVelocities(o)
      const offline = pressureByPoints(pointVelocities(recorded.modes, 16), geometryOf(o.bar), o.listener)
      expect(realTime.delay).toBe(offline.delay)
      // From 2 ms on. (The offline prototype leaves out the very first sample of motion; the processor does not.)
      let worst = 0
      for (let i = 96; i < offline.pressure.length; i++) worst = Math.max(worst, Math.abs(offline.pressure[i] - realTime.pressure[i]))
      expect(dB(worst / largest(offline.pressure)), name).toBeLessThan(-110)
    }
  }, 400000)

  test('bar modes ringing naturally: each within a third of a decibel of the frequency-domain reference, metal and wood', async () => {
    const metal = metalBar(2)
    const realTime = await pressureByRadiator(metal)
    const reference = pressureByTransfer((await modalVelocities(metal)).modes, geometryOf(metal.bar), LISTENER)
    const errors = frequenciesOf(metal.bar)
      .slice(0, 5)
      .map((f) => dB(partial(realTime.pressure, f, 4800 + lateBy(metal)) / partial(reference, f)))
    // Measured: -0.09, -0.17, -0.28, +0.09, +0.03 dB at 582, 1603, 3143, 5195 and 7760 Hz.
    for (const error of errors) expect(Math.abs(error)).toBeLessThan(0.35)
    expect(Math.abs(dB(largest(realTime.pressure) / largest(reference)))).toBeLessThan(0.5)
    const wood = woodenBar(1)
    const woodRealTime = await pressureByRadiator(wood)
    const woodReference = pressureByTransfer((await modalVelocities(wood)).modes, geometryOf(wood.bar), LISTENER)
    const f = frequenciesOf(wood.bar)[0]
    expect(Math.abs(dB(partial(woodRealTime.pressure, f, 2400 + lateBy(wood)) / partial(woodReference, f, 2400)))).toBeLessThan(0.2) // measured -0.07
    expect(Math.abs(dB(largest(woodRealTime.pressure) / largest(woodReference)))).toBeLessThan(0.3) // measured -0.12
  }, 400000)

  test('a bar driven by a string, far from its own notes: each string partial within a decibel of the reference', async () => {
    const o = hybrid(3, plucked)
    const realTime = await pressureByRadiator(o)
    const reference = pressureByTransfer((await modalVelocities(o)).modes, geometryOf(o.bar), LISTENER)
    const partials = [1, 2, 3, 4, 6, 9, 12].map((n) => n * 109.89)
    const errors = partials.map((f) => dB(partial(realTime.pressure, f, 4800 + lateBy(o)) / partial(reference, f)))
    // Measured: -0.79, +0.14, -0.02, -0.10, -0.16, -0.09, -0.13 dB. (One weight per mode was wrong by up to 36 dB here.)
    for (const error of errors) expect(Math.abs(error)).toBeLessThan(1)
    expect(Math.max(...errors.slice(1).map(Math.abs))).toBeLessThan(0.3)
    expect(Math.abs(dB(largest(realTime.pressure) / largest(reference)))).toBeLessThan(0.3)
  }, 400000)

  test('radiation depends on the mode: per metre a second at the strike point, the second mode makes ten times the pressure of the first', async () => {
    const o = metalBar(1.5)
    const { pressure } = await pressureByRadiator(o)
    const velocity = await velocityOutput(o)
    const f = frequenciesOf(o.bar)
    const perVelocity = (n: number) => partial(pressure, f[n]) / partial(velocity, f[n]) // Pa per m/s
    // Measured: +20.8 dB. A flat gain on the velocity would give 0.
    expect(dB(perVelocity(1) / perVelocity(0))).toBeGreaterThan(18)
    expect(dB(perVelocity(1) / perVelocity(0))).toBeLessThan(24)
    // And the pressure is in pascals: mode 1 here is a few millipascals for a few centimetres a second.
    expect(perVelocity(0)).toBeGreaterThan(0.01)
    expect(perVelocity(0)).toBeLessThan(1)
  }, 400000)
})

describe('The radiated pressure behaves as sound from a bar should', () => {
  test('symmetry: a bar struck at its middle sounds the same from either side of it, and is silent along its own line', async () => {
    const left = await pressureByRadiator(metalBar(1, { distance: 1, angle: 45 }, 0.5))
    const right = await pressureByRadiator(metalBar(1, { distance: 1, angle: -45 }, 0.5))
    let difference = 0
    for (let i = 0; i < left.pressure.length; i++) difference = Math.max(difference, Math.abs(left.pressure[i] - right.pressure[i]))
    expect(largest(left.pressure)).toBeGreaterThan(0.5) // Pa
    expect(difference / largest(left.pressure)).toBeLessThan(1e-6)
    // A dipole sends nothing sideways: along the bar's own line every point's cos(theta) is zero.
    const along = await pressureByRadiator(metalBar(1, { distance: 1, angle: 90 }, 0.5))
    expect(largest(along.pressure)).toBeLessThan(1e-12)
  }, 400000)

  test('distance: the radiator follows the reference from a quarter of a metre to eight, and falls faster than 1/r in front of the bar', async () => {
    const recorded = await modalVelocities(metalBar(1))
    const f = frequenciesOf(metalBar().bar)[0]
    const level: Record<string, number> = {}
    for (const [distance, angle] of [[0.25, 0], [1, 0], [2, 0], [4, 0], [8, 0], [0.5, 45], [2, 45], [4, 45], [8, 45]]) {
      const o = metalBar(1, { distance, angle })
      const { pressure } = await pressureByRadiator(o)
      const reference = pressureByTransfer(recorded.modes, geometryOf(o.bar), o.listener)
      level[`${distance}@${angle}`] = partial(pressure, f, 4800 + lateBy(o))
      // Measured: within 0.1 dB everywhere at 45 degrees and up to 2 m in front. Far in front of the bar the
      // sound is the small remainder of an almost complete cancellation, and sixteen points get that
      // remainder less exactly: +0.5 dB at 4 m, +1.7 dB at 8 m (where it is 55 dB below the level at 0.25 m).
      const allowed = angle === 0 && distance >= 8 ? 2 : angle === 0 && distance >= 4 ? 0.6 : 0.2
      expect(Math.abs(dB(level[`${distance}@${angle}`] / partial(reference, f))), `${distance} m, ${angle} degrees`).toBeLessThan(allowed)
    }
    // Straight in front, a free bar's mode pushes as much air one way as the other, so what is left falls
    // nearly as 1/r^2 (12 dB for each doubling) even metres away. Measured: 12.0, 11.7 and 10.9 dB.
    for (const [near, far] of [['1@0', '2@0'], ['2@0', '4@0'], ['4@0', '8@0']]) {
      expect(dB(level[near] / level[far])).toBeGreaterThan(10)
      expect(dB(level[near] / level[far])).toBeLessThan(12.5)
    }
    // Off to one side the travelling sound is what is left, and it falls as 1/r: 6 dB a doubling (measured 6.0).
    for (const [near, far] of [['2@45', '4@45'], ['4@45', '8@45']]) {
      expect(dB(level[near] / level[far])).toBeGreaterThan(5.8)
      expect(dB(level[near] / level[far])).toBeLessThan(6.3)
    }
  }, 400000)

  test('units: pascals whatever the node\'s ceiling is, and twice the pluck is twice the pressure', async () => {
    const o = hybrid(0.5, plucked)
    const [at16, at4] = [await pressureByRadiator(o, 16), await pressureByRadiator(o, 4)]
    // Nothing is normalized: a different ceiling is a different number in the node and the same pascals.
    expect(Math.abs(dB(largest(at16.pressure) / largest(at4.pressure)))).toBeLessThan(1e-4)
    const twice = await pressureByRadiator({ ...o, play: (calls) => plucked(calls).map((call): Call => (call[0] === 'pluck' ? ['pluck', call[1], call[2], 2 * call[3], ...(call.slice(4) as number[])] : call)) }, 16)
    expect(largest(twice.pressure) / largest(at16.pressure)).toBeCloseTo(2, 5)
    // The numbers themselves: far gain is Pa per (m/s^2) and positive in front of the bar, the delay is in samples.
    const bar = geometryOf(o.bar)
    const args = radiatorArguments(bar, LISTENER, 0, SR, 16)
    expect(args.length).toBe(3 + 4 * 16)
    expect(args[0]).toBe(16)
    for (let j = 0; j < 16; j++) {
      const [tap, far, near, late] = args.slice(3 + 4 * j, 7 + 4 * j)
      const R = Math.hypot(Math.sin(Math.PI / 4) - (pointAt(j) - 0.5) * bar.length, Math.cos(Math.PI / 4))
      expect(tap).toBe(j)
      expect(far).toBeGreaterThan(0)
      // Near field: rho B cos(theta) dx / (4 pi R^2), with B the air a metre of the bar moves.
      expect(near).toBeCloseTo((1.2 * (bar.width * bar.thickness + (Math.PI * bar.width ** 2) / 4) * (Math.cos(Math.PI / 4) / R) * (bar.length / 16)) / (4 * Math.PI * R * R), 14)
      expect(late).toBeCloseTo(((bar.length + R - 1) / 343) * SR, 9)
      expect(late).toBeGreaterThan(0)
    }
  }, 400000)

  test('the listener takes nothing: with no losses anywhere, the energy of string, bar and mallet is kept while the pressure is made', async () => {
    const lossless = built(heardGraph()).calls.map((call): Call => (call[0] === 'setMode' ? ['setMode', call[1], call[2], call[3], Infinity, call[5]] : call))
    const worklet = await createWorklet(lossless)
    worklet.send(struck(instrumentCalls(heardGraph(), built(heardGraph()))))
    worklet.render(4800) // the mallet has come and gone
    const start = worklet.engine.energy()
    let [low, high] = [start, start]
    const pressure = worklet.render(2 * SR, () => {
      const energy = worklet.engine.energy()
      low = Math.min(low, energy)
      high = Math.max(high, energy)
    })
    expect(start).toBeGreaterThan(0.001) // J
    expect((high - low) / start).toBeLessThan(1e-9)
    expect(largest(pressure) * LISTENER_FULL_SCALE).toBeGreaterThan(0.3) // Pa: it is being heard all the while
    expect(Math.abs(worklet.engine.dissipated()) / start).toBeLessThan(1e-12) // nothing is lost to anything
  }, 400000)

  test('played as hard as the builder allows, plucked and struck ten times a second for five seconds: no fault, never at the ceiling, the same every time', async () => {
    const hard = () => {
      const graph = heardGraph()
      return setParam(setParam(setParam(graph, part(graph, 'mallet').id, 'velocity', 5), part(graph, 'mallet').id, 'mass', 0.5), part(graph, 'steelString').id, 'pluckStrength', 8)
    }
    const once = async () => {
      const { backend, session } = await playing(hard())
      const out = backend.out(5, (block) => {
        if (block % 75 === 0) session.strikeBar(part(hard(), 'steelString').id)
        if (block % 75 === 37) session.strikeExciter(part(hard(), 'mallet').id)
      })
      const ringing = backend.engine.energy()
      const after = backend.out(3)
      return { out, after, ringing, left: backend.engine.energy(), faults: backend.engine.faults() }
    }
    const [a, b] = [await once(), await once()]
    expect(a.faults).toBe(0)
    expect(a.out.every(Number.isFinite)).toBe(true)
    expect(largest(a.out)).toBeGreaterThan(0.05)
    expect(largest(a.out)).toBeLessThan(1) // the node's ceiling is 16 Pa
    expect(a.left).toBeLessThan(a.ringing) // left alone, it dies away
    expect(largest(a.after, 2 * SR)).toBeLessThan(largest(a.out))
    expect(Array.from(b.out)).toEqual(Array.from(a.out))
    expect(Array.from(b.after)).toEqual(Array.from(a.after))
  }, 400000)
})

describe('The experimental example in the builder', () => {
  test('it is the approved hybrid with a listener: the same parts, the same engine system, and sixteen ports, taps and a radiator more', () => {
    const [heard, plain] = [heardGraph(), hybridGraph()]
    const listener = part(heard, 'listener')
    expect(removeComponent(heard, listener.id)).toEqual({ ...plain, nextId: heard.nextId })
    expect(serialize(hybridGraph())).not.toMatch(/listener/)
    const [a, b] = [built(heard), built(plain)]
    expect(b.output).toBe('velocity')
    expect(b.listener).toBeUndefined()
    expect(a.output).toBe('pressure')
    expect(a.listener).toEqual({ id: listener.id, barId: part(heard, 'metalBar').id })
    const bar = a.bars[part(heard, 'metalBar').id]
    const extra = (call: Call) => call[0] === 'addTap' || call[0] === 'radiator' || (call[0] === 'setShape' && call[1] === bar && call[2] >= 2)
    const same = a.calls.filter((call) => !extra(call)).map((call): Call => (call[0] === 'addResonator' && call[1] === 18 ? ['addResonator', 2, call[2]] : call))
    expect(same).toEqual(b.calls)
    // The extra ports hold the bar's shapes at the sixteen points, and each has its tap.
    const shapes = a.calls.filter((call) => call[0] === 'setShape' && call[1] === bar && call[2] >= 2)
    expect(shapes.length).toBe(16 * 8)
    for (const [, , port, n, value] of shapes) expect(value).toBe(barModeShape(n, pointAt(port - 2)))
    expect(a.calls.filter((call) => call[0] === 'addTap')).toEqual(Array.from({ length: 16 }, (_, j) => ['addTap', bar, 2 + j]))
    const geometry = { length: 0.4, width: 0.04, thickness: 0.01 }
    expect(a.calls.at(-1)).toEqual(['radiator', ...radiatorArguments(geometry, LISTENER, 0, SR, LISTENER_FULL_SCALE)])
    expect(a.calls.slice(-17)).toEqual(radiatorCalls(geometry, LISTENER, bar, 2, SR, LISTENER_FULL_SCALE))
    expect(LISTENER).toEqual({ distance: 1, angle: 45 })
  })

  test('what it plays is the validated radiator: pascals over 16 at the node, sample for sample the prototype\'s', async () => {
    const { backend, session } = await playing(heardGraph())
    expect(session.play()).toBe(true)
    const sound = backend.out(2)
    const prototype = await pressureByRadiator({ graph: hybridGraph(), bar: barOf(hybridGraph()), listener: LISTENER, seconds: 2 }, LISTENER_FULL_SCALE)
    expect(Array.from(sound, (v) => v * LISTENER_FULL_SCALE)).toEqual(Array.from(prototype.pressure))
    expect(largest(sound) * LISTENER_FULL_SCALE).toBeGreaterThan(0.5) // Pa: the mallet's stroke
    expect(largest(sound)).toBeLessThan(0.5)
    expect(backend.engine.faults()).toBe(0)
  }, 400000)

  test('it is played as the hybrid is: plucked, struck, touched, pulled and released; the joint is live; the listener comes and goes by a rebuild', async () => {
    const graph = heardGraph()
    const [stringId, barId, malletId] = [part(graph, 'steelString').id, part(graph, 'metalBar').id, part(graph, 'mallet').id]
    const { backend, session } = await playing(graph)
    expect(session.strikeBar(stringId)).toBe(true)
    const pluck = largest(backend.out(0.5)) * LISTENER_FULL_SCALE
    expect(session.strikeExciter(malletId)).toBe(true)
    const stroke = largest(backend.out(0.5)) * LISTENER_FULL_SCALE
    // Pascals. A string moves the bar slowly, and a slow bar moves little air: measured 0.0096 and 1.15 Pa.
    expect(pluck).toBeGreaterThan(0.005)
    expect(pluck).toBeLessThan(0.02)
    expect(stroke).toBeGreaterThan(0.8)
    expect(stroke).toBeLessThan(1.5)
    expect(session.strikeBar(barId)).toBe(true)
    backend.out(0.2)
    const stringBefore = backend.engine.resonatorEnergy(0)
    expect(session.touch(true)).toBe(true)
    backend.out(0.3)
    expect(backend.engine.resonatorEnergy(0)).toBeLessThan(0.2 * stringBefore)
    session.touch(false)
    expect(session.pull(0.004)).toBeGreaterThan(2)
    backend.out(0.4)
    expect(session.release()).toBe(true)
    expect(largest(backend.out(0.5))).toBeGreaterThan(0)
    const joint = graph.connections.find((c) => c.type !== 'strike')!
    expect(session.update(setConnection(graph, joint.id, { stiffness: 2e5 }))).toBe('live')
    expect(session.update(setParam(graph, barId, 'damping', 3))).toBe('live')
    expect(session.update(setParam(graph, stringId, 'tension', 80))).toBe('live')
    expect(session.update(setParam(graph, barId, 'length', 0.5))).toBe('rebuilt')
    // Without the listener it is the approved hybrid again, and sounds exactly as it.
    const without = removeComponent(graph, part(graph, 'listener').id)
    expect(structureKey(without)).not.toBe(structureKey(graph))
    expect(session.update(without)).toBe('rebuilt')
    session.play()
    const reference = await playing(hybridGraph())
    reference.session.play()
    expect(Array.from(backend.out(1))).toEqual(Array.from(reference.backend.out(1)))
    expect(largest(reference.backend.out(0.1)) / OUTPUT_GAIN).toBeGreaterThan(0.01) // m/s again
    expect(session.update(graph)).toBe('rebuilt')
    expect(backend.engine.faults()).toBe(0)
  }, 400000)

  test('a listener goes only with a string tied to a metal bar, one at most, and nothing is connected to it', () => {
    const heard = heardGraph()
    const listener = part(heard, 'listener')
    expect(validateGraph(heard)).toEqual([])
    expect(cannotAdd(hybridGraph(), 'listener')).toBeNull()
    expect(cannotAdd(heard, 'listener')).toMatch(/one listener/)
    for (const example of [...EXAMPLES, STRING_EXAMPLES[0]]) expect(cannotAdd(example.make(), 'listener'), example.label).toMatch(/metal bar that a string is tied to/)
    expect(cannotAdd(emptyGraph(), 'listener')).toMatch(/metal bar that a string is tied to/)
    for (const other of heard.components.filter((c) => c.id !== listener.id)) {
      expect(cannotConnect(heard, listener.id, other.id)).toMatch(/through the air/)
      expect(cannotConnect(heard, other.id, listener.id)).toMatch(/through the air/)
    }
    // The hybrid's own limits hold with a listener beside it.
    for (const type of ['steelString', 'metalBar', 'woodBar', 'mallet', 'impulse', 'dampedBox'] as const) expect(cannotAdd(heard, type), type).not.toBeNull()
    // A saved instrument with a listener and nothing for it to hear, or with two, is refused.
    const alone = { ...heard, components: heard.components.filter((c) => c.type === 'listener' || c.type === 'metalBar'), connections: [] }
    expect(validateGraph(alone).map((i) => i.message).join(' ')).toMatch(/metal bar that a string is tied to/)
    expect(() => deserialize(serialize(alone))).toThrow(/metal bar that a string is tied to/)
    const two = { ...heard, nextId: heard.nextId + 1, components: [...heard.components, { ...listener, id: `c${heard.nextId}` }] }
    expect(() => deserialize(serialize(two))).toThrow(/one listener/)
    // The string unplugged from the bar: still valid, still heard (the mallet's stroke), and the builder says what is missing.
    const apart = { ...heard, connections: heard.connections.filter((c) => c.type === 'strike') }
    expect(validateGraph(apart)).toEqual([])
    expect(built(apart).notes.map((n) => n.message).join(' ')).toMatch(/is not tied to/)
  })

  test('undo and redo, and saving and restoring, cover the listener', async () => {
    const plain = hybridGraph()
    let history = startHistory(plain)
    const added = addComponent(plain, 'listener', 160, 420)
    history = commit(history, added.graph, '', 0)
    history = commit(history, setParam(history.present, part(plain, 'steelString').id, 'tension', 90), 'tension', 1000)
    const { session } = await playing(history.present)
    expect(session.state.issues).toEqual([])
    history = undo(history)
    expect(history.present).toEqual(added.graph)
    expect(session.update(history.present)).toBe('live')
    history = undo(history)
    expect(history.present).toEqual(plain)
    expect(session.update(history.present)).toBe('rebuilt')
    history = redo(history)
    expect(part(history.present, 'listener').id).toBe(added.id)
    expect(session.update(history.present)).toBe('rebuilt')
    const back = restore(serialize(history.present))
    expect(back.problem).toBeUndefined()
    expect(back.graph).toEqual(history.present)
    expect(built(back.graph!).calls).toEqual(built(heardGraph()).calls)
    expect(structureKey(back.graph!)).toBe(structureKey(heardGraph()))
  })
})

test('the engine binary under test is the new one, and the fixture is the one Phase 3D.3 was approved with', () => {
  expect(before.byteLength).toBe(26494)
  expect(engineBytes.byteLength).not.toBe(before.byteLength)
  expect('addTap' in instantiate(before)).toBe(false)
  expect('addTap' in instantiate(engineBytes)).toBe(true)
})
