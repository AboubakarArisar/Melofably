// Phase 3D.9: other ways of putting a string, a metal bar and the damped
// body together, so that the string and the bar hear each other.
//
//   npm run render:three-body-architecture
//
// Output: renders/three-body-architecture/
//   measurements.json   screening, energy budgets, sound, exploration, playing
//   performance.json    cost in Node
//   manifest.json       every WAV: unit, excitation, peak, levels, harmonics,
//                       energy transfer, gains
//   common/*.wav        one gain for all: relative loudness
//   matched/*.wav       each scaled to the same A-weighted exposure: timbre
//
// Every sound is the approved body's radiated pressure in pascals, 1 m in
// front of the board. Nothing is filtered, compressed or boosted, and no
// sound of the bar or the string is added to it.
import { mkdirSync, writeFileSync } from 'node:fs'
import { decayRate, DEFAULT_LOSS, impedance } from '../src/experimental/string/modalString.ts'
import { modalMobility, plateModes } from '../src/experimental/string/soundboard.ts'
import { BAR_BRIDGE, BAR_STRING, barMass, barOnBoardModes, buildStringBarBody, LIGHT_MALLET, RIGID_MODES, SHARED_POINT, SOFT_MOUNT, supportPoints, type StringBarBody } from '../src/experimental/string/stringBarBody.ts'
import { BODY, buildPlayableStringBody, pluckCall, radiation, STRING_DENSITY } from '../src/experimental/string/stringBody.ts'
import type { Call } from '../src/experimental/wasm/engine.ts'
import { aWeighted, BANDS, bandShares, levels, pitchNear, type Levels } from './hybrid-study.ts'
import { SR } from './lib.ts'
import { fsPath, path, writeWav } from './offline.ts'
import { partial } from './radiation.ts'
import { approvedStringBody, cents, F0, fallTime, FULL_SCALE, measure, perform, PLUCK, pluckAt, shareNear, spectralPeaks, strikeAt, STROKE, touchAt, TUNED, type Run } from './three-body.ts'
import { createWorklet } from './worklet.ts'

const OUT = 'renders/three-body-architecture'
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
const light = (s: StringBarBody): StringBarBody => ({ ...s, mallet: LIGHT_MALLET.mallet })
const lump = (s: StringBarBody): StringBarBody => ({ ...s, bar: { ...s.bar, bendingModes: 0 } })
const modeEnergy = (run: Run, s: StringBarBody, n: number) => 0.5 * barMass(s.bar) * largest(run.barModes[n]) ** 2
const noteOf = (run: Run) => spectralPeaks(run.barModes[RIGID_MODES], 0.05, 1.5, 1)[0][0]
const second = Math.round(SR / 128)
const m: Record<string, unknown> = { units: 'energies as stated, pressures Pa or mPa, levels dB re 20 uPa (LAFmax: A-weighted, 125 ms)', excitation: { pluck: `${PLUCK} N, softness 0.3`, standardStroke: `20 g mallet, hardness 0.5, ${STROKE} m/s`, lightStroke: `${1000 * LIGHT_MALLET.mallet.mass} g mallet at ${LIGHT_MALLET.stroke} m/s: a different excitation` } }
const reference = await approvedStringBody(4)
const refLevels = levels(reference.pressure)
const designs: Record<string, StringBarBody> = { 'existing: Phase 3D.6 tuned': TUNED, 'existing: Phase 3D.7 soft mount': SOFT_MOUNT, 'A: shared bridge point': SHARED_POINT, 'B: the bar is the string\'s bridge': BAR_BRIDGE }

