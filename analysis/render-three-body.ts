// Phase 3D.6: the three-component feasibility prototype (a string and a
// metal bar both standing on the damped enclosed body), measured and
// rendered.
//
//   npm run render:three-body
//
// Output: renders/three-body/
//   measurements.json   architecture, energy transfer, acoustic output, pitch,
//                       the parameter exploration, and an estimate of the
//                       bar's own radiation
//   performance.json    cost in Node against the two-component instruments
//   listening.json      every WAV's unit, true peak and levels, and its gains
//   common/*.wav        one gain for all: relative loudness
//   matched/*.wav       each scaled to the same A-weighted exposure: timbre
//
// Every sound is the body's radiated pressure in pascals, 1 m in front of
// the board (the approved string instrument's output). Nothing of the bar or
// the string is added to it. A model's pressure, not calibrated.
import { mkdirSync, writeFileSync } from 'node:fs'
import { barModeShape } from '../src/audio/engine/physics.ts'
import { STRING_EXAMPLES } from '../src/builder/examples.ts'
import { instrumentCalls, translate } from '../src/builder/translate.ts'
import { airCavity } from '../src/experimental/string/airCavity.ts'
import { plateMass, plateModeList } from '../src/experimental/string/soundboard.ts'
import { barMass, barOnBoardModes, buildStringBarBody, RIGID_MODES, supportPoints, type StringBarBody } from '../src/experimental/string/stringBarBody.ts'
import { BODY, buildPlayableStringBody, pluckCall, radiation, STRING_DENSITY } from '../src/experimental/string/stringBody.ts'
import type { Call } from '../src/experimental/wasm/engine.ts'
import { aWeighted, BANDS, bandShares, levels, pitchNear, radiationOf, type Levels } from './hybrid-study.ts'
import { SR } from './lib.ts'
import { fsPath, path, writeWav } from './offline.ts'
import { partial } from './radiation.ts'
import { approvedStringBody, BASE, cents, F0, FULL_SCALE, measure, PLUCK, SMALL_BAR, STROKE, TUNED, variant, type Playing, type Run } from './three-body.ts'
import { createWorklet } from './worklet.ts'

const OUT = 'renders/three-body'
for (const dir of ['', '/common', '/matched']) mkdirSync(path(OUT + dir), { recursive: true })
const r = (x: number | null, digits = 3) => (x === null ? null : Number(x.toPrecision(digits)))
const d1 = (x: number | null) => (x === null ? null : Number(x.toFixed(1)))
const dB = (ratio: number) => Number((20 * Math.log10(ratio)).toFixed(1))
const mJ = (x: number) => r(1000 * x)
const largest = (x: ArrayLike<number>) => {
  let m = 0
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}
const show = (l: Levels) => ({ peak_Pa: r(l.peakPa), peak_dB: d1(l.peak_dB), SEL_A_dB: d1(l.selA_dB), LAFmax_dB: d1(l.lafMax_dB), secondsToLAFmax: r(l.attack, 2), secondsToFall20dB: r(l.fall20, 2) })
const bands = (x: ArrayLike<number>) => Object.fromEntries(bandShares(x).map((share, i) => [`${BANDS[i]}-${BANDS[i + 1]} Hz`, Number((100 * share).toFixed(2))]))
const at = (t: number) => Math.round((t * SR) / 128)
const barNote = (s: StringBarBody) => barOnBoardModes(s.bar, SR)[RIGID_MODES].frequency
const m: Record<string, unknown> = { units: 'energies mJ, velocities m/s, pressures Pa, levels dB re 20 uPa', playing: `pluck ${PLUCK} N (softness 0.3), stroke ${STROKE} m/s with a 20 g mallet`, listener: 'on the board\'s axis, 1 m (the approved string instrument\'s)' }

