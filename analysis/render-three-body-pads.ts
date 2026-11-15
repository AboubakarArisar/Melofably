// Phase 3D.8: can a more realistic pad under the bar give a better balance
// between the knock of a stroke, the bar's note, and the string?
//
//   npm run render:three-body-pads
//
// Output: renders/three-body-pads/
//   measurements.json   the stroke's energy budget, the pad models, the
//                       comparison, the tradeoff at equal note, robustness
//                       and playability
//   performance.json    cost in Node
//   manifest.json       every WAV: unit, excitation, true peak, levels, gains
//   common/*.wav        one gain for all: relative loudness
//   matched/*.wav       each scaled to the same A-weighted exposure: timbre
//
// Every sound is the body's radiated pressure in pascals, 1 m in front of
// the board. Nothing is filtered, compressed or boosted. A bar that cannot
// bend, and a bar with one bending mode, are used as measurements only.
import { mkdirSync, writeFileSync } from 'node:fs'
import { barMass, barOnBoardModes, buildStringBarBody, LIGHT_MALLET, MEDIUM_MOUNT, padStiffness, relaxationTime, RIGID_MODES, SOFT_MOUNT, VISCO_MOUNT, type Mount, type StringBarBody } from '../src/experimental/string/stringBarBody.ts'
import { buildPlayableStringBody, pluckCall, radiation } from '../src/experimental/string/stringBody.ts'
import type { Call } from '../src/experimental/wasm/engine.ts'
import { aWeighted, BANDS, bandShares, levels, pitchNear, type Levels } from './hybrid-study.ts'
import { SR } from './lib.ts'
import { fsPath, path, writeWav } from './offline.ts'
import { partial } from './radiation.ts'
import { approvedStringBody, BASE, cents, F0, fallTime, FULL_SCALE, measure, perform, PLUCK, pluckAt, shareNear, spectralPeaks, strikeAt, STROKE, touchAt, TUNED, variant, type Run } from './three-body.ts'
import { createWorklet } from './worklet.ts'

const OUT = 'renders/three-body-pads'
for (const dir of ['', '/common', '/matched']) mkdirSync(path(OUT + dir), { recursive: true })
const r = (x: number | null, digits = 3) => (x === null ? null : Number(x.toPrecision(digits)))
const d1 = (x: number | null) => (x === null ? null : Number(x.toFixed(1)))
const dB = (ratio: number) => Number((20 * Math.log10(ratio)).toFixed(1))
const largest = (x: ArrayLike<number>) => {
  let m = 0
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}
const show = (l: Levels) => ({ peak_Pa: r(l.peakPa), peak_dB: d1(l.peak_dB), SEL_dB: d1(l.sel_dB), LAFmax_dB: d1(l.lafMax_dB), secondsToLAFmax: r(l.attack, 2), secondsToFall20dB: r(l.fall20, 2) })
const bands = (x: ArrayLike<number>) => Object.fromEntries(bandShares(x).map((share, i) => [`${BANDS[i]}-${BANDS[i + 1]} Hz`, Number((100 * share).toFixed(2))]))
const light = (s: StringBarBody): StringBarBody => ({ ...s, mallet: LIGHT_MALLET.mallet })
const bending = (s: StringBarBody, count: number): StringBarBody => ({ ...s, bar: { ...s.bar, bendingModes: count } })
const modeEnergy = (run: Run, s: StringBarBody, n: number) => 0.5 * barMass(s.bar) * largest(run.barModes[n]) ** 2
const noteOf = (run: Run) => spectralPeaks(run.barModes[RIGID_MODES], 0.05, 1.5, 1)[0][0]
const m: Record<string, unknown> = { units: 'energies as stated, pressures Pa or mPa, levels dB re 20 uPa (LAFmax: A-weighted, 125 ms; SEL: all the sound energy, referred to 1 s)', excitation: { pluck: `${PLUCK} N, softness 0.3`, standardStroke: `20 g mallet, hardness 0.5, ${STROKE} m/s`, lightStroke: `${1000 * LIGHT_MALLET.mallet.mass} g mallet, hardness 0.5, ${LIGHT_MALLET.stroke} m/s: a different excitation, not a mounting change` } }
const reference = await approvedStringBody(4)
const refLevels = levels(reference.pressure)
const designs: Record<string, StringBarBody> = { 'A: Phase 3D.6 tuned (stiff pads)': TUNED, 'B: Phase 3D.7 candidate A (soft pads)': SOFT_MOUNT, 'C: viscoelastic pads': VISCO_MOUNT, 'D: plain pads of C\'s stiffness at the note': MEDIUM_MOUNT }