// ---- 1. Screening: what the string's end stands on -------------------------------------------------------------------
{
  const Z = impedance({ length: 0.65, tension: 73.5, density: STRING_DENSITY })
  // What a pluck would give a termination of mobility Y: each round trip (f0 a second) it takes 4 Z Re(Y) of a wave,
  // against the string's own losses. Valid while Z |Y| is small.
  const share = (reY: (f: number) => number) => {
    let [num, den] = [0, 0]
    for (let n = 1; n <= 12; n++) {
      const [out, own] = [F0 * 4 * Z * reY(n * F0), 2 * decayRate(DEFAULT_LOSS, n * F0)]
      const weight = (Math.sin(n * Math.PI * 0.2) / n) ** 2
      num += (weight * out) / (out + own)
      den += weight
    }
    return Number(((100 * num) / den).toFixed(2))
  }
  const row = (y: (f: number) => [number, number]) => ({ at110Hz: { Z_times_size: r(Z * Math.hypot(...y(F0)), 2), Z_times_real: r(Z * y(F0)[0], 2) }, at660Hz: { Z_times_size: r(Z * Math.hypot(...y(6 * F0)), 2), Z_times_real: r(Z * y(6 * F0)[0], 2) } })
  const board = (plate: typeof BODY.plate, at: [number, number]) => {
    const modes = plateModes(plate, [at], SR, BODY.limit)
    return (f: number) => modalMobility(modes, 0, f)
  }
  const bar = (at: number) => {
    const modes = barOnBoardModes(BAR_BRIDGE.bar, SR, [at])
    return (f: number) => modalMobility(modes, BAR_STRING, f)
  }
  const approved = board(BODY.plate, BODY.bridgeAt)
  const thin = { ...BODY.plate, thickness: 0.003 }
  m['1 screening: the string\'s end on different things (string impedance x mobility; 1 would be a perfect match)'] = {
    stringImpedance_kg_per_s: r(Z),
    'approved board under the approved bridge (existing, and A)': { ...row(approved), predictedShareOfAPluckThatLeavesTheString_percent: share((f) => approved(f)[0]) },
    'the bar, free in the air, at 0.2 of its length (B, before its pads)': { ...row(bar(0.2)), note: 'the bar is light and its bending mode is at 660 Hz: the string meets something it can move' },
    'the bar at its end (0)': row(bar(0)),
    'the bar at its node (0.224)': row(bar(0.224)),
    'C: approved board, bridge off the nodal line at (0.15, 0.5)': { ...row(board(BODY.plate, [0.15, 0.5])), predictedShare_percent: share((f) => board(BODY.plate, [0.15, 0.5])(f)[0]) },
    'C: a 3 mm board (as before Phase 3C.2.1), bridge where the approved one is': { ...row(board(thin, BODY.bridgeAt)), predictedShare_percent: share((f) => board(thin, BODY.bridgeAt)(f)[0]), lowestModeHz: r(plateModes(thin, [BODY.bridgeAt], SR, 400)[0].frequency) },
    'C: a 3 mm board, bridge at (0.3, 0.5)': { ...row(board(thin, [0.3, 0.5])), predictedShare_percent: share((f) => board(thin, [0.3, 0.5])(f)[0]) },
  }
}

