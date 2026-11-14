// Phase 3D.6: feasibility of three coupled parts. One string and one metal
// bar, both standing on the damped enclosed body
// (src/experimental/string/stringBarBody.ts). An isolated prototype: nothing
// here is in the builder.
import { describe, expect, test } from 'vitest'
import { levels, pitchNear } from '../analysis/hybrid-study'
import { partial } from '../analysis/radiation'
import { approvedStringBody, BASE, cents, F0, lossless, measure, sound, TUNED, variant } from '../analysis/three-body'
import { createWorklet } from '../analysis/worklet'
import { barModeShape } from '../src/audio/engine/physics'
import { addComponent, emptyGraph, setParam } from '../src/builder/graph'
import { barModes } from '../src/builder/translate'
import { BAR_STRIKE, barMass, barOnBoardModes, BOARD_RADIATION, buildStringBarBody, RIGID_MODES, SMALL_BAR, supportPoints } from '../src/experimental/string/stringBarBody'
import { buildPlayableStringBody, pluckCall, radiation } from '../src/experimental/string/stringBody'
import type { Call } from '../src/experimental/wasm/engine'
import { SR } from './helpers'

const at = (t: number) => Math.round((t * SR) / 128)
const span = (x: ArrayLike<number>, from: number) => {
  let [low, high] = [Infinity, -Infinity]
  for (let i = from; i < x.length; i++) {
    low = Math.min(low, x[i])
    high = Math.max(high, x[i])
  }
  return { low, high }
}
const largest = (x: ArrayLike<number>) => span(Array.from(x, Math.abs), 0).high

describe('What the prototype is made of', () => {
  test('the bar: the builder\'s bending modes, and two ways of moving as a whole that the bending modes are blind to', () => {
    const modes = barOnBoardModes(SMALL_BAR, SR)
    // The same bar made in the builder: the same frequencies, decay times, mass and shape at the strike point.
    let made = addComponent(emptyGraph(), 'metalBar', 0, 0)
    for (const [key, value] of Object.entries({ length: 0.2, width: 20, thickness: 5, strikePosition: 0.35 })) made = { graph: setParam(made.graph, made.id, key, value), id: made.id }
    const builders = barModes(made.graph.components[0], SR)
    const bending = modes.slice(RIGID_MODES)
    expect(bending.length).toBe(builders.length)
    bending.forEach((mode, n) => {
      expect(mode.frequency).toBe(builders[n].frequency)
      expect(mode.t60).toBe(builders[n].t60)
      expect(mode.mass).toBe(builders[n].mass)
      expect(mode.shape[BAR_STRIKE]).toBe(builders[n].shape[0])
    })
    expect(barMass(SMALL_BAR)).toBeCloseTo(0.054, 12) // kg
    expect(Math.round(bending[0].frequency)).toBe(654)
    // Up-and-down and rocking: no frequency of their own, no loss, the bar's mass, shapes 1 and sqrt(3) (2 xi - 1).
    for (const rigid of modes.slice(0, RIGID_MODES)) expect([rigid.frequency, rigid.t60, rigid.mass]).toEqual([0, Infinity, barMass(SMALL_BAR)])
    expect(modes[0].shape).toEqual([1, 1, 1, 1])
    expect(modes[1].shape[3]).toBeCloseTo(-Math.sqrt(3), 12) // at the end, xi = 0
    // Unit mean square, and at right angles to every bending shape (so the three kinds of motion do not mix by themselves).
    const mean = (f: (xi: number) => number) => Array.from({ length: 4000 }, (_, i) => f((i + 0.5) / 4000)).reduce((s, v) => s + v, 0) / 4000
    const rock = (xi: number) => Math.sqrt(3) * (2 * xi - 1)
    expect(mean((xi) => rock(xi) ** 2)).toBeCloseTo(1, 6)
    for (let n = 0; n < 4; n++) {
      expect(Math.abs(mean((xi) => barModeShape(n, xi)))).toBeLessThan(1e-6)
      expect(Math.abs(mean((xi) => barModeShape(n, xi) * rock(xi)))).toBeLessThan(1e-6)
      expect(mean((xi) => barModeShape(n, xi) ** 2)).toBeCloseTo(1, 5)
    }
  })

  test('one system, and one output: the body\'s. Nothing of the string or the bar is added to what is heard', () => {
    const built = buildStringBarBody(BASE, SR)
    const approved = buildPlayableStringBody({ tension: 73.5, length: 0.65, pluckAt: 0.8, joined: true }, SR)
    // The outputs are the approved instrument's two: the board's mean motion and the hole's flow.
    const outputs = built.calls.filter((call) => call[0] === 'addOutput')
    expect(outputs).toEqual([['addOutput', built.board, BOARD_RADIATION, 1], ['addOutput', built.plug, 0, -1]])
    expect(approved.calls.filter((call) => call[0] === 'addOutput')).toEqual([['addOutput', built.board, 1, 1], ['addOutput', built.plug, 0, -1]])
    expect(outputs.some((call) => call[1] === built.bar || call[1] === built.string)).toBe(false)
    // String, board, air plug, ground, bar, mallet; bridge, screen, air spring, finger, two pads, mallet contact.
    expect(built.calls.filter((call) => call[0] === 'addResonator').length).toBe(6)
    expect(built.calls.filter((call) => call[0] === 'addSpring' || call[0] === 'addContact').length).toBe(7)
    expect(built.modes).toEqual({ string: 100, board: approved.modes.body, bar: 10 })
    expect(built.calls.filter((call) => call[0] === 'reset').length).toBe(1)
    // The bar lies across the board's middle, its pads 0.16 m apart, well inside the board.
    expect(supportPoints(BASE).map((p) => p.map((x) => Number(x.toFixed(3))))).toEqual([[0.34, 0.65], [0.66, 0.65]])
    expect(() => buildStringBarBody(variant({ barAt: [0.1, 0.5] }), SR)).toThrow(/does not fit/)
  })

  test('reference: with the bar\'s pads taken away it is the approved string instrument, sample for sample', async () => {
    const [without, approved] = [await measure(variant({ mount: null }), 'pluck', 2), await approvedStringBody(2)]
    expect(Array.from(without.pressure)).toEqual(Array.from(approved.pressure))
    expect(Array.from(without.stringVelocity)).toEqual(Array.from(approved.stringVelocity))
    expect(without.peak.bar).toBe(0)
    expect(largest(approved.pressure)).toBeGreaterThan(0.09) // Pa
  }, 400000)
})