// ---- 1. The pad models -------------------------------------------------------------------------------------------------
{
  const out: Record<string, unknown> = {}
  for (const [name, s] of Object.entries(designs)) {
    const mount = s.mount as Mount
    out[name] = {
      mount, relaxationTime_ms: r(1000 * relaxationTime(mount)),
      byFrequency: Object.fromEntries([20, 60, 168, 330, 660, 1320, 2640].map((f) => {
        const [stiff, lossy] = padStiffness(mount, f)
        return [`${f} Hz`, { stiffness_N_per_m: r(stiff), lossFactor: r(lossy / stiff, 2) }]
      })),
    }
  }
  m['1 the pads: stiffness and loss factor by frequency'] = out
}

// ---- 2. A stroke's energy, and what the mounting and the bending each make of it -------------------------------------------
const strikes: Record<string, Run> = {}
{
  const out: Record<string, unknown> = {}
  for (const [name, s] of Object.entries(designs)) {
    const [full, lump, one] = [await measure(s, 'strike', 4), await measure(bending(s, 0), 'strike', 4), await measure(bending(s, 1), 'strike', 4)]
    strikes[name] = full
    const note = noteOf(full)
    const [l, ll, l1] = [levels(full.pressure), levels(lump.pressure), levels(one.pressure)]
    const gave = full.malletGave
    const rebound = Math.sqrt((2 * full.energy.mallet.at(-1)!) / s.mallet!.mass)
    out[name] = {
      mallet: { impulse_Ns: r(s.mallet!.mass * (STROKE + rebound)), gave_mJ: r(1000 * gave) },
      barKineticEnergyAtItsMost_mJ: { upAndDown: r(1000 * modeEnergy(full, s, 0)), rocking: r(1000 * modeEnergy(full, s, 1)), bending1: r(1000 * modeEnergy(full, s, 2)), bending3: r(1000 * modeEnergy(full, s, 4)) },
      padsHeldAtMost_mJ: r(1000 * full.padStoredPeak),
      whereItWent_percentOfWhatTheMalletGave: { padDampers: d1((100 * full.padLoss) / gave), ofWhichTheRelaxingPath: d1((100 * full.padPathLoss) / gave), barsOwnMaterial: d1((100 * full.barLoss) / gave), boardAirAndString: d1((100 * (full.dissipated - full.padLoss - full.barLoss)) / gave), accountedFor: d1((100 * full.dissipated) / gave) },
      barsNote: { asMounted_Hz: r(note, 5), cents_re_6thHarmonic: d1(cents(note, 6 * F0)), motionFalls20dB_s: r(fallTime(full.barModes[RIGID_MODES]), 2), inTheSound_from0p3s_mPa: r(1000 * partial(full.pressure, note, 14400), 3), shareOfSoundEnergyWithin1Percent: d1(100 * shareNear(full.pressure, [note], 1.01)) },
      sound: { wholeStroke: show(l), 'bar that cannot bend (the knock alone)': show(ll), 'bar with its lowest bending mode only': show(l1) },
      'whole stroke over knock alone, dB': { LAFmax: d1(l.lafMax_dB - ll.lafMax_dB), soundEnergy: d1(l.sel_dB - ll.sel_dB) },
      'note over knock: the bar\'s note from 0.3 s on, re the knock alone\'s peak, dB': dB(partial(full.pressure, note, 14400) / ll.peakPa),
      energyByBand_percent: bands(full.pressure),
    }
  }
  m['2 the stroke'] = out
}

