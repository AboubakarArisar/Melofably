// Phase 3D.11: a finger on the bar of the bar-as-bridge instrument
// (touchBar, barTouchCalls and barReleaseCalls in
// src/experimental/string/stringBarBody.ts). Isolated: nothing here is in
// the builder. Numbers in comments are measurements
// (renders/bar-damping/measurements.json); none says how anything sounds.
import { describe, expect, test } from 'vitest'
import { barReleaseAt, barSlapAt, barTouchAt, bendingEnergy, blockAt, CEILING, modeEnergy, play, roughness, unaccounted, type Played } from '../analysis/bar-damping'
import { pitchNear } from '../analysis/hybrid-study'
import { partial } from '../analysis/radiation'
import { cents, F0, pluckAt, retriggerAt, strikeAt, touchAt, type Event } from '../analysis/three-body'
import { BAR_BRIDGE, BAR_BRIDGE_FIRMER_TIE, BAR_TOUCH, barMass, barOnBoardModes, barTouchCalls, buildStringBarBody, dampable, LIGHT_STRIKER, RIGID_MODES, STROKES, type StringBarBody } from '../src/experimental/string/stringBarBody'
import { SR } from './helpers'

const S = dampable(0.5)
const T = BAR_TOUCH.medium
const largest = (x: ArrayLike<number>, from = 0, to = x.length) => {
  let m = 0
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}
const at = (seconds: number) => Math.round(seconds * SR)
const dB10 = (ratio: number) => 10 * Math.log10(ratio)
const dB = (ratio: number) => 20 * Math.log10(ratio)
/** Every joule between two moments accounted for, as a part of what the instrument lost. */
const balance = (p: Played, from: number, to: number) => Math.abs(unaccounted(p, from, to).residual / unaccounted(p, from, to).fell)

describe('What the finger on the bar is', () => {
  test('a place for a finger adds one port and one connection of no strength, and never used it leaves the Phase 3D.10 reference exactly as it was', async () => {
    const reference: StringBarBody = { ...BAR_BRIDGE, mallet: LIGHT_STRIKER }
    expect(S).toEqual({ ...reference, touchBar: { at: 0.5 } })
    expect(dampable(0.5, 0.18)).toEqual({ ...BAR_BRIDGE_FIRMER_TIE, mallet: LIGHT_STRIKER, touchBar: { at: 0.5 } })
    const [a, b] = [buildStringBarBody(reference, SR), buildStringBarBody(S, SR)]
    // Without a place for a finger nothing is built for one: the earlier instruments are built by the same calls as before.
    expect(a.barFinger).toBeUndefined()
    expect(a.calls.filter((call) => call[0] === 'addSpring').length + 1).toBe(b.calls.filter((call) => call[0] === 'addSpring').length)
    // The finger: the bar's sixth port (after the string's), to the thing that does not move, with no stiffness and no damping.
    expect(b.barTouchPort).toBe(5)
    expect(b.calls.filter((call) => call[0] === 'addSpring').at(-1)).toEqual(['addSpring', b.bar, 5, b.ground, 0, 0, 0, 0, 0])
    expect(b.barFinger).toBe(b.mallet! + 1) // after every other connection: none of them changes its place
    const modes = barOnBoardModes(S.bar, SR, [0.2, 0.5])
    expect(modes[0].shape[5]).toBe(1) // moving as a whole moves the middle
    expect(modes[1].shape[5]).toBeCloseTo(0, 12) // rocking does not
    expect(Math.abs(modes[2].shape[5])).toBeGreaterThan(1.2) // and it is an antinode of the note
    // Played without the finger: the same samples, all of them.
    const events = [pluckAt(0), strikeAt(0.5, STROKES.medium), pluckAt(1), strikeAt(1, STROKES.strong)]
    const [was, is] = [await play(reference, events, 2), await play(S, events, 2)]
    expect(Array.from(is.pressure)).toEqual(Array.from(was.pressure))
    expect(is.energy.total.at(-1)).toBe(was.energy.total.at(-1))
    expect(is.injected.at(-1)).toBe(0)
  }, 400000)

  test('the calls: the finger lands where the bar is, its spring stiffens along a ramp in the engine, and its damper is brought up by the processor', () => {
    const b = buildStringBarBody(S, SR)
    expect(barTouchCalls(b, T, SR)).toEqual([['attach', b.barFinger], ['setStiffness', b.barFinger, 2000, 1, 192], ['touch', b.barFinger, 6, 0.004, -1, 0]])
    expect(barTouchCalls(b, BAR_TOUCH.firm, SR, 0.004, false)[0][0]).toBe('setStiffness') // pressing harder: no second landing
    expect(() => barTouchCalls(buildStringBarBody(BAR_BRIDGE, SR), T, SR)).toThrow(/no place/)
    // Harder is stiffer and more damped, in the same order.
    const order = [BAR_TOUCH.light, BAR_TOUCH.medium, BAR_TOUCH.firm, BAR_TOUCH.palm]
    for (let i = 1; i < order.length; i++) {
      expect(order[i].stiffness).toBeGreaterThan(order[i - 1].stiffness)
      expect(order[i].damping).toBeGreaterThan(order[i - 1].damping)
    }
  })
})

