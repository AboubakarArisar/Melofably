// Phase 3D.7: the three-part prototype's mounting and playability. Why a
// stroke knocks, why the string hardly reaches the bar, what the physical
// parameters do about either, and two candidates.
//
//   npm run render:three-body-mounting
//
// Output: renders/three-body-mounting/
//   measurements.json   root causes, exploration, candidates, spectral differences
//   performance.json    cost in Node
//   listening.json      every WAV's unit, true peak, levels and gains
//   common/*.wav        one gain for all: relative loudness
//   matched/*.wav       each scaled to the same A-weighted exposure: timbre
//
// Every sound is the body's radiated pressure in pascals, 1 m in front of
// the board. Nothing is filtered, compressed or boosted; the bar's
// rigid-body modes are never removed from an instrument (a bar that cannot
// bend is used once, as a measurement of what the mounting does alone).
import { mkdirSync, writeFileSync } from 'node:fs'
import { decayRate, DEFAULT_LOSS, impedance } from '../src/experimental/string/modalString.ts'
import { modalMobility, plateModes } from '../src/experimental/string/soundboard.ts'
import { barMass, barOnBoardModes, buildStringBarBody, LIGHT_MALLET, RIGID_MODES, SOFT_MOUNT, SOFT_MOUNT_BRIDGE, type StringBarBody } from '../src/experimental/string/stringBarBody.ts'
import { BODY, buildPlayableStringBody, pluckCall, radiation, STRING_DENSITY } from '../src/experimental/string/stringBody.ts'
import type { Call } from '../src/experimental/wasm/engine.ts'
import { aWeighted, BANDS, bandShares, levels, pitchNear, type Levels } from './hybrid-study.ts'
import { SR } from './lib.ts'
import { fsPath, path, writeWav } from './offline.ts'
import { partial } from './radiation.ts'
import { approvedStringBody, BASE, cents, F0, fallTime, FULL_SCALE, measure, PLUCK, shareNear, spectralPeaks, STROKE, TUNED, variant, type Run } from './three-body.ts'
import { createWorklet } from './worklet.ts'

const OUT = 'renders/three-body-mounting'
for (const dir of ['', '/common', '/matched']) mkdirSync(path(OUT + dir), { recursive: true })
const r = (x: number | null, digits = 3) => (x === null ? null : Number(x.toPrecision(digits)))
const d1 = (x: number | null) => (x === null ? null : Number(x.toFixed(1)))
const dB = (ratio: number) => Number((20 * Math.log10(ratio)).toFixed(1))
const largest = (x: ArrayLike<number>) => {
  let m = 0
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}
const show = (l: Levels) => ({ peak_Pa: r(l.peakPa), peak_dB: d1(l.peak_dB), SEL_dB: d1(l.sel_dB), SEL_A_dB: d1(l.selA_dB), LAFmax_dB: d1(l.lafMax_dB), secondsToLAFmax: r(l.attack, 2), secondsToFall20dB: r(l.fall20, 2) })
const bands = (x: ArrayLike<number>) => Object.fromEntries(bandShares(x).map((share, i) => [`${BANDS[i]}-${BANDS[i + 1]} Hz`, Number((100 * share).toFixed(2))]))
const light = (s: StringBarBody): StringBarBody => ({ ...s, mallet: LIGHT_MALLET.mallet })
const rigidOnly = (s: StringBarBody): StringBarBody => ({ ...s, bar: { ...s.bar, bendingModes: 0 } })
/** Kinetic energy of one of the bar's modes at its fastest, J. */
const modeEnergy = (run: Run, s: StringBarBody, n: number) => 0.5 * barMass(s.bar) * largest(run.barModes[n]) ** 2
/** The bar's lowest bending mode as it is on its pads: the strongest component of that mode's own motion after a stroke. */
const noteOf = (run: Run) => spectralPeaks(run.barModes[RIGID_MODES], 0.05, 1.5, 1)[0][0]
const m: Record<string, unknown> = { units: 'energies as stated, pressures Pa or mPa, levels dB re 20 uPa (LAFmax: A-weighted, 125 ms)', playing: `pluck ${PLUCK} N; standard stroke 20 g at ${STROKE} m/s; light stroke ${1000 * LIGHT_MALLET.mallet.mass} g at ${LIGHT_MALLET.stroke} m/s; hardness 0.5 throughout unless stated` }
const reference = await approvedStringBody(4)
const refLevels = levels(reference.pressure)
const designs: Record<string, StringBarBody> = { 'Phase 3D.6 prototype': BASE, 'Phase 3D.6 tuned': TUNED, 'A: soft mount': SOFT_MOUNT, 'B: soft mount, bridge moved': SOFT_MOUNT_BRIDGE }

