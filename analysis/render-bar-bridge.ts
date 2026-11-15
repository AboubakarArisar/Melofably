// Phase 3D.10: the bar-as-bridge instrument (architecture B of Phase 3D.9)
// in other voices: the bar tuned to other harmonics of the string, the
// string tied at other places on the bar, a lighter striker, and how it
// answers to being played.
//
//   npm run render:bar-bridge
//
// Output: renders/bar-bridge/
//   measurements.json   reference, tuning, attachment, striking, playing
//   performance.json    cost in Node
//   manifest.json       every WAV: physical parameters, excitation, peak,
//                       levels, harmonics, energy transfer, gains
//   common/*.wav        one gain for all: relative loudness
//   matched/*.wav       each scaled to the same A-weighted exposure: timbre
//
// Every sound is the approved body's radiated pressure in pascals, 1 m in
// front of the board. Nothing is filtered, compressed or boosted. Numbers
// describe spectra and energies; they do not say whether a sound is good.
import { mkdirSync, writeFileSync } from 'node:fs'
import { impedance } from '../src/experimental/string/modalString.ts'
import { modalMobility } from '../src/experimental/string/soundboard.ts'
import { BAR_BRIDGE, BAR_BRIDGE_440, BAR_BRIDGE_880, BAR_BRIDGE_FIRMER_TIE, BAR_STRING, barBridgeWith, barMass, barOnBoardModes, buildStringBarBody, LIGHT_STRIKER, RIGID_MODES, STROKES, supportPoints, type StringBarBody } from '../src/experimental/string/stringBarBody.ts'
import { buildPlayableStringBody, pluckCall, radiation, STRING_DENSITY } from '../src/experimental/string/stringBody.ts'
import type { Call } from '../src/experimental/wasm/engine.ts'
import { aWeighted, BANDS, bandShares, levels, pitchNear, type Levels } from './hybrid-study.ts'
import { SR } from './lib.ts'
import { fsPath, path, writeWav } from './offline.ts'
import { partial } from './radiation.ts'
import { approvedStringBody, cents, F0, fallTime, FULL_SCALE, measure, perform, PLUCK, pluckAt, retriggerAt, shareNear, spectralPeaks, strikeAt, STROKE, touchAt, type Run } from './three-body.ts'
import { createWorklet } from './worklet.ts'

const OUT = 'renders/bar-bridge'
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
const bands = (x: ArrayLike<number>) => Object.fromEntries(bandShares(x).map((share, i) => [`${BANDS[i]}-${BANDS[i + 1]} Hz`, Number((100 * share).toFixed(1))]))
const lump = (s: StringBarBody): StringBarBody => ({ ...s, bar: { ...s.bar, bendingModes: 0 } })
const light = (s: StringBarBody): StringBarBody => ({ ...s, mallet: LIGHT_STRIKER })
const bending = (run: Run, s: StringBarBody) => 0.5 * barMass(s.bar) * largest(run.barModes[RIGID_MODES]) ** 2
const second = Math.round(SR / 128)
const harmonics = [1, 2, 3, 4, 5, 6, 7, 8]
const m: Record<string, unknown> = { units: 'energies as stated, pressures Pa or mPa, levels dB re 20 uPa (LAFmax: A-weighted, 125 ms)', excitation: { pluck: `${PLUCK} N, softness 0.3, at 0.8 of the string unless stated`, standardStroke: `20 g mallet, hardness 0.5, ${STROKE} m/s`, lightStriker: `${1000 * LIGHT_STRIKER.mass} g, hardness 0.5; gentle ${STROKES.gentle}, medium ${STROKES.medium}, strong ${STROKES.strong} m/s` } }
const reference = await approvedStringBody(4)
const refLevels = levels(reference.pressure)
const re = (x: Float32Array, n: number) => dB(partial(x, n * F0) / partial(reference.pressure, n * F0))

/** The bar's lowest bending mode as it stands, Hz: its strongest component after a stroke, within a fifth of `near`. */
const noteNear = (run: Run, near: number) => spectralPeaks(run.barModes[RIGID_MODES], 0.05, 1.5, 1, near / 1.5, near * 1.5)[0][0]

