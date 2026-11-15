// Phase 3D.11: a finger on the bar of the bar-as-bridge instrument: what
// kind of contact, how it lands and leaves, where it is laid, what it does
// to the string, and how the instrument answers to being played with it.
//
//   npm run render:bar-damping
//
// Output: renders/bar-damping/
//   measurements.json   every study
//   performance.json    cost in Node, with block-by-block timings
//   manifest.json       every WAV: physical parameters, contact, timing,
//                       excitation, peak, levels, energies, decay, gains
//   common/*.wav        one gain for all: relative loudness
//   matched/*.wav       each scaled to the same A-weighted exposure: timbre
//
// Every sound is the approved body's radiated pressure in pascals. Nothing
// is filtered, compressed, faded or boosted: a sound stops because energy
// left the bar or the string through a damper. Numbers describe; they do
// not say whether a sound is good.
import { mkdirSync, writeFileSync } from 'node:fs'
import { BAR_BRIDGE, BAR_TOUCH, BAR_TOUCH_TIME, barBridgeWith, barMass, barReleaseCalls, barTouchCalls, buildStringBarBody, dampable, LIGHT_STRIKER, RIGID_MODES, STROKES, type BarTouch, type StringBarBody } from '../src/experimental/string/stringBarBody.ts'
import { barModeShape } from '../src/audio/engine/physics.ts'
import { buildPlayableStringBody, fingerDamping, pluckCall, radiation } from '../src/experimental/string/stringBody.ts'
import type { Call } from '../src/experimental/wasm/engine.ts'
import { barReleaseAt, barSlapAt, barTouchAt, bendingEnergy, blockAt, CEILING, fallFrom, modeEnergy, play, roughness, stepRatio, unaccounted, type Played } from './bar-damping.ts'
import { aWeighted, BANDS, bandShares, levels, pitchNear } from './hybrid-study.ts'
import { SR } from './lib.ts'
import { fsPath, path, writeWav } from './offline.ts'
import { partial } from './radiation.ts'
import { approvedStringBody, cents, F0, measure, PLUCK, pluckAt, retriggerAt, spectralPeaks, strikeAt, touchAt, type Event } from './three-body.ts'
import { createWorklet } from './worklet.ts'

const OUT = 'renders/bar-damping'
for (const dir of ['', '/common', '/matched']) mkdirSync(path(OUT + dir), { recursive: true })
const r = (x: number | null, digits = 3) => (x === null ? null : Number(x.toPrecision(digits)))
const d1 = (x: number | null) => (x === null ? null : Number(x.toFixed(1)))
const dB = (ratio: number) => Number((20 * Math.log10(ratio)).toFixed(1))
const dB10 = (ratio: number) => Number((10 * Math.log10(ratio)).toFixed(1))
const largest = (x: ArrayLike<number>, from = 0, to = x.length) => {
  let m = 0
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}
const at = (seconds: number) => Math.round(seconds * SR)
const m: Record<string, unknown> = {
  units: 'energies J (uJ, mJ as stated), pressures Pa or mPa, levels dB re 20 uPa (LAFmax: A-weighted, 125 ms), forces N',
  instrument: 'architecture B (BAR_BRIDGE): reference bar on the 6th harmonic, string tied at 0.2 unless stated, the 5 g striker',
  finger: { strengths_N_per_m_and_Ns_per_m: BAR_TOUCH, arrives_s: BAR_TOUCH_TIME.arrive, leaves_s: BAR_TOUCH_TIME.leave, note: 'a spring and a damper from one point of the bar to a hand that does not move; values are order-of-magnitude estimates for fingertip flesh' },
}
const MEDIUM = STROKES.medium
const S = dampable(0.5)
const books = (p: Played, from: number, to: number) => {
  const u = unaccounted(p, from, to)
  return { from_s: from, to_s: to, instrumentLost_uJ: r(1e6 * u.fell, 4), countedAsDissipated_uJ: r(1e6 * u.lost, 4), addedByTheFingersSpringStiffening_uJ: r(1e6 * u.added, 3), unaccounted_partOfWhatWasLost: Number((u.residual / u.fell).toExponential(1)), theFingerTook_uJ: r(1e6 * u.fingerTook, 4), theFingerTook_percentOfWhatWasLost: d1((100 * u.fingerTook) / u.fell) }
}
/** Level of the strongest component near f, Pa, in a window after `from` seconds. */
const near = (x: Float32Array, f: number, from: number, to = from + 0.5) => spectralPeaks(x, from, Math.min(to, x.length / SR), 1, 0.97 * f, 1.03 * f)[0]?.[1] ?? 0
const health = (p: Played) => ({ solverIterationsWorst: p.worstIterations, faults: p.faults })

// ---- 0. The finger never used: the Phase 3D.10 reference, sample for sample ------------------------------------------
{
  const ref: StringBarBody = { ...BAR_BRIDGE, mallet: LIGHT_STRIKER }
  const events = [pluckAt(0), strikeAt(0.5, MEDIUM), pluckAt(1), strikeAt(1, STROKES.strong)]
  const [a, b] = [await play(ref, events, 2), await play(S, events, 2)]
  let differ = 0
  for (let i = 0; i < a.pressure.length; i++) if (a.pressure[i] !== b.pressure[i]) differ++
  const [ba, bb] = [buildStringBarBody(ref, SR), buildStringBarBody(S, SR)]
  m['0 the finger never used'] = { samplesCompared: a.pressure.length, samplesThatDiffer: differ, whatIsAdded: `one port on the bar (its ${bb.barTouchPort! + 1}th) and one connection of no stiffness and no damping (the ${bb.barFinger! + 1}th); ${bb.calls.length - ba.calls.length} more engine calls`, energyAtTheEnd_J: [a.energy.total.at(-1), b.energy.total.at(-1)] }
}

