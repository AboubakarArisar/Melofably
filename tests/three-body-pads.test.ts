// Phase 3D.8: a more realistic pad under the bar. A standard linear solid
// (a spring that always acts, and beside it a spring to a small lump of the
// pad that a damper ties to the board), made of the engine's own springs,
// dampers and masses (Mount.relaxing in
// src/experimental/string/stringBarBody.ts). Isolated: nothing here is in
// the builder.
import { describe, expect, test } from 'vitest'
import { levels, pitchNear } from '../analysis/hybrid-study'
import { partial } from '../analysis/radiation'
import { approvedStringBody, cents, F0, fallTime, lossless, measure, perform, pluckAt, shareNear, sound, spectralPeaks, strikeAt, touchAt, TUNED, variant, type Run } from '../analysis/three-body'
import { createWorklet } from '../analysis/worklet'
import { barMass, buildStringBarBody, LIGHT_MALLET, MEDIUM_MOUNT, padStiffness, relaxationTime, RIGID_MODES, SOFT_MOUNT, VISCO_MOUNT, type Mount, type StringBarBody } from '../src/experimental/string/stringBarBody'
import { pluckCall } from '../src/experimental/string/stringBody'
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
const lump = (s: StringBarBody): StringBarBody => ({ ...s, bar: { ...s.bar, bendingModes: 0 } })
const noteOf = (run: Run) => spectralPeaks(run.barModes[RIGID_MODES], 0.05, 1.5, 1)[0][0]
const modeEnergy = (run: Run, s: StringBarBody, n: number) => 0.5 * barMass(s.bar) * largest(run.barModes[n]) ** 2
const lossFactor = (m: Mount, f: number) => padStiffness(m, f)[1] / padStiffness(m, f)[0]