/** What a pluck of `s` is, in the numbers this study uses. `n`: the harmonic its bar is meant for. */
async function plucked(s: StringBarBody, n: number, pluck?: Run) {
  const p = pluck ?? (await measure(s, 'pluck', 4))
  const dead = await measure(lump(s), 'pluck', 4)
  const l = levels(p.pressure)
  const nominal = Math.sqrt(s.tension / STRING_DENSITY) / (2 * s.length)
  const others = harmonics.filter((h) => h !== n && h !== 5).map((h) => [h, re(p.pressure, h)] as const)
  return {
    ...show(l), LAFmax_re_approved_dB: d1(l.lafMax_dB - refLevels.lafMax_dB), stringPitch_cents: Number(cents(pitchNear(p.stringVelocity, nominal), nominal).toFixed(2)),
    harmonics1to8_mPa: harmonics.map((h) => r(1000 * partial(p.pressure, h * F0), 3)), harmonics1to8_re_approved_dB: harmonics.map((h) => re(p.pressure, h)),
    atTheBarsHarmonic: { re_approved_dB: re(p.pressure, n), strongestInTheFirstHalfSecond_mPa: r(1000 * (spectralPeaks(p.pressure, 0, 0.5, 1, 0.97 * n * F0, 1.03 * n * F0)[0]?.[1] ?? 0), 3), from1s_mPa: r(1000 * partial(p.pressure, n * F0, SR), 3), from1s_re_approved_dB: dB(partial(p.pressure, n * F0, SR) / partial(reference.pressure, n * F0, SR)), whatTheBarsBendingAdds_dB: dB(partial(p.pressure, n * F0) / partial(dead.pressure, n * F0)) },
    largestRiseAtAnyOtherHarmonic: (() => { const [h, v] = others.reduce((a, b) => (b[1] > a[1] ? b : a)); return { harmonic: h, dB: v, mPa: r(1000 * partial(p.pressure, h * F0), 3) } })(),
    strongestComponents_first0p5s: spectralPeaks(p.pressure, 0, 0.5, 4).map(([f, a]) => `${Math.round(f)} Hz ${r(1000 * a, 3)} mPa`),
    stringEnergyAfter1s_percentOfItsMost: Number(((100 * p.energy.string[second]) / p.peak.string).toPrecision(3)),
    energy: { barBendingAtItsMost_uJ: r(1e6 * bending(p, s)), barBending_percentOfThePluck: Number(((100 * bending(p, s)) / p.peak.in).toPrecision(2)), jointForward_mJ: r(1000 * p.toBoard), jointBack_mJ: r(1000 * p.fromBoard), barsMaterialTook_uJ: r(1e6 * p.barLoss) },
    energyByBand_percent: bands(p.pressure), solverIterationsWorst: p.worstIterations, faults: p.faults,
  }
}
async function struck(s: StringBarBody, n: number, stroke = STROKE) {
  const k = await measure(s, 'strike', 4, { stroke })
  const knock = await measure(lump(s), 'strike', 4, { stroke })
  const l = levels(k.pressure)
  const note = noteNear(k, n * F0)
  const rebound = Math.sqrt((2 * k.energy.mallet.at(-1)!) / s.mallet!.mass)
  return {
    run: k,
    numbers: {
      mallet: { mass_g: 1000 * s.mallet!.mass, velocity_m_per_s: stroke, momentum_gm_per_s: r(1000 * s.mallet!.mass * stroke), energy_mJ: r(500 * s.mallet!.mass * stroke ** 2), impulseGiven_Ns: r(s.mallet!.mass * (stroke + rebound)), energyGiven_mJ: r(1000 * k.malletGave), contact_ms: r(1000 * k.contactSeconds, 2), forcePeak_N: r(k.contactForcePeak) },
      ...show(l), knockAlone_LAFmax_dB: d1(levels(knock.pressure).lafMax_dB),
      barsNote: { asItStands_Hz: r(note, 5), cents_re_itsHarmonic: d1(cents(note, n * F0)), motionFalls20dB_s: r(fallTime(k.barModes[RIGID_MODES]), 2), inTheSound_from0p3s_mPa: r(1000 * partial(k.pressure, note, 14400), 3), shareOfSoundEnergy_percent: d1(100 * shareNear(k.pressure, [note], 1.01)) },
      string: { atItsMost_percentOfWhatTheMalletGave: Number(((100 * k.peak.string) / k.malletGave).toPrecision(3)), fundamentalInTheSound_from0p3s_mPa: r(1000 * partial(k.pressure, F0, 14400), 3) },
      energyByBand_percent: bands(k.pressure), solverIterationsWorst: k.worstIterations, faults: k.faults,
    },
  }
}

