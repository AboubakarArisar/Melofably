// Phase 3D.7: the three-part prototype's mounting and playability. What a
// stroke's knock is, why the string hardly reaches the bar, and two
// candidates (SOFT_MOUNT and SOFT_MOUNT_BRIDGE in
// src/experimental/string/stringBarBody.ts). Isolated: nothing here is in
// the builder.
import { describe, expect, test } from 'vitest'
import { levels, pitchNear } from '../analysis/hybrid-study'
import { partial } from '../analysis/radiation'
import { approvedStringBody, BASE, cents, F0, fallTime, measure, sound, spectralPeaks, TUNED, variant, type Run } from '../analysis/three-body'
import { createWorklet } from '../analysis/worklet'
import { decayRate, DEFAULT_LOSS, impedance } from '../src/experimental/string/modalString'
import { modalMobility, plateModes } from '../src/experimental/string/soundboard'
import { barMass, barOnBoardModes, buildStringBarBody, LIGHT_MALLET, PROTOTYPE, RIGID_MODES, SMALL_BAR, SOFT_MOUNT, SOFT_MOUNT_BRIDGE, type StringBarBody } from '../src/experimental/string/stringBarBody'
import { BODY, pluckCall, radiation } from '../src/experimental/string/stringBody'
import type { Call } from '../src/experimental/wasm/engine'
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
const rigidOnly = (s: StringBarBody): StringBarBody => ({ ...s, bar: { ...s.bar, bendingModes: 0 } })
/** Kinetic energy of one of the bar's modes at its fastest, J: 0 up and down, 1 rocking, 2 the lowest bending mode. */
const modeEnergy = (run: Run, s: StringBarBody, n: number) => 0.5 * barMass(s.bar) * largest(run.barModes[n]) ** 2
/** The bar's lowest bending mode as it is on its pads, Hz. */
const noteOf = (run: Run) => spectralPeaks(run.barModes[RIGID_MODES], 0.05, 1.5, 1)[0][0]
const freeNote = (s: StringBarBody) => barOnBoardModes(s.bar, SR)[RIGID_MODES].frequency
const candidates = [['A, soft mount', SOFT_MOUNT], ['B, soft mount and bridge moved', SOFT_MOUNT_BRIDGE]] as const

describe('What the candidates are', () => {
  test('the earlier configurations are untouched, and the candidates differ from them only as stated', () => {
    expect(PROTOTYPE).toEqual({ tension: 73.5, length: 0.65, pluckAt: 0.8, stringOn: true, bar: SMALL_BAR, barAt: [0.5, 0.65], mount: { stiffness: 1e6, damping: 5 }, mallet: { mass: 0.02, stiffness: 1e8 } })
    expect(TUNED).toEqual({ ...PROTOTYPE, bar: { ...SMALL_BAR, length: 0.1987, supports: [0.215, 0.785] } })
    // A: softer, lightly damped pads close to the nodes; struck at the middle; 0.6 mm longer. The approved string, bridge and body.
    expect(SOFT_MOUNT).toEqual({ ...PROTOTYPE, bar: { ...SMALL_BAR, length: 0.1993, supports: [0.215, 0.785], strikeAt: 0.5 }, mount: { stiffness: 1e5, damping: 1 } })
    expect(SOFT_MOUNT.bridgeAt).toBeUndefined()
    // B: A with the bridge off the approved body's nodal line.
    expect(SOFT_MOUNT_BRIDGE).toEqual({ ...SOFT_MOUNT, bridgeAt: [0.08, 0.44] })
    expect(BODY.bridgeAt).toEqual([0.08, 1 / 3]) // the approved body's own bridge is where it was
    expect(LIGHT_MALLET).toEqual({ mallet: { mass: 0.005, stiffness: 1e8 }, stroke: 1 })
    // A bar that cannot bend is a measuring device: the two rigid-body modes alone, the same mass.
    const lump = barOnBoardModes({ ...SMALL_BAR, bendingModes: 0 }, SR)
    expect(lump.length).toBe(RIGID_MODES)
    expect(lump.every((mode) => mode.frequency === 0 && mode.mass === barMass(SMALL_BAR))).toBe(true)
    expect(barOnBoardModes(SMALL_BAR, SR).length).toBe(RIGID_MODES + 8)
  })

  test('with its pads taken away candidate A is the approved string instrument, sample for sample; B is not, because its bridge is elsewhere', async () => {
    const [a, b, approved] = [await measure({ ...SOFT_MOUNT, mount: null }, 'pluck', 1.5), await measure({ ...SOFT_MOUNT_BRIDGE, mount: null }, 'pluck', 1.5), await approvedStringBody(1.5)]
    expect(Array.from(a.pressure)).toEqual(Array.from(approved.pressure))
    expect(a.peak.bar).toBe(0)
    expect(b.peak.bar).toBe(0)
    expect(largest(b.pressure)).toBeGreaterThan(1.2 * largest(approved.pressure)) // a louder body, and a different one
  }, 400000)
})