describe('Energy goes both ways, through the board', () => {
  test('string plucked: the board moves and the bar answers; bar struck: the board moves and the string answers', async () => {
    const [pluck, strike] = [await measure(BASE, 'pluck', 2), await measure(BASE, 'strike', 2)]
    // Plucked with 2 N: 5.1 mJ, nearly all of which the string keeps. Measured: board 0.0071 mJ, bar 0.00055 mJ at most.
    expect(pluck.peak.in).toBeGreaterThan(0.0048)
    expect(pluck.peak.in).toBeLessThan(0.0054)
    expect(pluck.peak.board).toBeGreaterThan(5e-6)
    expect(pluck.peak.bar).toBeGreaterThan(3e-7)
    expect(pluck.peak.bar).toBeLessThan(pluck.peak.board)
    expect(pluck.toBar).toBeGreaterThan(1e-5) // J that crossed the pads into the bar
    // Struck: the mallet gives 18.9 of its 22.5 mJ; the board holds up to 12.8 mJ, the string up to 0.045 mJ.
    expect(strike.malletGave).toBeGreaterThan(0.017)
    expect(strike.malletGave).toBeLessThan(0.021)
    expect(strike.peak.board).toBeGreaterThan(0.01)
    expect(strike.peak.string).toBeGreaterThan(2e-5)
    expect(strike.fromBar).toBeGreaterThan(0.02) // J that crossed the pads into the board
    expect(strike.bridgeWork.at(-1)!).toBeLessThan(0) // the board did work on the string: the bridge took energy from the board
    expect(pluck.bridgeWork.at(-1)!).toBeGreaterThan(0)
    expect(pluck.faults + strike.faults).toBe(0)
  }, 400000)

  test('take a joint away and what was behind it gets nothing, exactly', async () => {
    const noString = await measure(variant({ stringOn: false }), 'strike', 1.5)
    expect(noString.peak.string).toBe(0)
    expect(largest(noString.stringVelocity)).toBe(0)
    expect(largest(noString.pressure)).toBeGreaterThan(3) // Pa: the bar and the board are still an instrument
    const noBar = await measure(variant({ mount: null }), 'pluck', 1.5)
    expect(noBar.peak.bar).toBe(0)
    expect(largest(noBar.barVelocity)).toBe(0)
    // Neither standing on the board: each moves, the board does not, and there is nothing to hear.
    for (const playing of ['pluck', 'strike'] as const) {
      const apart = await measure(variant({ stringOn: false, mount: null }), playing, 1)
      expect(apart.peak.board).toBe(0)
      expect(largest(apart.pressure)).toBe(0)
      expect(playing === 'pluck' ? apart.peak.string : apart.peak.bar).toBeGreaterThan(0.004)
      expect(playing === 'pluck' ? apart.peak.bar : apart.peak.string).toBe(0)
    }
    // Together: what each does alone, added (the system is linear but for the mallet's contact).
    const [both, pluck, strike] = [await sound(BASE, 'both', 1), await sound(BASE, 'pluck', 1), await sound(BASE, 'strike', 1)]
    let worst = 0
    for (let i = 0; i < both.pressure.length; i++) worst = Math.max(worst, Math.abs(both.pressure[i] - pluck.pressure[i] - strike.pressure[i]))
    expect(worst / largest(both.pressure)).toBeLessThan(0.02)
  }, 400000)

  test('with every loss removed the whole keeps its energy to a part in a billion: plucked, struck, both, and with a direct tie', async () => {
    for (const [name, s] of [['prototype', BASE], ['tuned', TUNED], ['direct tie', variant({ direct: { stiffness: 1e5, damping: 0 } })], ['soft pads', variant({ mount: { stiffness: 1e4, damping: 5 } })]] as const) {
      for (const playing of ['pluck', 'strike', 'both'] as const) {
        const run = await measure(s, playing, 2, { lossless: true })
        const { low, high } = span(run.energy.total, at(0.3)) // the pluck's force and the mallet are gone
        expect((high - low) / high, `${name}, ${playing}`).toBeLessThan(1e-9)
        expect(Math.abs(run.dissipated) / high).toBeLessThan(1e-9)
        expect(high).toBeGreaterThan(0.002)
        expect(run.faults).toBe(0)
        expect(run.worstIterations).toBeLessThanOrEqual(4)
      }
    }
  }, 400000)

  test('with losses every joule that goes is one the engine counted, none appears, and stronger pads take more from the bar', async () => {
    for (const [name, s] of [['prototype', BASE], ['tuned', TUNED], ['pads of 50 N s/m', variant({ mount: { stiffness: 1e6, damping: 50 } })]] as const) {
      const built = buildStringBarBody(s, SR)
      const worklet = await createWorklet(built.calls)
      worklet.send([pluckCall(built, 2), ['launch', built.mallet!, 1.5]])
      worklet.render(Math.round(0.3 * SR))
      const engine = worklet.engine
      const start = engine.energy()
      let [lost, previous, rises] = [0, start, 0]
      for (let i = 0; i < SR / 2; i++) {
        worklet.render(1)
        lost += engine.dissipated()
        const now = engine.energy()
        if (now > previous * (1 + 1e-12)) rises++
        previous = now
      }
      expect(rises, name).toBe(0)
      expect(start - previous).toBeGreaterThan(0.0005)
      expect(Math.abs(start - previous - lost) / (start - previous), name).toBeLessThan(1e-6)
    }
    // The bar's energy 0.2 s after a stroke: less the more the pads are damped.
    const left = async (damping: number) => (await measure(variant({ mount: { stiffness: 1e6, damping } }), 'strike', 0.4)).energy.bar[at(0.2)]
    const [light, firm, heavy] = [await left(0.5), await left(5), await left(50)]
    expect(firm).toBeLessThan(light)
    expect(heavy).toBeLessThan(0.5 * firm)
  }, 400000)
})