// ---- 1. The reference: architecture B of Phase 3D.9 -----------------------------------------------------------------
const B = BAR_BRIDGE
const refPluck = await measure(B, 'pluck', 4)
const refStrike = await struck(B, 6)
{
  m['1 reference: architecture B'] = {
    bar: { length_m: B.bar.length, width_mm: B.bar.width, thickness_mm: B.bar.thickness, mass_g: r(1000 * barMass(B.bar)), padsAt: B.bar.supports, padsStandAt: supportPoints(B).map((q) => q.map((x) => Number(x.toFixed(3)))), pads: B.mount, stringTiedAt: B.stringOnBar!.at, tie_N_per_m: B.stringOnBar!.stiffness, struckAt: B.bar.strikeAt },
    'approved string on its box, plucked': { ...show(refLevels), stringPitch_cents: Number(cents(pitchNear(reference.stringVelocity, F0), F0).toFixed(2)), harmonics1to8_mPa: harmonics.map((h) => r(1000 * partial(reference.pressure, h * F0), 3)), energyByBand_percent: bands(reference.pressure) },
    plucked: await plucked(B, 6, refPluck), struck: refStrike.numbers,
    strokeOverPluck_LAFmax_dB: d1(levels(refStrike.run.pressure).lafMax_dB - levels(refPluck.pressure).lafMax_dB),
  }
}

// ---- 2. The bar on other harmonics -----------------------------------------------------------------------------------------
const tunedBars: Record<number, StringBarBody> = {}
{
  const out: Record<string, unknown> = {}
  // Bars of the reference bar's mass: the same thickness, a length that puts the note where it is wanted, a width that keeps 54 g.
  const start: Record<number, { length: number; width: number }> = { 3: { length: 0.2814, width: 14.2 }, 4: { length: 0.2437, width: 16.4 }, 5: { length: 0.2177, width: 18.3 }, 6: { length: 0.1986, width: 20 }, 8: { length: 0.1724, width: 23.2 } }
  for (const n of [3, 4, 5, 6, 8]) {
    // Tune the bar as it stands on its pads with the string cut loose: its own note there, not the free bar's.
    let L = start[n].length
    let alone = 0
    for (let i = 0; i < 4; i++) {
      alone = noteNear(await measure({ ...barBridgeWith({ ...start[n], length: L }), stringOn: false }, 'strike', 1.5), n * F0)
      if (Math.abs(cents(alone, n * F0)) < 0.5) break
      L *= Math.sqrt(alone / (n * F0))
    }
    const onTheHarmonic = barBridgeWith({ ...start[n], length: Number(L.toFixed(4)) })
    tunedBars[n] = onTheHarmonic
    const scan: Record<string, unknown> = {}
    for (const detune of [-30, -15, -8, 0, 8, 15, 30]) {
      const s = barBridgeWith({ ...start[n], length: onTheHarmonic.bar.length * 2 ** (-detune / 2400) })
      const [p, k] = [await measure(s, 'pluck', 4), await measure(s, 'strike', 2)]
      scan[`bar ${detune > 0 ? '+' : ''}${detune} cents from the harmonic`] = { pluck_LAFmax_re_approved_dB: d1(levels(p.pressure).lafMax_dB - refLevels.lafMax_dB), atTheHarmonic_re_approved_dB: re(p.pressure, n), firstHalfSecond_mPa: r(1000 * (spectralPeaks(p.pressure, 0, 0.5, 1, 0.97 * n * F0, 1.03 * n * F0)[0]?.[1] ?? 0), 3), from1s_mPa: r(1000 * partial(p.pressure, n * F0, SR), 3), barBending_percentOfThePluck: Number(((100 * bending(p, s)) / p.peak.in).toPrecision(2)), fourthHarmonic_re_approved_dB: re(p.pressure, 4), stringPitch_cents: Number(cents(pitchNear(p.stringVelocity, F0), F0).toFixed(2)), stringsShareOfAStroke_percent: Number(((100 * k.peak.string) / k.malletGave).toPrecision(2)), barsNoteMotionFalls20dB_s: r(fallTime(k.barModes[RIGID_MODES]), 2) }
    }
    const k = await struck(onTheHarmonic, n)
    out[`harmonic ${n} (${Math.round(n * F0)} Hz)`] = {
      bar: { length_m: onTheHarmonic.bar.length, width_mm: onTheHarmonic.bar.width, thickness_mm: onTheHarmonic.bar.thickness, mass_g: r(1000 * barMass(onTheHarmonic.bar)), secondPadStandsAt_x: Number(supportPoints(onTheHarmonic)[1][0].toFixed(3)) },
      note_Hz: { freeBar: r(barOnBoardModes(onTheHarmonic.bar, SR)[RIGID_MODES].frequency, 5), onItsPadsStringCutLoose: r(alone, 5), onItsPadsWithTheStringTied: k.numbers.barsNote.asItStands_Hz },
      plucked: await plucked(onTheHarmonic, n), struck: k.numbers, detuning: scan,
    }
  }
  // The two that are kept, as defined in stringBarBody.ts.
  out['kept: 440 Hz bar (BAR_BRIDGE_440)'] = { plucked: await plucked(BAR_BRIDGE_440, 4), struck: (await struck(BAR_BRIDGE_440, 4)).numbers }
  out['kept: 880 Hz bar (BAR_BRIDGE_880)'] = { plucked: await plucked(BAR_BRIDGE_880, 8), struck: (await struck(BAR_BRIDGE_880, 8)).numbers }
  m['2 the bar on other harmonics'] = out
}