describe('The stroke: what the mounting does', () => {
  test('a stroke\'s knock is the mallet\'s push reaching the board: a bar that cannot bend knocks as hard', async () => {
    for (const [name, s] of [['prototype', BASE], ['tuned', TUNED], ['A', SOFT_MOUNT]] as const) {
      const [full, lump] = [await measure(s, 'strike', 2), await measure(rigidOnly(s), 'strike', 2)]
      const [l, ll] = [levels(full.pressure), levels(lump.pressure)]
      // Measured LAFmax, whole stroke / lump alone: 87.9 / 92.4, 93.9 / 91.7, 86.2 / 87.8 dB.
      expect(ll.lafMax_dB, name).toBeGreaterThan(l.lafMax_dB - 3)
      expect(ll.peakPa).toBeGreaterThan(0.9 * l.peakPa)
      // The mallet (20 g at 1.5 m/s) hands over 0.034 to 0.045 N s whatever the bar does.
      const impulse = 0.02 * (1.5 + Math.sqrt((2 * full.energy.mallet.at(-1)!) / 0.02))
      expect(impulse).toBeGreaterThan(0.03)
      expect(impulse).toBeLessThan(0.05)
    }
  }, 400000)

  test('stiff pads near its ends make the bar a supported beam: its lowest bending mode falls from 654 to 419 Hz, and that is the thump', async () => {
    const run = await measure(BASE, 'strike', 2)
    const note = noteOf(run)
    expect(freeNote(BASE)).toBeGreaterThan(650)
    expect(note).toBeGreaterThan(405)
    expect(note).toBeLessThan(435)
    // The strongest thing in the stroke's sound is at that frequency, and the bar's up-and-down motion moves at it too.
    expect(Math.abs(spectralPeaks(run.pressure, 0, 0.3, 1)[0][0] - note)).toBeLessThan(5)
    expect(Math.abs(spectralPeaks(run.barModes[0], 0, 0.3, 1)[0][0] - note)).toBeLessThan(5)
    // It is gone in a third of a second: the pads and the board take it.
    expect(fallTime(run.barModes[RIGID_MODES])!).toBeLessThan(0.45)
  }, 400000)

  test('where the pads are: at the nodes the bar keeps its note; a little off, the note is lower and reaches the board', async () => {
    const pads = async (a: number) => {
      const s = variant({ ...TUNED, bar: { ...TUNED.bar, supports: [a, 1 - a], strikeAt: 0.5 } })
      const run = await measure(s, 'strike', 2)
      const note = noteOf(run)
      return { cents: cents(note, freeNote(s)), heard: partial(run.pressure, note, 14400) }
    }
    const [node, near, off] = [await pads(0.224), await pads(0.215), await pads(0.2)]
    // Measured: 0, -8 and -36 cents from the free bar's note; 2, 17 and 5 mPa in the sound from 0.3 s on.
    expect(Math.abs(node.cents)).toBeLessThan(2)
    expect(near.cents).toBeLessThan(-4)
    expect(near.cents).toBeGreaterThan(-12)
    expect(off.cents).toBeLessThan(-25)
    expect(near.heard).toBeGreaterThan(3 * node.heard)
    expect(near.heard).toBeGreaterThan(2 * off.heard)
  }, 400000)

  test('struck at its middle the bar does not rock, and its second bending mode stays silent', async () => {
    const [middle, aside] = [await measure(SOFT_MOUNT, 'strike', 1), await measure(variant({ ...SOFT_MOUNT, bar: { ...SOFT_MOUNT.bar, strikeAt: 0.35 } }), 'strike', 1)]
    expect(modeEnergy(middle, SOFT_MOUNT, 1)).toBeLessThan(1e-4 * modeEnergy(middle, SOFT_MOUNT, 0))
    expect(modeEnergy(middle, SOFT_MOUNT, 3)).toBeLessThan(1e-4 * modeEnergy(middle, SOFT_MOUNT, 2))
    expect(modeEnergy(aside, SOFT_MOUNT, 1)).toBeGreaterThan(0.05 * modeEnergy(aside, SOFT_MOUNT, 0))
    // And its lowest bending mode gets more: twice the energy of a stroke at 0.35.
    expect(modeEnergy(middle, SOFT_MOUNT, 2)).toBeGreaterThan(1.5 * modeEnergy(aside, SOFT_MOUNT, 2))
  }, 400000)

  test('candidate A: the knock is 7 dB lower than the tuned prototype\'s, and the bar\'s note is stronger later and lasts as long as the bar lets it', async () => {
    const [was, now] = [await measure(TUNED, 'strike', 3), await measure(SOFT_MOUNT, 'strike', 3)]
    const [lw, ln] = [levels(was.pressure), levels(now.pressure)]
    expect(lw.lafMax_dB - ln.lafMax_dB).toBeGreaterThan(6) // measured 7.7
    expect(ln.peakPa).toBeLessThan(lw.peakPa)
    // The bar's note, on the string's 6th harmonic as it stands: within 2 cents.
    const note = noteOf(now)
    expect(Math.abs(cents(note, 6 * F0))).toBeLessThan(2)
    // In the sound from 0.3 s on: 26.6 mPa against 18.6 mPa.
    expect(partial(now.pressure, note, 14400)).toBeGreaterThan(0.02)
    expect(partial(now.pressure, note, 14400)).toBeGreaterThan(partial(was.pressure, noteOf(was), 14400))
    // Its motion falls 20 dB in 0.67 s (the bar's own material allows 0.71 s); on the stiff pads it was 0.32 s.
    expect(fallTime(now.barModes[RIGID_MODES])!).toBeGreaterThan(0.55)
    expect(fallTime(was.barModes[RIGID_MODES])!).toBeLessThan(0.45)
    expect(ln.fall20!).toBeGreaterThan(lw.fall20!)
  }, 400000)

  test('how hard it is struck is the larger part: a 5 g mallet at 1 m/s is 11 dB quieter, and then within 14 dB of a pluck', async () => {
    const [standard, gentle, pluck] = [await sound(SOFT_MOUNT, 'strike', 2), await sound({ ...SOFT_MOUNT, mallet: LIGHT_MALLET.mallet }, 'strike', 2, { stroke: LIGHT_MALLET.stroke }), await sound(SOFT_MOUNT, 'pluck', 2)]
    const [ls, lg, lp] = [levels(standard.pressure), levels(gentle.pressure), levels(pluck.pressure)]
    expect(ls.lafMax_dB - lg.lafMax_dB).toBeGreaterThan(9) // measured 11.3
    expect(lg.lafMax_dB - lp.lafMax_dB).toBeLessThan(16) // measured 13.8; it was 33.2 for the tuned prototype's standard stroke
    expect(lg.lafMax_dB - lp.lafMax_dB).toBeGreaterThan(10)
  }, 400000)
})

