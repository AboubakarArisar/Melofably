// Phase 3D.5: why the radiated hybrid's pluck is 42 dB below its mallet
// stroke, what physical tuning does about it, and listening files.
//
//   npm run render:hybrid-study
//
// Output: renders/hybrid-study/
//   measurements.json   the chain (energy, joint, modes, pressure), radiation
//                       of the bar, listener positions, parameter sweeps,
//                       the candidates and their checks against the
//                       Phase 3D.3 reference
//   listening.json      every WAV's unit, true peak and levels, and its gain
//   matched/*.wav       level-matched (equal A-weighted sound exposure), for timbre
//   common/*.wav        one gain for every pressure file, for relative loudness
//   performance.json    cost in Node
//
// Nothing here boosts, compresses or filters a sound. A gain is applied only
// when a WAV is written, and is recorded. The pressures are a model's, in
// free air at 1 m and 45 degrees, and are not calibrated.
import { mkdirSync, writeFileSync } from 'node:fs'
import type { Graph } from '../src/builder/graph.ts'
import { instrumentCalls, translate } from '../src/builder/translate.ts'
import { SR } from './lib.ts'
import { fsPath, path, writeWav } from './offline.ts'
import { againstReference, approvedOutput, aWeighted, BANDS, bandShares, CANDIDATES, chain, crossover, design, dipoleArea, geometryOf, levels, part, pitchNear, quick, radiationOf, SHARP_PLUCK, SOFT_MALLET, stringPitch, type Design, type Levels } from './hybrid-study.ts'
import { frequenciesOf, partial } from './radiation.ts'
import { createWorklet } from './worklet.ts'

const OUT = 'renders/hybrid-study'
for (const dir of ['', '/matched', '/common']) mkdirSync(path(OUT + dir), { recursive: true })
const r = (x: number | null, digits = 3) => (x === null ? null : Number(x.toPrecision(digits)))
const d1 = (x: number | null) => (x === null ? null : Number(x.toFixed(1)))
const dB = (ratio: number) => Number((20 * Math.log10(ratio)).toFixed(1))
const dBe = (ratio: number) => Number((10 * Math.log10(ratio)).toFixed(1))
const largest = (x: ArrayLike<number>) => {
  let m = 0
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}
const show = (l: Levels) => ({ peak_Pa: r(l.peakPa), peak_dB: d1(l.peak_dB), SEL_dB: d1(l.sel_dB), SEL_A_dB: d1(l.selA_dB), LAFmax_dB: d1(l.lafMax_dB), secondsToLAFmax: r(l.attack, 2), secondsToFall20dB: r(l.fall20, 2) })
const bands = (x: ArrayLike<number>) => Object.fromEntries(bandShares(x).map((share, i) => [`${BANDS[i]}-${BANDS[i + 1]} Hz`, Number((100 * share).toFixed(2))]))
const F0 = stringPitch({ tension: 73.5, length: 0.65 })
const m: Record<string, unknown> = { units: 'energies J, powers W, velocities m/s, pressures Pa, levels dB re 20 uPa (SEL: referred to 1 s; LAFmax: A-weighted, 125 ms time weighting)', listener: 'free air, 1 m, 45 degrees', stringPitchHz: r(F0, 6) }