// ---- 2. Where a pluck's energy goes, and a stroke's -------------------------------------------------------------------
const plucks: Record<string, Run> = {}
const strikes: Record<string, Run> = {}
const boths: Record<string, Run> = {}
{
  const out: Record<string, unknown> = {}
  for (const [name, s] of Object.entries(designs)) {
    const [p, k, dead] = [await measure(s, 'pluck', 4), await measure(s, 'strike', 4), await measure(lump(s), 'pluck', 4)]
    plucks[name] = p
    strikes[name] = k
    boths[name] = await measure(s, 'both', 4)
    const put = p.peak.in
    const joint = p.bridgeWork.at(-1)!
    const stringLeft = p.energy.string.at(-1)!
    // What the pluck gave in the end: everything that was dissipated plus what is left (energy is conserved, tested).
    // It is less than the most the instrument held, because the plucking force, as it relaxes, takes some back.
    const given = p.dissipated + p.energy.total.at(-1)!
    const stringOwn = given - joint - stringLeft
    const pct = (x: number) => Number(((100 * x) / put).toPrecision(3))
    const note = noteOf(k)
    out[name] = {
      bar: { padsStandAt: supportPoints(s).map((q) => q.map((x) => Number(x.toFixed(3)))), pads: s.mount, stringTiedToTheBarAt: s.stringOnBar?.at ?? null },
      pluck: {
        mostTheInstrumentHeld_mJ: r(1000 * put), givenInTheEnd_mJ: r(1000 * given), takenBackByThePluckingForce_percentOfTheMost: pct(put - given),
        'the string\'s joint (to the board, or in B to the bar)': { forward_mJ: r(1000 * p.toBoard), back_mJ: r(1000 * p.fromBoard), net_mJ: r(1000 * joint), net_percentOfThePluck: pct(joint) },
        throughThePads: { toTheBar_uJ: r(1e6 * p.toBar), toTheBoard_uJ: r(1e6 * p.fromBar), netOnTheBar_uJ: r(1e6 * p.supportWork.at(-1)!) },
        atTheirMost_percentOfThePluck: { string: pct(p.peak.string), bar: pct(p.peak.bar), barBending1: pct(modeEnergy(p, s, 2)), barUpAndDown: pct(modeEnergy(p, s, 0)), barRocking: pct(modeEnergy(p, s, 1)), board: pct(p.peak.board) },
        barBending1AtItsMost_uJ: r(1e6 * modeEnergy(p, s, 2)),
        whereItWent_percentOfTheMostHeld: { takenBackByThePluckingForce: pct(put - given), stringsOwnLosses: pct(stringOwn), barsOwnMaterial: pct(p.barLoss), padDampers: pct(p.padLoss), boardAndAir: pct(p.dissipated - stringOwn - p.barLoss - p.padLoss), stillInTheStringAfter4s: pct(stringLeft) },
        stringEnergyAfter1s_percentOfItsMost: Number(((100 * p.energy.string[second]) / p.peak.string).toPrecision(3)),
        'what the bar\'s bending adds to the sound at the 6th harmonic (re the same bar unable to bend), dB': dB(partial(p.pressure, 6 * F0) / partial(dead.pressure, 6 * F0)),
      },
      strike: {
        malletGave_mJ: r(1000 * k.malletGave),
        atTheirMost_percentOfWhatTheMalletGave: { string: Number(((100 * k.peak.string) / k.malletGave).toPrecision(3)), board: Number(((100 * k.peak.board) / k.malletGave).toPrecision(3)) },
        'the string\'s joint: net work, mJ (negative: the string was fed)': r(1000 * k.bridgeWork.at(-1)!),
        whereItWent_percent: { padDampers: d1((100 * k.padLoss) / k.malletGave), barsOwnMaterial: d1((100 * k.barLoss) / k.malletGave), stringBoardAndAir: d1((100 * (k.dissipated - k.padLoss - k.barLoss)) / k.malletGave) },
        barsNote: { asMounted_Hz: r(note, 5), cents_re_6thHarmonic: d1(cents(note, 6 * F0)), motionFalls20dB_s: r(fallTime(k.barModes[RIGID_MODES]), 2) },
      },
      solverIterationsWorst: Math.max(p.worstIterations, k.worstIterations), faults: p.faults + k.faults,
    }
  }
  m['2 energy'] = out
}

// ---- 3. What is heard ----------------------------------------------------------------------------------------------------
const lightStrikes: Record<string, Float32Array> = {}
{
  const harmonics = Array.from({ length: 12 }, (_, i) => i + 1)
  const out: Record<string, unknown> = { 'approved string on its box': { ...show(refLevels), stringPitch_cents: Number(cents(pitchNear(reference.stringVelocity, F0), F0).toFixed(2)), harmonics_mPa: harmonics.map((h) => r(1000 * partial(reference.pressure, h * F0), 3)), sixthHarmonic_from1s_mPa: r(1000 * partial(reference.pressure, 6 * F0, SR), 3), energyByBand_percent: bands(reference.pressure) } }
  for (const [name, s] of Object.entries(designs)) {
    const [p, k] = [plucks[name], strikes[name]]
    const gentle = await measure(light(s), 'strike', 4, { stroke: LIGHT_MALLET.stroke })
    const knock = await measure(lump(s), 'strike', 4)
    lightStrikes[name] = gentle.pressure
    const [lp, lk, lg] = [levels(p.pressure), levels(k.pressure), levels(gentle.pressure)]
    const note = noteOf(k)
    out[name] = {
      pluck: {
        ...show(lp), LAFmax_re_approved_dB: d1(lp.lafMax_dB - refLevels.lafMax_dB), stringPitch_cents: Number(cents(pitchNear(p.stringVelocity, F0), F0).toFixed(2)),
        harmonics_mPa: harmonics.map((h) => r(1000 * partial(p.pressure, h * F0), 3)), harmonics_re_approved_dB: harmonics.map((h) => dB(partial(p.pressure, h * F0) / partial(reference.pressure, h * F0))),
        strongestComponents_first0p5s: spectralPeaks(p.pressure, 0, 0.5, 5).map(([f, a]) => `${Math.round(f)} Hz ${r(1000 * a, 3)} mPa`),
        'sound at the bar\'s note (6th harmonic) from 1 s on': { mPa: r(1000 * partial(p.pressure, 6 * F0, SR), 3), re_approved_dB: dB(partial(p.pressure, 6 * F0, SR) / partial(reference.pressure, 6 * F0, SR)) },
        energyByBand_percent: bands(p.pressure),
      },
      strike: {
        ...show(lk), knockAlone_LAFmax_dB: d1(levels(knock.pressure).lafMax_dB), barsNoteInTheSound_from0p3s_mPa: r(1000 * partial(k.pressure, note, 14400), 3), barsNoteShareOfSoundEnergy_percent: d1(100 * shareNear(k.pressure, [note], 1.01)),
        'the string in the sound after a stroke, from 0.3 s': { fundamental_mPa: r(1000 * partial(k.pressure, F0, 14400), 3), secondHarmonic_mPa: r(1000 * partial(k.pressure, 2 * F0, 14400), 3) },
        energyByBand_percent: bands(k.pressure),
      },
      'stroke over pluck, LAFmax dB': { standardStroke: d1(lk.lafMax_dB - lp.lafMax_dB), lightStroke: d1(lg.lafMax_dB - lp.lafMax_dB) },
      lightStroke: show(lg), bothTogether: show(levels(boths[name].pressure)),
    }
  }
  m['3 sound'] = out
}