// ---- 1. Three kinds of contact ---------------------------------------------------------------------------------------------
{
  const rows: Record<string, unknown> = {}
  const free = await play(S, [strikeAt(0, MEDIUM)], 1.2)
  const row = (p: Played, finger = true) => ({
    bendingEnergy_uJ: { justBefore: r(1e6 * bendingEnergy(p, S, 0.19)), '50 ms after': r(1e6 * bendingEnergy(p, S, 0.25)), '100 ms after': r(1e6 * bendingEnergy(p, S, 0.3)) },
    bending_re_untouched_100msAfter_dB: dB10(bendingEnergy(p, S, 0.3) / bendingEnergy(free, S, 0.3)),
    barsNoteFalls20dB_s: fallFrom(p.modes[RIGID_MODES], 0.2), soundFalls20dB_s: fallFrom(p.pressure, 0.2),
    barsNoteInTheSound_100to400ms_mPa: r(1000 * near(p.pressure, 6 * F0, 0.3, 0.6)),
    stepBetweenSamplesAtContact_overBefore: r(stepRatio(p.pressure, 0.2), 3), ...(finger ? { books: books(p, 0.19, 1.1), fingerForcePeak_N: r(p.fingerForcePeak) } : {}), ...health(p),
  })
  rows['untouched'] = row(free, false)
  rows['a damper alone, 6 N s/m (viscous contact)'] = row(await play(S, [strikeAt(0, MEDIUM), barTouchAt(0.2, { stiffness: 0, damping: 6 })], 1.2))
  rows['a spring and a damper, 2000 N/m and 6 N s/m (compliant finger): the model kept'] = row(await play(S, [strikeAt(0, MEDIUM), barTouchAt(0.2, BAR_TOUCH.medium)], 1.2))
  // A finger with its own mass: flesh (the same spring and damper) between the bar and a 5 g lump, the lump held by the arm (300 N/m, 3 N s/m).
  let flesh = -1
  const massy = await play(S, [strikeAt(0, MEDIUM), { at: 0.2, calls: () => [['attach', flesh], ['setStiffness', flesh, BAR_TOUCH.medium.stiffness, 1, at(BAR_TOUCH_TIME.arrive)], ['touch', flesh, BAR_TOUCH.medium.damping, BAR_TOUCH_TIME.arrive, -1, 0]] }], 1.2, {
    extra: (built, calls) => {
      const lump = calls.filter((c) => c[0] === 'addResonator').length
      flesh = calls.filter((c) => c[0] === 'addSpring' || c[0] === 'addContact').length
      return [...calls.slice(0, -1), ['addResonator', 1, 1], ['setShape', lump, 0, 0, 1], ['setMode', lump, 0, 0, Infinity, 0.005], ['addSpring', built.bar, built.barTouchPort!, lump, 0, 0, 0, 0, 0], ['addSpring', lump, 0, built.ground, 0, 300, 3, 0, 0], ['build']]
    },
  })
  rows['the same flesh on a 5 g fingertip held by the arm (finger mass)'] = row(massy, false)
  m['1 three kinds of contact (struck at 1 m/s, touched at the middle 0.2 s later)'] = rows
}

// ---- 2. How hard it is pressed ----------------------------------------------------------------------------------------------
{
  const rows: Record<string, unknown> = {}
  const free = await play(S, [strikeAt(0, MEDIUM)], 1.2)
  const w = 2 * Math.PI * 660.3
  for (const [name, touch] of Object.entries(BAR_TOUCH)) {
    const p = await play(S, [strikeAt(0, MEDIUM), barTouchAt(0.2, touch)], 1.2)
    const shape = barModeShape(0, 0.5)
    rows[`${name}: ${touch.stiffness} N/m, ${touch.damping} N s/m`] = {
      // A damper c at a point where the mode's shape is s takes the mode's amplitude down at c s^2 / (2 m) per second.
      expected_barsNoteFalls20dB_s: r(Math.log(10) / ((touch.damping * shape * shape) / (2 * barMass(S.bar)) + Math.log(1000) / 0.29), 2),
      expected_noteRisesBy_cents: r(1200 * Math.log2(Math.sqrt(1 + (touch.stiffness * shape * shape) / (barMass(S.bar) * w * w))), 2),
      barsNoteFalls20dB_s: fallFrom(p.modes[RIGID_MODES], 0.2), soundFalls20dB_s: fallFrom(p.pressure, 0.2),
      bending_re_untouched_dB: { '50 ms after': dB10(bendingEnergy(p, S, 0.25) / bendingEnergy(free, S, 0.25)), '100 ms after': dB10(bendingEnergy(p, S, 0.3) / bendingEnergy(free, S, 0.3)) },
      movingAsAWhole_re_untouched_100msAfter_dB: dB10(modeEnergy(p, S, 0, 0.3) / modeEnergy(free, S, 0, 0.3)), rocking_re_untouched_100msAfter_dB: dB10(modeEnergy(p, S, 1, 0.3) / modeEnergy(free, S, 1, 0.3)),
      barsNoteInTheSound_100to400ms_mPa: r(1000 * near(p.pressure, 6 * F0, 0.3, 0.6)), untouched_mPa: r(1000 * near(free.pressure, 6 * F0, 0.3, 0.6)),
      fingerForcePeak_N: r(p.fingerForcePeak), books: books(p, 0.19, 1.1), stepBetweenSamplesAtContact_overBefore: r(stepRatio(p.pressure, 0.2), 3), ...health(p),
    }
  }
  m['2 how hard it is pressed (struck at 1 m/s, touched at the middle 0.2 s later)'] = { modeShapeAtTheMiddle: r(barModeShape(0, 0.5), 4), rows }
}