// ---- 3. Where the string is tied ----------------------------------------------------------------------------------------------
{
  const Z = impedance({ length: B.length, tension: B.tension, density: STRING_DENSITY })
  const rows: Record<string, unknown> = {}
  for (const at of [0.224, 0.215, 0.21, 0.2, 0.19, 0.18, 0.165, 0.15, 0.125, 0.1]) {
    const s = barBridgeWith({}, at)
    const free = barOnBoardModes(s.bar, SR, [at])
    const size = (f: number) => Math.hypot(...modalMobility(free, BAR_STRING, f))
    const [p, k] = [await measure(s, 'pluck', 4), await measure(s, 'strike', 4)]
    const l = levels(p.pressure)
    rows[`tied at ${at}`] = {
      stringImpedanceTimesTheFreeBarsMobility: { at110Hz: r(Z * size(F0), 2), at660Hz: r(Z * size(6 * F0), 2) },
      pluck: { stringPitch_cents: Number(cents(pitchNear(p.stringVelocity, F0), F0).toFixed(2)), LAFmax_re_approved_dB: d1(l.lafMax_dB - refLevels.lafMax_dB), harmonics_1_2_3_4_6_7_re_approved_dB: [1, 2, 3, 4, 6, 7].map((h) => re(p.pressure, h)), at660Hz_firstHalfSecond_mPa: r(1000 * (spectralPeaks(p.pressure, 0, 0.5, 1, 640, 680)[0]?.[1] ?? 0), 3), at660Hz_from1s_mPa: r(1000 * partial(p.pressure, 6 * F0, SR), 3), secondsToLAFmax: r(l.attack, 2), secondsToFall20dB: r(l.fall20, 2), stringEnergyAfter1s_percent: Number(((100 * p.energy.string[second]) / p.peak.string).toPrecision(2)), barBending_percentOfThePluck: Number(((100 * bending(p, s)) / p.peak.in).toPrecision(2)), jointForward_mJ: r(1000 * p.toBoard), energyByBand_500to1000Hz_percent: Number((100 * bandShares(p.pressure)[2]).toFixed(1)) },
      strike: { barsNote_cents_re_6thHarmonic: d1(cents(noteNear(k, 6 * F0), 6 * F0)), stringsShare_percent: Number(((100 * k.peak.string) / k.malletGave).toPrecision(2)), barsNoteMotionFalls20dB_s: r(fallTime(k.barModes[RIGID_MODES]), 2) },
      solverIterationsWorst: Math.max(p.worstIterations, k.worstIterations), faults: p.faults + k.faults,
    }
  }
  m['3 where the string is tied (reference bar)'] = rows
  m['3b kept: firmer tie at 0.18 (BAR_BRIDGE_FIRMER_TIE)'] = { plucked: await plucked(BAR_BRIDGE_FIRMER_TIE, 6), struck: (await struck(BAR_BRIDGE_FIRMER_TIE, 6)).numbers }
}