// ---- 1. The stroke: what the mounting does, and what the bar's bending does ------------------------------------------
const strikes: Record<string, Run> = {}
{
  const out: Record<string, unknown> = {}
  for (const [name, s] of Object.entries(designs)) {
    const [full, lump] = [await measure(s, 'strike', 4), await measure(rigidOnly(s), 'strike', 4)]
    strikes[name] = full
    const M = barMass(s.bar)
    const [a, k] = [s.bar.supports[0], s.mount!.stiffness]
    const note = noteOf(full)
    const [l, ll] = [levels(full.pressure), levels(lump.pressure)]
    const rebound = Math.sqrt((2 * full.energy.mallet.at(-1)!) / s.mallet!.mass)
    out[name] = {
      onRigidGround: { upAndDown_Hz: Math.round(Math.sqrt((2 * k) / M) / (2 * Math.PI)), rocking_Hz: Math.round(Math.sqrt((k * 6 * (2 * a - 1) ** 2) / M) / (2 * Math.PI)), padDampingRatio_upAndDown: r((2 * s.mount!.damping) / (2 * Math.sqrt(2 * k * M)), 2) },
      mallet: { impulse_Ns: r(s.mallet!.mass * (STROKE + rebound)), gave_mJ: r(1000 * full.malletGave) },
      kineticEnergyAtItsMost_mJ: { upAndDown: r(1000 * modeEnergy(full, s, 0)), rocking: r(1000 * modeEnergy(full, s, 1)), bending1: r(1000 * modeEnergy(full, s, 2)), bending2: r(1000 * modeEnergy(full, s, 3)), bending3: r(1000 * modeEnergy(full, s, 4)) },
      lowestBendingModeOnItsPads: { freeBar_Hz: r(barOnBoardModes(s.bar, SR)[RIGID_MODES].frequency, 5), asMounted_Hz: r(note, 5), cents: d1(cents(note, barOnBoardModes(s.bar, SR)[RIGID_MODES].frequency)), motionFalls20dB_s: r(fallTime(full.barModes[RIGID_MODES]), 2) },
      padsTook_percentOfWhatTheMalletGave: d1((100 * full.padLoss) / full.malletGave),
      sound: { ...show(l), strongestComponents_first0p3s: spectralPeaks(full.pressure, 0, 0.3, 5).map(([f, a2]) => `${Math.round(f)} Hz ${r(a2, 2)} Pa`), shareOfSoundEnergyWithin1PercentOfTheBarsNote_percent: d1(100 * shareNear(full.pressure, [note], 1.01)), barsNote_from0p3s_mPa: r(1000 * partial(full.pressure, note, 14400), 3) },
      'the same stroke on a bar that cannot bend (the mounting alone)': { ...show(ll), strongestComponents_first0p3s: spectralPeaks(lump.pressure, 0, 0.3, 5).map(([f, a2]) => `${Math.round(f)} Hz ${r(a2, 2)} Pa`) },
      'whole stroke over mounting alone, dB': { LAFmax: d1(l.lafMax_dB - ll.lafMax_dB), soundEnergy: d1(l.sel_dB - ll.sel_dB) },
    }
  }
  m['1 the stroke: mounting and bending'] = out
}