describe('The pluck: why the string hardly reaches the bar', () => {
  test('the string keeps its energy: about 1.3 % of a pluck ever enters the board, as the board\'s mobility under the bridge predicts', async () => {
    const run = await measure(TUNED, 'pluck', 4)
    const entered = run.bridgeWork.at(-1)! / run.peak.in
    expect(entered).toBeGreaterThan(0.009) // measured 0.0129
    expect(entered).toBeLessThan(0.018)
    // Predicted: each round trip the bridge takes 4 Z Re(Y) of a wave's energy, against the string's own losses.
    const Z = impedance({ length: 0.65, tension: 73.5, density: 0.0036 })
    const predict = (bridge: [number, number]) => {
      const modes = plateModes(BODY.plate, [bridge], SR, BODY.limit)
      let [num, den] = [0, 0]
      for (let n = 1; n <= 12; n++) {
        const [toBoard, own] = [F0 * 4 * Z * modalMobility(modes, 0, n * F0)[0], 2 * decayRate(DEFAULT_LOSS, n * F0)]
        const share = (Math.sin(n * Math.PI * 0.2) / n) ** 2
        num += (share * toBoard) / (toBoard + own)
        den += share
      }
      return num / den
    }
    expect(predict(BODY.bridgeAt)).toBeGreaterThan(0.012) // 2.0 %: the same size as measured
    expect(predict(BODY.bridgeAt)).toBeLessThan(0.03)
    expect(Z * modalMobility(plateModes(BODY.plate, [BODY.bridgeAt], SR, BODY.limit), 0, F0)[0]).toBeLessThan(1e-4) // the mismatch at the fundamental
    expect(predict([0.08, 0.44])).toBeGreaterThan(2 * predict(BODY.bridgeAt))
  }, 400000)

  test('and of what enters the board the bar takes a hundredth: its bending never holds a ten-thousandth of the pluck', async () => {
    const run = await measure(TUNED, 'pluck', 4)
    const [entered, toBar] = [run.bridgeWork.at(-1)!, run.supportWork.at(-1)!]
    expect(toBar / entered).toBeLessThan(0.03) // measured 0.011
    expect(toBar).toBeGreaterThan(0)
    expect(modeEnergy(run, TUNED, 2) / run.peak.in).toBeLessThan(1e-4) // measured 0.00005
    expect(modeEnergy(run, TUNED, 2)).toBeGreaterThan(1e-8) // J: but it does move
    // Energy crosses the pads both ways, nearly as much back as forth.
    expect(run.toBar).toBeGreaterThan(20 * toBar)
    expect(run.fromBar).toBeGreaterThan(0.9 * run.toBar)
  }, 400000)

  test('moving the bridge off the nodal line lets more through: candidate B\'s string gives the board a third more, and takes far more from a stroke', async () => {
    const [a, b] = [await measure(SOFT_MOUNT, 'pluck', 4), await measure(SOFT_MOUNT_BRIDGE, 'pluck', 4)]
    // Net energy through the bridge: 0.101 mJ (A) and 0.133 mJ (B) of a 5.08 mJ pluck. More, but not much more.
    expect(b.bridgeWork.at(-1)!).toBeGreaterThan(1.2 * a.bridgeWork.at(-1)!)
    expect(b.bridgeWork.at(-1)! / b.peak.in).toBeLessThan(0.05)
    expect(modeEnergy(b, SOFT_MOUNT_BRIDGE, 2)).toBeGreaterThan(1.2 * modeEnergy(a, SOFT_MOUNT, 2))
    // Still a small thing: the bar's bending holds under a thousandth of the pluck.
    expect(modeEnergy(b, SOFT_MOUNT_BRIDGE, 2) / b.peak.in).toBeLessThan(1e-3)
    const [ka, kb] = [await measure(SOFT_MOUNT, 'strike', 2), await measure(SOFT_MOUNT_BRIDGE, 'strike', 2)]
    expect(kb.peak.string).toBeGreaterThan(4 * ka.peak.string) // measured 0.24 % against 0.031 % of what the mallet gave
  }, 400000)
})

