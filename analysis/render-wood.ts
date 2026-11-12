// Listening renders and measurements of the wooden bar model, including a
// like-for-like comparison with the metal bar.
//
//   npm run render:wood
//
// Output: renders/wooden-bar/*.wav and renders/wooden-bar/metrics.json.
import { writeFileSync } from 'node:fs'
import { barModeFrequencies, woodDecayTime, type BarParams } from '../src/audio/engine/physics.ts'
import { amplitudeAt, bandPower, dB, decayTime, peak, powerSpectrum, rms, spectralCentroid, SR, type Params } from './lib.ts'
import { compileModel, concat, freshDir, fsPath, path, realtimeFactor, writeWav } from './offline.ts'

const OUT = 'renders/wooden-bar'
const DEFAULT: BarParams = { length: 0.38, thickness: 19, density: 950, youngsModulus: 18 } // rosewood-like
const LONG: BarParams = { ...DEFAULT, length: 0.6 }
const METAL: BarParams = { length: 0.3, thickness: 10, density: 2700, youngsModulus: 70 } // bar model defaults

const fix = (v: number, d = 2) => Number(v.toFixed(d))
const wood = await compileModel('src/audio/models/wood.dsp', 'strike')
const metal = await compileModel('src/audio/models/bar.dsp', 'strike')
freshDir(OUT)

// ---- single strikes ---------------------------------------------------------
const SINGLES: { name: string; geometry: BarParams; params: Params }[] = [
  { name: '01-low-236Hz', geometry: LONG, params: { key: 0 } },
  { name: '02-low-315Hz', geometry: LONG, params: { key: 5 } },
  { name: '03-mid-589Hz', geometry: DEFAULT, params: { key: 0 } },
  { name: '04-mid-786Hz', geometry: DEFAULT, params: { key: 5 } },
  { name: '05-high-1177Hz', geometry: DEFAULT, params: { key: 12 } },
  { name: '06-high-2355Hz', geometry: DEFAULT, params: { key: 24 } },
  { name: '07-soft-mallet', geometry: DEFAULT, params: { hardness: 0.15 } },
  { name: '08-hard-mallet', geometry: DEFAULT, params: { hardness: 0.95 } },
  { name: '09-strike-at-end', geometry: DEFAULT, params: { strikePosition: 0 } },
  { name: '10-strike-at-mode-1-node', geometry: DEFAULT, params: { strikePosition: 0.224 } },
  { name: '11-strike-at-middle', geometry: DEFAULT, params: { strikePosition: 0.5 } },
  { name: '12-no-resonator-tubes', geometry: DEFAULT, params: { resonator: 0 } },
]
const notes: Record<string, unknown> = {}
for (const s of SINGLES) {
  const x = (await wood({ ...s.geometry, ...s.params })).play(1.5)
  writeWav(`${OUT}/${s.name}.wav`, x)
  const modes = barModeFrequencies(s.geometry, s.params.key ?? 0).slice(0, 6)
  const early = x.subarray(0, 0.04 * SR)
  const m1 = amplitudeAt(early, modes[0])
  notes[s.name] = {
    fundamentalHz: fix(modes[0], 1),
    // Level of modes 2 and 3 relative to the fundamental in the first 40 ms.
    mode2_dB: fix(dB(amplitudeAt(early, modes[1]) / m1), 1),
    mode3_dB: modes[2] < 0.45 * SR ? fix(dB(amplitudeAt(early, modes[2]) / m1), 1) : null,
    // Brightness of the strike itself against the ringing that follows.
    centroidFirst5ms_Hz: Math.round(spectralCentroid(powerSpectrum(x, 0, 256))),
    centroidAt60ms_Hz: Math.round(spectralCentroid(powerSpectrum(x, 0.06 * SR, 1024))),
    t60ms_modes123: modes.slice(0, 3).map((f) => Math.round(1000 * woodDecayTime(f, 0.006))).join(' / '),
    peak: fix(peak(x), 3),
    rmsFirst20ms: fix(rms(x, 0, 0.02 * SR), 4),
    decayTo20dB_s: fix(decayTime(x, 20)),
    finite: x.every(Number.isFinite),
  }
}