// ---- 2. The pluck: where the string's energy goes ---------------------------------------------------------------------
const plucks: Record<string, Run> = {}
{
  const Z = impedance({ length: BASE.length, tension: BASE.tension, density: STRING_DENSITY })
  const predicted: Record<string, unknown> = {}
  for (const at of [[0.08, 1 / 3], [0.08, 0.44], [0.15, 0.5], [0.3, 0.5]] as [number, number][]) {
    const modes = plateModes(BODY.plate, [at], SR, BODY.limit)
    let [num, den] = [0, 0]
    const rows: Record<string, unknown> = {}
    for (let n = 1; n <= 12; n++) {
      const reY = modalMobility(modes, 0, n * F0)[0]
      // Each round trip (f0 a second) the bridge takes 4 Z Re(Y) of a wave's energy; the string's own losses take 2 x its decay rate.
      const [toBoard, own] = [F0 * 4 * Z * reY, 2 * decayRate(DEFAULT_LOSS, n * F0)]
      const share = (Math.sin(n * Math.PI * (1 - BASE.pluckAt)) / n) ** 2
      num += (share * toBoard) / (toBoard + own)
      den += share
      if (n <= 6) rows[`harmonic ${n}`] = { boardMobility_real_m_per_Ns: r(reY, 2), stringImpedanceTimesIt: r(Z * reY, 2), shareThatReachesTheBoard_percent: Number(((100 * toBoard) / (toBoard + own)).toFixed(2)) }
    }
    predicted[`bridge at (${at.map((x) => x.toFixed(2)).join(', ')})`] = { ofThePluck_percent: Number(((100 * num) / den).toFixed(2)), ...rows }
  }
  const measured: Record<string, unknown> = {}
  for (const [name, s] of Object.entries(designs)) {
    const [p, lump] = [await measure(s, 'pluck', 4), await measure(rigidOnly(s), 'pluck', 4)]
    plucks[name] = p
    const [net, toBar] = [p.bridgeWork.at(-1)!, p.supportWork.at(-1)!]
    measured[name] = {
      putIn_mJ: r(1000 * p.peak.in),
      bridge: { stringToBoard_mJ: r(1000 * p.toBoard), boardToString_mJ: r(1000 * p.fromBoard), net_mJ: r(1000 * net), net_percentOfThePluck: Number(((100 * net) / p.peak.in).toFixed(2)), lostInTheStringItself_percent: Number((100 * (1 - net / p.peak.in)).toFixed(1)) },
      pads: { boardToBar_uJ: r(1e6 * p.toBar), barToBoard_uJ: r(1e6 * p.fromBar), netIntoTheBar_uJ: r(1e6 * toBar), net_percentOfWhatEnteredTheBoard: Number(((100 * toBar) / net).toFixed(2)), padDampersTook_uJ: r(1e6 * p.padLoss) },
      barKineticEnergyAtItsMost_uJ: { upAndDown: r(1e6 * modeEnergy(p, s, 0)), rocking: r(1e6 * modeEnergy(p, s, 1)), bending1: r(1e6 * modeEnergy(p, s, 2)), bending2: r(1e6 * modeEnergy(p, s, 3)) },
      bending1_shareOfThePluck_percent: Number(((100 * modeEnergy(p, s, 2)) / p.peak.in).toPrecision(2)),
      'what the bar\'s bending adds to the sound (re the same bar unable to bend), dB': { atTheStrings6thHarmonic: dB(partial(p.pressure, 6 * F0) / partial(lump.pressure, 6 * F0)), LAFmax: Number((levels(p.pressure).lafMax_dB - levels(lump.pressure).lafMax_dB).toFixed(2)) },
    }
  }
  m['2 the pluck: where the string\'s energy goes'] = { stringImpedance_kg_per_s: r(Z), predictedFromTheBoardsMobility: predicted, measured }
}

