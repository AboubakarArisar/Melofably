// Phase 3D.12: the hybrid lab page (hybrid-lab.html). What its controls send
// (src/experimental/hybrid/instrument.ts) and the processor it runs on
// (src/experimental/hybrid/hybrid-processor.js, which extends the engine's
// own, unchanged). Run in Node from the files the browser loads.
import { describe, expect, test } from 'vitest'
import { roughness } from '../analysis/bar-damping'
import { createHybridWorklet, processorClasses, type HybridWorklet } from '../analysis/hybrid-worklet'
import { levels } from '../analysis/hybrid-study'
import { buildLab, canPlay, CHOICES, Controls, DAMP_PLACES, dampCalls, DEFAULT_PLUCK_PLACE, FULL_SCALE, keyAction, muteCalls, PLUCK_FORCE, PLUCK_PLACES, pluckCalls, pluckLevel, STRIKE_SPEED, strikeCalls, strikeLevel, STRING, undampCalls, type Choice, type Lab, type Strength } from '../src/experimental/hybrid/instrument'
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

// ---- Phase 3D.13: playability -------------------------------------------------------------------------------------------

describe('Defects found by playing it, and their corrections', () => {
  test('a finger is down while its button is latched or its key is held: letting go of one does not lift what the other holds', () => {
    const lab = buildLab('tie-0.20', SR)
    const sent: Call[][] = []
    const c = new Controls(lab, (calls) => sent.push(calls))
    // The defect: the button latched the mute, and tapping M then lifted it.
    c.hold('mute', 'latch', true)
    expect([c.muted, c.latched('mute'), sent.length]).toEqual([true, true, 1])
    c.hold('mute', 'key', true)
    c.hold('mute', 'key', false)
    expect([c.muted, c.latched('mute'), sent.length]).toEqual([true, true, 1]) // still down, and nothing more was sent
    c.hold('mute', 'latch', false)
    expect([c.muted, sent.length]).toEqual([false, 2])
    // The other way about: held by the key, then latched, then the key let go.
    c.hold('damp', 'key', true)
    c.hold('damp', 'latch', true)
    c.hold('damp', 'key', false)
    expect([c.damped, c.latched('damp')]).toEqual([true, true])
    // The two fingers do not know of each other.
    expect(c.muted).toBe(false)
    c.hold('mute', 'key', true)
    c.lift()
    expect([c.muted, c.damped, c.latched('mute'), c.latched('damp')]).toEqual([false, false, false, false])
    const count = sent.length
    c.lift()
    expect(sent.length).toBe(count)
  })

  test('the playing keys: letters and digits play unless the keyboard is choosing from a list, typing, repeating or modified', () => {
    expect(['a', 's', '1', '2', '3', 'm', 'd'].map((key) => keyAction(key))).toEqual(['pluck', 'strike', 'gentle', 'medium', 'strong', 'mute', 'damp'])
    expect(keyAction('A')).toBe('pluck') // with Shift or Caps Lock
    expect(keyAction('q')).toBeNull()
    expect(keyAction('Enter')).toBeNull()
    // The defect: after choosing from a list the list kept the keyboard and A, S, M, D went to it as type-ahead ("m" for medium).
    // While a list has the keyboard its letters are still its own; the page gives the keyboard back once a choice is made.
    expect(keyAction('m', { focus: 'list' })).toBeNull()
    expect(keyAction('a', { focus: 'text' })).toBeNull()
    expect(keyAction('a', { focus: 'other' })).toBe('pluck')
    expect(keyAction('a', { repeat: true })).toBeNull() // a held key is one pluck, not thirty a second
    expect(keyAction('s', { modified: true })).toBeNull() // Ctrl+S is the browser's
  })

  test('nothing is sent to an engine that is not making sound', async () => {
    expect(canPlay('running', false)).toBe(true)
    for (const state of ['suspended', 'interrupted', 'closed']) expect(canPlay(state, false)).toBe(false)
    expect(canPlay('running', true)).toBe(false) // while another instrument is being built
    // Why it matters (the defect): an engine keeps what it is sent while no blocks are asked of it, and plays it when they are again.
    const { w, controls, lab } = await playing()
    controls.pluck(2)
    controls.strike(1)
    expect(w.engine.energy()).toBeGreaterThan(1e-3) // the striker is already on its way, and nothing has been rendered
    const later = w.render(SR / 4)
    expect(Math.max(...later.map(Math.abs))).toBeGreaterThan(0.05)
    expect(w.engine.resonatorEnergy(lab.string)).toBeGreaterThan(1e-4)
  }, 400000)
})

