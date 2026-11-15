// Phase 3D.10: the bar-as-bridge instrument (architecture B, BAR_BRIDGE) in
// other voices: the bar on the string's 4th and 8th harmonics, the string
// tied a little further along the bar, and a lighter striker. Isolated:
// nothing here is in the builder. Numbers in comments are measurements
// (renders/bar-bridge/measurements.json); none says how anything sounds.
import { describe, expect, test } from 'vitest'
import { levels, pitchNear } from '../analysis/hybrid-study'
import { partial } from '../analysis/radiation'
import { approvedStringBody, cents, F0, measure, perform, pluckAt, retriggerAt, shareNear, spectralPeaks, strikeAt, touchAt, type Run } from '../analysis/three-body'
import { createWorklet } from '../analysis/worklet'
import { alongTheBridgeLine, BAR_BRIDGE, BAR_BRIDGE_440, BAR_BRIDGE_880, BAR_BRIDGE_FIRMER_TIE, barBridgeWith, barMass, buildStringBarBody, LIGHT_STRIKER, RIGID_MODES, STROKES, supportPoints, type StringBarBody } from '../src/experimental/string/stringBarBody'
import { BODY, pluckCall } from '../src/experimental/string/stringBody'
import { SR } from './helpers'

const largest = (x: ArrayLike<number>) => {
  let m = 0
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}
const dB = (a: number, b: number) => 20 * Math.log10(a / b)
const light = (s: StringBarBody): StringBarBody => ({ ...s, mallet: LIGHT_STRIKER })
const lump = (s: StringBarBody): StringBarBody => ({ ...s, bar: { ...s.bar, bendingModes: 0 } })
const bending = (run: Run, s: StringBarBody) => 0.5 * barMass(s.bar) * largest(run.barModes[RIGID_MODES]) ** 2
const noteNear = (run: Run, near: number) => spectralPeaks(run.barModes[RIGID_MODES], 0.05, 1.5, 1, near / 1.5, near * 1.5)[0][0]
const early = (x: Float32Array, f: number) => spectralPeaks(x, 0, 0.5, 1, 0.97 * f, 1.03 * f)[0]?.[1] ?? 0
const kept = [['440 Hz bar', BAR_BRIDGE_440], ['880 Hz bar', BAR_BRIDGE_880], ['firmer tie', BAR_BRIDGE_FIRMER_TIE]] as const

describe('What the kept configurations are', () => {
  test('each is architecture B with one thing changed; B itself and its mallet are as they were', () => {
    expect(barBridgeWith({})).toEqual(BAR_BRIDGE)
    expect(BAR_BRIDGE.bar.length).toBe(0.1994)
    expect(BAR_BRIDGE.stringOnBar).toEqual({ at: 0.2, stiffness: 1e6, damping: 0 })
    expect(BAR_BRIDGE.mallet).toEqual({ mass: 0.02, stiffness: 1e8 })
    // Other bars: the same thickness and material, a length for the note, a width that keeps the reference bar's 54 g.
    for (const [s, length, width] of [[BAR_BRIDGE_440, 0.2437, 16.4], [BAR_BRIDGE_880, 0.1728, 23.2]] as const) {
      expect(s).toEqual({ ...BAR_BRIDGE, bar: { ...BAR_BRIDGE.bar, length, width }, padsAt: alongTheBridgeLine({ ...BAR_BRIDGE.bar, length, width }) })
      expect(Math.abs(barMass(s.bar) / barMass(BAR_BRIDGE.bar) - 1)).toBeLessThan(0.01)
      // Still along the nodal line, first pad on the approved bridge's point, and on the board.
      expect(supportPoints(s)[0]).toEqual([BODY.bridgeAt[0], BODY.bridgeAt[1]])
      expect(supportPoints(s)[1][1]).toBe(BODY.bridgeAt[1])
      expect(supportPoints(s)[1][0]).toBeLessThan(0.5)
    }
    expect(BAR_BRIDGE_FIRMER_TIE).toEqual({ ...BAR_BRIDGE, stringOnBar: { ...BAR_BRIDGE.stringOnBar!, at: 0.18 } })
    expect(LIGHT_STRIKER).toEqual({ mass: 0.005, stiffness: 1e8 }) // 5 g, the mallet's own hardness
    expect(STROKES).toEqual({ gentle: 0.5, medium: 1, strong: 2 }) // m/s
  })
})