// ---- 3. The pluck ---------------------------------------------------------------------------------------------------------
const plucks: Record<string, Run> = {}
{
  const out: Record<string, unknown> = {}
  for (const [name, s] of Object.entries(designs)) {
    const [p, lump] = [await measure(s, 'pluck', 4), await measure(bending(s, 0), 'pluck', 4)]
    plucks[name] = p
    const l = levels(p.pressure)
    const [net, toBar] = [p.bridgeWork.at(-1)!, p.supportWork.at(-1)!]
    out[name] = {
      ...show(l), LAFmax_re_approved_dB: d1(l.lafMax_dB - refLevels.lafMax_dB), stringPitch_cents: Number(cents(pitchNear(p.stringVelocity, F0), F0).toFixed(2)),
      harmonics_re_approved_dB: Object.fromEntries([1, 2, 3, 4, 6].map((h) => [`harmonic ${h}`, dB(partial(p.pressure, h * F0) / partial(reference.pressure, h * F0))])),
      stringEnergyAfter1s_percentOfItsMost: d1((100 * p.energy.string[Math.round(SR / 128)]) / p.peak.string),
      enteredTheBoard_percentOfThePluck: Number(((100 * net) / p.peak.in).toFixed(2)),
      crossedThePads_uJ: { toBar: r(1e6 * p.toBar), back: r(1e6 * p.fromBar), netIntoTheBar: r(1e6 * toBar) },
      padDampersTook_uJ: r(1e6 * p.padLoss), padsHeldAtMost_uJ: r(1e6 * p.padStoredPeak),
      barKineticEnergyAtItsMost_uJ: { upAndDown: r(1e6 * modeEnergy(p, s, 0)), rocking: r(1e6 * modeEnergy(p, s, 1)), bending1: r(1e6 * modeEnergy(p, s, 2)) },
      'what the bar\'s bending adds at the 6th harmonic, dB': dB(partial(p.pressure, 6 * F0) / partial(lump.pressure, 6 * F0)),
      energyByBand_percent: bands(p.pressure),
    }
  }
  m['3 the pluck'] = { 'approved string on its box': { ...show(refLevels), stringPitch_cents: Number(cents(pitchNear(reference.stringVelocity, F0), F0).toFixed(2)), energyByBand_percent: bands(reference.pressure) }, ...out }
}

// ---- 4. Side by side, and with the light stroke -------------------------------------------------------------------------------
const lightStrikes: Record<string, Float32Array> = {}
{
  const out: Record<string, unknown> = {}
  for (const [name, s] of Object.entries(designs)) {
    const [gentle, lump] = [await measure(light(s), 'strike', 4, { stroke: LIGHT_MALLET.stroke }), await measure(bending(light(s), 0), 'strike', 4, { stroke: LIGHT_MALLET.stroke })]
    lightStrikes[name] = gentle.pressure
    const [lp, lk, lg] = [levels(plucks[name].pressure), levels(strikes[name].pressure), levels(gentle.pressure)]
    out[name] = { 'stroke over pluck, LAFmax dB': { standardStroke: d1(lk.lafMax_dB - lp.lafMax_dB), lightStroke: d1(lg.lafMax_dB - lp.lafMax_dB) }, lightStroke: { ...show(lg), knockAlone_LAFmax_dB: d1(levels(lump.pressure).lafMax_dB), barsNoteInTheSound_from0p3s_mPa: r(1000 * partial(gentle.pressure, noteOf(gentle), 14400), 3) } }
  }
  m['4 pluck against stroke'] = out
}