describe('The pad model', () => {
  test('what it is: parts, units, and nothing changed in the pads that came before', () => {
    // Candidate C: 2e4 N/m always; beside it 2e5 N/m to a lump of 0.2 g, and 530 N s/m from the lump to the board.
    expect(VISCO_MOUNT.mount).toEqual({ stiffness: 2e4, damping: 0.5, relaxing: { stiffness: 2e5, damping: 530, mass: 0.0002 } })
    expect(VISCO_MOUNT).toEqual({ ...SOFT_MOUNT, bar: { ...SOFT_MOUNT.bar, length: 0.1994 }, mount: VISCO_MOUNT.mount })
    expect(MEDIUM_MOUNT).toEqual({ ...VISCO_MOUNT, mount: { stiffness: 2.2e5, damping: 3.4 } })
    expect(VISCO_MOUNT.bridgeAt).toBeUndefined() // the approved bridge
    expect(relaxationTime(VISCO_MOUNT.mount!)).toBeCloseTo(0.00265, 6) // s: damper over spring
    expect(relaxationTime(SOFT_MOUNT.mount!)).toBe(0)
    // The earlier pads, built as before: no lump, no extra connection.
    for (const s of [TUNED, SOFT_MOUNT]) {
      const b = buildStringBarBody(s, SR)
      expect(b.padLumps).toBeUndefined()
      expect(b.calls.filter((call) => call[0] === 'addResonator').length).toBe(6)
      expect(b.calls.filter((call) => call[0] === 'addSpring' || call[0] === 'addContact').length).toBe(7)
    }
    // C: two lumps (one resonator each, one mode, the pad's mass), and per pad a spring to the lump and a damper to the board.
    const c = buildStringBarBody(VISCO_MOUNT, SR)
    expect(c.calls.filter((call) => call[0] === 'addResonator').length).toBe(8)
    expect(c.calls.filter((call) => call[0] === 'addSpring' || call[0] === 'addContact').length).toBe(11)
    for (const l of c.padLumps!) expect(c.calls.find((call) => call[0] === 'setMode' && call[1] === l)).toEqual(['setMode', l, 0, 0, Infinity, 0.0002])
    const springs = c.calls.filter((call) => call[0] === 'addSpring')
    for (const [spring, damper] of c.padPaths!) {
      expect(springs[spring].slice(5, 7)).toEqual([2e5, 0]) // a spring only: N/m
      expect(springs[damper].slice(5, 7)).toEqual([0, 530]) // a damper only: N s/m
      expect(springs[spring][1]).toBe(c.bar)
      expect(springs[damper][3]).toBe(c.board)
    }
    // The engine's outputs are still the body's two, and only those.
    expect(c.calls.filter((call) => call[0] === 'addOutput').length).toBe(2)
  })

  test('soft when moved slowly, stiff when moved fast, and lossiest in between: where a plain pad only gets lossier with frequency', () => {
    const [visco, plain] = [VISCO_MOUNT.mount!, MEDIUM_MOUNT.mount!]
    // Stiffness, N/m: 2e4 at rest, rising to 2.2e5.
    expect(padStiffness(visco, 0.01)[0]).toBeCloseTo(2e4, 0)
    expect(padStiffness(visco, 20000)[0]).toBeGreaterThan(2.19e5)
    expect(padStiffness(visco, 660)[0]).toBeGreaterThan(2.17e5)
    expect(padStiffness(visco, 660)[0]).toBeLessThan(2.2e5)
    expect(padStiffness(plain, 5)[0]).toBe(2.2e5)
    expect(padStiffness(plain, 5000)[0]).toBe(2.2e5)
    // Loss factor: 0.32 at 168 Hz, 0.09 at the bar's note: more for the bouncing than for the ringing.
    expect(lossFactor(visco, 168)).toBeGreaterThan(0.3)
    expect(lossFactor(visco, 660)).toBeLessThan(0.1)
    expect(lossFactor(visco, 168)).toBeGreaterThan(3 * lossFactor(visco, 660))
    // The plain pad: 0.016 at 168 Hz and 0.064 at the note: the other way round.
    expect(lossFactor(plain, 660)).toBeGreaterThan(3.5 * lossFactor(plain, 168))
    // Passive whatever the frequency: it never pushes back with less than nothing, and never gives energy.
    for (const f of [0.1, 1, 10, 60, 168, 660, 5000, 20000]) for (const m of [visco, plain, TUNED.mount!, SOFT_MOUNT.mount!]) {
      expect(padStiffness(m, f)[0]).toBeGreaterThan(0)
      expect(padStiffness(m, f)[1]).toBeGreaterThanOrEqual(0)
    }
  })

  test('the pads\' own energy is counted: with every loss removed the whole is conserved, the lumps and the paths\' springs included', async () => {
    for (const playing of ['pluck', 'strike', 'both'] as const) {
      const run = await measure(VISCO_MOUNT, playing, 2, { lossless: true })
      const { low, high } = span(run.energy.total, at(0.3))
      expect((high - low) / high, playing).toBeLessThan(1e-9)
      expect(Math.abs(run.dissipated) / high).toBeLessThan(1e-9)
      expect(run.padLoss).toBe(0)
      expect(run.faults).toBe(0)
      // The pads really hold some of it: left out, the total would not be constant.
      if (playing !== 'pluck') expect(run.padStoredPeak / high).toBeGreaterThan(0.01)
    }
    // The lossless helper leaves the path's spring and lump in place and removes only its damper.
    const calls = lossless(buildStringBarBody(VISCO_MOUNT, SR).calls)
    expect(calls.filter((call) => call[0] === 'addSpring').every((call) => call[6] === 0)).toBe(true)
    expect(calls.filter((call) => call[0] === 'addSpring' && call[5] === 2e5).length).toBe(2)
  }, 400000)

  test('with losses every joule that goes is one a damper took: counted sample by sample, never rising, and the paths\' dampers take most of the pads\' share', async () => {
    const built = buildStringBarBody(VISCO_MOUNT, SR)
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
    expect(rises).toBe(0)
    expect(start - previous).toBeGreaterThan(0.0005)
    expect(Math.abs(start - previous - lost) / (start - previous)).toBeLessThan(1e-6)
    // Over a whole stroke: pads 34 % of what the mallet gave, 31 % in the paths' dampers; the bar's own material 24 %.
    const run = await measure(VISCO_MOUNT, 'strike', 4)
    expect(run.padLoss / run.malletGave).toBeGreaterThan(0.25)
    expect(run.padLoss / run.malletGave).toBeLessThan(0.45)
    expect(run.padPathLoss).toBeGreaterThan(0.8 * run.padLoss)
    expect(run.padPathLoss).toBeLessThan(run.padLoss)
    expect(run.barLoss).toBeGreaterThan(0.1 * run.malletGave)
    // Pads, bar and everything else add up to what the engine counted, which is what the mallet gave less what is left.
    expect(run.padLoss + run.barLoss).toBeLessThan(run.dissipated)
    expect(Math.abs(run.dissipated - run.malletGave) / run.malletGave).toBeLessThan(0.01)
  }, 400000)

  test('energy goes both ways through the new pads, and with the pads or the bridge taken away nothing passes', async () => {
    const [pluck, strike] = [await measure(VISCO_MOUNT, 'pluck', 2), await measure(VISCO_MOUNT, 'strike', 2)]
    expect(pluck.peak.bar).toBeGreaterThan(1e-7)
    expect(strike.peak.string).toBeGreaterThan(1e-6)
    expect(strike.fromBar).toBeGreaterThan(0.001) // J that crossed the pads into the board: measured 0.0033
    const noBar = await measure({ ...VISCO_MOUNT, mount: null }, 'pluck', 1.5)
    expect(noBar.peak.bar).toBe(0)
    expect(Array.from(noBar.pressure)).toEqual(Array.from((await approvedStringBody(1.5)).pressure)) // the approved instrument, sample for sample
    const noString = await measure({ ...VISCO_MOUNT, stringOn: false }, 'strike', 1)
    expect(noString.peak.string).toBe(0)
    const apart = await measure({ ...VISCO_MOUNT, stringOn: false, mount: null }, 'strike', 1)
    expect(largest(apart.pressure)).toBe(0)
  }, 400000)
})