describe('It damps the bar, passively', () => {
  test('a finger on the middle of a ringing bar takes its note down 20 dB in about the time its damper predicts, and more firmly pressed takes it faster', async () => {
    const open = await play(S, [strikeAt(0, 1)], 0.8)
    const shape = barOnBoardModes(S.bar, SR, [0.2, 0.5])[RIGID_MODES].shape[5]
    let before = 0
    for (const touch of [BAR_TOUCH.light, BAR_TOUCH.medium, BAR_TOUCH.firm]) {
      const p = await play(S, [strikeAt(0, 1), barTouchAt(0.2, touch)], 0.8)
      // 50 ms after landing: -14, -29 and -26 dB of the untouched bar's bending energy at that moment.
      const down = dB10(bendingEnergy(p, S, 0.25) / bendingEnergy(open, S, 0.25))
      expect(down).toBeLessThan(-10)
      // A damper c where the mode's shape is s takes its energy down at c s^2 / m per second: the light finger, alone slow enough to follow, is within 3 dB of that after 30 ms.
      if (touch === BAR_TOUCH.light) expect(Math.abs(dB10(bendingEnergy(p, S, 0.234) / bendingEnergy(open, S, 0.234)) - dB10(Math.exp((-touch.damping * shape * shape * 0.03) / barMass(S.bar))))).toBeLessThan(3)
      // And the sound: the bar's note from 0.1 s after landing is less than half what it was (17.7, 10.9, 8.0 mPa against 29.6).
      expect(partial(p.pressure, 6 * F0, at(0.3))).toBeLessThan(0.7 * partial(open.pressure, 6 * F0, at(0.3)))
      if (before) expect(partial(p.pressure, 6 * F0, at(0.3))).toBeLessThan(before)
      before = partial(p.pressure, 6 * F0, at(0.3))
      expect(p.faults).toBe(0)
      expect(p.worstIterations).toBeLessThanOrEqual(4)
    }
  }, 400000)

  test('energy never rises while the finger rests, and every joule that leaves is counted; the finger takes about half of it', async () => {
    const p = await play(S, [strikeAt(0, 1), barTouchAt(0.2, T)], 1.2)
    // From 10 ms after landing (its spring has stopped stiffening) the instrument's energy only falls.
    for (let b = blockAt(0.21) + 1; b < p.energy.total.length; b++) expect(p.energy.total[b]).toBeLessThanOrEqual(p.energy.total[b - 1] * (1 + 1e-12))
    expect(balance(p, 0.19, 1.1)).toBeLessThan(1e-9)
    const u = unaccounted(p, 0.19, 1.1)
    expect(u.fingerTook / u.fell).toBeGreaterThan(0.4) // 50 % of the 63 uJ lost
    expect(u.fingerTook / u.fell).toBeLessThan(0.6)
    // With every other loss removed, what the instrument loses is what the finger takes, and nothing else.
    const bare = await play(S, [strikeAt(0, 1), barTouchAt(0.2, T)], 0.8, { lossless: true })
    const v = unaccounted(bare, 0.21, 0.75)
    expect(v.fell).toBeGreaterThan(1e-5)
    expect(Math.abs(v.residual / v.fell)).toBeLessThan(1e-9)
    expect(Math.abs(v.fingerTook / v.fell - 1)).toBeLessThan(0.02) // measured by force x speed at the finger, sample by sample
    // And untouched, with every loss removed, nothing is lost at all.
    const kept = await play(S, [strikeAt(0, 1)], 0.8, { lossless: true })
    expect(Math.abs(kept.energy.total[blockAt(0.75)] / kept.energy.total[blockAt(0.21)] - 1)).toBeLessThan(1e-9)
    expect(kept.dissipated.at(-1)!).toBeLessThan(1e-12)
  }, 400000)
})