// ---- 3. Landing and leaving ---------------------------------------------------------------------------------------------------
{
  const T = BAR_TOUCH.medium
  const rows: Record<string, unknown> = {}
  // `open`: the same playing with the finger never used; each move's roughness is given relative to it.
  const scene = async (events: Event[], seconds: number, marks: number[], from: number, open?: Played) => {
    const p = await play(S, events, seconds)
    const l = levels(p.pressure)
    return { p, numbers: { peak_Pa: r(l.peakPa), LAFmax_dB: d1(l.lafMax_dB), stepBetweenSamples_overBefore_atEachMove: marks.map((t) => r(stepRatio(p.pressure, t), 3)), ...(open ? { roughnessInThe5msAfterEachMove_re_untouched_dB: marks.map((t) => dB10(roughness(p.pressure, t) / roughness(open.pressure, t))) } : {}), books: books(p, from, seconds - 0.05), fingerForcePeak_N: r(p.fingerForcePeak), energyLeftInTheInstrumentAtTheEnd_uJ: r(1e6 * (p.energy.total.at(-1)! - p.energy.striker.at(-1)!)), ...health(p) } }
  }
  const freeStrike = await play(S, [strikeAt(0.1, MEDIUM)], 1.5)
  const freePluck = await play(S, [pluckAt(0)], 2)
  {
    const x = await scene([barTouchAt(0, T), strikeAt(0.1, MEDIUM)], 1.5, [], 0.11)
    rows['finger on the bar before the stroke'] = { ...x.numbers, LAFmax_re_untouched_dB: d1(levels(x.p.pressure).lafMax_dB - levels(freeStrike.pressure).lafMax_dB), peak_re_untouched_dB: dB(largest(x.p.pressure) / largest(freeStrike.pressure)), barsNoteFalls20dB_s: fallFrom(x.p.modes[RIGID_MODES], 0.105), untouched_s: fallFrom(freeStrike.modes[RIGID_MODES], 0.105), soundFalls20dB_s: fallFrom(x.p.pressure, 0.105), untouchedSound_s: fallFrom(freeStrike.pressure, 0.105), barsNoteInTheSound_mPa: r(1000 * near(x.p.pressure, 6 * F0, 0.1, 0.6)), untouched_mPa: r(1000 * near(freeStrike.pressure, 6 * F0, 0.1, 0.6)) }
  }
  for (const delay of [0.02, 0.2, 0.5]) {
    const x = await scene([strikeAt(0.1, MEDIUM), barTouchAt(0.1 + delay, T)], 1.5, [0.1 + delay], 0.1 + delay - 0.01, freeStrike)
    rows[`finger lands ${1000 * delay} ms after the stroke`] = { ...x.numbers, bendingEnergy_uJ: { justBefore: r(1e6 * bendingEnergy(x.p, S, 0.09 + delay)), '50 ms after': r(1e6 * bendingEnergy(x.p, S, 0.15 + delay)) }, barsNoteFalls20dB_s: fallFrom(x.p.modes[RIGID_MODES], 0.1 + delay), soundFalls20dB_afterContact_s: fallFrom(x.p.pressure, 0.1 + delay), untouchedSound_s: fallFrom(freeStrike.pressure, 0.1 + delay) }
  }
  {
    const x = await scene([pluckAt(0), barTouchAt(0.3, T)], 2, [0.3], 0.29, freePluck)
    rows['finger lands on the bar 0.3 s into a pluck'] = { ...x.numbers, bendingEnergy_uJ: { justBefore: r(1e6 * bendingEnergy(x.p, S, 0.29)), '50 ms after': r(1e6 * bendingEnergy(x.p, S, 0.35)), untouchedThen: r(1e6 * bendingEnergy(freePluck, S, 0.35)) }, stringEnergy_1s_re_untouched_dB: dB10(x.p.energy.string[blockAt(1)] / freePluck.energy.string[blockAt(1)]) }
  }
  {
    const x = await scene([strikeAt(0.1, MEDIUM), barTouchAt(0.15, T), ...barReleaseAt(0.25, T)], 1.5, [0.15, 0.25], 0.14, freeStrike)
    rows['finger lands 50 ms after the stroke and leaves 100 ms later'] = { ...x.numbers, bendingEnergy_uJ: { justBeforeLanding: r(1e6 * bendingEnergy(x.p, S, 0.14)), justBeforeLeaving: r(1e6 * bendingEnergy(x.p, S, 0.24)), '100 ms after leaving': r(1e6 * bendingEnergy(x.p, S, 0.35)), '300 ms after leaving': r(1e6 * bendingEnergy(x.p, S, 0.55)) }, whatTheSpringHeldAsItLeft_uJ: r(1e6 * x.p.fingerStored[blockAt(0.25)]) }
  }
  {
    const moves = [0, 1, 2, 3, 4].flatMap((i) => [barTouchAt(0.3 + 0.2 * i, T), ...barReleaseAt(0.4 + 0.2 * i, T)])
    const x = await scene([pluckAt(0), strikeAt(0.1, MEDIUM), ...moves], 2.5, [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2], 0.29)
    rows['plucked and struck, then touched and released five times, 0.1 s on and 0.1 s off'] = x.numbers
  }
  const freeStrong = await play(S, [strikeAt(0.1, STROKES.strong)], 1.2)
  for (const [name, touch] of [['firm', BAR_TOUCH.firm], ['palm', BAR_TOUCH.palm]] as const) {
    const [ramp, slap, quick] = [await scene([strikeAt(0.1, STROKES.strong), barTouchAt(0.15, touch)], 1.2, [0.15], 0.14, freeStrong), await scene([strikeAt(0.1, STROKES.strong), barSlapAt(0.15, touch)], 1.2, [0.15], 0.14, freeStrong), await scene([strikeAt(0.1, STROKES.strong), barTouchAt(0.15, touch, 0.0005)], 1.2, [0.15], 0.14, freeStrong)]
    rows[`${name}, onto a strongly struck bar 50 ms after the stroke: landing over 4 ms, over 0.5 ms, and switched on in one sample`] = { 'over 4 ms': ramp.numbers, 'over 0.5 ms': quick.numbers, 'in one sample, without landing': slap.numbers }
  }
  m['3 landing and leaving (medium finger at the middle unless stated)'] = rows
}

// ---- 4. Where it is laid -------------------------------------------------------------------------------------------------------
const places: [string, number][] = [['the middle (antinode of the note; rocking does not move it)', 0.5], ['0.35', 0.35], ['the node of the note (0.224)', 0.224], ['the pad (0.215)', 0.215], ['where the string is tied (0.2)', 0.2], ['near the end (0.05: antinode)', 0.05], ['the far node (0.776)', 0.776], ['the far end (0.95)', 0.95]]
{
  const rows: Record<string, unknown> = {}
  const [freeStrike, freePluck] = [await play(S, [strikeAt(0, MEDIUM)], 1.5), await play(S, [pluckAt(0)], 2.5)]
  for (const [name, where] of places) {
    const s = dampable(where)
    const row: Record<string, unknown> = { shapeThere: { note: r(barModeShape(0, where), 3), secondBendingMode: r(barModeShape(1, where), 3), rocking: r(Math.sqrt(3) * (2 * where - 1), 3) } }
    for (const [strength, touch] of [['medium', BAR_TOUCH.medium], ['firm', BAR_TOUCH.firm]] as const) {
      const [k, p] = [await play(s, [strikeAt(0, MEDIUM), barTouchAt(0.2, touch)], 1.5), await play(s, [pluckAt(0), barTouchAt(0.3, touch)], 2.5)]
      row[strength] = {
        struck: {
          bending_re_untouched_100msAfter_dB: dB10(bendingEnergy(k, s, 0.3) / bendingEnergy(freeStrike, s, 0.3)), secondBendingMode_re_untouched_dB: dB10(modeEnergy(k, s, 3, 0.3) / modeEnergy(freeStrike, s, 3, 0.3)),
          movingAsAWhole_re_untouched_dB: dB10(modeEnergy(k, s, 0, 0.3) / modeEnergy(freeStrike, s, 0, 0.3)), rocking_re_untouched_dB: dB10(modeEnergy(k, s, 1, 0.3) / modeEnergy(freeStrike, s, 1, 0.3)),
          barsNoteFalls20dB_s: fallFrom(k.modes[RIGID_MODES], 0.2), soundFalls20dB_s: fallFrom(k.pressure, 0.2), barsNoteInTheSound_100to400ms_re_untouched_dB: dB(near(k.pressure, 6 * F0, 0.3, 0.6) / near(freeStrike.pressure, 6 * F0, 0.3, 0.6)),
          stringEnergy_300msAfter_re_untouched_dB: dB10(k.energy.string[blockAt(0.5)] / freeStrike.energy.string[blockAt(0.5)]), theFingerTook_uJ: r(1e6 * unaccounted(k, 0.19, 1.4).fingerTook), theFingerTook_percentOfWhatWasLost: d1((100 * unaccounted(k, 0.19, 1.4).fingerTook) / unaccounted(k, 0.19, 1.4).fell),
        },
        plucked: {
          bending_re_untouched_100msAfter_dB: dB10(bendingEnergy(p, s, 0.4) / bendingEnergy(freePluck, s, 0.4)),
          stringEnergy_re_untouched_dB: { '0.5 s': dB10(p.energy.string[blockAt(0.5)] / freePluck.energy.string[blockAt(0.5)]), '1 s': dB10(p.energy.string[blockAt(1)] / freePluck.energy.string[blockAt(1)]), '2 s': dB10(p.energy.string[blockAt(2)] / freePluck.energy.string[blockAt(2)]) },
          inTheSound_afterContact_re_untouched_dB: { fundamental: dB(partial(p.pressure, F0, at(0.35)) / partial(freePluck.pressure, F0, at(0.35))), second: dB(partial(p.pressure, 2 * F0, at(0.35)) / partial(freePluck.pressure, 2 * F0, at(0.35))), sixth_660Hz: dB(partial(p.pressure, 6 * F0, at(0.35)) / partial(freePluck.pressure, 6 * F0, at(0.35))), seventh: dB(partial(p.pressure, 7 * F0, at(0.35)) / partial(freePluck.pressure, 7 * F0, at(0.35))) },
          stringPitch_afterContact_cents: Number(cents(pitchNear(p.stringVelocity.subarray(at(0.35)), F0), F0).toFixed(2)), soundFalls20dB_afterContact_s: fallFrom(p.pressure, 0.3), untouched_s: fallFrom(freePluck.pressure, 0.3),
          theFingerTook_uJ: r(1e6 * unaccounted(p, 0.29, 2.4).fingerTook), theFingerTook_percentOfWhatWasLost: d1((100 * unaccounted(p, 0.29, 2.4).fingerTook) / unaccounted(p, 0.29, 2.4).fell),
        },
        solverIterationsWorst: Math.max(k.worstIterations, p.worstIterations), faults: k.faults + p.faults,
      }
    }
    rows[name] = row
  }
  m['4 where it is laid (struck: touched 0.2 s later; plucked: touched 0.3 s later)'] = { untouched: { stringPitch_cents: Number(cents(pitchNear(freePluck.stringVelocity.subarray(at(0.35)), F0), F0).toFixed(2)) }, rows }
}