// ---- 5. The tradeoff at equal note: plain pads against viscoelastic pads -------------------------------------------------------
{
  const plain = (c: number, k = 2.2e5) => variant({ ...MEDIUM_MOUNT, mount: { stiffness: k, damping: c } })
  const visco = (fr: number, k1 = 2e5) => variant({ ...VISCO_MOUNT, mount: { stiffness: 2e4, damping: 0.5, relaxing: { stiffness: k1, damping: k1 / (2 * Math.PI * fr), mass: 0.0002 } } })
  const rows: Record<string, unknown> = {}
  for (const [name, s] of [['plain 2.2e5 N/m, 1 N s/m', plain(1)], ['plain 2.2e5, 3.4', plain(3.4)], ['plain 2.2e5, 10', plain(10)], ['viscoelastic, change centred at 40 Hz', visco(40)], ['viscoelastic, 60 Hz (C)', visco(60)], ['viscoelastic, 100 Hz', visco(100)], ['viscoelastic, 150 Hz', visco(150)], ['viscoelastic, 400 Hz', visco(400)],
    ['softer, plain 1.2e5 N/m, 1 N s/m', plain(1, 1.2e5)], ['softer, plain 1.2e5, 2', plain(2, 1.2e5)], ['softer, plain 1.2e5, 4', plain(4, 1.2e5)], ['softer, viscoelastic 2e4 + 1e5, 40 Hz', visco(40, 1e5)], ['softer, viscoelastic 2e4 + 1e5, 60 Hz', visco(60, 1e5)], ['softer, viscoelastic 2e4 + 1e5, 100 Hz', visco(100, 1e5)]] as const) {
    const [k, lump, p, pl] = [await measure(s, 'strike', 4), await measure(bending(s, 0), 'strike', 4), await measure(s, 'pluck', 4), await measure(bending(s, 0), 'pluck', 4)]
    const note = noteOf(k)
    const ll = levels(lump.pressure)
    rows[name] = { lossFactorAtTheNote: r(padStiffness(s.mount!, 660)[1] / padStiffness(s.mount!, 660)[0], 2), lossFactorAt168Hz: r(padStiffness(s.mount!, 168)[1] / padStiffness(s.mount!, 168)[0], 2), knockAlone: { LAFmax_dB: d1(ll.lafMax_dB), SEL_dB: d1(ll.sel_dB) }, stroke_LAFmax_dB: d1(levels(k.pressure).lafMax_dB), barsNote_from0p3s_mPa: r(1000 * partial(k.pressure, note, 14400), 3), barsNoteMotionFalls20dB_s: r(fallTime(k.barModes[RIGID_MODES]), 2), noteShareOfSoundEnergy_percent: d1(100 * shareNear(k.pressure, [note], 1.01)), padsTook_percent: d1((100 * k.padLoss) / k.malletGave), pluck_bendingAddsAt6thHarmonic_dB: dB(partial(p.pressure, 6 * F0) / partial(pl.pressure, 6 * F0)), pluck_harmonics3and4_re_approved_dB: [3, 4].map((h) => dB(partial(p.pressure, h * F0) / partial(reference.pressure, h * F0))), solverIterationsWorst: Math.max(k.worstIterations, p.worstIterations), faults: k.faults + p.faults }
  }
  m['5 the tradeoff: knock against note, plain pads and viscoelastic pads'] = rows
}

// ---- 6. Is C a narrow tuning? ---------------------------------------------------------------------------------------------------
{
  const rows: Record<string, unknown> = {}
  const C = VISCO_MOUNT
  const relaxing = C.mount!.relaxing!
  async function row(name: string, s: StringBarBody) {
    const [k, lump, p] = [await measure(s, 'strike', 3), await measure(bending(s, 0), 'strike', 3), await measure(s, 'pluck', 3)]
    const note = noteOf(k)
    rows[name] = { knockAlone_LAFmax_dB: d1(levels(lump.pressure).lafMax_dB), stroke_LAFmax_dB: d1(levels(k.pressure).lafMax_dB), barsNote_cents_re_6thHarmonic: d1(cents(note, 6 * F0)), barsNote_from0p3s_mPa: r(1000 * partial(k.pressure, note, 14400), 3), noteShare_percent: d1(100 * shareNear(k.pressure, [note], 1.01)), stringPitch_cents: Number(cents(pitchNear(p.stringVelocity, F0), F0).toFixed(2)), pluck_LAFmax_re_approved_dB: d1(levels(p.pressure).lafMax_dB - refLevels.lafMax_dB), fundamental_re_approved_dB: dB(partial(p.pressure, F0) / partial(reference.pressure, F0)), solverIterationsWorst: Math.max(k.worstIterations, p.worstIterations), faults: k.faults + p.faults }
  }
  await row('C', C)
  for (const mass of [0.00005, 0.001]) await row(`lump ${1000 * mass} g`, { ...C, mount: { ...C.mount!, relaxing: { ...relaxing, mass } } })
  for (const k0 of [5e3, 5e4]) await row(`slow stiffness ${k0} N/m`, { ...C, mount: { ...C.mount!, stiffness: k0 } })
  for (const k1 of [1e5, 4e5]) await row(`fast stiffness adds ${k1} N/m (same relaxation time)`, { ...C, mount: { ...C.mount!, relaxing: { ...relaxing, stiffness: k1, damping: (relaxing.damping * k1) / relaxing.stiffness } } })
  for (const a of [0.21, 0.22]) await row(`pads at ${a}`, variant({ ...C }, { ...C.bar, supports: [a, 1 - a] }))
  for (const tension of [73, 74]) await row(`string tension ${tension} N (${cents(Math.sqrt(tension / 73.5), 1).toFixed(0)} cents)`, { ...C, tension })
  for (const at of [0.35, 0.2]) await row(`struck at ${at}`, variant({ ...C }, { ...C.bar, strikeAt: at }))
  m['6 candidate C with one thing changed'] = rows
}