// ---- 3. Exploration ---------------------------------------------------------------------------------------------------
{
  const rows: Record<string, unknown> = {}
  async function row(name: string, s: StringBarBody, stroke = STROKE) {
    const [p, k] = [await measure(s, 'pluck', 4), await measure(s, 'strike', 4, { stroke })]
    const [lp, lk] = [levels(p.pressure), levels(k.pressure)]
    const note = noteOf(k)
    rows[name] = {
      pluck: { stringPitch_cents: Number(cents(pitchNear(p.stringVelocity, F0), F0).toFixed(2)), LAFmax_re_approved_dB: d1(lp.lafMax_dB - refLevels.lafMax_dB), fundamental_re_approved_dB: dB(partial(p.pressure, F0) / partial(reference.pressure, F0)), harmonic6_re_approved_dB: dB(partial(p.pressure, 6 * F0) / partial(reference.pressure, 6 * F0)), secondsToLAFmax: r(lp.attack, 2), secondsToFall20dB: r(lp.fall20, 2), barBending1_percentOfThePluck: Number(((100 * modeEnergy(p, s, 2)) / p.peak.in).toPrecision(2)) },
      strike: { peak_Pa: r(lk.peakPa), LAFmax_dB: d1(lk.lafMax_dB), secondsToLAFmax: r(lk.attack, 2), secondsToFall20dB: r(lk.fall20, 2), barsNote_Hz: r(note, 4), barsNote_cents_re_free: d1(cents(note, barOnBoardModes(s.bar, SR)[RIGID_MODES].frequency)), barsNoteMotionFalls20dB_s: r(fallTime(k.barModes[RIGID_MODES]), 2), barsNoteInTheSound_from0p3s_mPa: r(1000 * partial(k.pressure, note, 14400), 3), padsTook_percent: d1((100 * k.padLoss) / k.malletGave), stringEnergyMax_percentOfGiven: Number(((100 * k.peak.string) / k.malletGave).toPrecision(2)), strokeOverPluck_LAFmax_dB: d1(lk.lafMax_dB - lp.lafMax_dB) },
      solverIterationsWorst: Math.max(p.worstIterations, k.worstIterations), faults: p.faults + k.faults,
    }
  }
  const tuned = (o: Partial<StringBarBody> = {}, bar: Partial<StringBarBody['bar']> = {}) => variant({ ...TUNED, ...o, bar: { ...TUNED.bar, strikeAt: 0.5, ...bar } })
  await row('Phase 3D.6 tuned (pads 1e6 N/m, 5 N s/m at 0.215; struck at 0.35)', TUNED)
  for (const a of [0.224, 0.215, 0.2]) for (const k of [1e4, 1e5, 1e6]) for (const c of [1, 5, 30]) await row(`pads at ${a}, ${k} N/m, ${c} N s/m; struck at the middle`, tuned({ mount: { stiffness: k, damping: c } }, { supports: [a, 1 - a] }))
  for (const at of [0.2, 0.35]) await row(`A struck at ${at}`, variant({ ...SOFT_MOUNT, bar: { ...SOFT_MOUNT.bar, strikeAt: at } }))
  for (const hardness of [0.2, 0.35, 0.8]) await row(`A, mallet hardness ${hardness}`, { ...SOFT_MOUNT, mallet: { mass: 0.02, stiffness: 10 ** (6 + 4 * hardness) } })
  for (const mass of [0.005, 0.01]) await row(`A, mallet ${1000 * mass} g at 1.5 m/s`, { ...SOFT_MOUNT, mallet: { mass, stiffness: 1e8 } })
  await row('A, light stroke (5 g at 1 m/s)', light(SOFT_MOUNT), LIGHT_MALLET.stroke)
  for (const at of [[0.08, 0.44], [0.15, 0.5], [0.3, 0.5]] as [number, number][]) await row(`A, bridge at (${at.join(', ')})`, { ...SOFT_MOUNT, bridgeAt: at })
  for (const at of [[0.5, 0.5], [0.25, 0.5], [0.3, 1 / 3]] as [number, number][]) await row(`A, bar's middle at (${at.map((x) => x.toFixed(2)).join(', ')}) of the board`, { ...SOFT_MOUNT, barAt: at })
  await row('A, bar 10 mm wider (30 mm, 81 g)', variant({ ...SOFT_MOUNT }, { ...SOFT_MOUNT.bar, width: 30 }))
  m['3 exploration'] = rows
}

// ---- 4. Candidates ----------------------------------------------------------------------------------------------------
const sounds: Record<string, { pluck: Float32Array; strike: Float32Array; both: Float32Array; lightStrike: Float32Array }> = {}
{
  const out: Record<string, unknown> = {}
  const harmonics = [1, 2, 3, 4, 6]
  for (const [name, s] of Object.entries(designs)) {
    const [p, k] = [plucks[name], strikes[name]]
    const both = await measure(s, 'both', 4)
    const gentle = await measure(light(s), 'strike', 4, { stroke: LIGHT_MALLET.stroke })
    const lump = await measure(rigidOnly(light(s)), 'strike', 4, { stroke: LIGHT_MALLET.stroke })
    sounds[name] = { pluck: p.pressure, strike: k.pressure, both: both.pressure, lightStrike: gentle.pressure }
    const [lp, lk, lg] = [levels(p.pressure), levels(k.pressure), levels(gentle.pressure)]
    const note = noteOf(k)
    out[name] = {
      pluck: { ...show(lp), stringPitch_cents: Number(cents(pitchNear(p.stringVelocity, F0), F0).toFixed(2)), LAFmax_re_approved_dB: d1(lp.lafMax_dB - refLevels.lafMax_dB), harmonics_re_approved_dB: Object.fromEntries(harmonics.map((h) => [`harmonic ${h}`, dB(partial(p.pressure, h * F0) / partial(reference.pressure, h * F0))])), energyByBand_percent: bands(p.pressure) },
      strike: { ...show(lk), barsNote_Hz: r(note, 5), barsNote_cents_re_6thHarmonic: d1(cents(note, 6 * F0)), barsNoteMotionFalls20dB_s: r(fallTime(k.barModes[RIGID_MODES]), 2), barsNoteInTheSound_from0p3s_mPa: r(1000 * partial(k.pressure, note, 14400), 3), stringsFundamentalInTheSound_from0p3s_mPa: r(1000 * partial(k.pressure, F0, 14400), 3), stringEnergyMax_percentOfGiven: Number(((100 * k.peak.string) / k.malletGave).toPrecision(2)), energyByBand_percent: bands(k.pressure) },
      'stroke over pluck, LAFmax dB': { standardStroke: d1(lk.lafMax_dB - lp.lafMax_dB), lightStroke: d1(lg.lafMax_dB - lp.lafMax_dB) },
      lightStroke: { ...show(lg), mountingAlone_LAFmax_dB: d1(levels(lump.pressure).lafMax_dB), barsNoteInTheSound_from0p3s_mPa: r(1000 * partial(gentle.pressure, noteOf(gentle), 14400), 3) },
      bothTogether: show(levels(both.pressure)),
      solverIterationsWorst: Math.max(p.worstIterations, k.worstIterations, both.worstIterations), faults: p.faults + k.faults + both.faults,
    }
  }
  m['4 candidates'] = { 'approved string on its box, plucked': { ...show(refLevels), energyByBand_percent: bands(reference.pressure) }, ...out }
}

