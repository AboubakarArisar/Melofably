// Phase 3D.9: other ways of putting a string, a metal bar and the damped
// body together. Architecture A: string and bar stand on the same point of
// the board. Architecture B: the string is tied to the bar, and the bar
// stands on the board (SHARED_POINT and BAR_BRIDGE in
// src/experimental/string/stringBarBody.ts). Isolated: nothing here is in
// the builder.
import { describe, expect, test } from 'vitest'
import { levels, pitchNear } from '../analysis/hybrid-study'
import { partial } from '../analysis/radiation'
import { approvedStringBody, cents, F0, lossless, measure, perform, pluckAt, sound, spectralPeaks, strikeAt, touchAt, TUNED, type Run } from '../analysis/three-body'
import { createWorklet } from '../analysis/worklet'
import { impedance } from '../src/experimental/string/modalString'
import { modalMobility, plateModes } from '../src/experimental/string/soundboard'
import { BAR_BRIDGE, BAR_STRING, barMass, barOnBoardModes, BOARD_RADIATION, buildStringBarBody, RIGID_MODES, SHARED_POINT, SOFT_MOUNT, supportPoints, VISCO_MOUNT, type StringBarBody } from '../src/experimental/string/stringBarBody'
import { BODY, pluckCall } from '../src/experimental/string/stringBody'
import { SR } from './helpers'

const at = (t: number) => Math.round((t * SR) / 128)
const largest = (x: ArrayLike<number>) => {
  let m = 0
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}
const span = (x: ArrayLike<number>, from: number) => {
  let [low, high] = [Infinity, -Infinity]
  for (let i = from; i < x.length; i++) {
    low = Math.min(low, x[i])
    high = Math.max(high, x[i])
  }
  return { low, high }
}
const modeEnergy = (run: Run, s: StringBarBody, n: number) => 0.5 * barMass(s.bar) * largest(run.barModes[n]) ** 2
const noteOf = (run: Run) => spectralPeaks(run.barModes[RIGID_MODES], 0.05, 1.5, 1)[0][0]
const architectures = [['A, shared bridge point', SHARED_POINT], ['B, the bar is the bridge', BAR_BRIDGE]] as const