// ---- 5. The string tied at 0.20 and at 0.18 ------------------------------------------------------------------------------------
{
  const approved = await approvedStringBody(4)
  const re = (x: Float32Array, n: number) => dB(partial(x, n * F0) / partial(approved.pressure, n * F0))
  const bend = (run: Awaited<ReturnType<typeof measure>>, s: StringBarBody) => 0.5 * barMass(s.bar) * largest(run.barModes[RIGID_MODES]) ** 2
  const lump = (s: StringBarBody): StringBarBody => ({ ...s, bar: { ...s.bar, bendingModes: 0 } })
  const second = Math.round(SR / 128)
  const out: Record<string, unknown> = {}
  for (const tie of [0.2, 0.18]) {
    const s = dampable(0.5, tie)
    const [p, dead, k] = [await measure(s, 'pluck', 4), await measure(lump(s), 'pluck', 4), await measure(s, 'strike', 4, { stroke: MEDIUM })]
    const l = levels(p.pressure)
    const [touchedStrike, freeStrike, touchedPluck, freePluck] = [await play(s, [strikeAt(0, MEDIUM), barTouchAt(0.2, BAR_TOUCH.medium)], 1.2), await play(s, [strikeAt(0, MEDIUM)], 1.2), await play(s, [pluckAt(0), barTouchAt(0.3, BAR_TOUCH.medium)], 2.5), await play(s, [pluckAt(0)], 2.5)]
    const sensitivity: Record<string, unknown> = {}
    const vary: [string, StringBarBody][] = [['as it is', barBridgeWith({}, tie)], ['bar 15 cents flatter', barBridgeWith({ length: BAR_BRIDGE.bar.length * 2 ** (15 / 2400) }, tie)], ['bar 15 cents sharper', barBridgeWith({ length: BAR_BRIDGE.bar.length * 2 ** (-15 / 2400) }, tie)], ['pads half as stiff', { ...barBridgeWith({}, tie), mount: { stiffness: 5e5, damping: 5 } }], ['pads twice as stiff', { ...barBridgeWith({}, tie), mount: { stiffness: 2e6, damping: 5 } }], ['tie half as stiff', { ...barBridgeWith({}, tie), stringOnBar: { at: tie, stiffness: 5e5, damping: 0 } }], ['tie twice as stiff', { ...barBridgeWith({}, tie), stringOnBar: { at: tie, stiffness: 2e6, damping: 0 } }]]
    for (const [name, v] of vary) {
      const q = await measure(v, 'pluck', 4)
      sensitivity[name] = { stringPitch_cents: Number(cents(pitchNear(q.stringVelocity, F0), F0).toFixed(2)), fundamental_re_approved_dB: re(q.pressure, 1), sixth_re_approved_dB: re(q.pressure, 6), LAFmax_re_approved_dB: d1(levels(q.pressure).lafMax_dB - levels(approved.pressure).lafMax_dB), secondsToFall20dB: r(levels(q.pressure).fall20, 2), barBending_percentOfThePluck: Number(((100 * bend(q, v)) / q.peak.in).toPrecision(2)) }
    }
    out[`tied at ${tie}`] = {
      plucked: { stringPitch_cents: Number(cents(pitchNear(p.stringVelocity, F0), F0).toFixed(2)), fundamental_mPa: r(1000 * partial(p.pressure, F0)), harmonics_1_2_3_4_6_7_re_approved_dB: [1, 2, 3, 4, 6, 7].map((n) => re(p.pressure, n)), LAFmax_dB: d1(l.lafMax_dB), LAFmax_re_approved_dB: d1(l.lafMax_dB - levels(approved.pressure).lafMax_dB), secondsToFall20dB: r(l.fall20, 2), stringEnergyAfter1s_percentOfItsMost: Number(((100 * p.energy.string[second]) / p.peak.string).toPrecision(3)), barBending_uJ: r(1e6 * bend(p, s)), barBending_percentOfThePluck: Number(((100 * bend(p, s)) / p.peak.in).toPrecision(2)), at660Hz_firstHalfSecond_mPa: r(1000 * near(p.pressure, 6 * F0, 0, 0.5)), whatTheBarsBendingAddsAt660Hz_dB: dB(partial(p.pressure, 6 * F0) / partial(dead.pressure, 6 * F0)), at660Hz_firstHalfSecond_withABarThatCannotBend_mPa: r(1000 * near(dead.pressure, 6 * F0, 0, 0.5)) },
      'struck, 5 g at 1 m/s': { LAFmax_dB: d1(levels(k.pressure).lafMax_dB), stringsShare_percent: Number(((100 * k.peak.string) / k.malletGave).toPrecision(3)), barsNoteMotionFalls20dB_s: fallFrom(k.barModes[RIGID_MODES], 0.01), fundamentalInTheSound_from0p3s_mPa: r(1000 * partial(k.pressure, F0, 14400), 3) },
      'medium finger at the middle': {
        struck: { barsNoteFalls20dB_s: fallFrom(touchedStrike.modes[RIGID_MODES], 0.2), untouched_s: fallFrom(freeStrike.modes[RIGID_MODES], 0.2), bending_re_untouched_100msAfter_dB: dB10(bendingEnergy(touchedStrike, s, 0.3) / bendingEnergy(freeStrike, s, 0.3)), soundFalls20dB_s: fallFrom(touchedStrike.pressure, 0.2) },
        plucked: { stringEnergy_1s_re_untouched_dB: dB10(touchedPluck.energy.string[blockAt(1)] / freePluck.energy.string[blockAt(1)]), stringEnergy_2s_re_untouched_dB: dB10(touchedPluck.energy.string[blockAt(2)] / freePluck.energy.string[blockAt(2)]), fundamental_afterContact_re_untouched_dB: dB(partial(touchedPluck.pressure, F0, at(0.35)) / partial(freePluck.pressure, F0, at(0.35))), sixth_afterContact_re_untouched_dB: dB(partial(touchedPluck.pressure, 6 * F0, at(0.35)) / partial(freePluck.pressure, 6 * F0, at(0.35))) },
      },
      sensitivity,
    }
  }
  m['5 the string tied at 0.20 and at 0.18 (everything else the same)'] = out
}