describe('The bar on other harmonics', () => {
  test('whichever bar it stands on, the string keeps its pitch within a cent and its fundamental within 1.5 dB', async () => {
    const approved = await approvedStringBody(4)
    for (const [name, s] of kept) {
      const run = await measure(s, 'pluck', 4)
      expect(Math.abs(cents(pitchNear(run.stringVelocity, F0), F0)), name).toBeLessThan(1) // -0.73, -0.73, -0.77
      expect(Math.abs(dB(partial(run.pressure, F0), partial(approved.pressure, F0))), name).toBeLessThan(1.5)
      expect(levels(run.pressure).fall20!, name).toBeGreaterThan(0.75)
      expect(run.energy.string[Math.round(SR / 128)] / run.peak.string, name).toBeGreaterThan(0.008)
      expect(run.faults).toBe(0)
      expect(run.worstIterations).toBeLessThanOrEqual(2)
    }
  }, 400000)

  test('the 440 Hz bar: struck it rings at the 4th harmonic; plucked, that harmonic is over 10 dB up, and the pluck is quieter than on the reference bar', async () => {
    const [pluck, strike, ref, approved] = [await measure(BAR_BRIDGE_440, 'pluck', 4), await measure(BAR_BRIDGE_440, 'strike', 4), await measure(BAR_BRIDGE, 'pluck', 4), await approvedStringBody(4)]
    expect(Math.abs(cents(noteNear(strike, 4 * F0), 4 * F0))).toBeLessThan(5) // +2.1
    expect(dB(partial(pluck.pressure, 4 * F0), partial(approved.pressure, 4 * F0))).toBeGreaterThan(10) // +15.9
    expect(partial(pluck.pressure, 4 * F0)).toBeLessThan(partial(pluck.pressure, F0)) // 2.4 mPa beside a 6.1 mPa fundamental
    // Most of that rise is there with a bar that cannot bend (+10 dB): it is the longer bar on its pads, not the bar's note.
    const dead = await measure(lump(BAR_BRIDGE_440), 'pluck', 4)
    expect(dB(partial(dead.pressure, 4 * F0), partial(approved.pressure, 4 * F0))).toBeGreaterThan(7)
    // The 660 Hz presence of the reference bar is gone, and with it 8 dB of the meter's reading.
    expect(early(pluck.pressure, 6 * F0)).toBeLessThan(0.7 * early(ref.pressure, 6 * F0))
    expect(levels(ref.pressure).lafMax_dB - levels(pluck.pressure).lafMax_dB).toBeGreaterThan(6)
    expect(bending(pluck, BAR_BRIDGE_440) / pluck.peak.in).toBeGreaterThan(1.5e-3) // 0.29 % of the pluck
  }, 400000)

  test('the 880 Hz bar, 8 cents flat: the 8th harmonic is 3 dB or more up and little else moves; exactly on the harmonic it would take it away', async () => {
    const [pluck, strike, approved] = [await measure(BAR_BRIDGE_880, 'pluck', 4), await measure(BAR_BRIDGE_880, 'strike', 4), await approvedStringBody(4)]
    const note = cents(noteNear(strike, 8 * F0), 8 * F0)
    expect(note).toBeLessThan(-4) // -8.7
    expect(note).toBeGreaterThan(-14)
    const eighth = (x: Float32Array) => dB(partial(x, 8 * F0), partial(approved.pressure, 8 * F0))
    expect(eighth(pluck.pressure)).toBeGreaterThan(3) // +5.2
    expect(Math.abs(levels(pluck.pressure).lafMax_dB - levels(approved.pressure).lafMax_dB)).toBeLessThan(1.5) // +0.2
    const exact = await measure(barBridgeWith({ length: 0.1724, width: 23.2 }), 'pluck', 4)
    expect(eighth(exact.pressure)).toBeLessThan(eighth(pluck.pressure) - 4) // -1.2
  }, 400000)

  test('a bar exactly on the 6th harmonic absorbs it (-11 dB); the reference bar, 14 cents flat of that, adds to it (+5 dB)', async () => {
    const [exact, ref, approved] = [await measure(barBridgeWith({ length: 0.1986 }), 'pluck', 4), await measure(BAR_BRIDGE, 'pluck', 4), await approvedStringBody(4)]
    const sixth = (x: Float32Array) => dB(partial(x, 6 * F0), partial(approved.pressure, 6 * F0))
    expect(sixth(exact.pressure)).toBeLessThan(-6)
    expect(sixth(ref.pressure)).toBeGreaterThan(3)
    // The attack is there either way: in the first half second 660 Hz is the strongest thing in both.
    expect(early(exact.pressure, 6 * F0)).toBeGreaterThan(0.02)
  }, 400000)
})