// ---- 7. Playing it ------------------------------------------------------------------------------------------------------------------
const played: Record<string, Float32Array> = {}
{
  const out: Record<string, unknown> = {}
  for (const [name, s] of [['A', TUNED], ['B', SOFT_MOUNT], ['C', VISCO_MOUNT]] as const) {
    const every = (seconds: number, step: number) => Array.from({ length: Math.floor(seconds / step) }, (_, i) => i * step)
    const scenes: [string, Parameters<typeof perform>[1], number][] = [
      ['string plucked four times a second for 3 s', every(3, 0.25).map((t) => pluckAt(t)), 6],
      ['bar struck four times a second for 3 s', every(3, 0.25).map((t) => strikeAt(t)), 6],
      ['pluck and stroke in turn, every 0.75 s', every(3, 0.75).map((t, i) => (i % 2 ? strikeAt(t) : pluckAt(t))), 5],
      ['pluck and stroke at the same instant', [pluckAt(0), strikeAt(0)], 4],
      ['plucked, then a finger laid on the string at 0.5 s', [pluckAt(0), touchAt(0.5, s, true)], 2],
      ['struck, then a finger laid on the string at 0.2 s', [strikeAt(0), touchAt(0.2, s, true)], 2],
      ['as hard as allowed: 8 N plucks and 5 m/s strokes in turn, ten a second for 3 s', every(3, 0.1).map((t, i) => (i % 2 ? strikeAt(t, 5) : pluckAt(t, 8))), 6],
      ['gentle: 0.5 N pluck', [pluckAt(0, 0.5)], 3],
      ['gentle: 0.3 m/s stroke', [strikeAt(0, 0.3)], 3],
    ]
    const rows: Record<string, unknown> = {}
    for (const [scene, events, seconds] of scenes) {
      const p = await perform(s, events, seconds)
      const l = levels(p.pressure)
      const last = events.at(-1)!.at
      const [mostEnergy, endEnergy] = [Math.max(...p.energy), p.energy.at(-1)!]
      rows[scene] = { peak_Pa: r(l.peakPa), LAFmax_dB: d1(l.lafMax_dB), largestStepBetweenSamples_overPeak: r(p.largestStepOverPeak, 2), instrumentEnergyAtMost_mJ: r(1000 * mostEnergy), energyLeftAtTheEnd_percentOfMost: Number(((100 * endEnergy) / mostEnergy).toPrecision(2)), secondsRenderedAfterTheLastEvent: Number((seconds - last).toFixed(2)), solverIterationsWorst: p.worstIterations, faults: p.faults, ...(/finger/.test(scene) ? { stringEnergyLeft_uJ: r(1e6 * p.stringEnergy) } : {}) }
      if (name === 'C' && /in turn, every/.test(scene)) played.alternating = p.pressure
      if (name === 'C' && /same instant/.test(scene)) played.together = p.pressure
    }
    // A pluck's level against its force, and a stroke's against its speed.
    const [soft, hard] = [await perform(s, [pluckAt(0, 1)], 2), await perform(s, [pluckAt(0, 4)], 2)]
    const [slow, fast] = [await perform(s, [strikeAt(0, 0.75)], 2), await perform(s, [strikeAt(0, 3)], 2)]
    rows['response to how hard it is played'] = { 'pluck 4 N over 1 N, dB (12.0 if linear)': dB(largest(hard.pressure) / largest(soft.pressure)), 'stroke 3 m/s over 0.75 m/s, peak dB (12.0 if linear; a Hertz contact gives more)': dB(largest(fast.pressure) / largest(slow.pressure)) }
    out[name] = rows
  }
  m['7 playing it'] = out
}