// ---- 6. Playing with it ----------------------------------------------------------------------------------------------------------
const kept: Record<string, Played> = {}
{
  const T = BAR_TOUCH.medium
  const rows: Record<string, unknown> = {}
  const E = (p: Played, t: number) => ({ string_uJ: r(1e6 * p.energy.string[blockAt(t)]), bar_uJ: r(1e6 * p.energy.bar[blockAt(t)]), barsNote_uJ: r(1e6 * bendingEnergy(p, S, t)) })
  const basics = (p: Played) => ({ peak_Pa: r(largest(p.pressure)), LAFmax_dB: d1(levels(p.pressure).lafMax_dB), energyLeftAtTheEnd_uJ: r(1e6 * (p.energy.total.at(-1)! - p.energy.striker.at(-1)!)), ...health(p) })
  // Strokes, with and without a finger already on the bar.
  for (const [name, v] of Object.entries(STROKES)) {
    const [free, held] = [await play(S, [strikeAt(0, v)], 1.5), await play(S, [barTouchAt(0, T), strikeAt(0.05, v)], 1.5)]
    rows[`${name} stroke (${v} m/s)`] = { open: { ...basics(free), soundFalls20dB_s: fallFrom(free.pressure, 0.005), barsNote_mPa: r(1000 * near(free.pressure, 6 * F0, 0, 0.5)) }, 'finger on the bar': { ...basics(held), soundFalls20dB_s: fallFrom(held.pressure, 0.055), barsNote_mPa: r(1000 * near(held.pressure, 6 * F0, 0.05, 0.55)), LAFmax_re_open_dB: d1(levels(held.pressure).lafMax_dB - levels(free.pressure).lafMax_dB) } }
  }
  // Plucks in different places, with and without a finger on the bar.
  for (const where of [0.5, 0.75, 0.8, 0.9]) {
    const s = { ...S, pluckAt: where }
    const [free, held] = [await play(s, [pluckAt(0.05)], 2), await play(s, [barTouchAt(0, T), pluckAt(0.05)], 2)]
    rows[`plucked at ${where} of the string`] = { open: { ...basics(free), at660Hz_firstHalfSecond_mPa: r(1000 * near(free.pressure, 6 * F0, 0.05, 0.55)), fundamental_mPa: r(1000 * partial(free.pressure, F0)) }, 'finger on the bar': { ...basics(held), at660Hz_firstHalfSecond_mPa: r(1000 * near(held.pressure, 6 * F0, 0.05, 0.55)), fundamental_mPa: r(1000 * partial(held.pressure, F0)), LAFmax_re_open_dB: d1(levels(held.pressure).lafMax_dB - levels(free.pressure).lafMax_dB), stringEnergy_1s_re_open_dB: dB10(held.energy.string[blockAt(1.05)] / free.energy.string[blockAt(1.05)]), stringPitch_cents: Number(cents(pitchNear(held.stringVelocity.subarray(at(0.1)), F0), F0).toFixed(2)) } }
  }
  // The two gestures, and whether they are separate.
  const pluckOpen = await play(S, [pluckAt(0)], 2.5)
  const strikeOpen = await play(S, [strikeAt(0, MEDIUM)], 1.5)
  const both = await play(S, [pluckAt(0), strikeAt(0, MEDIUM)], 2.5)
  {
    const p = await play(S, [pluckAt(0), barTouchAt(0.3, T)], 2.5)
    kept.pluckThenBarDamped = p
    rows['string plucked; bar damped at 0.3 s and held'] = { ...basics(p), at_1s: E(p, 1), open_at_1s: E(pluckOpen, 1), stringEnergy_re_open_dB: { '1 s': dB10(p.energy.string[blockAt(1)] / pluckOpen.energy.string[blockAt(1)]), '2 s': dB10(p.energy.string[blockAt(2)] / pluckOpen.energy.string[blockAt(2)]) }, fundamental_afterContact_re_open_dB: dB(partial(p.pressure, F0, at(0.35)) / partial(pluckOpen.pressure, F0, at(0.35))), sixth_afterContact_re_open_dB: dB(partial(p.pressure, 6 * F0, at(0.35)) / partial(pluckOpen.pressure, 6 * F0, at(0.35))), sound_0p5to1s_re_open_dB: dB(Math.sqrt(p.pressure.subarray(at(0.5), at(1)).reduce((a, v) => a + v * v, 0) / pluckOpen.pressure.subarray(at(0.5), at(1)).reduce((a, v) => a + v * v, 0))) }
  }
  {
    const p = await play(S, [strikeAt(0, MEDIUM), touchAt(0.05, S, true)], 1.5)
    rows['bar struck; string muted at 0.05 s and held'] = { ...basics(p), at_0p3s: E(p, 0.3), open_at_0p3s: E(strikeOpen, 0.3), barsNote_re_open_dB: dB10(bendingEnergy(p, S, 0.3) / bendingEnergy(strikeOpen, S, 0.3)), barsNoteFalls20dB_s: fallFrom(p.modes[RIGID_MODES], 0.05), open_s: fallFrom(strikeOpen.modes[RIGID_MODES], 0.05), barsNoteInTheSound_re_open_dB: dB(near(p.pressure, 6 * F0, 0.1, 0.6) / near(strikeOpen.pressure, 6 * F0, 0.1, 0.6)), fundamentalInTheSound_re_open_dB: dB(partial(p.pressure, F0, at(0.1)) / partial(strikeOpen.pressure, F0, at(0.1))) }
  }
  {
    const p = await play(S, [pluckAt(0), strikeAt(0, MEDIUM), barTouchAt(0.15, T)], 2.5)
    rows['plucked and struck together; bar damped at 0.15 s'] = { ...basics(p), at_0p5s: E(p, 0.5), open_at_0p5s: E(both, 0.5), stringEnergy_1s_re_open_dB: dB10(p.energy.string[blockAt(1)] / both.energy.string[blockAt(1)]), fundamental_afterContact_re_open_dB: dB(partial(p.pressure, F0, at(0.2)) / partial(both.pressure, F0, at(0.2))), sixth_afterContact_re_open_dB: dB(partial(p.pressure, 6 * F0, at(0.2)) / partial(both.pressure, 6 * F0, at(0.2))) }
  }
  {
    const p = await play(S, [pluckAt(0), strikeAt(0, MEDIUM), touchAt(0.15, S, true)], 2.5)
    rows['plucked and struck together; string muted at 0.15 s'] = { ...basics(p), at_0p5s: E(p, 0.5), open_at_0p5s: E(both, 0.5), barsNote_0p3s_re_open_dB: dB10(bendingEnergy(p, S, 0.3) / bendingEnergy(both, S, 0.3)) }
  }
  {
    // The processor moves one finger at a time: the second is sent once the first has settled.
    const p = await play(S, [pluckAt(0), strikeAt(0, MEDIUM), touchAt(0.15, S, true), barTouchAt(0.16, T)], 1.5)
    rows['plucked and struck together; string muted at 0.15 s and bar damped at 0.16 s'] = { ...basics(p), at_0p3s: E(p, 0.3), at_0p5s: E(p, 0.5), open_at_0p5s: E(both, 0.5), everything_0p5s_re_open_dB: dB10(p.energy.total[blockAt(0.5)] / both.energy.total[blockAt(0.5)]), soundFalls20dB_fromTheFirstTouch_s: fallFrom(p.pressure, 0.15), lastAbove_minus60dBOfPeak_s: (() => { const peak = largest(p.pressure); let last = 0; for (let i = 0; i < p.pressure.length; i++) if (Math.abs(p.pressure[i]) > peak * 0.001) last = i; return Number((last / SR).toFixed(2)) })(), stepBetweenSamples_overBefore: [r(stepRatio(p.pressure, 0.15)), r(stepRatio(p.pressure, 0.16))], books: books(p, 0.17, 1.4) }
  }
  {
    const p = await play(S, [strikeAt(0, MEDIUM), barTouchAt(0.2, T), ...barReleaseAt(0.5, T), strikeAt(0.6, MEDIUM)], 1.6)
    const fresh = largest(strikeOpen.pressure)
    rows['struck, damped at 0.2 s, released at 0.5 s, struck again at 0.6 s'] = { ...basics(p), secondStroke_peak_re_aFreshOne_dB: dB(largest(p.pressure, at(0.6)) / fresh), secondStroke_barsNote_100msAfter_re_fresh_dB: dB10(bendingEnergy(p, S, 0.7) / bendingEnergy(strikeOpen, S, 0.1)), books: books(p, 0.19, 0.59) }
  }
  {
    const p = await play(S, [barTouchAt(0, T), retriggerAt(0.05, S), ...barReleaseAt(0.5, T), retriggerAt(0.8, S)], 2)
    rows['finger on the bar, string retriggered; finger lifted at 0.5 s; string retriggered at 0.8 s'] = { ...basics(p), at660Hz_firstPluck_mPa: r(1000 * near(p.pressure, 6 * F0, 0.08, 0.5)), at660Hz_secondPluck_mPa: r(1000 * near(p.pressure, 6 * F0, 0.83, 1.33)) }
  }
  {
    const events: Event[] = [0, 1, 2, 3].flatMap((i) => [pluckAt(i * 0.8), strikeAt(i * 0.8 + 0.4, MEDIUM), barTouchAt(i * 0.8 + 0.55, T), ...barReleaseAt(i * 0.8 + 0.75, T)])
    const p = await play(S, events, 4.5)
    kept.alternating = p
    rows['four times: pluck, stroke 0.4 s later, bar damped 0.15 s after the stroke, finger lifted before the next pluck'] = { ...basics(p), stepBetweenSamples_overBefore_atTheFirstTouchAndRelease: [r(stepRatio(p.pressure, 0.95)), r(stepRatio(p.pressure, 1.15))], fingerForcePeak_N: r(p.fingerForcePeak), injectedByTheFingersSpring_uJ: r(1e6 * p.injected.at(-1)!) }
  }
  {
    // A phrase with both gestures: an open pluck; a stroke stopped short; a pluck with the bar held (string alone); the finger lifts, a strong stroke rings; the string is muted under it; then everything is stopped.
    const events: Event[] = [pluckAt(0), strikeAt(0.6, MEDIUM), barTouchAt(0.68, BAR_TOUCH.firm), retriggerAt(1.1, S), ...barReleaseAt(1.8, BAR_TOUCH.firm), strikeAt(1.9, STROKES.strong), touchAt(2.0, S, true), touchAt(2.5, S, false), pluckAt(2.6, 4), strikeAt(3.0, STROKES.gentle), touchAt(3.6, S, true), barTouchAt(3.62, BAR_TOUCH.firm)]
    const p = await play(S, events, 4.6)
    kept.phrase = p
    rows['a phrase using both gestures (described in the manifest)'] = { ...basics(p), fingerForcePeak_N: r(p.fingerForcePeak), injectedByTheFingersSpring_uJ: r(1e6 * p.injected.at(-1)!), lastAbove_minus60dBOfPeak_s: (() => { const peak = largest(p.pressure); let last = 0; for (let i = 0; i < p.pressure.length; i++) if (Math.abs(p.pressure[i]) > peak * 0.001) last = i; return Number((last / SR).toFixed(2)) })() }
  }
  {
    const hard: Event[] = Array.from({ length: 30 }, (_, i) => (i % 2 ? strikeAt(i * 0.1, 5) : pluckAt(i * 0.1, 8)))
    const moves: Event[] = Array.from({ length: 15 }, (_, i) => (i % 2 ? barReleaseAt(0.05 + i * 0.2, BAR_TOUCH.palm) : [barTouchAt(0.05 + i * 0.2, BAR_TOUCH.palm)])).flat()
    const p = await play({ ...S, mallet: BAR_BRIDGE.mallet }, [...hard, ...moves], 6)
    rows['as hard as allowed (8 N plucks, 5 m/s strokes of the 20 g mallet, ten a second for 3 s) while the palm lands and lifts every 0.2 s'] = { ...basics(p), fingerForcePeak_N: r(p.fingerForcePeak), injectedByTheFingersSpring_mJ: r(1000 * p.injected.at(-1)!), instrumentEnergyAtMost_mJ: r(1000 * Math.max(...p.energy.total)), clipped: largest(p.pressure) >= CEILING }
  }
  m['6 playing with it (medium finger at the middle unless stated; light striker)'] = rows
}

