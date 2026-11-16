// Phase 3D.12: the hybrid lab page (hybrid-lab.html). What its controls send
// (src/experimental/hybrid/instrument.ts) and the processor it runs on
// (src/experimental/hybrid/hybrid-processor.js, which extends the engine's
// own, unchanged). Run in Node from the files the browser loads.
import { describe, expect, test } from 'vitest'
import { roughness } from '../analysis/bar-damping'
import { createHybridWorklet, processorClasses, type HybridWorklet } from '../analysis/hybrid-worklet'
import { buildLab, CHOICES, Controls, DAMP_PLACES, dampCalls, DEFAULT_PLUCK_PLACE, FULL_SCALE, muteCalls, PLUCK_PLACES, pluckCalls, strikeCalls, STRING, undampCalls, type Choice, type Lab } from '../src/experimental/hybrid/instrument'
import { BAR_TOUCH, buildStringBarBody, dampable, LIGHT_STRIKER } from '../src/experimental/string/stringBarBody'
import { buildPlayableStringBody, fingerDamping, pluckCall, radiation, retriggerCalls, touchCall } from '../src/experimental/string/stringBody'
import type { Call } from '../src/experimental/wasm/engine'
import { SR } from './helpers'

const radiate = (): Call => {
  const r = radiation(SR)
  return ['radiate', r.perSample, r.b0, r.b1, r.a1, FULL_SCALE]
}
const same = (a: Float32Array, b: Float32Array) => {
  let differ = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) differ++
  return differ
}
const fingersOf = (w: HybridWorklet) => (w.diag().fingers as { connection: number; stage: number; damping: number }[]).map((f) => [f.connection, f.stage, f.damping])
/** A lab instrument on the lab's processor, with the page's controls wired to it. */
async function playing(choice: Choice = 'tie-0.20') {
  const lab = buildLab(choice, SR)
  const w = await createHybridWorklet(lab.calls)
  const sent: Call[][] = []
  const controls = new Controls(lab, (calls) => {
    sent.push(calls)
    w.send(calls)
  })
  return { lab, w, controls, sent }
}