// ---- 1. What it is made of --------------------------------------------------------------------------------------------
{
  const air = airCavity(BODY.plate, BODY.cavity)
  const built = buildStringBarBody(BASE, SR)
  const describe = (s: StringBarBody) => ({
    length_m: s.bar.length, width_mm: s.bar.width, thickness_mm: s.bar.thickness, mass_g: r(1000 * barMass(s.bar)), supportsAt: s.bar.supports, struckAt: s.bar.strikeAt,
    bendingModesHz: barOnBoardModes(s.bar, SR).slice(RIGID_MODES).map((x) => Math.round(x.frequency)), lowestOverStringPitch: r(barNote(s) / F0, 4),
    standsOnTheBoardAt: supportPoints(s).map((p) => p.map((x) => Number(x.toFixed(3)))),
    padEach: s.mount, bounceOnItsPadsHz: s.mount ? Math.round(Math.sqrt((2 * s.mount.stiffness) / barMass(s.bar)) / (2 * Math.PI)) : null,
  })
  m['1 architecture'] = {
    string: { pitchHz: r(F0, 6), mass_g: r(1000 * STRING_DENSITY * BASE.length), modes: built.modes.string, ports: ['bridge end', 'pluck point', 'a point 0.3 along'], bridge: `spring ${1e6} N/m at ${BODY.bridgeAt.map((x) => Number(x.toFixed(3)))} of the board` },
    board: { plate: `spruce ${BODY.plate.length} x ${BODY.plate.width} m x ${1000 * BODY.plate.thickness} mm`, mass_g: r(1000 * plateMass(BODY.plate)), modes: built.modes.board, modalMass_g: r(250 * plateMass(BODY.plate)), modesBelow1kHz: plateModeList(BODY.plate, 1000).map((x) => `(${x.m},${x.n}) ${Math.round(x.frequency)} Hz`), ports: ['under the bridge', 'under the bar\'s first pad', 'under its second pad', 'radiation (mean motion)'] },
    air: { litres: r(1000 * air.volume), helmholtzHz: r(air.helmholtz), boardOnTheAirHz: r(air.bodyResonance), plugMass_g: r(1000 * air.plug.mass) },
    bar: { prototype: describe(BASE), tuned: describe(TUNED), modes: built.modes.bar, ofWhichRigid: RIGID_MODES, ports: ['first pad', 'second pad', 'strike point', 'end'] },
    engine: { resonators: built.calls.filter((c) => c[0] === 'addResonator').length, modes: built.modes.string + built.modes.board + built.modes.bar + 3, connections: built.calls.filter((c) => c[0] === 'addSpring' || c[0] === 'addContact').length },
    output: 'the board\'s mean velocity and the hole\'s flow (the engine\'s one output), turned into pressure by the processor\'s existing \'radiate\'',
  }
}

// ---- 2. Energy ----------------------------------------------------------------------------------------------------------
const reference = await approvedStringBody(4)
const refLevels = levels(reference.pressure)
const energyOf = (run: Run, playing: Playing) => {
  const given = playing === 'strike' ? run.malletGave : run.peak.in
  const e = run.energy
  const timeline = (x: Float64Array) => Object.fromEntries([0.01, 0.05, 0.2, 0.5, 1, 2].map((t) => [`${t} s`, mJ(x[at(t)])]))
  return {
    putIn_mJ: mJ(given), ...(playing !== 'pluck' ? { malletLeavesWith_mJ: mJ(e.mallet.at(-1)!) } : {}),
    most: { string_mJ: mJ(run.peak.string), board_mJ: mJ(run.peak.board), bar_mJ: mJ(run.peak.bar) },
    mostAsShareOfPutIn_percent: { string: r((100 * run.peak.string) / given), board: r((100 * run.peak.board) / given), bar: r((100 * run.peak.bar) / given) },
    crossedThePads: { boardToBar_mJ: mJ(run.toBar), barToBoard_mJ: mJ(run.fromBar) },
    bridgeNetWorkOnBoard_end_mJ: mJ(run.bridgeWork.at(-1)!),
    overTime: { string: timeline(e.string), board: timeline(e.board), bar: timeline(e.bar) },
    dissipated_mJ: mJ(run.dissipated), solverIterationsWorst: run.worstIterations, faults: run.faults,
  }
}
const cases: [string, StringBarBody, Playing][] = [
  ['string plucked', BASE, 'pluck'], ['bar struck', BASE, 'strike'], ['both together', BASE, 'both'],
  ['string disconnected, bar struck', variant({ stringOn: false }), 'strike'], ['bar disconnected, string plucked', variant({ mount: null }), 'pluck'],
  ['both disconnected, string plucked', variant({ stringOn: false, mount: null }), 'pluck'], ['both disconnected, bar struck', variant({ stringOn: false, mount: null }), 'strike'],
]
const runs: Record<string, Run> = {}
{
  const out: Record<string, unknown> = {}
  for (const [name, s, playing] of cases) {
    runs[name] = await measure(s, playing, 4)
    out[name] = energyOf(runs[name], playing)
  }
  for (const [name, playing] of [['tuned: string plucked', 'pluck'], ['tuned: bar struck', 'strike'], ['tuned: both together', 'both']] as const) {
    runs[name] = await measure(TUNED, playing, 4)
    out[name] = energyOf(runs[name], playing)
  }
  m['2 energy'] = out
  // With every loss removed, and the dissipation balance with losses.
  const checks: Record<string, unknown> = {}
  for (const [name, s] of [['prototype', BASE], ['tuned', TUNED]] as const) {
    for (const playing of ['pluck', 'strike', 'both'] as const) {
      const free = await measure(s, playing, 2.5, { lossless: true })
      let [low, high] = [Infinity, 0]
      for (let b = at(0.3); b < free.energy.total.length; b++) {
        low = Math.min(low, free.energy.total[b])
        high = Math.max(high, free.energy.total[b])
      }
      const lossy = runs[name === 'prototype' ? { pluck: 'string plucked', strike: 'bar struck', both: 'both together' }[playing] : `tuned: ${{ pluck: 'string plucked', strike: 'bar struck', both: 'both together' }[playing]}`]
      // From 0.3 s (the pluck's force and the mallet are gone): what was lost against what the engine counted.
      checks[`${name}, ${playing}`] = { lossless_energyDrift: Number(((high - low) / high).toExponential(2)), lossless_dissipated_J: Number(free.dissipated.toExponential(2)), solverIterationsWorst: free.worstIterations, withLosses_energyLeftAfter4s_mJ: mJ(lossy.energy.total.at(-1)! - lossy.energy.mallet.at(-1)!) }
    }
  }
  m['2b conservation'] = checks
}