// ---- 1. The whole chain, for the experimental example as it is ----------------------------------------------------
const base = design()
const [pluck, strike] = [await chain(base, 'pluck', 4), await chain(base, 'strike', 4)]
{
  const one = (c: typeof pluck, playing: string) => ({
    energyPutIn_J: r(c.energyIn), ...(playing === 'strike' ? { malletThrown_J: c.malletThrown, malletLeavesWith_J: r(c.energy.mallet.at(-1)!) } : {}),
    stringEnergyMax_J: r(Math.max(...c.energy.string)), barEnergyMax_J: r(Math.max(...c.energy.bar)),
    barShareOfEnergyMax_percent: d1(100 * c.barSharePeak),
    joint: { netWorkOnBar_max_J: r(c.jointWorkPeak), netWorkOnBar_end_J: r(c.jointWork.at(-1)!), allStringToBar_J: r(c.jointForward), powerPeak_W: r(c.jointPowerPeak) },
    barModes: c.modes.map((mode) => ({ Hz: Math.round(mode.frequency), peakModalVelocity: r(mode.peakVelocity), peakEnergy_J: r(mode.peakEnergy), shareOfBarEnergy_percent: Number(((100 * mode.peakEnergy) / c.modes.reduce((s, x) => s + x.peakEnergy, 0)).toFixed(2)) })),
    barVelocityAtStrikePoint: { peak: r(largest(c.velocity)), energyByBand_percent: bands(c.velocity) },
    pressure: { ...show(levels(c.pressure)), energyByBand_percent: bands(c.pressure) },
    stringPitch_cents: Number((1200 * Math.log2(pitchNear(c.stringVelocity, F0) / F0)).toFixed(2)),
    solverIterationsWorst: c.worstIterations, faults: c.faults,
  })
  const [lp, ls] = [levels(pluck.pressure), levels(strike.pressure)]
  const modeEnergy = (c: typeof pluck) => c.modes.reduce((s, x) => s + x.peakEnergy, 0)
  m['1 chain: the experimental example, pluck 4 N and mallet 20 g at 1.5 m/s'] = {
    pluck: one(pluck, 'pluck'), strike: one(strike, 'strike'),
    'strike over pluck, dB': {
      peakPressure: d1(ls.peak_dB - lp.peak_dB), soundEnergy_SEL: d1(ls.sel_dB - lp.sel_dB), soundEnergy_A_weighted: d1(ls.selA_dB - lp.selA_dB), LAFmax: d1(ls.lafMax_dB - lp.lafMax_dB),
      energyPutIn: dBe(strike.energyIn / pluck.energyIn), barEnergyMax: dBe(Math.max(...strike.energy.bar) / Math.max(...pluck.energy.bar)), barVelocityPeak: dB(largest(strike.velocity) / largest(pluck.velocity)),
      'sound energy per joule in the bar': Number((ls.sel_dB - lp.sel_dB - 10 * Math.log10(modeEnergy(strike) / modeEnergy(pluck))).toFixed(1)),
    },
  }
}

// ---- 2. How well the bar radiates ---------------------------------------------------------------------------------
{
  const bar = part(base, 'metalBar')
  const g = geometryOf(bar)
  const f = frequenciesOf(bar)
  const row = (n: number, hz: number) => {
    const x = radiationOf(g, n, hz)
    return { Hz: Math.round(hz), Pa_per_m_per_s: r(x.pressurePerVelocity), radiationEfficiency: r(x.efficiency), efficiency_dB: dBe(x.efficiency), reactiveOverRadiatedPower: r(x.reactiveOverRadiated), wavelengthOverBarLength: r(x.wavelengthOverLength), wavelengthOverBarWidth: r(x.wavelengthOverWidth) }
  }
  m['2 radiation of the bar (0.40 m x 40 mm x 10 mm), by the Phase 3D.3 model'] = {
    crossoverHz: Math.round(crossover(g)), dipoleArea_cm2: r(1e4 * dipoleArea(g)),
    'each mode at its own frequency': Object.fromEntries([0, 1, 2, 3, 4].map((n) => [`mode ${n + 1}`, row(n, f[n])])),
    'the lowest mode\'s shape, driven at the string\'s harmonics': Object.fromEntries([1, 2, 3, 4, 6, 9, 12, 16, 24].map((h) => [`harmonic ${h}`, row(0, h * F0)])),
  }
  // Where the listener is: the reference of Phase 3D.3, from the same recorded motion.
  const listeners = [[1, 0], [1, 30], [1, 45], [1, 60], [0.5, 45], [0.25, 45], [0.1, 45], [2, 45]].map(([distance, angle]) => ({ distance, angle }))
  const [p, s] = [await againstReference(base, 'pluck', 3, listeners), await againstReference(base, 'strike', 3, listeners)]
  m['2b listener position (frequency-domain reference): pluck, stroke and the gap'] = Object.fromEntries(listeners.map((l, i) => {
    const [lp, ls] = [levels(p.references[i]), levels(s.references[i])]
    return [`${l.distance} m, ${l.angle} degrees`, { pluck_LAFmax_dB: d1(lp.lafMax_dB), pluck_peak_dB: d1(lp.peak_dB), strike_LAFmax_dB: d1(ls.lafMax_dB), gap_LAFmax_dB: d1(ls.lafMax_dB - lp.lafMax_dB), gap_peak_dB: d1(ls.peak_dB - lp.peak_dB) }]
  }))
}