// ---- 8. Cost in Node ------------------------------------------------------------------------------------------------------------
const performanceResult: Record<string, unknown> = {}
{
  const r3 = radiation(SR)
  const radiate: Call = ['radiate', r3.perSample, r3.b0, r3.b1, r3.a1, FULL_SCALE]
  const box = buildPlayableStringBody({ tension: BASE.tension, length: BASE.length, pluckAt: BASE.pluckAt, joined: true }, SR)
  const systems: [string, Call[], Call[]][] = [['approved string on its box, plucked five times a second', [...box.calls, radiate], [pluckCall(box, PLUCK)]]]
  for (const [name, s] of Object.entries(designs)) {
    const b = buildStringBarBody(s, SR)
    systems.push([`${name}, plucked and struck in turn`, [...b.calls, radiate], [pluckCall(b, PLUCK), ['launch', b.mallet!, STROKE]]])
  }
  for (const [name, calls, play] of systems) {
    const speeds: number[] = []
    let [iterations, faults] = [0, 0]
    for (let run = 0; run < 4; run++) {
      const worklet = await createWorklet(calls)
      const t0 = performance.now()
      worklet.render(20 * SR, (block) => block % 37 === 0 && (play.length > 1 || (block / 37) % 2 === 0) && worklet.send([play[(block / 37) % play.length]]))
      if (run > 0) speeds.push((performance.now() - t0) / 20000)
      iterations = Math.max(iterations, worklet.engine.worstIterations())
      faults += worklet.engine.faults()
    }
    performanceResult[name] = { percentOfOneCore: Number((100 * speeds.sort((a, b) => a - b)[1]).toFixed(2)), resonators: calls.filter((c) => c[0] === 'addResonator').length, connections: calls.filter((c) => c[0] === 'addSpring' || c[0] === 'addContact').length, solverIterationsWorst: iterations, faults }
  }
}