// ---- phrase -----------------------------------------------------------------
const PHRASE: [number, number][] = [
  [0, 1], [4, 1], [7, 1], [12, 1], [16, 1], [12, 1], [7, 1], [4, 1],
  [5, 1], [9, 1], [12, 1], [17, 1], [21, 1], [17, 1], [12, 1], [9, 1],
  [7, 0.5], [7, 0.5], [11, 0.5], [11, 0.5], [14, 0.5], [14, 0.5], [19, 0.5], [19, 0.5], [24, 2],
]
async function playPhrase(model: typeof wood, setup: Params) {
  const inst = await model(setup)
  const parts: Float32Array[] = []
  for (const [key, beats] of PHRASE) {
    inst.set({ key })
    parts.push(inst.play(0.2 * beats))
  }
  parts.push(inst.render(2.5))
  return concat(parts)
}
const phraseAudio = await playPhrase(wood, DEFAULT)
writeWav(`${OUT}/13-phrase.wav`, phraseAudio)

// ---- wood versus metal --------------------------------------------------------
// Comparable conditions: each model at its own default material, damping and
// mallet; the metal bar's length adjusted so both sets play the same notes;
// both struck at 0.35 of the length, velocity 0.8, hardness 0.7.
const woodF1 = barModeFrequencies(DEFAULT)[0]
const metalTuned = { ...METAL, length: METAL.length * Math.sqrt(barModeFrequencies(METAL)[0] / woodF1) }
const stroke = { strikePosition: 0.35, hardness: 0.7, velocity: 0.8 }
const gap = new Float32Array(0.5 * SR)
const pair = async (key: number) => [
  (await wood({ ...DEFAULT, ...stroke, key })).play(2),
  (await metal({ ...metalTuned, ...stroke, key })).play(2),
]
const [woodNote, metalNote] = await pair(0)
writeWav(`${OUT}/14-compare-single-note-wood-then-metal.wav`, concat([woodNote, gap, metalNote]))
writeWav(
  `${OUT}/15-compare-phrase-wood-then-metal.wav`,
  concat([await playPhrase(wood, { ...DEFAULT, ...stroke }), gap, await playPhrase(metal, { ...metalTuned, ...stroke })]),
)
const describe = (x: Float32Array, modes: number[]) => {
  const rate = (f: number) =>
    dB(amplitudeAt(x.subarray(0.02 * SR, 0.05 * SR), f) / amplitudeAt(x.subarray(0.05 * SR, 0.08 * SR), f)) / 0.03
  const early = powerSpectrum(x, 0, 2048)
  return {
    fundamentalHz: fix(modes[0], 1),
    peak: fix(peak(x), 3),
    secondsTo20dB: fix(decayTime(x, 20)),
    secondsTo40dB: fix(decayTime(x, 40)),
    mode1_dB_per_s: fix(rate(modes[0]), 0),
    mode2_dB_per_s: fix(rate(modes[1]), 0),
    centroidFirst40ms_Hz: Math.round(spectralCentroid(early)),
    centroidAt200ms_Hz: Math.round(spectralCentroid(powerSpectrum(x, 0.2 * SR, 2048))),
    above2kHzFirst40ms_dB: fix(dB(Math.sqrt(bandPower(early, 2000) / bandPower(early, 0))), 1),
    above2kHzAt100ms_dB: fix(dB(Math.sqrt(bandPower(powerSpectrum(x, 0.1 * SR, 2048), 2000) / bandPower(early, 0))), 1),
  }
}
const comparison = {
  wood: describe(woodNote, barModeFrequencies(DEFAULT)),
  metal: describe(metalNote, barModeFrequencies(metalTuned)),
}

// ---- performance ------------------------------------------------------------
const performanceResult = { woodAllBarsRinging_xRealtime: await realtimeFactor(wood, { lossFactor: 0.001 }, 25) }

const phraseStats = { peak: fix(peak(phraseAudio), 3), finite: phraseAudio.every(Number.isFinite) }
writeFileSync(
  path(`${OUT}/metrics.json`),
  JSON.stringify({ notes, phrase: phraseStats, woodVersusMetal: comparison, performance: performanceResult }, null, 2),
)
console.table(notes)
console.table({ phrase: phraseStats })
console.table(comparison)
console.table({ performance: performanceResult })
console.log(`\nWAV files and metrics.json written to ${fsPath(OUT)}`)