describe('What the new pad does, against the two before it', () => {
  test('at equal note, it knocks a little less than a plain pad: about one decibel, not more', async () => {
    const [c, d] = [await measure(VISCO_MOUNT, 'strike', 4), await measure(MEDIUM_MOUNT, 'strike', 4)]
    const [knockC, knockD] = [levels((await measure(lump(VISCO_MOUNT), 'strike', 4)).pressure), levels((await measure(lump(MEDIUM_MOUNT), 'strike', 4)).pressure)]
    // The bar's note in the sound is the same within 3 dB (C is 2.6 dB the quieter) and rings as long (0.41 and 0.44 s).
    const [noteC, noteD] = [partial(c.pressure, noteOf(c), 14400), partial(d.pressure, noteOf(d), 14400)]
    expect(Math.abs(20 * Math.log10(noteC / noteD))).toBeLessThan(3.5)
    expect(Math.abs(fallTime(c.barModes[RIGID_MODES])! - fallTime(d.barModes[RIGID_MODES])!)).toBeLessThan(0.08)
    // The knock alone: 89.1 against 91.2 dB LAFmax, 84.6 against 87.2 dB in sound energy.
    expect(knockD.lafMax_dB - knockC.lafMax_dB).toBeGreaterThan(1)
    expect(knockD.lafMax_dB - knockC.lafMax_dB).toBeLessThan(4)
    expect(knockD.sel_dB - knockC.sel_dB).toBeGreaterThan(1.5)
    expect(knockD.sel_dB - knockC.sel_dB).toBeLessThan(4.5)
  }, 400000)

  test('it sits between the stiff pads and the soft ones: a stroke that is mostly the bar\'s note, a bar that still answers the string, a quieter knock than the stiff pads\'', async () => {
    const run = async (s: StringBarBody) => {
      const [strike, knock, pluck, dead] = [await measure(s, 'strike', 4), await measure(lump(s), 'strike', 4), await measure(s, 'pluck', 4), await measure(lump(s), 'pluck', 4)]
      const note = noteOf(strike)
      return { stroke: levels(strike.pressure).lafMax_dB, knock: levels(knock.pressure).lafMax_dB, share: shareNear(strike.pressure, [note], 1.01), note: partial(strike.pressure, note, 14400), ring: fallTime(strike.barModes[RIGID_MODES])!, cents: cents(note, 6 * F0), adds: 20 * Math.log10(partial(pluck.pressure, 6 * F0) / partial(dead.pressure, 6 * F0)), bending: modeEnergy(pluck, s, 2), third: partial(pluck.pressure, 3 * F0) }
    }
    const [a, b, c] = [await run(TUNED), await run(SOFT_MOUNT), await run(VISCO_MOUNT)]
    expect(Math.abs(c.cents)).toBeLessThan(2) // the bar's note is on the string's 6th harmonic
    // The stroke: 93.9, 86.2 and 89.8 dB. The knock alone: 91.7, 87.8 and 89.1 dB.
    expect(c.stroke).toBeLessThan(a.stroke - 3)
    expect(c.stroke).toBeGreaterThan(b.stroke + 2)
    expect(c.knock).toBeLessThan(a.knock - 1.5)
    // Most of the stroke's sound is the bar's note (61 %), as with the stiff pads (73 %) and unlike the soft ones (20 %).
    expect(c.share).toBeGreaterThan(0.5)
    expect(b.share).toBeLessThan(0.3)
    expect(a.share).toBeGreaterThan(0.65)
    // The note rings longer than on the stiff pads (0.41 against 0.32 s), shorter than on the soft ones (0.67 s).
    expect(c.ring).toBeGreaterThan(a.ring + 0.05)
    expect(c.ring).toBeLessThan(b.ring - 0.1)
    // And the bar answers a pluck: +4.3 dB at the 6th harmonic (stiff +3.8, soft +0.1), with four times the soft mount's bending.
    expect(c.adds).toBeGreaterThan(3)
    expect(b.adds).toBeLessThan(1)
    expect(c.bending).toBeGreaterThan(3 * b.bending)
    expect(c.bending).toBeLessThan(a.bending)
    // Without the soft mount's rise near 330 Hz: the pluck's 3rd harmonic is 8 dB lower than on the soft pads.
    expect(20 * Math.log10(b.third / c.third)).toBeGreaterThan(6)
  }, 400000)

  test('the string is still the string: pitch, fundamental, level and sustain as on the approved instrument', async () => {
    const [run, approved] = [await measure(VISCO_MOUNT, 'pluck', 4), await approvedStringBody(4)]
    expect(Math.abs(cents(pitchNear(run.stringVelocity, F0), F0))).toBeLessThan(1) // measured -0.48
    const fundamental = 20 * Math.log10(partial(run.pressure, F0) / partial(approved.pressure, F0))
    expect(fundamental).toBeGreaterThan(-3.5) // measured -2.6
    expect(fundamental).toBeLessThan(0)
    const [l, la] = [levels(run.pressure), levels(approved.pressure)]
    expect(Math.abs(l.lafMax_dB - la.lafMax_dB)).toBeLessThan(0.5)
    expect(Math.abs(l.fall20! - la.fall20!)).toBeLessThan(0.15)
    // The string's own energy a second after the pluck: what the bar-less instrument's string has, within a tenth.
    const bare = await measure({ ...VISCO_MOUNT, mount: null }, 'pluck', 2)
    const second = Math.round(SR / 128)
    expect(Math.abs(run.energy.string[second] / bare.energy.string[second] - 1)).toBeLessThan(0.1)
  }, 400000)

  test('the lump\'s mass and the slow stiffness are not narrow settings; the pads\' place is', async () => {
    const base = VISCO_MOUNT
    const relaxing = base.mount!.relaxing!
    const stroke = async (s: StringBarBody) => {
      const k = await measure(s, 'strike', 3)
      return { level: levels(k.pressure).lafMax_dB, note: partial(k.pressure, noteOf(k), 14400), iterations: k.worstIterations, faults: k.faults }
    }
    const c = await stroke(base)
    // The lump a quarter or five times as heavy: the same to a tenth of a decibel. It is there to carry a state, not to matter.
    for (const mass of [0.00005, 0.001]) {
      const x = await stroke({ ...base, mount: { ...base.mount!, relaxing: { ...relaxing, mass } } })
      expect(Math.abs(x.level - c.level)).toBeLessThan(0.3)
      expect(Math.abs(20 * Math.log10(x.note / c.note))).toBeLessThan(0.5)
      expect(x.faults).toBe(0)
    }
    // The slow stiffness a quarter or two and a half times: within 1.5 dB.
    for (const stiffness of [5e3, 5e4]) {
      const x = await stroke({ ...base, mount: { ...base.mount!, stiffness } })
      expect(Math.abs(x.level - c.level)).toBeLessThan(1.5)
      expect(x.iterations).toBeLessThanOrEqual(4)
    }
    // The pads' place still matters, as it does for any pad. With pads that take energy at the bar's note, a little
    // nearer the nodes the note is drained less and is stronger later (29.8 against 14.1 mPa from 0.3 s on).
    const [nearer, further] = [await stroke(variant({ ...base }, { ...base.bar, supports: [0.22, 0.78] })), await stroke(variant({ ...base }, { ...base.bar, supports: [0.21, 0.79] }))]
    expect(nearer.note).toBeGreaterThan(c.note)
    expect(Math.abs(20 * Math.log10(nearer.note / c.note))).toBeLessThan(9)
    // That is a millimetre of pad position for 3.2 dB of stroke and 6.5 dB of note: the pads' place is a sensitive setting.
    expect(Math.abs(nearer.level - c.level)).toBeLessThan(5)
    expect(Math.abs(nearer.level - c.level)).toBeGreaterThan(1)
    expect(further.faults + nearer.faults).toBe(0)
  }, 400000)
})