// ---- 4. Striking ---------------------------------------------------------------------------------------------------------------
const strokes: Record<string, Float32Array> = {}
{
  const pluckLevel = levels(refPluck.pressure).lafMax_dB
  const row = async (s: StringBarBody, stroke: number) => {
    const k = await struck(s, 6, stroke)
    return { ...k.numbers, 'stroke over the 2 N pluck, LAFmax dB': d1(levels(k.run.pressure).lafMax_dB - pluckLevel), pressure: k.run.pressure }
  }
  const strip = (x: Record<string, unknown>) => Object.fromEntries(Object.entries(x).filter(([key]) => key !== 'pressure' && key !== 'energyByBand_percent'))
  const grid: Record<string, unknown> = {}
  for (const mass of [0.002, 0.005, 0.01, 0.02]) for (const v of [0.5, 1, 2]) grid[`${1000 * mass} g at ${v} m/s`] = strip(await row({ ...B, mallet: { mass, stiffness: 1e8 } }, v))
  const hardness: Record<string, unknown> = {}
  for (const h of [0.2, 0.35, 0.5, 0.65, 0.8]) hardness[`hardness ${h} (contact ${(10 ** (6 + 4 * h)).toExponential(1)} N/m^1.5), 5 g at 1 m/s`] = strip(await row({ ...B, mallet: { mass: 0.005, stiffness: 10 ** (6 + 4 * h) } }, 1))
  const place: Record<string, unknown> = {}
  for (const at of [0.5, 0.35, 0.2, 0.05]) place[`struck at ${at} of the bar, 5 g at 1 m/s`] = strip(await row({ ...light(B), bar: { ...B.bar, strikeAt: at } }, 1))
  const three: Record<string, unknown> = {}
  for (const [name, v] of Object.entries(STROKES)) {
    const x = await row(light(B), v)
    strokes[name] = x.pressure
    three[`${name}: ${v} m/s`] = strip(x)
  }
  // The plucks they are to sit beside.
  const plucks: Record<string, unknown> = {}
  for (const force of [0.5, 2, 8]) {
    const p = await measure(B, 'pluck', 4, { pluck: force })
    plucks[`${force} N`] = { peak_Pa: r(levels(p.pressure).peakPa), LAFmax_dB: d1(levels(p.pressure).lafMax_dB) }
  }
  m['4 striking'] = { 'the light striker, three strokes': three, 'mallet mass and speed (hardness 0.5, struck at the middle)': grid, hardness, 'where it is struck': place, 'plucks, for comparison': plucks }
}