describe('What the two architectures are', () => {
  test('A and B are the earlier bar, pads and body, put together differently; nothing earlier is changed', () => {
    // The bar lies along the nodal line the approved bridge stands on, its first pad on the bridge's own point.
    expect(supportPoints(SHARED_POINT)[0]).toEqual([BODY.bridgeAt[0], BODY.bridgeAt[1]])
    expect(supportPoints(SHARED_POINT)[1][1]).toBe(BODY.bridgeAt[1])
    expect(supportPoints(SHARED_POINT)[1][0]).toBeCloseTo(0.08 + (0.57 * 0.1994) / 0.5, 10)
    expect(SHARED_POINT).toEqual({ ...VISCO_MOUNT, mount: { stiffness: 1e6, damping: 5 }, padsAt: supportPoints(SHARED_POINT) })
    expect(SHARED_POINT.stringOnBar).toBeUndefined()
    // B is A with the string's end on the bar, a fifth of the way along (the pad is at 0.215), by the bridge's own spring.
    expect(BAR_BRIDGE).toEqual({ ...SHARED_POINT, stringOnBar: { at: 0.2, stiffness: 1e6, damping: 0 } })
    // Pads that are not as far apart on the board as on the bar are refused.
    expect(() => supportPoints({ ...SHARED_POINT, padsAt: [[0.08, 1 / 3], [0.5, 1 / 3]] })).toThrow(/apart/)
    // The earlier prototypes build exactly as they did: four bar ports, no tie.
    for (const s of [TUNED, SOFT_MOUNT, VISCO_MOUNT]) {
      const b = buildStringBarBody(s, SR)
      expect(b.tie).toBeUndefined()
      expect(b.calls.some((call) => call[0] === 'setShape' && call[1] === b.bar && call[2] >= 4)).toBe(false)
    }
    expect(barOnBoardModes(TUNED.bar, SR)[0].shape.length).toBe(4)
  })

  test('B as the engine has it: the string\'s end joined to a fifth port of the bar, not to the board; the outputs are still the body\'s', () => {
    const [a, b] = [buildStringBarBody(SHARED_POINT, SR), buildStringBarBody(BAR_BRIDGE, SR)]
    const springs = (x: typeof a) => x.calls.filter((call) => call[0] === 'addSpring')
    // A: the approved bridge spring, string end to the board's bridge port.
    expect(springs(a)[a.bridge].slice(1, 5)).toEqual([a.string, 0, a.board, 0])
    // Its stiffness as the engine has it is 6.4e4 N/m: the bridge's 1e6 N/m in series with the give of the string's missing modes.
    expect(springs(a)[a.bridge][5]).toBeGreaterThan(5e4)
    expect(springs(a)[a.bridge][5]).toBeLessThan(1e5)
    expect(a.tie).toBeUndefined()
    // B: that spring carries nothing (stiffness 0), and a new one of the same stiffness goes from the string's end to the bar.
    expect(springs(b)[b.bridge][5]).toBe(0)
    expect(springs(b)[b.tie!].slice(1, 5)).toEqual([b.string, 0, b.bar, BAR_STRING])
    expect(springs(b)[b.tie!][5]).toBe(springs(a)[a.bridge][5]) // the bridge's stiffness with the string's missing modes allowed for: N/m
    expect(springs(b)[b.tie!][6]).toBe(0)
    // The bar's fifth port holds its modes' shapes at 0.2 of its length: 1 for moving as a whole, sqrt(3) (2 x 0.2 - 1) for rocking.
    const modes = barOnBoardModes(BAR_BRIDGE.bar, SR, [0.2])
    expect(modes[0].shape[BAR_STRING]).toBe(1)
    expect(modes[1].shape[BAR_STRING]).toBeCloseTo(-0.6 * Math.sqrt(3), 12)
    expect(b.calls.filter((call) => call[0] === 'setShape' && call[1] === b.bar && call[2] === BAR_STRING).length).toBe(modes.length)
    // One connection more than A; the same resonators; and the two outputs of the approved body, nothing else.
    expect(springs(b).length).toBe(springs(a).length + 1)
    expect(b.calls.filter((call) => call[0] === 'addOutput')).toEqual([['addOutput', b.board, BOARD_RADIATION, 1], ['addOutput', b.plug, 0, -1]])
  })

  test('why B was chosen: the string meets something it can move. Its impedance times the mobility of what it stands on is over ten times larger on the bar than on the board', () => {
    const Z = impedance({ length: 0.65, tension: 73.5, density: 0.0036 })
    const board = plateModes(BODY.plate, [BODY.bridgeAt], SR, BODY.limit)
    const bar = barOnBoardModes(BAR_BRIDGE.bar, SR, [0.2])
    const size = (y: [number, number]) => Math.hypot(y[0], y[1])
    expect(Z * modalMobility(board, 0, F0)[0]).toBeLessThan(1e-4)
    expect(Z * size(modalMobility(board, 0, F0))).toBeLessThan(2e-3)
    // The free bar at 0.2 of its length: at the fundamental a 54 g mass, at 660 Hz its own bending mode.
    expect(Z * size(modalMobility(bar, BAR_STRING, F0))).toBeGreaterThan(0.01)
    expect(Z * size(modalMobility(bar, BAR_STRING, F0))).toBeGreaterThan(10 * Z * size(modalMobility(board, 0, F0)))
    expect(Z * size(modalMobility(bar, BAR_STRING, 6 * F0))).toBeGreaterThan(3 * Z * size(modalMobility(board, 0, 6 * F0)))
  })
})