describe('Where the string is tied', () => {
  test('from 0.224 to 0.18 of the bar the exchange grows steadily and the string stays itself; the firmer tie is the far end of that range', async () => {
    const approved = await approvedStringBody(4)
    let [was, share] = [0, 0]
    for (const at of [0.224, 0.2, 0.18]) {
      const s = barBridgeWith({}, at)
      const [p, k] = [await measure(s, 'pluck', 4), await measure(s, 'strike', 2)]
      expect(bending(p, s) / p.peak.in, `tied at ${at}`).toBeGreaterThan(1.5 * was) // 0.023 %, 0.098 %, 0.18 % of the pluck
      expect(k.peak.string / k.malletGave).toBeGreaterThan(1.3 * share) // 0.97 %, 3.9 %, 6.8 % of the stroke
      ;[was, share] = [bending(p, s) / p.peak.in, k.peak.string / k.malletGave]
      expect(Math.abs(cents(pitchNear(p.stringVelocity, F0), F0))).toBeLessThan(1)
      expect(Math.abs(dB(partial(p.pressure, F0), partial(approved.pressure, F0)))).toBeLessThan(1.5)
      const loud = levels(p.pressure).lafMax_dB - levels(approved.pressure).lafMax_dB
      expect(loud).toBeGreaterThan(4.5) // 5.2, 6.2, 6.4 dB
      expect(loud).toBeLessThan(7.5)
    }
    // Further along it stops being the same instrument: at 0.1 the fundamental is 4 dB down and the pitch over a cent flat.
    const far = await measure(barBridgeWith({}, 0.1), 'pluck', 4)
    expect(dB(partial(far.pressure, F0), partial(approved.pressure, F0))).toBeLessThan(-3)
    expect(cents(pitchNear(far.stringVelocity, F0), F0)).toBeLessThan(-1)
  }, 400000)
})