// ---- 5. Playing it ---------------------------------------------------------------------------------------------------------------
const played: Record<string, Float32Array> = {}
{
  const every = (seconds: number, step: number) => Array.from({ length: Math.floor(seconds / step) }, (_, i) => i * step)
  const L = light(B)
  const scene = async (s: StringBarBody, events: Parameters<typeof perform>[1], seconds: number) => {
    const p = await perform(s, events, seconds)
    const l = levels(p.pressure)
    return { pressure: p.pressure, numbers: { peak_Pa: r(l.peakPa), LAFmax_dB: d1(l.lafMax_dB), largestStepBetweenSamples_overPeak: r(p.largestStepOverPeak, 2), instrumentEnergyAtMost_mJ: r(1000 * Math.max(...p.energy)), energyLeftAtTheEnd_percentOfMost: Number(((100 * p.energy.at(-1)!) / Math.max(...p.energy)).toPrecision(2)), stringEnergyLeft_uJ: r(1e6 * p.stringEnergy), solverIterationsWorst: p.worstIterations, faults: p.faults } }
  }
  // How the bar answers a pluck: by how hard, and by where.
  const byForce: Record<string, unknown> = {}
  for (const force of [0.5, 2, 8]) {
    const p = await measure(B, 'pluck', 4, { pluck: force })
    byForce[`${force} N`] = { peak_Pa: r(levels(p.pressure).peakPa), LAFmax_dB: d1(levels(p.pressure).lafMax_dB), barBending_percentOfThePluck: Number(((100 * bending(p, B)) / p.peak.in).toPrecision(3)), at660Hz_firstHalfSecond_mPa: r(1000 * (spectralPeaks(p.pressure, 0, 0.5, 1, 640, 680)[0]?.[1] ?? 0), 3), fundamental_mPa: r(1000 * partial(p.pressure, F0), 3), stringPitch_cents: Number(cents(pitchNear(p.stringVelocity, F0), F0).toFixed(2)) }
  }
  const byPlace: Record<string, unknown> = {}
  for (const at of [0.5, 0.65, 0.75, 0.8, 0.85, 0.9]) {
    const s = { ...B, pluckAt: at }
    const p = await measure(s, 'pluck', 4)
    byPlace[`plucked at ${at} of the string`] = { peak_Pa: r(levels(p.pressure).peakPa), LAFmax_dB: d1(levels(p.pressure).lafMax_dB), 'share of a pluck\'s energy in the 6th harmonic, by the string\'s own shape (relative)': r(Math.sin(6 * Math.PI * (1 - at)) ** 2, 2), barBending_percentOfThePluck: Number(((100 * bending(p, s)) / p.peak.in).toPrecision(2)), at660Hz_firstHalfSecond_mPa: r(1000 * (spectralPeaks(p.pressure, 0, 0.5, 1, 640, 680)[0]?.[1] ?? 0), 3), fundamental_mPa: r(1000 * partial(p.pressure, F0), 3), energyByBand_500to1000Hz_percent: Number((100 * bandShares(p.pressure)[2]).toFixed(1)), stringPitch_cents: Number(cents(pitchNear(p.stringVelocity, F0), F0).toFixed(2)) }
  }
  const phrase = [pluckAt(0), strikeAt(0.75, STROKES.medium), pluckAt(1.5), strikeAt(2.25, STROKES.gentle), pluckAt(3, 4), strikeAt(3.75, STROKES.strong)]
  const scenes: [string, StringBarBody, Parameters<typeof perform>[1], number][] = [
    ['plucked four times a second for 3 s', B, every(3, 0.25).map((t) => pluckAt(t)), 6],
    ['plucked four times a second for 3 s, each pluck retriggered (a finger rests 30 ms first)', B, every(3, 0.25).map((t) => retriggerAt(t, B)), 6],
    ['light striker, medium stroke, four times a second for 3 s', L, every(3, 0.25).map((t) => strikeAt(t, STROKES.medium)), 6],
    ['a phrase: pluck, medium stroke, pluck, gentle stroke, hard pluck (4 N), strong stroke, 0.75 s apart (light striker)', L, phrase, 6],
    ['pluck and medium stroke at the same instant (light striker)', L, [pluckAt(0), strikeAt(0, STROKES.medium)], 4],
    ['plucked, then a finger laid on the string at 0.5 s', B, [pluckAt(0), touchAt(0.5, B, true)], 2.5],
    ['struck (light, medium), then a finger laid on the string at 0.2 s', L, [strikeAt(0, STROKES.medium), touchAt(0.2, L, true)], 2],
    ['one pluck left to die away, 8 s', B, [pluckAt(0)], 8],
    ['as hard as allowed: 8 N plucks and 5 m/s strokes of the 20 g mallet in turn, ten a second for 3 s', B, every(3, 0.1).map((t, i) => (i % 2 ? strikeAt(t, 5) : pluckAt(t, 8))), 6],
  ]
  const rows: Record<string, unknown> = {}
  for (const [name, s, events, seconds] of scenes) {
    const x = await scene(s, events, seconds)
    rows[name] = x.numbers
    if (/^a phrase/.test(name)) played.phrase = x.pressure
    if (/same instant/.test(name)) played.together = x.pressure
    if (/die away/.test(name)) {
      const peak = largest(x.pressure)
      const below = (ratio: number) => { let last = 0; for (let i = 0; i < x.pressure.length; i++) if (Math.abs(x.pressure[i]) > peak * ratio) last = i; return Number((last / SR).toFixed(2)) }
      ;(rows[name] as Record<string, unknown>).lastAbove_s = { '-20 dB of its peak': below(0.1), '-40 dB': below(0.01), '-60 dB': below(0.001) }
    }
  }
  m['5 playing it'] = { 'how the bar answers a pluck, by force': byForce, 'how the bar answers a pluck, by where it is plucked': byPlace, scenes: rows }
}