describe('Events and their timing', () => {
  test('every numbered message is answered once, in order, with the block it took effect from; asking changes no sample', async () => {
    const run = async (stamped: boolean) => {
      const { lab, w } = await playing()
      const answers: { stamp: number; frame: number; wall: number }[] = []
      let stamp = 0
      const pressure = w.render(SR / 2, (block) => {
        // Several messages before one block, as when a pluck and a stroke are pressed together, and bursts of them.
        const calls = block % 7 === 0 ? [pluckCalls(lab, 2), strikeCalls(lab, 1), muteCalls(lab, block % 14 === 0)] : block % 5 === 0 ? [dampCalls(lab, 0, BAR_TOUCH.medium, block % 10 === 0)] : []
        for (const list of calls) {
          if (stamped) w.processor.port.onmessage!({ data: { calls: list, stamp: ++stamp } })
          else w.send(list)
        }
        if (stamped) for (const m of w.processor.posted.splice(0)) if ('stamp' in m) answers.push(m as never)
      })
      return { pressure, answers, sent: stamp, w }
    }
    const [a, b] = [await run(true), await run(false)]
    expect(a.sent).toBeGreaterThan(100)
    expect(a.answers.length).toBe(a.sent)
    expect(a.answers.map((x) => x.stamp)).toEqual(Array.from({ length: a.sent }, (_, i) => i + 1))
    for (let i = 1; i < a.answers.length; i++) expect(a.answers[i].frame).toBeGreaterThanOrEqual(a.answers[i - 1].frame)
    expect(a.answers.every((x) => x.frame % 128 === 0)).toBe(true) // a message takes effect from the start of the next block
    expect(a.answers.at(-1)!.frame).toBeLessThan(SR / 2)
    expect(same(a.pressure, b.pressure)).toBe(0)
    expect(a.w.diag().frame).toBe(SR / 2)
  }, 400000)

  test('the spread of the calls about an even delivery is zero when they come evenly and shows a stall when they do not', async () => {
    const lab = buildLab('tie-0.20', SR)
    const Hybrid = (await processorClasses())['sonicmatter-hybrid']
    const { engineBytes } = await import('../analysis/wasm')
    const spreadOf = async (gaps: number[]) => {
      const processor = new Hybrid({ processorOptions: { bytes: engineBytes, calls: lab.calls, measure: false, coarseClock: true } })
      const real = Date.now
      let [now, call] = [5000, 0]
      // The clock is read at the start and at the end of each block: the start of block i is `gaps[i - 1]` ms after the start of the one before.
      Date.now = () => {
        if (call % 2 === 0 && call > 0) now += gaps[call / 2 - 1]
        call++
        return now
      }
      try {
        for (let i = 0; i <= gaps.length; i++) processor.process([], [[new Float32Array(128)]])
      } finally {
        Date.now = real
      }
      processor.port.onmessage!({ data: { diag: 1 } })
      return (processor.posted.find((m) => m.diag === 1) as Record<string, number>).deliverySpread_ms
    }
    // Three blocks every 8 ms, exactly on time on average (8 ms for 3 x 2.667): the spread is the batch, and no more.
    const even = await spreadOf([0, 0, 8, 0, 0, 8, 0, 0, 8, 0, 0, 8])
    expect(even).toBeGreaterThan(4)
    expect(even).toBeLessThan(6)
    // The same with the audio thread held up for 40 ms once.
    expect(await spreadOf([0, 0, 8, 0, 0, 48, 0, 0, 8, 0, 0, 8])).toBeGreaterThan(even + 39)
  }, 400000)

  test('a force that is not a number is counted by the engine as a fault and never reaches the output as anything but silence or a number', async () => {
    const { lab, w } = await playing()
    w.send([['pluck', lab.string, lab.pluckPorts[3], Number.NaN, 2000, 0.2, 0]])
    const x = w.render(SR / 10)
    const d = w.diag()
    expect((d.faults as number) + (d.nonFiniteSamples as number)).toBeGreaterThan(0) // it does not pass unnoticed
    expect(d.nonFiniteSamples).toBe(x.filter((v) => !Number.isFinite(v)).length) // and what the page reports is what came out
  }, 400000)
})