describe('Striking', () => {
  test('the light striker: three strokes 6 to 7 dB apart, the medium one 15 dB above a 2 N pluck where the 20 g mallet was 23, and nothing scaled', async () => {
    const pluck = levels((await measure(BAR_BRIDGE, 'pluck', 4)).pressure).lafMax_dB
    const runs: Run[] = []
    for (const v of Object.values(STROKES)) runs.push(await measure(light(BAR_BRIDGE), 'strike', 4, { stroke: v }))
    const laf = runs.map((k) => levels(k.pressure).lafMax_dB) // 75.9, 82.5, 89.0
    for (const step of [laf[1] - laf[0], laf[2] - laf[1]]) {
      expect(step).toBeGreaterThan(5.5)
      expect(step).toBeLessThan(7.5)
    }
    expect(laf[1] - pluck).toBeLessThan(17) // 15.2
    expect(laf[0] - pluck).toBeLessThan(10) // 8.6: a gentle stroke is level with a 5 N pluck
    const heavy = await measure(BAR_BRIDGE, 'strike', 4)
    expect(levels(heavy.pressure).lafMax_dB - pluck).toBeGreaterThan(22)
    // The contact is a real collision: shorter and stiffer the harder it is struck, and it cannot give more than it had.
    expect(runs[2].contactSeconds).toBeLessThan(runs[0].contactSeconds) // 0.29 ms, 0.21 ms
    expect(runs[2].contactForcePeak / runs[0].contactForcePeak).toBeGreaterThan(4.5) // 26.6 N, 136 N: more than the speed's 4 times
    runs.forEach((k, i) => {
      const v = Object.values(STROKES)[i]
      expect(k.malletGave).toBeLessThan(0.5 * LIGHT_STRIKER.mass * v * v)
      expect(k.malletGave).toBeGreaterThan(0.5 * 0.5 * LIGHT_STRIKER.mass * v * v)
      expect(k.faults).toBe(0)
    })
  }, 400000)

  test('with the light striker the bar\'s note, not the knock, is most of the stroke; with the 20 g mallet the knock alone is as loud as the whole', async () => {
    const [k, knock, heavy, heavyKnock] = [await measure(light(BAR_BRIDGE), 'strike', 4, { stroke: 1 }), await measure(lump(light(BAR_BRIDGE)), 'strike', 4, { stroke: 1 }), await measure(BAR_BRIDGE, 'strike', 4), await measure(lump(BAR_BRIDGE), 'strike', 4)]
    expect(levels(k.pressure).lafMax_dB - levels(knock.pressure).lafMax_dB).toBeGreaterThan(4) // 82.5 against 77.0
    expect(Math.abs(levels(heavy.pressure).lafMax_dB - levels(heavyKnock.pressure).lafMax_dB)).toBeLessThan(1) // 90.6 against 90.4
    const note = noteNear(k, 6 * F0)
    expect(shareNear(k.pressure, [note], 1.01)).toBeGreaterThan(0.35) // 41 % of the sound's energy; 30 % with the 20 g mallet
    expect(shareNear(k.pressure, [note], 1.01)).toBeGreaterThan(shareNear(heavy.pressure, [noteNear(heavy, 6 * F0)], 1.01))
    // And the string takes a larger part of what the striker gave: 7.0 % against 3.9 %.
    expect(k.peak.string / k.malletGave).toBeGreaterThan(1.5 * (heavy.peak.string / heavy.malletGave))
  }, 400000)
})