describe('Energy between the string and the bar', () => {
  test('B: the bar\'s bending takes twenty times more of a pluck than in any earlier prototype, and the string takes ten times more of a stroke', async () => {
    const [was, a, b] = [await measure(TUNED, 'pluck', 4), await measure(SHARED_POINT, 'pluck', 4), await measure(BAR_BRIDGE, 'pluck', 4)]
    // The lowest bending mode at its most: 0.236 uJ (the tuned prototype, the best before), 0.9 uJ (A), 5.0 uJ (B).
    const bending = [modeEnergy(was, TUNED, 2), modeEnergy(a, SHARED_POINT, 2), modeEnergy(b, BAR_BRIDGE, 2)]
    expect(bending[0]).toBeLessThan(0.4e-6)
    expect(bending[1]).toBeGreaterThan(2.5 * bending[0])
    expect(bending[2]).toBeGreaterThan(15 * bending[0])
    expect(bending[2] / b.peak.in).toBeGreaterThan(5e-4) // a tenth of a percent of the pluck; it was 0.005 %
    // It is energy that went through the joint: forward and back are both much larger than in A, and the bar as a whole holds more.
    expect(b.toBoard).toBeGreaterThan(2 * a.toBoard)
    expect(b.peak.bar).toBeGreaterThan(3 * a.peak.bar)
    // Struck: the string holds 3.9 % of what the mallet gave (0.29 % before, 0.76 % in A).
    const [kWas, kA, kB] = [await measure(TUNED, 'strike', 2), await measure(SHARED_POINT, 'strike', 2), await measure(BAR_BRIDGE, 'strike', 2)]
    expect(kB.peak.string / kB.malletGave).toBeGreaterThan(0.025)
    expect(kB.peak.string / kB.malletGave).toBeGreaterThan(8 * (kWas.peak.string / kWas.malletGave))
    expect(kA.peak.string / kA.malletGave).toBeGreaterThan(2 * (kWas.peak.string / kWas.malletGave))
    expect(kB.bridgeWork.at(-1)!).toBeLessThan(0) // over a stroke the joint's net work on the bar is negative: the bar fed the string
  }, 400000)

  test('with every loss removed both keep their energy to a part in a billion, and with losses every joule that goes was counted', async () => {
    for (const [name, s] of architectures) {
      for (const playing of ['pluck', 'strike', 'both'] as const) {
        const run = await measure(s, playing, 2, { lossless: true })
        const { low, high } = span(run.energy.total, at(0.3))
        expect((high - low) / high, `${name}, ${playing}`).toBeLessThan(1e-9)
        expect(Math.abs(run.dissipated) / high).toBeLessThan(1e-9)
        expect(run.faults).toBe(0)
        expect(run.worstIterations).toBeLessThanOrEqual(4)
      }
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
      expect(Math.abs(start - previous - lost) / (start - previous), name).toBeLessThan(1e-6)
    }
    // The tie is a spring: the lossless helper leaves it in place.
    const b = buildStringBarBody(BAR_BRIDGE, SR)
    expect(lossless(b.calls).filter((call) => call[0] === 'addSpring')[b.tie!][5]).toBeGreaterThan(5e4)
  }, 400000)

  test('take a joint away and what is behind it gets nothing: in B the string cut loose leaves the bar and board alone, and the pads removed leave the board silent', async () => {
    const cut = await measure({ ...BAR_BRIDGE, stringOn: false }, 'strike', 1)
    expect(cut.peak.string).toBe(0)
    expect(largest(cut.pressure)).toBeGreaterThan(1) // the bar on the board is still an instrument
    const plucked = await measure({ ...BAR_BRIDGE, stringOn: false }, 'pluck', 1)
    expect(plucked.peak.bar).toBe(0)
    expect(largest(plucked.pressure)).toBe(0)
    // No pads: string and bar are one thing in the air, and the board hears nothing at all.
    const floating = await measure({ ...BAR_BRIDGE, mount: null }, 'pluck', 1)
    expect(floating.peak.board).toBe(0)
    expect(largest(floating.pressure)).toBe(0)
    expect(floating.peak.bar).toBeGreaterThan(1e-5)
    // A with its pads removed is the approved string instrument, sample for sample.
    const bare = await measure({ ...SHARED_POINT, mount: null }, 'pluck', 1.5)
    expect(Array.from(bare.pressure)).toEqual(Array.from((await approvedStringBody(1.5)).pressure))
  }, 400000)
})