describe('Playing it', () => {
  test('repeated plucks, repeated strokes, the two in turn and together: no fault, no click, energy that settles and then dies away', async () => {
    const every = (seconds: number, step: number) => Array.from({ length: Math.floor(seconds / step) }, (_, i) => i * step)
    for (const [name, events] of [['plucks', every(3, 0.25).map((t) => pluckAt(t))], ['strokes', every(3, 0.25).map((t) => strikeAt(t))], ['in turn', every(3, 0.25).map((t, i) => (i % 2 ? strikeAt(t) : pluckAt(t)))], ['together', every(3, 0.5).flatMap((t) => [pluckAt(t), strikeAt(t)])]] as const) {
      const p = await perform(VISCO_MOUNT, [...events], 6)
      expect(p.faults, name).toBe(0)
      expect(p.clipped).toBe(false)
      expect(p.pressure.every(Number.isFinite)).toBe(true)
      expect(p.worstIterations).toBeLessThanOrEqual(6)
      // Bounded: what the instrument holds during the last second of playing is no more than twice the first second's most.
      const blocks = (from: number, to: number) => p.energy.slice(Math.round((from * SR) / 128), Math.round((to * SR) / 128))
      expect(Math.max(...blocks(2, 3))).toBeLessThan(2 * Math.max(...blocks(0, 1)))
      // And three seconds after the last event it has less than a hundredth of that.
      expect(p.energy.at(-1)!).toBeLessThan(0.01 * Math.max(...p.energy))
      // No step between two samples larger than a mallet's own onset makes (a click would be near the whole peak).
      expect(p.largestStepOverPeak).toBeLessThan(0.5)
    }
  }, 400000)

  test('a finger on the string mutes the string and leaves the bar\'s note; hard and gentle playing give more and less of the same', async () => {
    const [muted, open] = [await perform(VISCO_MOUNT, [pluckAt(0), touchAt(0.5, VISCO_MOUNT, true)], 1.5), await perform(VISCO_MOUNT, [pluckAt(0)], 1.5)]
    expect(muted.stringEnergy).toBeLessThan(0.01 * open.stringEnergy)
    expect(muted.faults).toBe(0)
    // Twice the pluck is twice the pressure (6.0 dB); a stroke four times as fast is 14 to 16 dB more (a Hertz contact stiffens).
    const [one, four] = [await perform(VISCO_MOUNT, [pluckAt(0, 1)], 1.5), await perform(VISCO_MOUNT, [pluckAt(0, 4)], 1.5)]
    expect(20 * Math.log10(largest(four.pressure) / largest(one.pressure))).toBeCloseTo(12.04, 1)
    const [slow, fast] = [await perform(VISCO_MOUNT, [strikeAt(0, 0.75)], 1.5), await perform(VISCO_MOUNT, [strikeAt(0, 3)], 1.5)]
    const more = 20 * Math.log10(largest(fast.pressure) / largest(slow.pressure))
    expect(more).toBeGreaterThan(11)
    expect(more).toBeLessThan(18)
    // The light stroke is a different excitation: 10 dB quieter, and then 19 dB above a pluck (29 dB for the standard stroke).
    const [standard, gentle, pluck] = [await sound(VISCO_MOUNT, 'strike', 2), await sound({ ...VISCO_MOUNT, mallet: LIGHT_MALLET.mallet }, 'strike', 2, { stroke: LIGHT_MALLET.stroke }), await sound(VISCO_MOUNT, 'pluck', 2)]
    expect(levels(standard.pressure).lafMax_dB - levels(gentle.pressure).lafMax_dB).toBeGreaterThan(9)
    expect(levels(gentle.pressure).lafMax_dB - levels(pluck.pressure).lafMax_dB).toBeLessThan(21)
  }, 400000)

  test('played as hard as allowed for three seconds, struck at three places: no fault, bounded, the same every time', async () => {
    const hard = Array.from({ length: 30 }, (_, i) => (i % 2 ? strikeAt(i * 0.1, 5) : pluckAt(i * 0.1, 8)))
    for (const strike of [0.2, 0.35, 0.5]) {
      const s = variant({ ...VISCO_MOUNT }, { ...VISCO_MOUNT.bar, strikeAt: strike })
      const [a, b] = [await perform(s, hard, 6), await perform(s, hard, 6)]
      expect(a.faults, `struck at ${strike}`).toBe(0)
      expect(a.clipped).toBe(false)
      expect(a.worstIterations).toBeLessThanOrEqual(10)
      expect(a.energy.at(-1)!).toBeLessThan(0.02 * Math.max(...a.energy))
      expect(Array.from(b.pressure)).toEqual(Array.from(a.pressure))
    }
  }, 400000)
})