describe('Landing and leaving', () => {
  test('landing gives the bar nothing but what the stiffening spring is counted as giving, under half a percent of what is then lost; leaving gives nothing', async () => {
    const p = await play(S, [strikeAt(0, 1), barTouchAt(0.05, T), ...barReleaseAt(0.15, T)], 1)
    expect(balance(p, 0.04, 0.95)).toBeLessThan(1e-9)
    const landing = p.injected[blockAt(0.06)]
    expect(landing).toBeGreaterThan(0) // the hand pressing in while the bar moves under it: 1.3 uJ, a quarter of a percent of the 552 uJ then lost
    expect(landing).toBeLessThan(5e-3 * unaccounted(p, 0.04, 0.95).fell)
    // Leaving: the spring's stiffness goes while it is stretched, which takes its energy away (to the hand), never adds any.
    expect(p.injected[blockAt(0.17)]).toBeLessThanOrEqual(landing)
    expect(p.fingerStored.at(-1)).toBe(0)
    // After the finger has gone the instrument is as it was built: untouched, and losing energy only to itself.
    for (let b = blockAt(0.17) + 1; b < p.energy.total.length; b++) expect(p.energy.total[b]).toBeLessThanOrEqual(p.energy.total[b - 1] * (1 + 1e-12))
    expect(p.injected.at(-1)).toBe(p.injected[blockAt(0.17)])
    expect(p.faults).toBe(0)
  }, 400000)

  test('a finger landing or leaving makes no click: the sound just after is no rougher than the untouched instrument at the same moment', async () => {
    const open = await play(S, [strikeAt(0, 2)], 0.6)
    const moves: [string, Event[]][] = [['medium', [barTouchAt(0.05, T), ...barReleaseAt(0.2, T)]], ['firm', [barTouchAt(0.05, BAR_TOUCH.firm), ...barReleaseAt(0.2, BAR_TOUCH.firm)]], ['palm', [barTouchAt(0.05, BAR_TOUCH.palm), ...barReleaseAt(0.2, BAR_TOUCH.palm)]]]
    for (const [name, events] of moves) {
      const p = await play(S, [strikeAt(0, 2), ...events], 0.6)
      expect(dB10(roughness(p.pressure, 0.05) / roughness(open.pressure, 0.05)), name).toBeLessThan(1)
      expect(dB10(roughness(p.pressure, 0.2) / roughness(open.pressure, 0.2)), name).toBeLessThan(1)
      let jump = 0
      for (let i = at(0.04); i < p.pressure.length; i++) jump = Math.max(jump, Math.abs(p.pressure[i] - p.pressure[i - 1]))
      let openJump = 0
      for (let i = at(0.04); i < open.pressure.length; i++) openJump = Math.max(openJump, Math.abs(open.pressure[i] - open.pressure[i - 1]))
      expect(jump).toBeLessThanOrEqual(openJump * 1.05)
    }
  }, 400000)

  test('touched and released again and again while it rings: no fault, the books balance, and it is the same every time', async () => {
    const moves = [0, 1, 2, 3, 4].flatMap((i) => [barTouchAt(0.3 + 0.2 * i, T), ...barReleaseAt(0.4 + 0.2 * i, T)])
    const events = [pluckAt(0), strikeAt(0.1, 1), ...moves]
    const [a, b] = [await play(S, events, 2), await play(S, events, 2)]
    expect(a.faults).toBe(0)
    expect(a.worstIterations).toBeLessThanOrEqual(4)
    expect(balance(a, 0.29, 1.95)).toBeLessThan(1e-9)
    expect(Array.from(b.pressure)).toEqual(Array.from(a.pressure))
    expect(Array.from(b.energy.total)).toEqual(Array.from(a.energy.total))
  }, 400000)

  test('a finger already on the bar: the stroke is duller and shorter, not silent, and the finger pushes back with a force a finger can make', async () => {
    const [open, held] = [await play(S, [strikeAt(0.05, 1)], 1), await play(S, [barTouchAt(0, T), strikeAt(0.05, 1)], 1)]
    expect(dB(largest(held.pressure) / largest(open.pressure))).toBeGreaterThan(-2) // the knock is hardly changed: -0.7 dB
    expect(dB(partial(held.pressure, 6 * F0, at(0.06)) / partial(open.pressure, 6 * F0, at(0.06)))).toBeLessThan(-10) // the note is: -20 dB
    expect(held.fingerForcePeak).toBeLessThan(5) // 1.9 N
    expect(balance(held, 0.07, 0.95)).toBeLessThan(1e-9)
  }, 400000)
})