// ---- 3. One property at a time ------------------------------------------------------------------------------------
{
  const rows: Record<string, unknown> = {}
  async function row(label: string, d: Design) {
    const g = design(d)
    const s = part(g, 'steelString').params
    const nominal = stringPitch({ tension: s.tension, length: s.length })
    const [p, k] = [await chain(g, 'pluck', 3), await chain(g, 'strike', 3)]
    const [lp, lk] = [levels(p.pressure), levels(k.pressure)]
    rows[label] = { pluck_energyIn_mJ: r(1000 * p.energyIn), pluck_barShareMax_percent: d1(100 * p.barSharePeak), pluck_peak_dB: d1(lp.peak_dB), pluck_SEL_A_dB: d1(lp.selA_dB), pluck_LAFmax_dB: d1(lp.lafMax_dB), pluck_fall20_s: r(lp.fall20, 2), stringPitch_cents: Number((1200 * Math.log2(pitchNear(p.stringVelocity, nominal) / nominal)).toFixed(2)), strike_LAFmax_dB: d1(lk.lafMax_dB), gap_LAFmax_dB: d1(lk.lafMax_dB - lp.lafMax_dB), gap_peak_dB: d1(lk.peak_dB - lp.peak_dB), solverIterationsWorst: Math.max(p.worstIterations, k.worstIterations), faults: p.faults + k.faults }
  }
  await row('as it is', {})
  for (const v of [40, 60, 90, 120]) await row(`string tension ${v} N`, { string: { tension: v } })
  for (const v of [0.5, 0.58, 0.72, 0.8]) await row(`string length ${v} m`, { string: { length: v } })
  for (const v of [0.5, 0.65, 0.9, 0.95]) await row(`pluck position ${v}`, { string: { pluckPosition: v } })
  for (const v of [1, 8]) await row(`pluck force ${v} N`, { string: { pluckStrength: v } })
  for (const v of [0, 1]) await row(`pluck softness ${v}`, { string: { pluckSoftness: v } })
  for (const v of [0.2, 0.3, 0.35, 0.5, 0.7]) await row(`bar length ${v} m`, { bar: { length: v } })
  for (const v of [2, 4, 6, 20]) await row(`bar thickness ${v} mm`, { bar: { thickness: v } })
  for (const v of [10, 20, 80, 200]) await row(`bar width ${v} mm`, { bar: { width: v } })
  for (const v of ['steel', 'brass', 'bronze']) await row(`bar material ${v}`, { material: v })
  for (const v of [1e4, 1e5, 1e7, 1e8]) await row(`joint stiffness ${v} N/m`, { joint: { stiffness: v } })
  for (const v of [1, 10, 100]) await row(`joint damping ${v} N s/m`, { joint: { damping: v } })
  for (const v of [0, 0.05, 0.224, 0.35, 0.5]) await row(`connection position ${v}`, { bar: { connectionPosition: v } })
  for (const v of [0.1, 0.5, 5]) await row(`mallet velocity ${v} m/s`, { mallet: { velocity: v } })
  for (const v of [0, 0.15, 1]) await row(`mallet hardness ${v}`, { mallet: { hardness: v } })
  m['3 one property changed at a time (the rest as the example)'] = rows

  // Bar length in 5 mm steps with the string tied at the bar's end: where its modes meet the string's harmonics.
  const scan: Record<string, unknown> = {}
  for (let L = 0.2; L <= 0.6001; L += 0.005) {
    const g = design({ bar: { connectionPosition: 0, length: Number(L.toFixed(3)) } })
    const q = await quick(g, 'pluck', 2.5)
    scan[`${L.toFixed(3)} m`] = { pluck_LAFmax_dB: d1(q.levels.lafMax_dB), barShareMax_percent: d1(100 * q.barSharePeak), barModesOverStringPitch: frequenciesOf(part(g, 'metalBar')).slice(0, 5).map((x) => Number((x / F0).toFixed(2))) }
  }
  m['3b bar length, string tied at the bar\'s end'] = scan
}