describe('Playing dynamics', () => {
  test('the levels shown beside the two strength controls are the model\'s, within 1 dB', async () => {
    const level = async (play: (c: Controls) => void) => {
      const { w, controls } = await playing()
      play(controls)
      return levels(w.render(2 * SR).map((v) => v * FULL_SCALE)).lafMax_dB
    }
    for (const force of [0.5, 4, 8]) expect(Math.abs((await level((c) => c.pluck(force))) - pluckLevel(force)), `${force} N`).toBeLessThan(1)
    for (const speed of [0.25, 0.5, 1, 2]) expect(Math.abs((await level((c) => c.strike(speed))) - strikeLevel(speed)), `${speed} m/s`).toBeLessThan(1)
  }, 400000)

  test('plucks and strokes overlap between 69 and 79 dB, and the page starts inside the overlap; no model or reference uses its defaults', () => {
    const plucks = [pluckLevel(PLUCK_FORCE.min), pluckLevel(PLUCK_FORCE.max)] // 55.3 to 79.3 dB
    const strokes = [strikeLevel(STRIKE_SPEED.min), strikeLevel(STRIKE_SPEED.max)] // 69.4 to 89.1 dB
    expect(strokes[0]).toBeLessThan(plucks[1]) // the gentlest stroke is quieter than the hardest pluck
    expect(plucks[1] - strokes[0]).toBeGreaterThan(9) // by 10 dB: that is the overlap
    expect([PLUCK_FORCE.default, STRIKE_SPEED.default]).toEqual([4, 0.5])
    for (const level of [pluckLevel(PLUCK_FORCE.default), strikeLevel(STRIKE_SPEED.default)]) {
      expect(level).toBeGreaterThan(strokes[0])
      expect(level).toBeLessThan(plucks[1])
    }
    expect(Math.abs(pluckLevel(PLUCK_FORCE.default) - strikeLevel(STRIKE_SPEED.default))).toBeLessThan(3) // 2.6 dB apart
    expect(strikeLevel(1) - pluckLevel(2)).toBeGreaterThan(14) // where the measurements' own 2 N and 1 m/s are 15 dB apart
    // The three named strokes are Phase 3D.10's, unchanged.
    expect([STRIKE_SPEED.gentle, STRIKE_SPEED.medium, STRIKE_SPEED.strong]).toEqual([0.5, 1, 2])
  })
})