// ---- 5. Cost in Node -----------------------------------------------------------------------------------------------------
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
    performanceResult[name] = { percentOfOneCore: Number((100 * speeds.sort((a, b) => a - b)[1]).toFixed(2)), solverIterationsWorst: iterations, faults }
  }
}

// ---- 6. Listening files ----------------------------------------------------------------------------------------------------
const [proto, , a, b] = Object.values(sounds)
const files: [string, Float32Array, string][] = [
  ['1-approved-string-and-body-plucked', reference.pressure, 'the approved string instrument: the reference'],
  ['2-phase-3d6-prototype-string-plucked', proto.pluck, 'the first three-part prototype, plucked'],
  ['3-phase-3d6-prototype-bar-struck', proto.strike, 'the first three-part prototype, struck (20 g at 1.5 m/s)'],
  ['4-candidate-A-string-plucked', a.pluck, 'candidate A (soft mount), plucked'],
  ['5-candidate-A-bar-struck', a.strike, 'candidate A, struck (20 g at 1.5 m/s)'],
  ['6-candidate-A-both-together', a.both, 'candidate A, plucked and struck at the same instant'],
  ['7a-candidate-B-string-plucked', b.pluck, 'candidate B (soft mount, bridge moved), plucked'],
  ['7b-candidate-B-bar-struck', b.strike, 'candidate B, struck (20 g at 1.5 m/s)'],
  ['7c-candidate-B-both-together', b.both, 'candidate B, plucked and struck together'],
  ['8-candidate-A-bar-struck-lightly', a.lightStrike, 'candidate A played differently: a 5 g mallet at 1 m/s'],
]
const exposure = (x: Float32Array) => Math.sqrt(aWeighted(x).reduce((s, v) => s + v * v, 0))
const commonGain = 0.9 / Math.max(...files.map(([, x]) => largest(x)))
const matchedTarget = Math.min(...files.map(([, x]) => (0.9 * exposure(x)) / largest(x)))
const info: Record<string, unknown> = {}
for (const [name, x, note] of files) {
  const matched = matchedTarget / exposure(x)
  writeWav(`${OUT}/common/${name}.wav`, Float32Array.from(x, (v) => v * commonGain))
  writeWav(`${OUT}/matched/${name}.wav`, Float32Array.from(x, (v) => v * matched))
  info[name] = { unit: 'Pa', note, ...show(levels(x)), energyByBand_percent: bands(x), common: { gain_perPascal: r(commonGain), gain_dB: dB(commonGain), peakInFile_dBFS: dB(largest(x) * commonGain) }, matched: { gain_perPascal: r(matched), gain_dB: dB(matched), peakInFile_dBFS: dB(largest(x) * matched) } }
}
writeFileSync(path(`${OUT}/listening.json`), JSON.stringify({ sampleRate: SR, bitDepth: 24, seconds: 4, unit: 'Pa: the body\'s radiated sound pressure, 1 m in front of the board; a model\'s, not calibrated', common: `every file multiplied by the same ${r(commonGain)} per pascal: compare loudness`, matched: 'each scaled to the same A-weighted sound exposure: compare timbre only', files: info }, null, 2))
writeFileSync(path(`${OUT}/measurements.json`), JSON.stringify(m, null, 2))
writeFileSync(path(`${OUT}/performance.json`), JSON.stringify({ sampleRate: SR, node: process.version, results: performanceResult }, null, 2))
console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => { const x = v as Record<string, unknown>; return [k, { peak_Pa: x.peak_Pa, LAFmax_dB: x.LAFmax_dB, fall20_s: x.secondsToFall20dB, common_dBFS: (x.common as Record<string, unknown>).peakInFile_dBFS, matched_dB: (x.matched as Record<string, unknown>).gain_dB }] })))
console.table(performanceResult)
console.log(`\nwritten to ${fsPath(OUT)}`)