describe('Where the finger is laid', () => {
  test('on an antinode of the note it stops the note; on its node it leaves the note alone; the middle leaves rocking alone', async () => {
    const open = await play(S, [strikeAt(0, 1)], 0.5)
    const down = async (where: number, mode: number) => {
      const s = dampable(where)
      const p = await play(s, [strikeAt(0, 1), barTouchAt(0.2, T)], 0.5)
      expect(p.faults).toBe(0)
      return { note: dB10(modeEnergy(p, s, RIGID_MODES, 0.3) / modeEnergy(open, s, RIGID_MODES, 0.3)), other: dB10(modeEnergy(p, s, mode, 0.3) / modeEnergy(open, s, mode, 0.3)), took: unaccounted(p, 0.19, 0.45).fingerTook }
    }
    const [middle, node, end] = [await down(0.5, 1), await down(0.224, 1), await down(0.05, 1)]
    expect(middle.note).toBeLessThan(-10) // -13.8 dB
    expect(end.note).toBeLessThan(-18) // -24.1 dB
    expect(Math.abs(node.note)).toBeLessThan(1) // 0.0 dB
    expect(node.took).toBeLessThan(0.3 * middle.took) // 5.5 uJ against 31.6
    expect(end.other).toBeLessThan(-6) // at the end the rocking is damped too: -8.7 dB
  }, 400000)
})

describe('Two gestures', () => {
  test('a finger on the bar stops the bar and leaves the string: its energy, pitch and fundamental are what they were', async () => {
    const [open, damped] = [await play(S, [pluckAt(0)], 2.2), await play(S, [pluckAt(0), barTouchAt(0.3, T)], 2.2)]
    for (const t of [0.5, 1, 2]) expect(Math.abs(dB10(damped.energy.string[blockAt(t)] / open.energy.string[blockAt(t)]))).toBeLessThan(0.1) // 0.0 dB
    expect(Math.abs(dB(partial(damped.pressure, F0, at(0.35)) / partial(open.pressure, F0, at(0.35))))).toBeLessThan(1) // -0.3 dB
    expect(Math.abs(cents(pitchNear(damped.stringVelocity.subarray(at(0.35)), F0), F0) - cents(pitchNear(open.stringVelocity.subarray(at(0.35)), F0), F0))).toBeLessThan(0.1)
    expect(bendingEnergy(damped, S, 0.4)).toBeLessThan(0.5 * bendingEnergy(open, S, 0.4)) // the bar's note: -6.6 dB
    expect(dB(partial(damped.pressure, 6 * F0, at(0.35)) / partial(open.pressure, 6 * F0, at(0.35)))).toBeLessThan(-4) // and in the sound: -6.8 dB
  }, 400000)

  test('a finger on the string stops the string and leaves the bar ringing; both fingers stop everything', async () => {
    const [open, muted, both] = [await play(S, [strikeAt(0, 1)], 0.8), await play(S, [strikeAt(0, 1), touchAt(0.05, S, true)], 0.8), await play(S, [pluckAt(0), strikeAt(0, 1), touchAt(0.15, S, true), barTouchAt(0.16, T)], 0.8)]
    expect(muted.energy.string[blockAt(0.3)]).toBeLessThan(0.05 * open.energy.string[blockAt(0.3)]) // 0.17 uJ against 16.5
    expect(dB10(bendingEnergy(muted, S, 0.3) / bendingEnergy(open, S, 0.3))).toBeGreaterThan(-5) // the bar's note: -2.5 dB
    expect(partial(muted.pressure, 6 * F0, at(0.1))).toBeGreaterThan(0.5 * partial(open.pressure, 6 * F0, at(0.1)))
    // Both: half a second in, less than a thousandth of the string's energy and of the bar's.
    const loud = await play(S, [pluckAt(0), strikeAt(0, 1)], 0.8)
    expect(both.energy.string[blockAt(0.5)]).toBeLessThan(1e-3 * loud.energy.string[blockAt(0.5)])
    expect(both.energy.bar[blockAt(0.5)]).toBeLessThan(1e-2 * loud.energy.bar[blockAt(0.5)])
    expect(both.faults).toBe(0)
    expect(balance(both, 0.17, 0.75)).toBeLessThan(1e-6)
  }, 400000)

  test('after the finger has gone the bar is struck again and answers as if it had never been touched', async () => {
    const [fresh, again] = [await play(S, [strikeAt(0, 1)], 0.4), await play(S, [strikeAt(0, 1), barTouchAt(0.2, T), ...barReleaseAt(0.5, T), strikeAt(0.6, 1)], 1)]
    expect(Math.abs(dB(largest(again.pressure, at(0.6)) / largest(fresh.pressure)))).toBeLessThan(0.2)
    expect(Math.abs(dB10(bendingEnergy(again, S, 0.7) / bendingEnergy(fresh, S, 0.1)))).toBeLessThan(0.5)
  }, 400000)
})