describe('What B sounds like, by the numbers', () => {
  test('the string is still a string: its pitch within a cent, its fundamental as strong as on the approved instrument, its sustain kept', async () => {
    const [run, approved] = [await measure(BAR_BRIDGE, 'pluck', 4), await approvedStringBody(4)]
    expect(Math.abs(cents(pitchNear(run.stringVelocity, F0), F0))).toBeLessThan(1) // measured -0.73
    const fundamental = 20 * Math.log10(partial(run.pressure, F0) / partial(approved.pressure, F0))
    expect(Math.abs(fundamental)).toBeLessThan(1.5) // measured +0.5 dB
    expect(Math.abs(20 * Math.log10(partial(run.pressure, 2 * F0) / partial(approved.pressure, 2 * F0)))).toBeLessThan(1.5)
    const [l, la] = [levels(run.pressure), levels(approved.pressure)]
    expect(l.fall20!).toBeGreaterThan(0.75) // 0.88 s against 1.0 s
    expect(l.fall20!).toBeLessThan(la.fall20! + 0.1)
    // The string's own energy a second after the pluck: 1.0 % of its most, as on the approved instrument (1.1 %).
    const second = Math.round(SR / 128)
    expect(run.energy.string[second] / run.peak.string).toBeGreaterThan(0.008)
  }, 400000)

  test('and the bar is heard with it: the pluck\'s strongest component is the bar\'s note, with no rise at the board\'s 330 Hz resonance', async () => {
    const [run, approved, a] = [await measure(BAR_BRIDGE, 'pluck', 4), await approvedStringBody(4), await measure(SHARED_POINT, 'pluck', 4)]
    // In the first half second the strongest thing in the sound is at 660 Hz (32 mPa), above the fundamental (16 mPa).
    const [strongest] = spectralPeaks(run.pressure, 0, 0.5, 1)
    expect(Math.abs(strongest[0] - 6 * F0)).toBeLessThan(8)
    expect(strongest[1]).toBeGreaterThan(0.02)
    expect(strongest[1]).toBeGreaterThan(1.5 * partial(run.pressure, F0, 0))
    // Over the whole note the 6th harmonic is 5 dB above the approved instrument's, and the pluck 6 dB louder by the meter.
    const sixth = 20 * Math.log10(partial(run.pressure, 6 * F0) / partial(approved.pressure, 6 * F0))
    expect(sixth).toBeGreaterThan(3)
    expect(sixth).toBeLessThan(8)
    expect(levels(run.pressure).lafMax_dB - levels(approved.pressure).lafMax_dB).toBeGreaterThan(4)
    expect(levels(run.pressure).lafMax_dB - levels(approved.pressure).lafMax_dB).toBeLessThan(8)
    // The 3rd harmonic (330 Hz, the board's own resonance) is lower than on the approved instrument, not higher.
    expect(partial(run.pressure, 3 * F0)).toBeLessThan(partial(approved.pressure, 3 * F0))
    expect(partial(a.pressure, 3 * F0)).toBeLessThan(partial(approved.pressure, 3 * F0))
  }, 400000)

  test('the bar must lie along the nodal line: with its second pad off it, the 330 Hz resonance returns at over 20 dB', async () => {
    const [bx, by] = supportPoints(BAR_BRIDGE)[0]
    const apart = 0.57 * BAR_BRIDGE.bar.length
    const dy = 0.2 * BODY.plate.width
    const off: StringBarBody = { ...BAR_BRIDGE, padsAt: [[bx, by], [bx + Math.sqrt(apart ** 2 - dy ** 2) / BODY.plate.length, by + 0.2]] }
    const [on, moved, approved] = [await sound(BAR_BRIDGE, 'pluck', 3), await sound(off, 'pluck', 3), await approvedStringBody(3)]
    const third = (x: Float32Array) => 20 * Math.log10(partial(x, 3 * F0) / partial(approved.pressure, 3 * F0))
    expect(third(moved.pressure)).toBeGreaterThan(20)
    expect(third(on.pressure)).toBeLessThan(0)
  }, 400000)

  test('struck, the bar rings at the string\'s 6th harmonic and the string answers; a stroke is 23 dB above a pluck where it was 33', async () => {
    const [strike, pluck, was, wasPluck] = [await measure(BAR_BRIDGE, 'strike', 4), await sound(BAR_BRIDGE, 'pluck', 4), await sound(TUNED, 'strike', 4), await sound(TUNED, 'pluck', 4)]
    expect(Math.abs(cents(noteOf(strike), 6 * F0))).toBeLessThan(4) // measured +2.1
    expect(partial(strike.pressure, noteOf(strike), 14400)).toBeGreaterThan(0.008) // Pa from 0.3 s on: measured 0.0146
    expect(partial(strike.pressure, F0, 14400)).toBeGreaterThan(1e-4) // the string's fundamental after the stroke
    const gap = levels(strike.pressure).lafMax_dB - levels(pluck.pressure).lafMax_dB
    const gapWas = levels(was.pressure).lafMax_dB - levels(wasPluck.pressure).lafMax_dB
    expect(gap).toBeLessThan(25)
    expect(gapWas - gap).toBeGreaterThan(7)
  }, 400000)
})