// ---- 9. Listening files ------------------------------------------------------------------------------------------------------------
const [nA, nB, nC, nD] = Object.keys(designs)
const std = `stroke: 20 g mallet at ${STROKE} m/s`
const files: [string, Float32Array, string, string][] = [
  ['01-approved-string-and-body-plucked', reference.pressure, 'the approved string instrument: the reference', `pluck ${PLUCK} N`],
  ['02-A-phase-3d6-tuned-plucked', plucks[nA].pressure, 'A: stiff pads (1e6 N/m, 5 N s/m), struck at 0.35', `pluck ${PLUCK} N`],
  ['03-A-phase-3d6-tuned-struck', strikes[nA].pressure, 'A', std],
  ['04-B-phase-3d7-soft-mount-plucked', plucks[nB].pressure, 'B: soft pads (1e5 N/m, 1 N s/m), struck at the middle', `pluck ${PLUCK} N`],
  ['05-B-phase-3d7-soft-mount-struck', strikes[nB].pressure, 'B', std],
  ['06-C-viscoelastic-pads-plucked', plucks[nC].pressure, 'C: viscoelastic pads (2e4 N/m slow, 2.2e5 N/m fast), struck at the middle', `pluck ${PLUCK} N`],
  ['07-C-viscoelastic-pads-struck', strikes[nC].pressure, 'C', std],
  ['08a-C-pluck-and-stroke-in-turn', played.alternating, 'C: pluck at 0 s, stroke at 0.75 s, pluck at 1.5 s, stroke at 2.25 s', `pluck ${PLUCK} N; ${std}`],
  ['08b-C-pluck-and-stroke-together', played.together, 'C: plucked and struck at the same instant', `pluck ${PLUCK} N; ${std}`],
  ['09a-A-struck-lightly', lightStrikes[nA], 'A with the light stroke: a different excitation, not a mounting change', 'stroke: 5 g mallet at 1 m/s'],
  ['09b-B-struck-lightly', lightStrikes[nB], 'B with the light stroke', 'stroke: 5 g mallet at 1 m/s'],
  ['09c-C-struck-lightly', lightStrikes[nC], 'C with the light stroke', 'stroke: 5 g mallet at 1 m/s'],
  ['10a-D-plain-pads-of-the-same-stiffness-plucked', plucks[nD].pressure, 'D: a spring and damper side by side with C\'s stiffness at the bar\'s note: the simpler model nearest to C', `pluck ${PLUCK} N`],
  ['10b-D-plain-pads-of-the-same-stiffness-struck', strikes[nD].pressure, 'D', std],
]
const exposure = (x: Float32Array) => Math.sqrt(aWeighted(x).reduce((s, v) => s + v * v, 0))
const commonGain = 0.9 / Math.max(...files.map(([, x]) => largest(x)))
const matchedTarget = Math.min(...files.map(([, x]) => (0.9 * exposure(x)) / largest(x)))
const info: Record<string, unknown> = {}
for (const [name, x, note, excitation] of files) {
  const matched = matchedTarget / exposure(x)
  writeWav(`${OUT}/common/${name}.wav`, Float32Array.from(x, (v) => v * commonGain))
  writeWav(`${OUT}/matched/${name}.wav`, Float32Array.from(x, (v) => v * matched))
  info[name] = { unit: 'Pa', what: note, excitation, seconds: Number((x.length / SR).toFixed(2)), ...show(levels(x)), energyByBand_percent: bands(x), common: { gain_perPascal: r(commonGain), gain_dB: dB(commonGain), peakInFile_dBFS: dB(largest(x) * commonGain) }, matched: { gain_perPascal: r(matched), gain_dB: dB(matched), peakInFile_dBFS: dB(largest(x) * matched) } }
}
const [lA, lB, lC] = [nA, nB, nC].map((n) => ({ pluck: levels(plucks[n].pressure), strike: levels(strikes[n].pressure) }))
writeFileSync(path(`${OUT}/manifest.json`), JSON.stringify({
  sampleRate: SR, bitDepth: 24, unit: 'Pa: the body\'s radiated sound pressure, 1 m in front of the board; a model\'s, not calibrated',
  common: `every file multiplied by the same ${r(commonGain)} per pascal (the loudest peaks at 0.9 of full scale): compare loudness. The plucks are far down in their files: turn the playback up, not the file`,
  matched: 'each file scaled to the same A-weighted sound exposure: compare timbre only',
  nothingElseIsDone: 'one multiplication per file; no filter, compression or correction',
  listeningApproval: 'none: these have been measured, not heard',
  'measured differences, dB (LAFmax)': { 'stroke: C over A': d1(lC.strike.lafMax_dB - lA.strike.lafMax_dB), 'stroke: C over B': d1(lC.strike.lafMax_dB - lB.strike.lafMax_dB), 'pluck: C over approved': d1(lC.pluck.lafMax_dB - refLevels.lafMax_dB), 'stroke over pluck: A, B, C': [lA, lB, lC].map((l) => d1(l.strike.lafMax_dB - l.pluck.lafMax_dB)) },
  files: info,
}, null, 2))
writeFileSync(path(`${OUT}/measurements.json`), JSON.stringify(m, null, 2))
writeFileSync(path(`${OUT}/performance.json`), JSON.stringify({ sampleRate: SR, node: process.version, results: performanceResult }, null, 2))
console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => { const x = v as Record<string, unknown>; return [k, { peak_Pa: x.peak_Pa, LAFmax_dB: x.LAFmax_dB, fall20_s: x.secondsToFall20dB, common_dBFS: (x.common as Record<string, unknown>).peakInFile_dBFS, matched_dB: (x.matched as Record<string, unknown>).gain_dB }] })))
console.table(performanceResult)
console.log(`\nwritten to ${fsPath(OUT)}`)
void barOnBoardModes