// ---- 3. Sound, pitch and tone ---------------------------------------------------------------------------------------------
{
  const harmonics = [1, 2, 3, 4, 6]
  const tone = (pressure: Float32Array, from = 4800) => Object.fromEntries(harmonics.map((h) => [`string harmonic ${h} (${Math.round(h * F0)} Hz)`, r(1000 * partial(pressure, h * F0, from), 3)]))
  const out: Record<string, unknown> = {
    'approved string on its box, plucked': { ...show(refLevels), stringPitch_cents: Number(cents(pitchNear(reference.stringVelocity, F0), F0).toFixed(2)), components_mPa: tone(reference.pressure), energyByBand_percent: bands(reference.pressure) },
  }
  for (const [name, run] of Object.entries(runs)) {
    if (/both disconnected/.test(name)) continue
    const l = levels(run.pressure)
    const s = /tuned/.test(name) ? TUNED : BASE
    const note = barNote(s)
    const plucked = !/struck/.test(name) || /together/.test(name)
    out[name] = {
      ...show(l), LAFmax_re_approvedPluck_dB: d1(l.lafMax_dB - refLevels.lafMax_dB),
      ...(plucked && !/string disconnected/.test(name) ? { stringPitch_cents: Number(cents(pitchNear(run.stringVelocity, F0), F0).toFixed(2)) } : {}),
      components_mPa: tone(run.pressure), ...(plucked ? { components_re_approvedPluck_dB: Object.fromEntries(harmonics.map((h) => [`harmonic ${h}`, dB(partial(run.pressure, h * F0) / partial(reference.pressure, h * F0))])) } : {}),
      ...(/bar disconnected/.test(name) ? {} : { barNoteInTheSound_from0p3s: { Hz: r(pitchNear(run.pressure, note, 1.05, 0.3), 5), mPa: r(1000 * partial(run.pressure, pitchNear(run.pressure, note, 1.05, 0.3), 14400), 3) }, barNoteOnTheBar_Hz: r(pitchNear(run.barVelocity, note, 1.05, 0.1), 5), barNoteFree_Hz: r(note, 5) }),
      energyByBand_percent: bands(run.pressure), barVelocityPeak: r(largest(run.barVelocity)), boardMeanVelocityPeak: r(largest(run.boardVelocity)),
    }
  }
  m['3 sound, pitch and tone'] = out
  // The other approved two-part instrument, for the string's fundamental: the radiated hybrid (docs/HYBRID_PLAYABILITY.md).
  m['3b the string\'s fundamental in the sound, mPa'] = { 'approved string on its box (2 N)': r(1000 * partial(reference.pressure, F0)), 'three parts, prototype (2 N)': r(1000 * partial(runs['string plucked'].pressure, F0)), 'three parts, tuned (2 N)': r(1000 * partial(runs['tuned: string plucked'].pressure, F0)), 'string tied to a bar, radiated by the bar (4 N; Phase 3D.5)': 0.00018 }
}