describe('The lab\'s processor', () => {
  test('it is the engine\'s own processor, registered beside it; with one finger the two make the same samples', async () => {
    const classes = await processorClasses()
    expect(Object.keys(classes).sort()).toEqual(['sonicmatter-hybrid', 'sonicmatter-physics'])
    expect(Object.getPrototypeOf(classes['sonicmatter-hybrid'])).toBe(classes['sonicmatter-physics'])
    const S = dampable(0.5)
    const built = buildStringBarBody(S, SR)
    const calls = [...built.calls, radiate()]
    // A pluck and a stroke; the string muted and let go; the bar's finger down and up; a retrigger (a finger that rests for a fixed time).
    const phrase = (w: HybridWorklet) =>
      w.render(SR, (block) => {
        if (block === 0) w.send([pluckCall(built, 2), ['launch', built.mallet!, 1]])
        if (block === 40) w.send([touchCall(built, S, true)])
        if (block === 120) w.send([touchCall(built, S, false)])
        if (block === 200) w.send(retriggerCalls(built, S, 2))
        if (block === 280) w.send([['touch', built.barFinger!, 6, 0.004, -1, 0]])
        if (block === 330) w.send([['touch', built.barFinger!, 0, 0.008, 0, 0]])
      })
    const [engines, labs] = [phrase(await createHybridWorklet(calls, 'sonicmatter-physics')), phrase(await createHybridWorklet(calls))]
    expect(same(engines, labs)).toBe(0)
    expect(Math.max(...engines.map(Math.abs))).toBeGreaterThan(0.1)
    // The approved string instrument too.
    const box = buildPlayableStringBody({ ...STRING, joined: true }, SR)
    const strum = (w: HybridWorklet) =>
      w.render(SR / 2, (block) => {
        if (block === 0) w.send([pluckCall(box, 2)])
        if (block === 60) w.send(retriggerCalls(box, STRING, 4))
      })
    expect(same(strum(await createHybridWorklet([...box.calls, radiate()], 'sonicmatter-physics')), strum(await createHybridWorklet([...box.calls, radiate()])))).toBe(0)
  }, 400000)

  test('two fingers sent together each follow their own ramp; the engine\'s own processor, given the same, leaves the first where it stood', async () => {
    const { lab, w } = await playing()
    const [string, bar] = [lab.stringFinger, lab.barFingers[0]]
    const mute = fingerDamping(STRING)
    w.send([...muteCalls(lab, true), ...dampCalls(lab, 0, BAR_TOUCH.medium)])
    w.render(64)
    // The string's finger lands in 2 ms (96 samples), the bar's in 4 ms (192): after 64 samples, two thirds and one third of the way.
    expect(fingersOf(w)).toEqual([[string, 1, (mute * 64) / 96], [bar, 1, (6 * 64) / 192]])
    w.render(64)
    expect(fingersOf(w)).toEqual([[string, 2, mute], [bar, 1, (6 * 128) / 192]])
    w.render(128)
    expect(fingersOf(w)).toEqual([[string, 2, mute], [bar, 2, 6]])
    // The string's finger lifts (4 ms, 192 samples) while the bar's rests, and the bar's lifts (8 ms, 384 samples) while the string's is still leaving.
    w.send(muteCalls(lab, false))
    w.render(96)
    expect(fingersOf(w)).toEqual([[string, 1, mute / 2], [bar, 2, 6]])
    w.send(undampCalls(lab, 0))
    w.render(128)
    expect(fingersOf(w)).toEqual([[bar, 1, 6 * (1 - 128 / 384)]]) // the string's finger has gone; the bar's is a third of the way off
    w.render(384)
    expect(fingersOf(w)).toEqual([])
    expect(w.engine.stiffness(bar)).toBe(0)
    // The limitation this removes: the engine's processor has one finger. Sent both, it moves the second and abandons the first at nothing.
    const one = await createHybridWorklet(lab.calls, 'sonicmatter-physics')
    one.send([...pluckCalls(lab, 2), ...muteCalls(lab, true), ...dampCalls(lab, 0, BAR_TOUCH.medium)])
    one.render(SR / 2)
    const both = await createHybridWorklet(lab.calls)
    both.send([...pluckCalls(lab, 2), ...muteCalls(lab, true), ...dampCalls(lab, 0, BAR_TOUCH.medium)])
    both.render(SR / 2)
    expect(both.engine.resonatorEnergy(lab.string)).toBeLessThan(1e-3 * one.engine.resonatorEnergy(lab.string))
  }, 400000)

  test('the order two simultaneous gestures are sent in does not matter, and each does what it does alone', async () => {
    const run = async (gestures: (lab: Lab) => Call[]) => {
      const { lab, w } = await playing()
      w.send([...pluckCalls(lab, 2), ...strikeCalls(lab, 1)])
      w.render(Math.round(0.15 * SR))
      w.send(gestures(lab))
      const pressure = w.render(Math.round(0.35 * SR))
      return { pressure, string: w.engine.resonatorEnergy(lab.string), bar: w.engine.resonatorEnergy(lab.bar!) }
    }
    const mute = (lab: Lab) => muteCalls(lab, true)
    const damp = (lab: Lab) => dampCalls(lab, 0, BAR_TOUCH.medium)
    const [a, b, muted, damped, open] = [await run((lab) => [...mute(lab), ...damp(lab)]), await run((lab) => [...damp(lab), ...mute(lab)]), await run(mute), await run(damp), await run(() => [])]
    expect(same(a.pressure, b.pressure)).toBe(0)
    // Both: the string as muted as by the mute alone (within 2 %), far below the open string.
    expect(Math.abs(a.string / muted.string - 1)).toBeLessThan(0.02)
    expect(a.string).toBeLessThan(1e-3 * open.string)
    // And the bar is stopped by its own finger: far below the open bar, and below what muting the string alone leaves.
    expect(a.bar).toBeLessThan(0.05 * open.bar)
    expect(a.bar).toBeLessThan(0.2 * muted.bar)
    // (Alone, the bar's finger leaves the bar what the ringing string keeps giving it: the bar as a whole moves with the string's end.)
    expect(damped.bar).toBeLessThan(0.6 * open.bar)
    // The bar's finger alone leaves the string its energy (within 1 %).
    expect(Math.abs(damped.string / open.string - 1)).toBeLessThan(0.01)
  }, 400000)

  test('overlapping gestures keep the books: what the instrument loses is what was dissipated, less what the bar finger\'s stiffening spring is counted as giving', async () => {
    const { lab, w, controls } = await playing()
    controls.pluck(2)
    controls.strike(1)
    const at = (seconds: number) => Math.round(seconds * SR)
    let [lost, start, rises, previous] = [0, 0, 0, 0]
    const injected = () => lab.barFingers.reduce((sum, k) => sum + w.engine.injected(k), 0)
    for (let i = 0; i < at(1.2); i++) {
      if (i === at(0.3)) controls.setMute(true)
      if (i === at(0.3) + 40) controls.setDamp(true) // while the string's finger is still landing
      if (i === at(0.5)) controls.setDamp(false)
      if (i === at(0.5) + 100) controls.setMute(false) // while the bar's finger is still leaving
      if (i === at(0.6)) controls.setDampPlace(1)
      if (i === at(0.6) + 1) controls.setDamp(true)
      if (i === at(0.7)) controls.setDampStrength('firm')
      if (i === at(0.7) + 30) controls.setMute(true)
      if (i === at(0.8)) controls.setDampPlace(2) // lifted at one place and laid at another, while the string is held
      w.render(1)
      if (i === at(0.28)) start = w.engine.energy() // the plucking force has gone by now (0.2 s)
      if (i > at(0.28)) lost += w.engine.dissipated()
      // Once every finger has settled (the last move was at 0.8 s) energy only falls.
      if (i > at(0.85) && w.engine.energy() > previous * (1 + 1e-12)) rises++
      previous = w.engine.energy()
    }
    const fell = start - w.engine.energy()
    expect(fell).toBeGreaterThan(1e-4)
    expect(Math.abs(fell - lost + injected()) / fell).toBeLessThan(1e-9)
    expect(Math.abs(injected())).toBeLessThan(5e-3 * fell)
    expect(rises).toBe(0)
    expect(w.engine.faults()).toBe(0)
    expect(w.engine.worstIterations()).toBeLessThanOrEqual(4)
  }, 400000)

  test('rapid, overlapping playing is the same every time, faultless, clickless, and ends with every finger off', async () => {
    const session = async () => {
      const { lab, w, controls } = await playing()
      const pressure = w.render(2 * SR, (block) => {
        // Every 8 ms something happens: plucks and strokes in turn, the two fingers down and up out of step, the bar's finger moved and pressed.
        if (block % 3 !== 0 || block > 600) return
        const i = block / 3
        if (i % 4 === 0) controls.pluck(i % 8 ? 2 : 6)
        if (i % 4 === 2) controls.strike(i % 8 === 2 ? 1 : 2)
        if (i % 5 === 1) controls.setMute(!controls.muted)
        if (i % 3 === 1) controls.setDamp(!controls.damped)
        if (i % 7 === 3) controls.setDampPlace((controls.dampPlace + 1) % DAMP_PLACES.length)
        if (i % 11 === 5) controls.setDampStrength(controls.dampStrength === 'firm' ? 'light' : 'firm')
      })
      controls.setMute(false)
      controls.setDamp(false)
      const tail = w.render(SR)
      return { lab, w, pressure, tail }
    }
    const [a, b] = [await session(), await session()]
    expect(same(a.pressure, b.pressure) + same(a.tail, b.tail)).toBe(0)
    expect(a.w.engine.faults()).toBe(0)
    expect(a.w.engine.worstIterations()).toBeLessThanOrEqual(6)
    expect(a.pressure.every(Number.isFinite)).toBe(true)
    expect(Math.max(...a.pressure.map(Math.abs))).toBeLessThan(1) // below the node's ceiling: nothing was clipped
    expect(fingersOf(a.w)).toEqual([])
    for (const k of a.lab.barFingers) expect(a.w.engine.stiffness(k)).toBe(0)
    // Both fingers landing at once on a ringing instrument: no rougher than the instrument left alone.
    const ring = async (touch: boolean) => {
      const { lab, w } = await playing()
      w.send([...pluckCalls(lab, 2), ...strikeCalls(lab, 2)])
      w.render(Math.round(0.05 * SR))
      if (touch) w.send([...muteCalls(lab, true), ...dampCalls(lab, 0, BAR_TOUCH.firm)])
      return w.render(Math.round(0.1 * SR))
    }
    const [touched, open] = [await ring(true), await ring(false)]
    expect(10 * Math.log10(roughness(touched, 0) / roughness(open, 0))).toBeLessThan(1)
  }, 400000)
})