// ---- 4. Exploration ------------------------------------------------------------------------------------------------------
{
  const rows: Record<string, unknown> = {}
  const B = BAR_BRIDGE
  async function row(name: string, s: StringBarBody) {
    const nominal = Math.sqrt(s.tension / STRING_DENSITY) / (2 * s.length)
    const [p, k] = [await measure(s, 'pluck', 4), await measure(s, 'strike', 4)]
    const [lp, lk] = [levels(p.pressure), levels(k.pressure)]
    const note = noteOf(k)
    const h = (n: number) => dB(partial(p.pressure, n * nominal) / partial(reference.pressure, n * F0))
    rows[name] = {
      pluck: { stringPitch_cents: Number(cents(pitchNear(p.stringVelocity, nominal), nominal).toFixed(2)), LAFmax_re_approved_dB: d1(lp.lafMax_dB - refLevels.lafMax_dB), harmonics_1_2_3_4_6_re_approved_dB: [1, 2, 3, 4, 6].map(h), secondsToFall20dB: r(lp.fall20, 2), stringEnergyAfter1s_percent: Number(((100 * p.energy.string[second]) / p.peak.string).toPrecision(2)), jointNet_percentOfThePluck: Number(((100 * p.bridgeWork.at(-1)!) / p.peak.in).toPrecision(3)), barBending1_percentOfThePluck: Number(((100 * modeEnergy(p, s, 2)) / p.peak.in).toPrecision(2)), soundAtTheBarsNote_from1s_mPa: r(1000 * partial(p.pressure, note, SR), 3) },
      strike: { LAFmax_dB: d1(lk.lafMax_dB), secondsToFall20dB: r(lk.fall20, 2), barsNote_cents_re_6thHarmonic: d1(cents(note, 6 * nominal)), barsNoteMotionFalls20dB_s: r(fallTime(k.barModes[RIGID_MODES]), 2), barsNoteInTheSound_from0p3s_mPa: r(1000 * partial(k.pressure, note, 14400), 3), stringEnergyMax_percentOfGiven: Number(((100 * k.peak.string) / k.malletGave).toPrecision(2)), strokeOverPluck_LAFmax_dB: d1(lk.lafMax_dB - lp.lafMax_dB) },
      solverIterationsWorst: Math.max(p.worstIterations, k.worstIterations), faults: p.faults + k.faults,
    }
  }
  const sep = Math.abs(B.bar.supports[1] - B.bar.supports[0]) * B.bar.length
  const across = (dy: number): StringBarBody['padsAt'] => [[BODY.bridgeAt[0], BODY.bridgeAt[1]], [BODY.bridgeAt[0] + Math.sqrt(sep ** 2 - (dy * BODY.plate.width) ** 2) / BODY.plate.length, BODY.bridgeAt[1] + dy]]
  await row('B', B)
  for (const at of [0.215, 0.18, 0.15, 0.1, 0]) await row(`string tied at ${at} of the bar`, { ...B, stringOnBar: { ...B.stringOnBar!, at } })
  for (const k of [2.2e5, 5e5, 2e6]) await row(`pads ${k} N/m`, { ...B, mount: { stiffness: k, damping: 5 } })
  for (const c of [1, 20]) await row(`pads' damping ${c} N s/m`, { ...B, mount: { stiffness: 1e6, damping: c } })
  for (const k of [3e5, 3e6]) await row(`tie ${k} N/m`, { ...B, stringOnBar: { ...B.stringOnBar!, stiffness: k } })
  await row('tie with a damper of 2 N s/m', { ...B, stringOnBar: { ...B.stringOnBar!, damping: 2 } })
  for (const dy of [0.1, 0.2]) await row(`second pad ${dy} of the board's width off the nodal line`, { ...B, padsAt: across(dy) })
  await row('bar across the board\'s middle, as in earlier phases', { ...B, padsAt: undefined, barAt: [0.5, 0.65] })
  for (const tension of [73, 74, 71.5, 75.5]) await row(`string tension ${tension} N (${cents(Math.sqrt(tension / 73.5), 1).toFixed(0)} cents)`, { ...B, tension })
  for (const ratio of [5.5, 6.5, 3]) await row(`bar's note at ${ratio} x the string's pitch`, { ...B, bar: { ...B.bar, length: B.bar.length * Math.sqrt(6 / ratio) }, padsAt: undefined, barAt: [BODY.bridgeAt[0] + ((0.5 - 0.215) * B.bar.length * Math.sqrt(6 / ratio)) / BODY.plate.length, BODY.bridgeAt[1]] })
  await row('bar 30 mm wide (81 g)', { ...B, bar: { ...B.bar, width: 30 } })
  for (const at of [0.35, 0.2]) await row(`struck at ${at}`, { ...B, bar: { ...B.bar, strikeAt: at } })
  await row('plucked at 0.5 of the string', { ...B, pluckAt: 0.5 })
  m['4 exploration: architecture B with one thing changed'] = rows
}