describe('The gestures, through the page\'s controls', () => {
  test('each finger does its own work, to the same sample every time: harder presses damp the bar more, the string is left alone, and the mute leaves the bar', async () => {
    const at = (seconds: number) => Math.round((seconds * SR) / 128)
    const run = async (gesture: (c: Controls) => void) => {
      const { lab, w, controls } = await playing()
      let [string, bar] = [0, 0]
      const pressure = w.render(Math.round(0.25 * SR), (block) => {
        if (block === 0) {
          controls.pluck(2)
          controls.strike(1)
        }
        if (block === at(0.15)) gesture(controls)
        if (block === at(0.2)) [string, bar] = [w.engine.resonatorEnergy(lab.string), w.engine.resonatorEnergy(lab.bar!)]
      })
      expect(w.engine.faults()).toBe(0)
      expect(w.engine.worstIterations()).toBeLessThanOrEqual(4)
      return { pressure, string, bar }
    }
    const damp = (place: number, strength: Strength) => (c: Controls) => {
      c.setDampPlace(place)
      c.setDampStrength(strength)
      c.setDamp(true)
    }
    const open = await run(() => undefined)
    const dB = (x: number, reference: number) => 10 * Math.log10(x / reference)
    // The middle: light, medium, firm take the bar down by 8.9, 15.4 and 17.0 dB within 50 ms, and leave the string within 0.05 dB.
    let before = 0
    for (const strength of ['light', 'medium', 'firm'] as const) {
      const [a, b] = [await run(damp(0, strength)), await run(damp(0, strength))]
      expect(same(a.pressure, b.pressure), strength).toBe(0)
      expect(dB(a.bar, open.bar)).toBeLessThan(before - 1)
      expect(Math.abs(dB(a.string, open.string))).toBeLessThan(0.1)
      before = dB(a.bar, open.bar)
    }
    expect(before).toBeLessThan(-15)
    // Place matters: the end by the string stops more than the middle; by the tie a medium finger does little (-2.6 dB).
    const [end, tie, middle] = [await run(damp(1, 'medium')), await run(damp(2, 'medium')), await run(damp(0, 'medium'))]
    expect(dB(end.bar, open.bar)).toBeLessThan(dB(middle.bar, open.bar) - 2)
    expect(dB(tie.bar, open.bar)).toBeGreaterThan(-5)
    // The mute: the string down 33 dB, the bar hardly changed 50 ms on.
    const muted = await run((c) => c.setMute(true))
    expect(dB(muted.string, open.string)).toBeLessThan(-25)
    expect(Math.abs(dB(muted.bar, open.bar))).toBeLessThan(1.5)
    // Both in one message: both down.
    const both = await run((c) => {
      c.setMute(true)
      c.setDamp(true)
    })
    expect(dB(both.string, open.string)).toBeLessThan(-25)
    expect(dB(both.bar, open.bar)).toBeLessThan(-15)
  }, 400000)

  test('half a minute of dense playing with both fingers: bounded, faultless, nothing left down, and silent again three seconds after the last note', async () => {
    const { lab, w, controls: c } = await playing()
    let [most, peak, bad] = [0, 0, 0]
    const blocks = Math.round((30 * SR) / 128)
    for (let block = 0; block < blocks; block++) {
      if (block % 3 === 0) {
        const i = block / 3
        if (i % 4 === 0) c.pluck(i % 8 ? 2 : 8)
        if (i % 4 === 2) c.strike(i % 8 === 2 ? 1 : 2)
        if (i % 5 === 1) c.hold('mute', 'key', !c.muted)
        if (i % 3 === 1) c.hold('damp', i % 2 ? 'latch' : 'key', !c.damped)
        if (i % 7 === 3) c.setDampPlace((c.dampPlace + 1) % DAMP_PLACES.length)
        if (i % 11 === 5) c.setDampStrength(c.dampStrength === 'firm' ? 'light' : 'firm')
      }
      for (const v of w.render(128)) {
        if (!Number.isFinite(v)) bad++
        peak = Math.max(peak, Math.abs(v))
      }
      most = Math.max(most, w.engine.energy())
    }
    c.lift()
    w.render(3 * SR)
    const d = w.diag()
    expect([bad, d.faults, d.nonFiniteSamples, d.fingers]).toEqual([0, 0, 0, []])
    expect(peak).toBeLessThan(1) // 5.3 Pa of the node's 8
    expect(most).toBeLessThan(0.2) // J: it does not build up (87 mJ at most)
    expect(w.engine.worstIterations()).toBeLessThanOrEqual(8) // 7
    expect(w.engine.energy() - w.engine.resonatorEnergy(lab.bar! + 1)).toBeLessThan(1e-5 * most)
    expect(w.engine.memory.buffer.byteLength).toBe(3145728)
  }, 400000)
})