describe('What the controls send', () => {
  test('each control is one physical event: the engine calls, exactly', async () => {
    const lab = buildLab('tie-0.20', SR)
    const sent: Call[][] = []
    const c = new Controls(lab, (calls) => sent.push(calls))
    const last = () => sent.at(-1)!
    c.pluck(2)
    expect(last()).toEqual(pluckCalls(lab, 2, DEFAULT_PLUCK_PLACE))
    expect(last()[0].slice(0, 4)).toEqual(['pluck', lab.string, lab.pluckPorts[3], 2])
    c.setPluckPlace(0)
    c.pluck(8)
    expect(last()[0].slice(0, 4)).toEqual(['pluck', lab.string, lab.pluckPorts[0], 8])
    c.pluck(100) // more than the control allows: held to its range
    expect(last()[0][3]).toBe(8)
    c.strike(1)
    expect(last()).toEqual([['launch', lab.striker, 1]])
    c.strike(0)
    expect(last()).toEqual([['launch', lab.striker, 0.25]])
    // The string's finger: the approved instrument's mute, once per change.
    c.setMute(true)
    expect(last()).toEqual([['touch', lab.stringFinger, fingerDamping(STRING), 0.002, -1, 0]])
    const count = sent.length
    c.setMute(true)
    expect(sent.length).toBe(count)
    c.setMute(false)
    expect(last()).toEqual([['touch', lab.stringFinger, 0, 0.004, 0, 0]])
    // The bar's finger: Phase 3D.11's, at the place and pressure chosen.
    c.setDamp(true)
    expect(last()).toEqual([['attach', lab.barFingers[0]], ['setStiffness', lab.barFingers[0], 2000, 1, 192], ['touch', lab.barFingers[0], 6, 0.004, -1, 0]])
    c.setDampStrength('firm') // pressed harder where it is: no second landing
    expect(last()).toEqual([['setStiffness', lab.barFingers[0], 8000, 1, 192], ['touch', lab.barFingers[0], 20, 0.004, -1, 0]])
    c.setDampPlace(1) // lifted where it was, laid where it now is
    expect(last()).toEqual([['setStiffness', lab.barFingers[0], 0, 1, 384], ['touch', lab.barFingers[0], 0, 0.008, 0, 0], ['attach', lab.barFingers[1]], ['setStiffness', lab.barFingers[1], 8000, 1, 192], ['touch', lab.barFingers[1], 20, 0.004, -1, 0]])
    c.setDamp(false)
    expect(last()).toEqual(undampCalls(lab, 1))
    const quiet = sent.length
    c.setDampPlace(2) // a finger that is up is moved without a word to the engine
    c.setDampStrength('light')
    c.setDamp(false)
    expect(sent.length).toBe(quiet)
    expect([c.dampPlace, c.dampStrength, c.muted, c.damped]).toEqual([2, 'light', false, false])
    expect(() => c.setDampStrength('crushing' as never)).toThrow(/unknown strength/)
  })

  test('on the approved string instrument the bar\'s controls send nothing, and its pluck is the approved pluck', async () => {
    const lab = buildLab('approved-string', SR)
    const sent: Call[][] = []
    const c = new Controls(lab, (calls) => sent.push(calls))
    c.strike(1)
    c.setDamp(true)
    c.setDampPlace(1)
    expect(sent).toEqual([])
    expect([c.hasBar, c.damped, lab.barFingers, lab.striker]).toEqual([false, false, [], undefined])
    // Plucked at its usual place through the lab, it is the approved instrument sample for sample.
    const box = buildPlayableStringBody({ ...STRING, joined: true }, SR)
    const [approved, inLab] = [await createHybridWorklet([...box.calls, radiate()], 'sonicmatter-physics'), await createHybridWorklet(lab.calls)]
    approved.send([pluckCall(box, 2)])
    c.pluck(2)
    inLab.send(sent[0])
    expect(same(approved.render(SR), inLab.render(SR))).toBe(0)
  }, 400000)
})