// ---- 4. Exploration -------------------------------------------------------------------------------------------------------
{
  const rows: Record<string, unknown> = {}
  const tunedTo = (ratio: number) => ({ ...SMALL_BAR, length: SMALL_BAR.length * Math.sqrt(barNote(BASE) / (ratio * F0)) })
  async function row(name: string, s: StringBarBody) {
    const [p, k] = [await measure(s, 'pluck', 3), await measure(s, 'strike', 3)]
    const [lp, lk] = [levels(p.pressure), levels(k.pressure)]
    const note = barNote(s)
    let ring: number | null = null
    for (let b = at(0.05); b < k.energy.bar.length; b++) if (k.energy.bar[b] < 0.01 * k.energy.bar[at(0.05)]) {
      ring = (b * 128) / SR - 0.05
      break
    }
    const heard = pitchNear(k.pressure, note, 1.05, 0.3)
    rows[name] = {
      pluck: { barEnergyMax_percentOfPutIn: r((100 * p.peak.bar) / p.peak.in, 2), stringPitch_cents: Number(cents(pitchNear(p.stringVelocity, F0), F0).toFixed(2)), LAFmax_re_approved_dB: d1(lp.lafMax_dB - refLevels.lafMax_dB), fundamental_re_approved_dB: dB(partial(p.pressure, F0) / partial(reference.pressure, F0)), harmonic6_re_approved_dB: dB(partial(p.pressure, 6 * F0) / partial(reference.pressure, 6 * F0)), secondsToFall20dB: r(lp.fall20, 2) },
      strike: { malletGave_mJ: mJ(k.malletGave), stringEnergyMax_percentOfGiven: r((100 * k.peak.string) / k.malletGave, 2), peak_Pa: r(lk.peakPa), LAFmax_dB: d1(lk.lafMax_dB), secondsToFall20dB: r(lk.fall20, 2), barEnergyFalls20dB_s: r(ring, 2), barNoteOnTheBar_cents: Number(cents(pitchNear(k.barVelocity, note, 1.05, 0.1), note).toFixed(1)), barNoteInTheSound_from0p3s_mPa: r(1000 * partial(k.pressure, heard, 14400), 2), stringFundamentalInTheSound_from0p3s_mPa: r(1000 * partial(k.pressure, F0, 14400), 2) },
      solverIterationsWorst: Math.max(p.worstIterations, k.worstIterations), faults: p.faults + k.faults,
    }
  }
  await row('prototype', BASE)
  for (const k of [1e4, 1e5, 1e7]) await row(`pad stiffness ${k} N/m`, variant({ mount: { stiffness: k, damping: 5 } }))
  for (const c of [0.5, 50]) await row(`pad damping ${c} N s/m`, variant({ mount: { stiffness: 1e6, damping: c } }))
  for (const a of [0.224, 0.215, 0.2, 0.18, 0.15, 0]) await row(`pads at ${a} and ${Number((1 - a).toFixed(3))} of the bar`, variant({}, { supports: [a, 1 - a] }))
  for (const p of [[0.5, 0.5], [0.3, 1 / 3], [0.25, 0.5], [0.7, 0.8]] as [number, number][]) await row(`bar's middle at ${p.map((x) => x.toFixed(2))} of the board`, variant({ barAt: p }))
  for (const ratio of [6, 5.5, 3, 2]) await row(`bar's lowest note at ${ratio} x the string's pitch`, variant({ bar: tunedTo(ratio) }))
  await row('a large bar, 0.40 m x 40 x 10 mm (432 g), at the board\'s middle', variant({ barAt: [0.5, 0.5] }, { length: 0.4, width: 40, thickness: 10 }))
  for (const p of [[0.08, 0.44], [0.3, 0.5]] as [number, number][]) await row(`bridge at ${p} of the board`, variant({ bridgeAt: p }))
  await row('a direct tie as well, string end to bar end, 1e5 N/m', variant({ direct: { stiffness: 1e5, damping: 0 } }))
  await row('tuned', TUNED)
  m['4 exploration: one thing changed at a time'] = rows
}