// ---- 6. Cost in Node --------------------------------------------------------------------------------------------------------------
const performanceResult: Record<string, unknown> = {}
{
  const r3 = radiation(SR)
  const radiate: Call = ['radiate', r3.perSample, r3.b0, r3.b1, r3.a1, FULL_SCALE]
  const box = buildPlayableStringBody({ tension: 73.5, length: 0.65, pluckAt: 0.8, joined: true }, SR)
  const systems: [string, Call[], Call[]][] = [['approved string on its box, plucked five times a second', [...box.calls, radiate], [pluckCall(box, PLUCK)]]]
  for (const [name, s, stroke] of [['reference B, 20 g mallet', B, STROKE], ['reference B, light striker', light(B), STROKES.medium], ['440 Hz bar, light striker', light(BAR_BRIDGE_440), STROKES.medium], ['880 Hz bar, light striker', light(BAR_BRIDGE_880), STROKES.medium], ['firmer tie, light striker', light(BAR_BRIDGE_FIRMER_TIE), STROKES.medium]] as const) {
    const b = buildStringBarBody(s, SR)
    systems.push([`${name}, plucked and struck in turn`, [...b.calls, radiate], [pluckCall(b, PLUCK), ['launch', b.mallet!, stroke]]])
  }
  for (const [name, calls, play] of systems) {
    const speeds: number[] = []
    let [iterations, faults, memory] = [0, 0, 0]
    for (let run = 0; run < 6; run++) {
      const worklet = await createWorklet(calls)
      const t0 = performance.now()
      worklet.render(20 * SR, (block) => block % 37 === 0 && (play.length > 1 || (block / 37) % 2 === 0) && worklet.send([play[(block / 37) % play.length]]))
      if (run > 0) speeds.push((100 * (performance.now() - t0)) / 20000)
      iterations = Math.max(iterations, worklet.engine.worstIterations())
      faults += worklet.engine.faults()
      memory = worklet.engine.memory.buffer.byteLength
    }
    speeds.sort((a, b) => a - b)
    performanceResult[name] = { percentOfOneCore_median: Number(speeds[2].toFixed(2)), lowestAndHighestOfFiveRuns: [Number(speeds[0].toFixed(2)), Number(speeds[4].toFixed(2))], connections: calls.filter((c) => c[0] === 'addSpring' || c[0] === 'addContact').length, solverIterationsWorst: iterations, faults, engineMemoryBytes: memory }
  }
}