// ---- 7. Cost in Node, block by block ------------------------------------------------------------------------------------------------
const performanceResult: Record<string, unknown> = {}
{
  const r3 = radiation(SR)
  const radiate: Call = ['radiate', r3.perSample, r3.b0, r3.b1, r3.a1, 16]
  const box = buildPlayableStringBody({ tension: 73.5, length: 0.65, pluckAt: 0.8, joined: true }, SR)
  const ref = buildStringBarBody({ ...BAR_BRIDGE, mallet: LIGHT_STRIKER }, SR)
  const fingered = buildStringBarBody(S, SR)
  const both = (b: typeof ref): Call[] => [pluckCall(b, PLUCK), ['launch', b.mallet!, MEDIUM]]
  const systems: [string, Call[], Call[], ((block: number) => Call[] | null)?][] = [
    ['approved string on its box, plucked five times a second', [...box.calls, radiate], [pluckCall(box, PLUCK)]],
    ['Phase 3D.10 reference (no finger), plucked and struck in turn', [...ref.calls, radiate], both(ref)],
    ['finger never used', [...fingered.calls, radiate], both(fingered)],
    ['finger held on the bar (medium)', [...fingered.calls, radiate], both(fingered), (block) => (block === 0 ? barTouchCalls(fingered, BAR_TOUCH.medium, SR) : null)],
    ['finger touching and leaving five times a second', [...fingered.calls, radiate], both(fingered), (block) => (block % 75 === 20 ? ((block / 75) % 2 < 1 ? barTouchCalls(fingered, BAR_TOUCH.medium, SR) : barReleaseCalls(fingered, SR)) : null)],
  ]
  // The systems take turns, run by run, so that whatever else the machine is doing falls on all of them alike.
  const tally = systems.map(() => ({ speeds: [] as number[], blockMs: [] as number[], iterations: 0, faults: 0, memory: 0 }))
  for (let run = 0; run < 6; run++) {
    for (const [index, [, calls, playing, finger]] of systems.entries()) {
      const { speeds, blockMs } = tally[index]
      const worklet = await createWorklet(calls)
      const t0 = performance.now()
      let last = t0
      worklet.render(20 * SR, (block) => {
        const now = performance.now()
        if (run > 0 && block > 0) blockMs.push(now - last)
        if (block % 37 === 0 && (playing.length > 1 || (block / 37) % 2 === 0)) worklet.send([playing[(block / 37) % playing.length]])
        const extra = finger?.(block)
        if (extra) worklet.send(extra)
        last = performance.now()
      })
      if (run > 0) speeds.push((100 * (performance.now() - t0)) / 20000)
      tally[index].iterations = Math.max(tally[index].iterations, worklet.engine.worstIterations())
      tally[index].faults += worklet.engine.faults()
      tally[index].memory = worklet.engine.memory.buffer.byteLength
    }
  }
  for (const [index, [name, calls]] of systems.entries()) {
    const { speeds, blockMs, iterations, faults, memory } = tally[index]
    speeds.sort((a, b) => a - b)
    blockMs.sort((a, b) => a - b)
    const q = (f: number) => Number(blockMs[Math.min(blockMs.length - 1, Math.floor(f * blockMs.length))].toFixed(3))
    performanceResult[name] = { percentOfOneCore_median: Number(speeds[2].toFixed(2)), lowestAndHighestOfFiveRuns: [Number(speeds[0].toFixed(2)), Number(speeds[4].toFixed(2))], blockMs: { blocksTimed: blockMs.length, median: q(0.5), p99: q(0.99), p999: q(0.999), longest: q(1), over1ms: blockMs.filter((t) => t >= 1).length, over2ms: blockMs.filter((t) => t >= 2).length, over2p67ms: blockMs.filter((t) => t >= 128000 / SR).length }, connections: calls.filter((c) => c[0] === 'addSpring' || c[0] === 'addContact').length, solverIterationsWorst: iterations, faults, engineMemoryBytes: memory }
  }
}