describe('What is heard, and whether it is still a string', () => {
  test('the string keeps its pitch and its fundamental with a bar on the board', async () => {
    const approved = await approvedStringBody(3)
    const was = cents(pitchNear(approved.stringVelocity, F0), F0)
    for (const [name, s] of [['prototype', BASE], ['tuned', TUNED]] as const) {
      const run = await measure(s, 'pluck', 3)
      const now = cents(pitchNear(run.stringVelocity, F0), F0)
      expect(Math.abs(now), name).toBeLessThan(1) // cents from the string between fixed ends; measured -0.48
      expect(Math.abs(now - was)).toBeLessThan(0.2) // the bar moves it by 0.06 cents
      // The fundamental at the listener: 1.9 to 2.2 dB below the approved instrument's, not gone.
      const fundamental = 20 * Math.log10(partial(run.pressure, F0) / partial(approved.pressure, F0))
      expect(fundamental).toBeGreaterThan(-3.5)
      expect(fundamental).toBeLessThan(0)
      expect(partial(run.pressure, F0)).toBeGreaterThan(0.004) // Pa. (Through a bar alone it was 0.00000018 Pa.)
      // As loud as the approved instrument within 3 dB.
      expect(Math.abs(levels(run.pressure).lafMax_dB - levels(approved.pressure).lafMax_dB)).toBeLessThan(3)
    }
  }, 400000)

  test('the tuned bar: its note sits on the string\'s 6th harmonic, rings through the board when struck, and colours the pluck', async () => {
    const [strike, pluck, plain, approved] = [await measure(TUNED, 'strike', 3), await measure(TUNED, 'pluck', 3), await measure(BASE, 'strike', 3), await approvedStringBody(3)]
    // The bar's note as it is on the board: within 2 cents of 6 x the string's pitch.
    expect(Math.abs(cents(pitchNear(strike.barVelocity, 6 * F0, 1.02, 0.1), 6 * F0))).toBeLessThan(2)
    // In the sound from 0.3 s on: 18 mPa at that note, against less than 1 mPa for the first prototype, whose pads drain the bar.
    const ring = partial(strike.pressure, 6 * F0, 14400)
    expect(ring).toBeGreaterThan(0.01)
    expect(ring).toBeGreaterThan(10 * partial(plain.pressure, 654, 14400))
    // The string answers the stroke: its fundamental is in the sound afterwards.
    expect(partial(strike.pressure, F0, 14400)).toBeGreaterThan(5e-5)
    expect(strike.peak.string).toBeGreaterThan(2e-5)
    // Plucked, the 6th harmonic is 7 dB stronger than on the approved instrument: the bar rings with it.
    const sixth = 20 * Math.log10(partial(pluck.pressure, 6 * F0) / partial(approved.pressure, 6 * F0))
    expect(sixth).toBeGreaterThan(4)
    expect(sixth).toBeLessThan(11)
  }, 400000)

  test('a stroke is far louder than a pluck, and most of it is the bar thumping the board', async () => {
    const [pluck, strike] = [await sound(BASE, 'pluck', 2), await sound(BASE, 'strike', 2)]
    const [lp, ls] = [levels(pluck.pressure), levels(strike.pressure)]
    expect(ls.peakPa).toBeGreaterThan(3.5) // Pa; measured 4.34
    expect(ls.peakPa).toBeLessThan(5.5)
    expect(ls.lafMax_dB - lp.lafMax_dB).toBeGreaterThan(25) // measured 29.5
    // It dies quickly: 20 dB in 0.67 s, against 1.1 s for the pluck.
    expect(ls.fall20!).toBeLessThan(0.9)
    expect(lp.fall20!).toBeGreaterThan(0.9)
  }, 400000)
})