// ---- 4. The candidates -------------------------------------------------------------------------------------------
const designs: Record<string, Design> = { 'experimental example (Phase 3D.4)': {}, 'end-tied': CANDIDATES.endTied, 'end-tied and tuned (bar 0.485 m)': CANDIDATES.tuned }
const sounds: Record<string, { pluck: Float32Array; strike: Float32Array; sharp: Float32Array; soft: Float32Array }> = {}
{
  const out: Record<string, unknown> = {}
  const reference = levels(pluck.pressure)
  for (const [name, d] of Object.entries(designs)) {
    const g = design(d)
    const [p, k] = [await chain(g, 'pluck', 4), await chain(g, 'strike', 4)]
    const sharp = await quick(design({ ...d, string: { ...d.string, ...SHARP_PLUCK } }), 'pluck', 4)
    const soft = await quick(design({ ...d, mallet: SOFT_MALLET }), 'strike', 4)
    sounds[name] = { pluck: p.pressure, strike: k.pressure, sharp: sharp.pressure, soft: soft.pressure }
    const [lp, lk] = [levels(p.pressure), levels(k.pressure)]
    const tension: Record<string, number | null> = {}
    for (let T = 71.5; T <= 75.51; T += 0.25) tension[`${T.toFixed(2)} N (${(1200 * Math.log2(Math.sqrt(T / 73.5))).toFixed(0)} cents)`] = d1((await quick(design({ ...d, string: { tension: Number(T.toFixed(2)) } }), 'pluck', 2.5)).levels.lafMax_dB)
    // The radiator on this geometry against the frequency-domain reference.
    const [vp, vk] = [await againstReference(g, 'pluck', 3), await againstReference(g, 'strike', 3)]
    const strongest = (x: Float32Array) => {
      let best = [0, 0]
      for (const f of [...Array.from({ length: 40 }, (_, i) => (i + 1) * F0), ...frequenciesOf(part(g, 'metalBar'))]) if (partial(x, f) > best[1]) best = [f, partial(x, f)]
      return best[0]
    }
    const compare = (v: typeof vp) => {
      const f = strongest(v.references[0])
      const [a, b] = [levels(v.realTime), levels(v.references[0])]
      return { peak_dB: d1(a.peak_dB - b.peak_dB), SEL_dB: Number((a.sel_dB - b.sel_dB).toFixed(2)), LAFmax_dB: Number((a.lafMax_dB - b.lafMax_dB).toFixed(2)), strongestComponent_Hz: Math.round(f), strongestComponent_dB: Number((20 * Math.log10(partial(v.realTime, f, 4800 + v.late) / partial(v.references[0], f))).toFixed(2)) }
    }
    out[name] = {
      bar: `${part(g, 'metalBar').params.length} m, tied at ${part(g, 'metalBar').params.connectionPosition}`, barModesOverStringPitch: frequenciesOf(part(g, 'metalBar')).slice(0, 5).map((x) => Number((x / F0).toFixed(2))),
      pluck: { ...show(lp), gainOverExample_LAFmax_dB: d1(lp.lafMax_dB - reference.lafMax_dB), gainOverExample_peak_dB: d1(lp.peak_dB - reference.peak_dB), energyByBand_percent: bands(p.pressure), barShareMax_percent: d1(100 * p.barSharePeak), jointNetMax_mJ: r(1000 * p.jointWorkPeak), stringPitch_cents: Number((1200 * Math.log2(pitchNear(p.stringVelocity, F0) / F0)).toFixed(2)), barModalVelocityPeak: p.modes.slice(0, 5).map((x) => r(x.peakVelocity, 2)), solverIterationsWorst: p.worstIterations, faults: p.faults },
      strike: { ...show(lk), energyByBand_percent: bands(k.pressure), solverIterationsWorst: k.worstIterations, faults: k.faults },
      'strike over pluck, dB': { LAFmax: d1(lk.lafMax_dB - lp.lafMax_dB), peak: d1(lk.peak_dB - lp.peak_dB), SEL: d1(lk.sel_dB - lp.sel_dB) },
      'played differently': { sharpPluck: show(sharp.levels), softSlowMallet: show(soft.levels), 'soft mallet over sharp pluck, LAFmax dB': d1(soft.levels.lafMax_dB - sharp.levels.lafMax_dB) },
      'pluck LAFmax by string tension': tension,
      'real-time radiator re frequency-domain reference': { pluck: compare(vp), strike: compare(vk) },
    }
  }
  m['4 candidates'] = out
}

// ---- 5. Cost in Node: each design plucked and struck in turn ten times a second -----------------------------------------
const performanceResult: Record<string, unknown> = {}
for (const [name, d] of Object.entries(designs)) {
  const graph = design(d)
  const translation = translate(graph, SR)
  if (!translation.ok) throw new Error('does not translate')
  const play = instrumentCalls(graph, translation.built)
  const speeds: number[] = []
  let faults = 0
  for (let run = 0; run < 4; run++) {
    const worklet = await createWorklet(translation.built.calls)
    const t0 = performance.now()
    worklet.render(20 * SR, (block) => block % 37 === 0 && worklet.send([play[(block / 37) % 2]]))
    if (run > 0) speeds.push((performance.now() - t0) / 20000)
    faults += worklet.engine.faults()
  }
  performanceResult[name] = { percentOfOneCore: Number((100 * speeds.sort((a, b) => a - b)[1]).toFixed(2)), faults }
}