// ---- 8. Listening files ---------------------------------------------------------------------------------------------------------------
{
  const T = BAR_TOUCH.medium
  const approved = await approvedStringBody(4)
  const S18 = dampable(0.5, 0.18)
  const [refPluck, strikeOpen, strikeDamped, strikeHeld, pluckHeld, tie20, tie18] = [await play(S, [pluckAt(0)], 4), await play(S, [strikeAt(0, MEDIUM)], 2.5), await play(S, [strikeAt(0, MEDIUM), barTouchAt(0.25, T)], 2.5), await play(S, [barTouchAt(0, T), strikeAt(0.05, MEDIUM)], 2.5), await play(S, [barTouchAt(0, T), pluckAt(0.05)], 4), await play(S, [pluckAt(0), strikeAt(1.5, MEDIUM)], 4), await play(S18, [pluckAt(0), strikeAt(1.5, MEDIUM)], 4)]
  const finger = (touch: BarTouch, where = 0.5) => ({ at_fractionOfTheBar: where, stiffness_N_per_m: touch.stiffness, damping_Ns_per_m: touch.damping, arrives_ms: 1000 * BAR_TOUCH_TIME.arrive, leaves_ms: 1000 * BAR_TOUCH_TIME.leave })
  const stringFinger = { damping_Ns_per_m: r(fingerDamping(S)), at: 'the pluck point', arrives_ms: 2, leaves_ms: 4 }
  const files: [string, Float32Array, string, string, Record<string, unknown>, Played?][] = [
    ['01-approved-string-and-body-plucked', approved.pressure, 'the approved string instrument: the reference', `pluck ${PLUCK} N at 0.8`, {}],
    ['02-reference-B-plucked', refPluck.pressure, 'Phase 3D.10 reference: architecture B, string tied at 0.2, no finger used', `pluck ${PLUCK} N at 0.8`, {}, refPluck],
    ['03-bar-struck-open', strikeOpen.pressure, 'bar struck, nothing damped', `5 g at ${MEDIUM} m/s at the middle`, {}, strikeOpen],
    ['04-bar-struck-then-damped', strikeDamped.pressure, 'bar struck; a finger lands on its middle 0.25 s later and stays', `5 g at ${MEDIUM} m/s`, { fingerOnBar: finger(T), lands_s: 0.25 }, strikeDamped],
    ['05-bar-struck-with-finger-already-on', strikeHeld.pressure, 'a finger is on the bar\'s middle; the bar is struck 0.05 s into the file', `5 g at ${MEDIUM} m/s at 0.05 s`, { fingerOnBar: finger(T), lands_s: 0 }, strikeHeld],
    ['06-string-plucked-bar-open', refPluck.pressure, 'string plucked, bar free (the same sound as 02)', `pluck ${PLUCK} N at 0.8`, {}, refPluck],
    ['07-string-plucked-bar-held', pluckHeld.pressure, 'a finger is on the bar\'s middle; the string is plucked 0.05 s into the file', `pluck ${PLUCK} N at 0.05 s`, { fingerOnBar: finger(T), lands_s: 0 }, pluckHeld],
    ['08-string-plucked-then-bar-damped', kept.pluckThenBarDamped.pressure, 'string plucked; a finger lands on the bar\'s middle 0.3 s later and stays', `pluck ${PLUCK} N`, { fingerOnBar: finger(T), lands_s: 0.3 }, kept.pluckThenBarDamped],
    ['09-tie-0p20-pluck-then-strike', tie20.pressure, 'string tied at 0.20 of the bar: a pluck, and a stroke 1.5 s later; no finger', `pluck ${PLUCK} N; 5 g at ${MEDIUM} m/s at 1.5 s`, { stringTiedAt: 0.2 }, tie20],
    ['10-tie-0p18-pluck-then-strike', tie18.pressure, 'string tied at 0.18 of the bar: the same pluck and stroke', `pluck ${PLUCK} N; 5 g at ${MEDIUM} m/s at 1.5 s`, { stringTiedAt: 0.18 }, tie18],
    ['11-pluck-and-strike-in-turn-with-damping', kept.alternating.pressure, 'four times, 0.8 s apart: pluck; stroke 0.4 s later; finger on the bar 0.15 s after the stroke; finger lifted 0.2 s after that', `pluck ${PLUCK} N; 5 g at ${MEDIUM} m/s`, { fingerOnBar: finger(T), lands_s: [0.55, 1.35, 2.15, 2.95], lifts_s: [0.75, 1.55, 2.35, 3.15] }, kept.alternating],
    ['12-phrase-with-both-gestures', kept.phrase.pressure, 'open pluck (0 s); medium stroke (0.6 s) stopped by a firm finger on the bar (0.68 s); string retriggered with the bar still held (1.1 s); finger lifted (1.8 s); strong stroke (1.9 s); string muted under it (2.0 to 2.5 s); 4 N pluck (2.6 s); gentle stroke (3.0 s); string muted (3.6 s) and bar damped (3.62 s)', 'as described', { fingerOnBar: finger(BAR_TOUCH.firm), fingerOnString: stringFinger }, kept.phrase],
  ]
  const exposure = (x: Float32Array) => Math.sqrt(aWeighted(x).reduce((sum, v) => sum + v * v, 0))
  const commonGain = 0.9 / Math.max(...files.map(([, x]) => largest(x)))
  const matchedTarget = Math.min(...files.map(([, x]) => (0.9 * exposure(x)) / largest(x)))
  const info: Record<string, unknown> = {}
  for (const [name, x, what, excitation, physical, p] of files) {
    const matched = matchedTarget / exposure(x)
    writeWav(`${OUT}/common/${name}.wav`, Float32Array.from(x, (v) => v * commonGain))
    writeWav(`${OUT}/matched/${name}.wav`, Float32Array.from(x, (v) => v * matched))
    const l = levels(x)
    const peak = largest(x)
    const below = (ratio: number) => { let last = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > peak * ratio) last = i; return Number((last / SR).toFixed(2)) }
    info[name] = {
      unit: 'Pa', what, excitation, seconds: Number((x.length / SR).toFixed(2)), physical: { bar: `${S.bar.length} m x ${S.bar.width} mm x ${S.bar.thickness} mm aluminium, ${r(1000 * barMass(S.bar))} g, on the 6th harmonic`, stringTiedAt: 0.2, striker: '5 g, hardness 0.5', ...physical },
      peak_Pa: r(l.peakPa), peak_dB: d1(l.peak_dB), SEL_dB: d1(l.sel_dB), LAFmax_dB: d1(l.lafMax_dB), secondsToFall20dB: r(l.fall20, 2), lastAbove_s: { '-20 dB of peak': below(0.1), '-40 dB': below(0.01), '-60 dB': below(0.001) },
      harmonics1to8_mPa: [1, 2, 3, 4, 5, 6, 7, 8].map((h) => r(1000 * partial(x, h * F0), 3)), energyByBand_percent: Object.fromEntries(bandShares(x).map((share, i) => [`${BANDS[i]}-${BANDS[i + 1]} Hz`, Number((100 * share).toFixed(1))])),
      ...(p ? { energy: { instrumentAtMost_uJ: r(1e6 * Math.max(...Array.from(p.energy.total, (e, i) => e - p.energy.striker[i]))), leftAtTheEnd_uJ: r(1e6 * (p.energy.total.at(-1)! - p.energy.striker.at(-1)!)), theFingerOnTheBarTook_uJ: r(1e6 * p.fingerTook.at(-1)!), addedByTheFingersSpringStiffening_uJ: r(1e6 * p.injected.at(-1)!), countedAsDissipated_uJ: r(1e6 * p.dissipated.at(-1)!) } } : {}),
      common: { gain_perPascal: r(commonGain), gain_dB: dB(commonGain), peakInFile_dBFS: dB(peak * commonGain) }, matched: { gain_perPascal: r(matched), gain_dB: dB(matched), peakInFile_dBFS: dB(peak * matched) },
    }
  }
  writeFileSync(path(`${OUT}/manifest.json`), JSON.stringify({
    sampleRate: SR, bitDepth: 24, unit: 'Pa: the approved body\'s radiated sound pressure, 1 m in front of the board; a model\'s, not calibrated',
    common: `every file multiplied by the same ${r(commonGain)} per pascal (the loudest peaks at 0.9 of full scale): compare loudness`,
    matched: 'each file scaled to the same A-weighted sound exposure: compare timbre only',
    nothingElseIsDone: 'one multiplication per file; no filter, compression, fade, correction or added source. A sound that stops, stops because a damper took its energy.',
    listeningApproval: 'none: these have been measured, not heard',
    string: 'A2, 73.5 N, 0.65 m (the approved string); body and air: approved, unchanged',
    files: info,
  }, null, 2))
  console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => { const x = v as Record<string, unknown>; return [k, { peak_Pa: x.peak_Pa, LAFmax_dB: x.LAFmax_dB, minus40dB_s: (x.lastAbove_s as Record<string, unknown>)['-40 dB'], common_dBFS: (x.common as Record<string, unknown>).peakInFile_dBFS, matched_dB: (x.matched as Record<string, unknown>).gain_dB }] })))
}
writeFileSync(path(`${OUT}/measurements.json`), JSON.stringify(m, null, 2))
writeFileSync(path(`${OUT}/performance.json`), JSON.stringify({ sampleRate: SR, node: process.version, note: 'Node, not a browser audio thread; five timed runs of 20 s each; block times by performance.now() around each 128-sample block', budgetPerBlock_ms: Number((128000 / SR).toFixed(3)), results: performanceResult }, null, 2))
console.table(Object.fromEntries(Object.entries(performanceResult).map(([k, v]) => { const x = v as Record<string, unknown>; return [k, { cpu: x.percentOfOneCore_median, ...(x.blockMs as object), iterations: x.solverIterationsWorst, faults: x.faults }] })))
console.log(`\nwritten to ${fsPath(OUT)}`)