describe('Playing it hard', () => {
  test('a phrase with both fingers, and three seconds of the hardest playing while the palm lands and lifts: bounded, faultless, the same every time', async () => {
    const phrase: Event[] = [pluckAt(0), strikeAt(0.6, 1), barTouchAt(0.68, BAR_TOUCH.firm), retriggerAt(1.1, S), ...barReleaseAt(1.8, BAR_TOUCH.firm), strikeAt(1.9, 2), touchAt(2.0, S, true), touchAt(2.5, S, false), pluckAt(2.6, 4), strikeAt(3.0, 0.5), touchAt(3.6, S, true), barTouchAt(3.62, BAR_TOUCH.firm)]
    const [a, b] = [await play(S, phrase, 4.4), await play(S, phrase, 4.4)]
    expect(a.faults).toBe(0)
    expect(a.worstIterations).toBeLessThanOrEqual(6)
    expect(Array.from(b.pressure)).toEqual(Array.from(a.pressure))
    expect(a.energy.total.at(-1)! - a.energy.striker.at(-1)!).toBeLessThan(1e-6 * Math.max(...a.energy.total))
    const hard: Event[] = Array.from({ length: 30 }, (_, i) => (i % 2 ? strikeAt(i * 0.1, 5) : pluckAt(i * 0.1, 8)))
    const palm: Event[] = Array.from({ length: 15 }, (_, i) => (i % 2 ? barReleaseAt(0.05 + i * 0.2, BAR_TOUCH.palm) : [barTouchAt(0.05 + i * 0.2, BAR_TOUCH.palm)])).flat()
    const p = await play({ ...S, mallet: BAR_BRIDGE.mallet }, [...hard, ...palm], 5)
    expect(p.faults).toBe(0)
    expect(p.pressure.every(Number.isFinite)).toBe(true)
    expect(largest(p.pressure)).toBeLessThan(CEILING)
    expect(p.worstIterations).toBeLessThanOrEqual(10)
    expect(p.energy.total.at(-1)! - p.energy.striker.at(-1)!).toBeLessThan(0.01 * Math.max(...p.energy.total))
    // What the stiffening spring is counted as adding, over all its landings, is a thousandth of what the playing put in.
    expect(Math.abs(p.injected.at(-1)!)).toBeLessThan(1e-3 * Math.max(...p.energy.total))
  }, 400000)

  test('switched on in one sample instead of landing, the same finger is rougher: the landing is there for a reason', async () => {
    const open = await play(S, [strikeAt(0, 2)], 0.3)
    const [landed, slapped] = [await play(S, [strikeAt(0, 2), barTouchAt(0.05, BAR_TOUCH.palm)], 0.3), await play(S, [strikeAt(0, 2), barSlapAt(0.05, BAR_TOUCH.palm)], 0.3)]
    expect(roughness(slapped.pressure, 0.05, 0.001)).toBeGreaterThan(roughness(landed.pressure, 0.05, 0.001))
    expect(dB10(roughness(landed.pressure, 0.05, 0.001) / roughness(open.pressure, 0.05, 0.001))).toBeLessThan(1)
    // Even so its books balance: the engine counts what an abrupt change of stiffness does.
    expect(balance(slapped, 0.04, 0.25)).toBeLessThan(1e-9)
  }, 400000)
})