describe('Building and switching', () => {
  test('each choice builds at the browser\'s sample rate, silent and faultless until played; a bad request is refused in words', async () => {
    for (const choice of Object.keys(CHOICES) as Choice[]) {
      for (const rate of [44100, 48000, 96000]) {
        const lab = buildLab(choice, rate)
        const w = await createHybridWorklet(lab.calls)
        const d = w.diag({ resonators: [lab.string], connections: [lab.stringFinger, ...lab.barFingers] })
        expect([d.energy, d.faults, d.fingers], `${choice} at ${rate}`).toEqual([0, 0, []])
        expect(d.stiffness).toEqual([0, ...lab.barFingers.map(() => 0)])
        expect(Math.max(...w.render(1024).map(Math.abs))).toBe(0)
        expect(lab.pluckPorts.length).toBe(PLUCK_PLACES.length)
        expect(lab.barFingers.length).toBe(choice === 'approved-string' ? 0 : DAMP_PLACES.length)
      }
    }
    expect(() => buildLab('banjo' as never, SR)).toThrow(/unknown instrument/)
    expect(() => buildLab('tie-0.20', 8000)).toThrow(/cannot build/)
    expect(() => buildLab('tie-0.20', Number.NaN)).toThrow(/cannot build/)
    // A broken engine is reported, not thrown from the audio thread.
    const Hybrid = (await processorClasses())['sonicmatter-hybrid']
    const broken = new Hybrid({ processorOptions: { bytes: new Uint8Array([1, 2, 3]), calls: [], measure: false } })
    expect(broken.posted.some((message) => 'error' in message)).toBe(true)
    expect(broken.process([], [[new Float32Array(128)]])).toBe(true)
  }, 400000)

  test('the two hybrids are the Phase 3D.11 references, sample for sample, with every finger unused', async () => {
    for (const [choice, tie] of [['tie-0.20', 0.2], ['tie-0.18', 0.18]] as const) {
      const lab = buildLab(choice, SR)
      const reference = buildStringBarBody(dampable(0.5, tie), SR)
      expect(dampable(0.5, tie).mallet).toEqual(LIGHT_STRIKER)
      const [ref, w] = [await createHybridWorklet([...reference.calls, radiate()], 'sonicmatter-physics'), await createHybridWorklet(lab.calls)]
      ref.send([pluckCall(reference, 2), ['launch', reference.mallet!, 1]])
      w.send([...pluckCalls(lab, 2), ...strikeCalls(lab, 1)])
      expect(same(ref.render(SR), w.render(SR)), choice).toBe(0)
    }
    // And the two are not each other.
    const sound = async (choice: Choice) => {
      const { lab, w } = await playing(choice)
      w.send(pluckCalls(lab, 2))
      return w.render(SR / 2)
    }
    expect(same(await sound('tie-0.20'), await sound('tie-0.18'))).toBeGreaterThan(1000)
  }, 400000)

  test('choosing another instrument is a new engine: nothing of the old one\'s motion or fingers comes with it', async () => {
    // As the page does it: the old node is stopped and a new processor is made for the new choice.
    const old = await playing('tie-0.20')
    old.controls.pluck(8)
    old.controls.strike(2)
    old.controls.setMute(true)
    old.controls.setDamp(true)
    old.w.render(4800)
    old.w.processor.port.onmessage!({ data: { stop: true } })
    expect(old.w.processor.process([], [[new Float32Array(128)]])).toBe(false) // the old processor ends
    const next = await playing('tie-0.18')
    expect([next.controls.muted, next.controls.damped]).toEqual([false, false])
    expect(fingersOf(next.w)).toEqual([])
    expect(next.w.engine.energy()).toBe(0)
    const fresh = await playing('tie-0.18')
    for (const x of [next, fresh]) x.controls.pluck(2)
    expect(same(next.w.render(SR / 2), fresh.w.render(SR / 2))).toBe(0)
    // And back again gives the first instrument as it was first built.
    const [back, first] = [await playing('tie-0.20'), await playing('tie-0.20')]
    for (const x of [back, first]) x.controls.strike(1)
    expect(same(back.w.render(SR / 2), first.w.render(SR / 2))).toBe(0)
  }, 400000)
})