// ---- 5. Would the bar's own sound matter? An estimate, not an implementation -----------------------------------------------
{
  const run = runs['tuned: bar struck']
  const note = pitchNear(run.barVelocity, barNote(TUNED), 1.05, 0.1)
  const g = { length: TUNED.bar.length, width: TUNED.bar.width / 1000, thickness: TUNED.bar.thickness / 1000 }
  // The bar's lowest bending mode, from its velocity at the strike point, from 0.3 s on.
  const modal = partial(run.barVelocity, note, 14400) / Math.abs(barModeShape(0, TUNED.bar.strikeAt))
  const [oblique, front] = [radiationOf(g, 0, note, { distance: 1, angle: 45 }), radiationOf(g, 0, note, { distance: 1, angle: 0 })]
  m['5 the bar\'s own radiation, estimated (free-air model of Phase 3D.3; the board beside it is ignored)'] = {
    barNote_Hz: r(note, 5), modalVelocity_m_per_s: r(modal),
    directFromTheBar_mPa: { '1 m, 45 degrees': r(1000 * oblique.pressurePerVelocity * modal), '1 m, straight in front': r(1000 * front.pressurePerVelocity * modal) },
    throughTheBoard_mPa: r(1000 * partial(run.pressure, pitchNear(run.pressure, note, 1.02, 0.3), 14400)),
    caution: 'the free-air model does not hold for a bar a few millimetres above a board, and was validated for the bar alone',
  }
}

// ---- 6. Cost in Node ------------------------------------------------------------------------------------------------------------
const performanceResult: Record<string, unknown> = {}
{
  const r3 = radiation(SR)
  const radiate: Call = ['radiate', r3.perSample, r3.b0, r3.b1, r3.a1, FULL_SCALE]
  const three = (s: StringBarBody) => {
    const b = buildStringBarBody(s, SR)
    return { calls: [...b.calls, radiate], play: [pluckCall(b, PLUCK), ['launch', b.mallet!, STROKE] as Call] }
  }
  const box = buildPlayableStringBody({ tension: BASE.tension, length: BASE.length, pluckAt: BASE.pluckAt, joined: true }, SR)
  const hybridGraph = STRING_EXAMPLES[1].make()
  const hybrid = translate(hybridGraph, SR)
  if (!hybrid.ok) throw new Error('the hybrid does not translate')
  const systems: [string, Call[], Call[]][] = [
    ['approved string on its box (two parts), plucked five times a second', [...box.calls, radiate], [pluckCall(box, PLUCK)]],
    ['approved string tied to a bar (two parts), plucked and struck in turn', hybrid.built.calls, instrumentCalls(hybridGraph, hybrid.built)],
    ['three parts, prototype, plucked five times a second', three(BASE).calls, three(BASE).play.slice(0, 1)],
    ['three parts, prototype, plucked and struck in turn', three(BASE).calls, three(BASE).play],
    ['three parts, tuned, plucked and struck in turn', three(TUNED).calls, three(TUNED).play],
  ]
  for (const [name, calls, play] of systems) {
    const speeds: number[] = []
    let [worst, slow, blocks, iterations, faults, memory] = [0, 0, 0, 0, 0, 0]
    for (let run = 0; run < 4; run++) {
      const worklet = await createWorklet(calls)
      const t0 = performance.now()
      let last = t0
      worklet.render(20 * SR, (block) => {
        const now = performance.now()
        if (run > 0 && block > 0) {
          worst = Math.max(worst, now - last)
          if (now - last >= 2) slow++
          blocks++
        }
        last = now
        // Ten events a second: every 37 blocks, taking the ways of playing in turn (or the one, every other time).
        if (block % 37 === 0 && (play.length > 1 || (block / 37) % 2 === 0)) worklet.send([play[(block / 37) % play.length]])
      })
      if (run > 0) speeds.push((performance.now() - t0) / 20000)
      iterations = Math.max(iterations, worklet.engine.worstIterations())
      faults += worklet.engine.faults()
      memory = worklet.engine.memory.buffer.byteLength
    }
    performanceResult[name] = { percentOfOneCore: Number((100 * speeds.sort((a, b) => a - b)[1]).toFixed(2)), longestBlock_ms: Number(worst.toFixed(2)), blocksOf2msOrMore: slow, blocksTimed: blocks, solverIterationsWorst: iterations, faults, engineMemoryBytes: memory, modes: calls.filter((c) => c[0] === 'setMode').length, connections: calls.filter((c) => c[0] === 'addSpring' || c[0] === 'addContact').length }
  }
}