describe('Playing B', () => {
  test('repeated plucks, repeated strokes, the two in turn and together, and a finger on the string: no fault, no click, energy that settles and dies away', async () => {
    const every = (seconds: number, step: number) => Array.from({ length: Math.floor(seconds / step) }, (_, i) => i * step)
    for (const [name, events] of [['plucks', every(3, 0.25).map((t) => pluckAt(t))], ['strokes', every(3, 0.25).map((t) => strikeAt(t))], ['in turn', every(3, 0.25).map((t, i) => (i % 2 ? strikeAt(t) : pluckAt(t)))], ['together', every(3, 0.5).flatMap((t) => [pluckAt(t), strikeAt(t)])]] as const) {
      const p = await perform(BAR_BRIDGE, [...events], 6)
      expect(p.faults, name).toBe(0)
      expect(p.clipped).toBe(false)
      expect(p.pressure.every(Number.isFinite)).toBe(true)
      expect(p.worstIterations).toBeLessThanOrEqual(6)
      const blocks = (from: number, to: number) => p.energy.slice(Math.round((from * SR) / 128), Math.round((to * SR) / 128))
      expect(Math.max(...blocks(2, 3))).toBeLessThan(2 * Math.max(...blocks(0, 1)))
      expect(p.energy.at(-1)!).toBeLessThan(0.01 * Math.max(...p.energy))
      expect(p.largestStepOverPeak).toBeLessThan(0.5)
    }
    // A finger on the string after a pluck: the string is muted, and the bar it was driving stops being fed.
    const [muted, open] = [await perform(BAR_BRIDGE, [pluckAt(0), touchAt(0.5, BAR_BRIDGE, true)], 1.5), await perform(BAR_BRIDGE, [pluckAt(0)], 1.5)]
    expect(muted.stringEnergy).toBeLessThan(0.01 * open.stringEnergy)
    expect(muted.faults).toBe(0)
    // Twice the pluck is twice the pressure.
    const [one, four] = [await perform(BAR_BRIDGE, [pluckAt(0, 1)], 1.5), await perform(BAR_BRIDGE, [pluckAt(0, 4)], 1.5)]
    expect(20 * Math.log10(largest(four.pressure) / largest(one.pressure))).toBeCloseTo(12.04, 1)
  }, 400000)

  test('played as hard as allowed for three seconds: no fault, bounded, the same every time', async () => {
    const hard = Array.from({ length: 30 }, (_, i) => (i % 2 ? strikeAt(i * 0.1, 5) : pluckAt(i * 0.1, 8)))
    for (const [name, s] of architectures) {
      const [a, b] = [await perform(s, hard, 6), await perform(s, hard, 6)]
      expect(a.faults, name).toBe(0)
      expect(a.clipped).toBe(false)
      expect(a.worstIterations).toBeLessThanOrEqual(10)
      expect(a.energy.at(-1)!).toBeLessThan(0.02 * Math.max(...a.energy))
      expect(Array.from(b.pressure)).toEqual(Array.from(a.pressure))
    }
  }, 400000)
})