describe('Timing diagnostics', () => {
  test('every block is counted once, in one bin; asking for the numbers or clearing them does not touch the sound', async () => {
    const { lab, w, controls } = await playing()
    controls.pluck(2)
    w.render(100 * 128)
    const d = w.diag({ resonators: [lab.string, lab.bar!] }) as Record<string, number> & { bins: number[]; binLabels: string[]; resonatorEnergy: number[] }
    expect(d.clock).toBe('performance.now')
    expect(d.blocks).toBe(100)
    expect(d.bins.reduce((sum, n) => sum + n, 0)).toBe(100)
    expect(d.bins.length).toBe(d.binLabels.length)
    expect(d.quantum_ms).toBeCloseTo(128000 / SR, 9)
    expect(d.mean_ms).toBeGreaterThan(0)
    expect(d.worst_ms).toBeGreaterThanOrEqual(d.mean_ms)
    expect(d.overruns).toBeLessThanOrEqual(d.blocks)
    expect(d.possibleOverruns).toBe(0) // a fine clock leaves nothing in doubt
    expect(d.peak).toBeGreaterThan(0.01)
    expect(d.resonatorEnergy[0]).toBeGreaterThan(1e-4)
    w.diag({ clear: true })
    expect(w.diag().blocks).toBe(0)
    // Two instruments played alike, one asked for its numbers every block: the same samples.
    const [asked, left] = [await playing(), await playing()]
    for (const x of [asked, left]) x.controls.strike(1)
    expect(same(asked.w.render(SR / 4, () => void asked.w.diag({ clear: true })), left.w.render(SR / 4))).toBe(0)
  }, 400000)

  test('with only a millisecond clock, a reading is certain to be an overrun only from 4 ms; 2 and 3 ms are reported as possible, not as overruns', async () => {
    const lab = buildLab('tie-0.20', SR)
    const Hybrid = (await processorClasses())['sonicmatter-hybrid']
    const { engineBytes } = await import('../analysis/wasm')
    const processor = new Hybrid({ processorOptions: { bytes: engineBytes, calls: lab.calls, measure: false, coarseClock: true } })
    // A clock that says each block took 0, 1, 2, 3, 4 and 12 ms in turn.
    const readings = [0, 1, 2, 3, 4, 12]
    const real = Date.now
    let [now, call] = [1000, 0]
    Date.now = () => {
      if (call % 2 === 1) now += readings[(call - 1) / 2]
      call++
      return now
    }
    try {
      for (let i = 0; i < readings.length; i++) processor.process([], [[new Float32Array(128)]])
    } finally {
      Date.now = real
    }
    processor.port.onmessage!({ data: { diag: 1 } })
    const d = processor.posted.find((message) => message.diag === 1) as Record<string, number> & { bins: number[]; binLabels: string[] }
    expect(d.clock).toBe('Date.now')
    expect(d.blocks).toBe(6)
    expect(d.bins).toEqual([1, 1, 1, 1, 1, 0, 0, 1])
    expect(d.binLabels.slice(0, 5)).toEqual(['0 ms', '1 ms', '2 ms', '3 ms', '4 ms'])
    expect(d.worst_ms).toBe(12)
    expect(d.overruns).toBe(2) // 4 ms and 12 ms: at least 3 ms, which is over 2.67
    expect(d.possibleOverruns).toBe(2) // 2 ms (1 to 3) and 3 ms (2 to 4): the clock cannot say
    expect(d.mean_ms).toBeCloseTo(22 / 6, 9)
  }, 400000)
})