describe('The candidates are still honest mechanics, and still a string', () => {
  test('with every loss removed, energy is kept to a part in a billion: plucked, struck and both', async () => {
    for (const [name, s] of candidates) {
      for (const playing of ['pluck', 'strike', 'both'] as const) {
        const run = await measure(s, playing, 2, { lossless: true })
        const { low, high } = span(run.energy.total, at(0.3))
        expect((high - low) / high, `${name}, ${playing}`).toBeLessThan(1e-9)
        expect(Math.abs(run.dissipated) / high).toBeLessThan(1e-9)
        expect(run.padLoss).toBe(0)
        expect(run.faults).toBe(0)
        expect(run.worstIterations).toBeLessThanOrEqual(4)
      }
    }
  }, 400000)

  test('with losses, what goes is what the engine counted, none appears, and the pads\' share is part of it', async () => {
    for (const [name, s] of candidates) {
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
      const run = await measure(s, 'strike', 2)
      expect(run.padLoss).toBeGreaterThan(0)
      expect(run.padLoss).toBeLessThan(run.dissipated)
    }
  }, 400000)

  test('energy goes both ways, and a removed joint passes nothing', async () => {
    for (const [name, s] of candidates) {
      const [pluck, strike] = [await measure(s, 'pluck', 2), await measure(s, 'strike', 2)]
      expect(pluck.peak.bar, name).toBeGreaterThan(1e-7)
      expect(strike.peak.string).toBeGreaterThan(1e-6)
      const noString = await measure({ ...s, stringOn: false }, 'strike', 1)
      expect(noString.peak.string).toBe(0)
      const noBar = await measure({ ...s, mount: null }, 'pluck', 1)
      expect(noBar.peak.bar).toBe(0)
      const apart = await measure({ ...s, stringOn: false, mount: null }, 'strike', 1)
      expect(apart.peak.board).toBe(0)
      expect(largest(apart.pressure)).toBe(0)
    }
  }, 400000)

  test('the string keeps its pitch and its fundamental', async () => {
    const approved = await approvedStringBody(3)
    for (const [name, s] of candidates) {
      const run = await measure(s, 'pluck', 3)
      expect(Math.abs(cents(pitchNear(run.stringVelocity, F0), F0)), name).toBeLessThan(1) // measured -0.48 (A) and -0.39 (B)
      const fundamental = 20 * Math.log10(partial(run.pressure, F0) / partial(approved.pressure, F0))
      expect(fundamental).toBeGreaterThan(-3.5) // measured -2.7 (A) and -0.6 (B)
      expect(fundamental).toBeLessThan(1)
      expect(partial(run.pressure, F0)).toBeGreaterThan(0.004) // Pa
    }
    // A's pluck is as loud as the approved instrument's to a tenth of a decibel; B's is 2.6 dB louder.
    const [a, b] = [await sound(SOFT_MOUNT, 'pluck', 3), await sound(SOFT_MOUNT_BRIDGE, 'pluck', 3)]
    expect(Math.abs(levels(a.pressure).lafMax_dB - levels(approved.pressure).lafMax_dB)).toBeLessThan(0.5)
    expect(levels(b.pressure).lafMax_dB - levels(approved.pressure).lafMax_dB).toBeGreaterThan(1.5)
    expect(levels(b.pressure).lafMax_dB - levels(approved.pressure).lafMax_dB).toBeLessThan(4)
  }, 400000)

  test('the same playing gives the same samples', async () => {
    for (const [, s] of candidates) {
      const [x, y] = [await sound(s, 'both', 1), await sound(s, 'both', 1)]
      expect(Array.from(x.pressure)).toEqual(Array.from(y.pressure))
    }
  }, 400000)

  test('plucked hard and struck hard in turn for five seconds, with the heavy and the light mallet: no fault, bounded, and it dies away', async () => {
    for (const [name, s] of [...candidates, ['A, light mallet', { ...SOFT_MOUNT, mallet: LIGHT_MALLET.mallet }], ['A, softest pads tried', variant({ ...SOFT_MOUNT, mount: { stiffness: 1e4, damping: 1 } })]] as const) {
      const built = buildStringBarBody(s, SR)
      const r = radiation(SR)
      const worklet = await createWorklet([...built.calls, ['radiate', r.perSample, r.b0, r.b1, r.a1, 64]])
      const play: Call[] = [pluckCall(built, 8, 0), ['launch', built.mallet!, 5]]
      const out = worklet.render(5 * SR, (block) => block % 37 === 0 && worklet.send([play[(block / 37) % 2]]))
      const ringing = worklet.engine.energy() - worklet.engine.resonatorEnergy(built.malletHead!)
      worklet.render(3 * SR)
      expect(worklet.engine.faults(), name).toBe(0)
      expect(out.every(Number.isFinite)).toBe(true)
      expect(largest(out)).toBeGreaterThan(0.02)
      expect(largest(out)).toBeLessThan(1) // below 64 Pa
      expect(worklet.engine.energy() - worklet.engine.resonatorEnergy(built.malletHead!)).toBeLessThan(0.2 * ringing)
      expect(worklet.engine.worstIterations()).toBeLessThanOrEqual(10)
    }
  }, 400000)
})