// ---- 5. Playing it -------------------------------------------------------------------------------------------------------
const played: Record<string, Float32Array> = {}
{
  const out: Record<string, unknown> = {}
  const every = (seconds: number, step: number) => Array.from({ length: Math.floor(seconds / step) }, (_, i) => i * step)
  for (const [name, s] of [['A', SHARED_POINT], ['B', BAR_BRIDGE]] as const) {
    const scenes: [string, Parameters<typeof perform>[1], number][] = [
      ['string plucked four times a second for 3 s', every(3, 0.25).map((t) => pluckAt(t)), 6],
      ['bar struck four times a second for 3 s', every(3, 0.25).map((t) => strikeAt(t)), 6],
      ['pluck and stroke in turn, every 0.75 s', every(3, 0.75).map((t, i) => (i % 2 ? strikeAt(t) : pluckAt(t))), 5],
      ['pluck and stroke at the same instant', [pluckAt(0), strikeAt(0)], 4],
      ['plucked, then a finger laid on the string at 0.5 s', [pluckAt(0), touchAt(0.5, s, true)], 2.5],
      ['struck, then a finger laid on the string at 0.2 s', [strikeAt(0), touchAt(0.2, s, true)], 2],
      ['as hard as allowed: 8 N plucks and 5 m/s strokes in turn, ten a second for 3 s', every(3, 0.1).map((t, i) => (i % 2 ? strikeAt(t, 5) : pluckAt(t, 8))), 6],
    ]
    const rows: Record<string, unknown> = {}
    for (const [scene, events, seconds] of scenes) {
      const p = await perform(s, events, seconds)
      const l = levels(p.pressure)
      rows[scene] = { peak_Pa: r(l.peakPa), LAFmax_dB: d1(l.lafMax_dB), largestStepBetweenSamples_overPeak: r(p.largestStepOverPeak, 2), instrumentEnergyAtMost_mJ: r(1000 * Math.max(...p.energy)), energyLeftAtTheEnd_percentOfMost: Number(((100 * p.energy.at(-1)!) / Math.max(...p.energy)).toPrecision(2)), solverIterationsWorst: p.worstIterations, faults: p.faults, ...(/finger/.test(scene) ? { stringEnergyLeft_uJ: r(1e6 * p.stringEnergy), soundInTheLastHalfSecond_mPa: r(1000 * largest(p.pressure.subarray(p.pressure.length - SR / 2)), 3) } : {}) }
      if (name === 'B' && /in turn, every/.test(scene)) played.alternating = p.pressure
    }
    const [one, four] = [await perform(s, [pluckAt(0, 1)], 2), await perform(s, [pluckAt(0, 4)], 2)]
    const [slow, fast] = [await perform(s, [strikeAt(0, 0.75)], 2), await perform(s, [strikeAt(0, 3)], 2)]
    rows['response to how hard it is played'] = { 'pluck 4 N over 1 N, dB (12.0 if linear)': dB(largest(four.pressure) / largest(one.pressure)), 'stroke 3 m/s over 0.75 m/s, peak dB': dB(largest(fast.pressure) / largest(slow.pressure)) }
    out[name] = rows
  }
  m['5 playing it'] = out
}