// The numbers the test page's integratedThreeBody() computes in the browser, here in Node: the tuned
// prototype plucked and struck at once, 2.2 s, as the audio node carries it (pascals / 16).
{
  const b = buildStringBarBody(TUNED, SR)
  const r3 = radiation(SR)
  const worklet = await createWorklet([...b.calls, ['radiate', r3.perSample, r3.b0, r3.b1, r3.a1, FULL_SCALE], pluckCall(b, PLUCK), ['launch', b.mallet!, STROKE]])
  const data = worklet.render(Math.round(2.2 * SR))
  m['6 the tuned prototype as integratedThreeBody() on the test page computes it'] = { fullScalePa: FULL_SCALE, peak: largest(data), sumOfSquares: data.reduce((s, v) => s + v * v, 0), samples: [100, 1000, 10000, 50000, 100000].map((n) => data[n]) }
  console.log(JSON.stringify(m['6 the tuned prototype as integratedThreeBody() on the test page computes it']))
}

// ---- 7. Listening files ---------------------------------------------------------------------------------------------------------
const files: [string, Float32Array, string][] = [
  ['1-approved-string-and-body-plucked', reference.pressure, 'the approved string instrument: the reference'],
  ['2-three-parts-string-plucked', runs['string plucked'].pressure, 'prototype: the bar stands on the board, the string is plucked'],
  ['3-three-parts-bar-struck', runs['bar struck'].pressure, 'prototype: the string stands on the board, the bar is struck'],
  ['4-three-parts-both-together', runs['both together'].pressure, 'prototype: plucked and struck at the same instant'],
  ['5-string-disconnected-bar-struck', runs['string disconnected, bar struck'].pressure, 'prototype without the string\'s bridge: the bar and the board alone'],
  ['6-bar-disconnected-string-plucked', runs['bar disconnected, string plucked'].pressure, 'prototype without the bar\'s pads: the same samples as file 1'],
  ['7a-tuned-string-plucked', runs['tuned: string plucked'].pressure, 'most promising configuration (pads near the bar\'s nodes, bar on the string\'s 6th harmonic), plucked'],
  ['7b-tuned-bar-struck', runs['tuned: bar struck'].pressure, 'most promising configuration, struck'],
  ['7c-tuned-both-together', runs['tuned: both together'].pressure, 'most promising configuration, plucked and struck together'],
]
const exposure = (x: Float32Array) => Math.sqrt(aWeighted(x).reduce((s, v) => s + v * v, 0))
const commonGain = 0.9 / Math.max(...files.map(([, x]) => largest(x)))
const matchedTarget = Math.min(...files.map(([, x]) => (0.9 * exposure(x)) / largest(x)))
const info: Record<string, unknown> = {}
for (const [name, x, note] of files) {
  const matched = matchedTarget / exposure(x)
  writeWav(`${OUT}/common/${name}.wav`, Float32Array.from(x, (v) => v * commonGain))
  writeWav(`${OUT}/matched/${name}.wav`, Float32Array.from(x, (v) => v * matched))
  info[name] = { unit: 'Pa', note, ...show(levels(x)), common: { gain_perPascal: r(commonGain), gain_dB: dB(commonGain), peakInFile_dBFS: dB(largest(x) * commonGain) }, matched: { gain_perPascal: r(matched), gain_dB: dB(matched), peakInFile_dBFS: dB(largest(x) * matched) } }
}
writeFileSync(path(`${OUT}/listening.json`), JSON.stringify({ sampleRate: SR, bitDepth: 24, seconds: 4, unit: 'Pa: the body\'s radiated sound pressure, 1 m in front of the board; a model\'s, not calibrated', common: `every file multiplied by the same ${r(commonGain)} per pascal: compare loudness. The plucks are far down in their files: turn the playback up, not the file`, matched: 'each scaled to the same A-weighted sound exposure: compare timbre only', files: info }, null, 2))
writeFileSync(path(`${OUT}/measurements.json`), JSON.stringify(m, null, 2))
writeFileSync(path(`${OUT}/performance.json`), JSON.stringify({ sampleRate: SR, node: process.version, note: 'Node, not a browser audio thread: the longest block here includes Node\'s own pauses', results: performanceResult }, null, 2))
console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => { const x = v as Record<string, unknown>; return [k, { peak_Pa: x.peak_Pa, LAFmax_dB: x.LAFmax_dB, fall20_s: x.secondsToFall20dB, common_dBFS: (x.common as Record<string, unknown>).peakInFile_dBFS, matched_dB: (x.matched as Record<string, unknown>).gain_dB }] })))
console.table(performanceResult)
console.log(`\nwritten to ${fsPath(OUT)}`)