// ---- 6. Listening files ------------------------------------------------------------------------------------------------
const original = await approvedOutput(base, 'pluck', 4)
const [ex, tied, tuned] = Object.values(sounds)
const files: [string, Float32Array, string, string][] = [
  ['1-original-hybrid-plucked-velocity', original, 'm/s', 'the approved hybrid: the bar\'s velocity where it is struck. Not a pressure: its level cannot be compared with the others'],
  ['2-radiated-example-plucked', ex.pluck, 'Pa', 'the experimental example of Phase 3D.4, pluck of 4 N'],
  ['3-radiated-example-struck', ex.strike, 'Pa', 'the same, mallet of 20 g at 1.5 m/s, hardness 0.5'],
  ['4-tuned-candidate-plucked', tuned.pluck, 'Pa', 'best candidate: string tied at the bar\'s end, bar 0.485 m; the same pluck'],
  ['5-tuned-candidate-struck', tuned.strike, 'Pa', 'best candidate, the same mallet stroke'],
  ['6a-end-tied-candidate-plucked', tied.pluck, 'Pa', 'alternative: only the tie moved to the bar\'s end (bar still 0.40 m); the same pluck. Quieter than 4, but does not depend on tuning'],
  ['6b-end-tied-candidate-struck', tied.strike, 'Pa', 'alternative, the same mallet stroke'],
  ['7-tuned-candidate-sharp-pluck', tuned.sharp, 'Pa', 'best candidate played differently: pluck softness 0 (a nail or pick) instead of 0.3'],
  ['8-tuned-candidate-soft-mallet', tuned.soft, 'Pa', 'best candidate played differently: a soft mallet (hardness 0.15) at 1 m/s'],
]
const info: Record<string, unknown> = {}
const exposure = (x: Float32Array) => {
  const a = aWeighted(x)
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * a[i]
  return Math.sqrt(s)
}
// Level-matched: every file to the same A-weighted exposure, the largest that keeps every peak at or below 0.9.
const matchedTarget = Math.min(...files.map(([, x]) => (0.9 * exposure(x)) / largest(x)))
// Common gain: one number for every pressure file, so that the loudest peaks at 0.9.
const commonGain = 0.9 / Math.max(...files.filter(([, , unit]) => unit === 'Pa').map(([, x]) => largest(x)))
for (const [name, x, unit, note] of files) {
  const matched = matchedTarget / exposure(x)
  const common = unit === 'Pa' ? commonGain : 0.9 / largest(x)
  writeWav(`${OUT}/matched/${name}.wav`, Float32Array.from(x, (v) => v * matched))
  writeWav(`${OUT}/common/${name}.wav`, Float32Array.from(x, (v) => v * common))
  info[name] = {
    unit, note, peak: r(largest(x)), ...(unit === 'Pa' ? show(levels(x)) : {}),
    matched: { gain: r(matched), gain_dB: dB(matched), peakInFile: r(largest(x) * matched) },
    common: { gain: r(common), gain_dB: dB(common), peakInFile: r(largest(x) * common), peakInFile_dBFS: dB(largest(x) * common), ...(unit === 'Pa' ? {} : { warning: 'its own gain: a velocity cannot share a gain with pressures' }) },
  }
}

writeFileSync(path(`${OUT}/listening.json`), JSON.stringify({ sampleRate: SR, bitDepth: 24, seconds: 4, matched: 'each file scaled to the same A-weighted sound exposure; compare timbre, not loudness', common: `every pressure file multiplied by the same ${r(commonGain)} per pascal; compare loudness. The quietest is far down in its file: turn the playback up, not the file`, pressureIsNotCalibrated: true, files: info }, null, 2))
writeFileSync(path(`${OUT}/measurements.json`), JSON.stringify(m, null, 2))
writeFileSync(path(`${OUT}/performance.json`), JSON.stringify({ sampleRate: SR, node: process.version, playing: 'plucked and struck in turn, ten times a second, 20 s', results: performanceResult }, null, 2))
const c = m['4 candidates'] as Record<string, { pluck: Record<string, unknown>; strike: Record<string, unknown> }>
console.table(Object.fromEntries(Object.entries(c).flatMap(([name, v]) => [[`${name}: pluck`, { peak_Pa: v.pluck.peak_Pa, LAFmax: v.pluck.LAFmax_dB, SEL_A: v.pluck.SEL_A_dB, cents: v.pluck.stringPitch_cents }], [`${name}: strike`, { peak_Pa: v.strike.peak_Pa, LAFmax: v.strike.LAFmax_dB, SEL_A: v.strike.SEL_A_dB }]])))
console.table(performanceResult)
console.log(`\nwritten to ${fsPath(OUT)}`)
void ({} as Graph)