// ---- 6. Cost in Node --------------------------------------------------------------------------------------------------------
const performanceResult: Record<string, unknown> = {}
{
  const r3 = radiation(SR)
  const radiate: Call = ['radiate', r3.perSample, r3.b0, r3.b1, r3.a1, FULL_SCALE]
  const box = buildPlayableStringBody({ tension: 73.5, length: 0.65, pluckAt: 0.8, joined: true }, SR)
  const systems: [string, Call[], Call[]][] = [['approved string on its box, plucked five times a second', [...box.calls, radiate], [pluckCall(box, PLUCK)]]]
  for (const [name, s] of Object.entries(designs)) {
    const b = buildStringBarBody(s, SR)
    systems.push([`${name}, plucked and struck in turn`, [...b.calls, radiate], [pluckCall(b, PLUCK), ['launch', b.mallet!, STROKE]]])
  }
  for (const [name, calls, play] of systems) {
    const speeds: number[] = []
    let [iterations, faults, worst, memory] = [0, 0, 0, 0]
    for (let run = 0; run < 4; run++) {
      const worklet = await createWorklet(calls)
      const t0 = performance.now()
      let last = t0
      worklet.render(20 * SR, (block) => {
        const now = performance.now()
        if (run > 0 && block > 0) worst = Math.max(worst, now - last)
        last = now
        if (block % 37 === 0 && (play.length > 1 || (block / 37) % 2 === 0)) worklet.send([play[(block / 37) % play.length]])
      })
      if (run > 0) speeds.push((performance.now() - t0) / 20000)
      iterations = Math.max(iterations, worklet.engine.worstIterations())
      faults += worklet.engine.faults()
      memory = worklet.engine.memory.buffer.byteLength
    }
    performanceResult[name] = { percentOfOneCore: Number((100 * speeds.sort((a, b) => a - b)[1]).toFixed(2)), longestBlock_ms: Number(worst.toFixed(2)), resonators: calls.filter((c) => c[0] === 'addResonator').length, connections: calls.filter((c) => c[0] === 'addSpring' || c[0] === 'addContact').length, solverIterationsWorst: iterations, faults, engineMemoryBytes: memory }
  }
}