describe('Playing it', () => {
  test('a pluck is linear: four times the force is 12.04 dB and the same share for the bar; where it is plucked decides whether the bar is heard', async () => {
    const [soft, hard] = [await measure(BAR_BRIDGE, 'pluck', 2, { pluck: 0.5 }), await measure(BAR_BRIDGE, 'pluck', 2, { pluck: 2 })]
    expect(dB(largest(hard.pressure), largest(soft.pressure))).toBeCloseTo(12.04, 1)
    expect(bending(hard, BAR_BRIDGE) / hard.peak.in).toBeCloseTo(bending(soft, BAR_BRIDGE) / soft.peak.in, 6)
    // Plucked at the middle the string has no 6th harmonic to give; at three quarters it has the most.
    const [middle, quarter] = [await measure({ ...BAR_BRIDGE, pluckAt: 0.5 }, 'pluck', 2), await measure({ ...BAR_BRIDGE, pluckAt: 0.75 }, 'pluck', 2)]
    expect(early(quarter.pressure, 6 * F0)).toBeGreaterThan(20 * early(middle.pressure, 6 * F0)) // 56 mPa against 0.8
    expect(bending(quarter, BAR_BRIDGE) / quarter.peak.in).toBeGreaterThan(20 * (bending(middle, BAR_BRIDGE) / middle.peak.in))
  }, 400000)

  test('phrases on every kept configuration with the light striker: no fault, no click, energy that dies away, the same every time', async () => {
    for (const [name, s] of [['reference B', BAR_BRIDGE], ...kept] as const) {
      const L = light(s)
      const phrase = [pluckAt(0), strikeAt(0.75, STROKES.medium), pluckAt(1.5), strikeAt(2.25, STROKES.gentle), pluckAt(3, 4), strikeAt(3.75, STROKES.strong), pluckAt(4.5), strikeAt(4.5, STROKES.medium), retriggerAt(5, L), touchAt(5.5, L, true)]
      const [a, b] = [await perform(L, phrase, 8), await perform(L, phrase, 8)]
      expect(a.faults, name).toBe(0)
      expect(a.clipped).toBe(false)
      expect(a.pressure.every(Number.isFinite)).toBe(true)
      expect(a.worstIterations).toBeLessThanOrEqual(6)
      expect(a.largestStepOverPeak).toBeLessThan(0.5)
      expect(a.energy.at(-1)!).toBeLessThan(1e-4 * Math.max(...a.energy))
      expect(Array.from(b.pressure)).toEqual(Array.from(a.pressure))
    }
  }, 400000)

  test('played as hard as allowed for three seconds, each kept configuration stays bounded and faultless', async () => {
    const hard = Array.from({ length: 30 }, (_, i) => (i % 2 ? strikeAt(i * 0.1, 5) : pluckAt(i * 0.1, 8)))
    for (const [name, s] of kept) {
      const a = await perform(s, hard, 6)
      expect(a.faults, name).toBe(0)
      expect(a.clipped).toBe(false)
      expect(a.worstIterations).toBeLessThanOrEqual(10)
      expect(a.energy.at(-1)!).toBeLessThan(0.02 * Math.max(...a.energy))
    }
  }, 400000)
})

describe('The physics of the kept configurations', () => {
  test('with every loss removed each keeps its energy to a part in a billion; with losses, energy never rises and every joule that goes was counted', async () => {
    for (const [name, s] of kept) {
      const L = light(s)
      const run = await measure(L, 'both', 2, { lossless: true })
      let [low, high] = [Infinity, -Infinity]
      for (let i = Math.round((0.3 * SR) / 128); i < run.energy.total.length; i++) [low, high] = [Math.min(low, run.energy.total[i]), Math.max(high, run.energy.total[i])]
      expect((high - low) / high, name).toBeLessThan(1e-9)
      expect(Math.abs(run.dissipated) / high).toBeLessThan(1e-9)
      expect(run.faults).toBe(0)
      const built = buildStringBarBody(L, SR)
      const worklet = await createWorklet(built.calls)
      worklet.send([pluckCall(built, 2), ['launch', built.mallet!, STROKES.strong]])
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
  }, 400000)

  test('energy goes both ways through the tie, and a joint taken away leaves what is behind it with nothing', async () => {
    for (const [name, s] of kept) {
      const [p, k] = [await measure(s, 'pluck', 2), await measure(light(s), 'strike', 2, { stroke: 1 })]
      expect(p.toBoard, name).toBeGreaterThan(1e-4) // the string works on the bar: joules
      expect(p.fromBoard).toBeGreaterThan(1e-4) // and the bar on the string
      expect(p.peak.bar).toBeGreaterThan(0)
      expect(k.peak.string / k.malletGave).toBeGreaterThan(0.02) // the struck bar moves the string
      const cut = { ...s, stringOn: false }
      expect((await measure(cut, 'pluck', 1)).peak.bar).toBe(0)
      expect((await measure(light(cut), 'strike', 1, { stroke: 1 })).peak.string).toBe(0)
      const floating = await measure({ ...s, mount: null }, 'pluck', 1)
      expect(largest(floating.pressure)).toBe(0)
    }
  }, 400000)
})