describe('It stays well behaved', () => {
  test('the same playing gives the same samples', async () => {
    const [a, b] = [await sound(TUNED, 'both', 1), await sound(TUNED, 'both', 1)]
    expect(Array.from(a.pressure)).toEqual(Array.from(b.pressure))
  }, 400000)

  test('plucked hard and struck hard in turn, ten times a second for five seconds: no fault, bounded, and it dies away', async () => {
    for (const [name, s] of [['prototype', BASE], ['tuned', TUNED], ['stiff pads', variant({ mount: { stiffness: 1e7, damping: 5 } })], ['soft pads', variant({ mount: { stiffness: 1e4, damping: 5 } })]] as const) {
      const built = buildStringBarBody(s, SR)
      const r = radiation(SR)
      const worklet = await createWorklet([...built.calls, ['radiate', r.perSample, r.b0, r.b1, r.a1, 64]])
      const play: Call[] = [pluckCall(built, 8, 0), ['launch', built.mallet!, 5]]
      const out = worklet.render(5 * SR, (block) => block % 37 === 0 && worklet.send([play[(block / 37) % 2]]))
      const ringing = worklet.engine.energy() - worklet.engine.resonatorEnergy(built.malletHead!)
      worklet.render(3 * SR)
      expect(worklet.engine.faults(), name).toBe(0)
      expect(out.every(Number.isFinite)).toBe(true)
      expect(largest(out)).toBeGreaterThan(0.05)
      expect(largest(out)).toBeLessThan(1) // below 64 Pa
      expect(worklet.engine.energy() - worklet.engine.resonatorEnergy(built.malletHead!)).toBeLessThan(0.2 * ringing)
      expect(worklet.engine.worstIterations()).toBeLessThanOrEqual(8)
    }
  }, 400000)

  test('a lossless system is really lossless: the helper removes every damper and every decay', () => {
    const calls = lossless(buildStringBarBody(BASE, SR).calls)
    expect(calls.filter((call) => call[0] === 'setMode').every((call) => call[4] === Infinity)).toBe(true)
    expect(calls.filter((call) => call[0] === 'addSpring').every((call) => call[6] === 0)).toBe(true)
  })
})