// ---- 7. Listening files --------------------------------------------------------------------------------------------------------
const [n36, n37, nA, nB] = Object.keys(designs)
const std = `stroke: 20 g mallet at ${STROKE} m/s`
const files: [string, Float32Array, string, string, string?][] = [
  ['01-approved-string-and-body-plucked', reference.pressure, 'the approved string instrument: the reference', `pluck ${PLUCK} N`],
  ['02a-phase-3d6-tuned-plucked', plucks[n36].pressure, 'the Phase 3D.6 tuned three-part prototype', `pluck ${PLUCK} N`, n36],
  ['02b-phase-3d6-tuned-struck', strikes[n36].pressure, 'the Phase 3D.6 tuned three-part prototype', std, n36],
  ['03a-phase-3d7-soft-mount-plucked', plucks[n37].pressure, 'the Phase 3D.7 soft-mount candidate', `pluck ${PLUCK} N`, n37],
  ['03b-phase-3d7-soft-mount-struck', strikes[n37].pressure, 'the Phase 3D.7 soft-mount candidate', std, n37],
  ['04-B-bar-as-bridge-plucked', plucks[nB].pressure, 'architecture B: the string is tied to the bar, which stands on the board', `pluck ${PLUCK} N`, nB],
  ['05-B-bar-as-bridge-struck', strikes[nB].pressure, 'architecture B', std, nB],
  ['06a-B-bar-as-bridge-both-together', boths[nB].pressure, 'architecture B, plucked and struck at the same instant', `pluck ${PLUCK} N; ${std}`, nB],
  ['06b-B-bar-as-bridge-pluck-and-stroke-in-turn', played.alternating, 'architecture B: pluck at 0 s, stroke at 0.75 s, pluck at 1.5 s, stroke at 2.25 s', `pluck ${PLUCK} N; ${std}`, nB],
  ['06c-B-bar-as-bridge-struck-lightly', lightStrikes[nB], 'architecture B with the light stroke: a different excitation', 'stroke: 5 g mallet at 1 m/s', nB],
  ['07a-A-shared-bridge-point-plucked', plucks[nA].pressure, 'architecture A: string and bar stand on the same point of the board', `pluck ${PLUCK} N`, nA],
  ['07b-A-shared-bridge-point-struck', strikes[nA].pressure, 'architecture A', std, nA],
]
const exposure = (x: Float32Array) => Math.sqrt(aWeighted(x).reduce((s, v) => s + v * v, 0))
const commonGain = 0.9 / Math.max(...files.map(([, x]) => largest(x)))
const matchedTarget = Math.min(...files.map(([, x]) => (0.9 * exposure(x)) / largest(x)))
const info: Record<string, unknown> = {}
const energy = m['2 energy'] as Record<string, { pluck: Record<string, unknown>; strike: Record<string, unknown> }>
for (const [name, x, what, excitation, design] of files) {
  const matched = matchedTarget / exposure(x)
  writeWav(`${OUT}/common/${name}.wav`, Float32Array.from(x, (v) => v * commonGain))
  writeWav(`${OUT}/matched/${name}.wav`, Float32Array.from(x, (v) => v * matched))
  info[name] = {
    unit: 'Pa', what, excitation, seconds: Number((x.length / SR).toFixed(2)), ...show(levels(x)),
    harmonics1to8_mPa: Array.from({ length: 8 }, (_, i) => r(1000 * partial(x, (i + 1) * F0), 3)), energyByBand_percent: bands(x),
    ...(design ? { energyTransfer: /plucked/.test(name) ? { barBending1AtItsMost_uJ: energy[design].pluck.barBending1AtItsMost_uJ, atTheirMost_percentOfThePluck: energy[design].pluck.atTheirMost_percentOfThePluck } : /struck$/.test(name) ? { stringAtItsMost_percentOfWhatTheMalletGave: (energy[design].strike.atTheirMost_percentOfWhatTheMalletGave as Record<string, number>).string } : undefined } : {}),
    common: { gain_perPascal: r(commonGain), gain_dB: dB(commonGain), peakInFile_dBFS: dB(largest(x) * commonGain) }, matched: { gain_perPascal: r(matched), gain_dB: dB(matched), peakInFile_dBFS: dB(largest(x) * matched) },
  }
}
writeFileSync(path(`${OUT}/manifest.json`), JSON.stringify({
  sampleRate: SR, bitDepth: 24, unit: 'Pa: the approved body\'s radiated sound pressure, 1 m in front of the board; a model\'s, not calibrated',
  common: `every file multiplied by the same ${r(commonGain)} per pascal (the loudest peaks at 0.9 of full scale): compare loudness. The plucks are far down in their files: turn the playback up, not the file`,
  matched: 'each file scaled to the same A-weighted sound exposure: compare timbre only',
  nothingElseIsDone: 'one multiplication per file; no filter, compression, correction or added source',
  listeningApproval: 'none: these have been measured, not heard',
  files: info,
}, null, 2))
writeFileSync(path(`${OUT}/measurements.json`), JSON.stringify(m, null, 2))
writeFileSync(path(`${OUT}/performance.json`), JSON.stringify({ sampleRate: SR, node: process.version, note: 'Node, not a browser audio thread', results: performanceResult }, null, 2))
console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => { const x = v as Record<string, unknown>; return [k, { peak_Pa: x.peak_Pa, LAFmax_dB: x.LAFmax_dB, fall20_s: x.secondsToFall20dB, common_dBFS: (x.common as Record<string, unknown>).peakInFile_dBFS, matched_dB: (x.matched as Record<string, unknown>).gain_dB }] })))
console.table(performanceResult)
console.log(`\nwritten to ${fsPath(OUT)}`)