// ---- 7. Listening files --------------------------------------------------------------------------------------------------------------
const pluck440 = await measure(BAR_BRIDGE_440, 'pluck', 4)
const pluck880 = await measure(BAR_BRIDGE_880, 'pluck', 4)
const pluckTie = await measure(BAR_BRIDGE_FIRMER_TIE, 'pluck', 4)
const describe = (s: StringBarBody) => ({ bar: `${s.bar.length} m x ${s.bar.width} mm x ${s.bar.thickness} mm, ${r(1000 * barMass(s.bar))} g`, stringTiedAt: s.stringOnBar!.at, pads: s.mount, padsStandAt: supportPoints(s).map((q) => q.map((x) => Number(x.toFixed(3)))) })
const transfer = (p: Run, s: StringBarBody) => ({ barBendingAtItsMost_uJ: r(1e6 * bending(p, s)), barBending_percentOfThePluck: Number(((100 * bending(p, s)) / p.peak.in).toPrecision(2)), stringPitch_cents: Number(cents(pitchNear(p.stringVelocity, F0), F0).toFixed(2)) })
const pl = `pluck ${PLUCK} N at 0.8 of the string`
const files: [string, Float32Array, string, string, Record<string, unknown>?][] = [
  ['01-approved-string-and-body-plucked', reference.pressure, 'the approved string instrument: the reference', pl],
  ['02-reference-B-bar-as-bridge-660-plucked', refPluck.pressure, 'architecture B of Phase 3D.9: the bar on the string\'s 6th harmonic', pl, { ...describe(B), ...transfer(refPluck, B) }],
  ['03-lower-harmonic-440-bar-plucked', pluck440.pressure, 'the bar on the 4th harmonic (440 Hz)', pl, { ...describe(BAR_BRIDGE_440), ...transfer(pluck440, BAR_BRIDGE_440) }],
  ['04-higher-harmonic-880-bar-plucked', pluck880.pressure, 'the bar on the 8th harmonic (880 Hz), 8 cents flat of it', pl, { ...describe(BAR_BRIDGE_880), ...transfer(pluck880, BAR_BRIDGE_880) }],
  ['05-firmer-tie-0p18-plucked', pluckTie.pressure, 'the reference bar with the string tied at 0.18 instead of 0.2', pl, { ...describe(BAR_BRIDGE_FIRMER_TIE), ...transfer(pluckTie, BAR_BRIDGE_FIRMER_TIE) }],
  ['06-gentle-strike', strokes.gentle, 'reference B, light striker', `5 g at ${STROKES.gentle} m/s, hardness 0.5, at the bar's middle`, describe(B)],
  ['07-medium-strike', strokes.medium, 'reference B, light striker', `5 g at ${STROKES.medium} m/s`, describe(B)],
  ['08-strong-strike', strokes.strong, 'reference B, light striker', `5 g at ${STROKES.strong} m/s`, describe(B)],
  ['09-phrase-plucks-and-strikes-in-turn', played.phrase, 'reference B, light striker: pluck 2 N, medium stroke, pluck 2 N, gentle stroke, pluck 4 N, strong stroke, 0.75 s apart', 'as described', describe(B)],
  ['10-pluck-and-medium-strike-together', played.together, 'reference B, light striker: plucked and struck at the same instant', `pluck ${PLUCK} N; 5 g at ${STROKES.medium} m/s`, describe(B)],
]
const exposure = (x: Float32Array) => Math.sqrt(aWeighted(x).reduce((s, v) => s + v * v, 0))
const commonGain = 0.9 / Math.max(...files.map(([, x]) => largest(x)))
const matchedTarget = Math.min(...files.map(([, x]) => (0.9 * exposure(x)) / largest(x)))
const info: Record<string, unknown> = {}
for (const [name, x, what, excitation, physical] of files) {
  const matched = matchedTarget / exposure(x)
  writeWav(`${OUT}/common/${name}.wav`, Float32Array.from(x, (v) => v * commonGain))
  writeWav(`${OUT}/matched/${name}.wav`, Float32Array.from(x, (v) => v * matched))
  info[name] = { unit: 'Pa', what, excitation, seconds: Number((x.length / SR).toFixed(2)), ...(physical ? { physical } : {}), ...show(levels(x)), harmonics1to8_mPa: harmonics.map((h) => r(1000 * partial(x, h * F0), 3)), energyByBand_percent: bands(x), common: { gain_perPascal: r(commonGain), gain_dB: dB(commonGain), peakInFile_dBFS: dB(largest(x) * commonGain) }, matched: { gain_perPascal: r(matched), gain_dB: dB(matched), peakInFile_dBFS: dB(largest(x) * matched) } }
}
writeFileSync(path(`${OUT}/manifest.json`), JSON.stringify({
  sampleRate: SR, bitDepth: 24, unit: 'Pa: the approved body\'s radiated sound pressure, 1 m in front of the board; a model\'s, not calibrated',
  common: `every file multiplied by the same ${r(commonGain)} per pascal (the loudest peaks at 0.9 of full scale): compare loudness`,
  matched: 'each file scaled to the same A-weighted sound exposure: compare timbre only',
  nothingElseIsDone: 'one multiplication per file; no filter, compression, correction or added source',
  listeningApproval: 'none: these have been measured, not heard',
  string: 'A2, 73.5 N, 0.65 m (the approved string); body and air: approved, unchanged',
  files: info,
}, null, 2))
writeFileSync(path(`${OUT}/measurements.json`), JSON.stringify(m, null, 2))
writeFileSync(path(`${OUT}/performance.json`), JSON.stringify({ sampleRate: SR, node: process.version, note: 'Node, not a browser audio thread; five timed runs of 20 s each', results: performanceResult }, null, 2))
console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => { const x = v as Record<string, unknown>; return [k, { peak_Pa: x.peak_Pa, LAFmax_dB: x.LAFmax_dB, fall20_s: x.secondsToFall20dB, common_dBFS: (x.common as Record<string, unknown>).peakInFile_dBFS, matched_dB: (x.matched as Record<string, unknown>).gain_dB }] })))
console.table(performanceResult)
console.log(`\nwritten to ${fsPath(OUT)}`)
