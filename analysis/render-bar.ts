// Listening renders and measurements of the metal bar model.
//
//   npm run render:bar
//
// Output: renders/metal-bar/*.wav and renders/metal-bar/metrics.json.
import { writeFileSync } from 'node:fs'
import { barModeFrequencies, type BarParams } from '../src/audio/engine/physics.ts'
import { decayTime, peak, rms, spectralPeaks, SR, type Params } from './lib.ts'
import { compileModel, concat, freshDir, fsPath, path, realtimeFactor, writeWav } from './offline.ts'

const OUT = 'renders/metal-bar'
const DEFAULT: BarParams = { length: 0.3, thickness: 10, density: 2700, youngsModulus: 70 } // aluminium
const LONG: BarParams = { ...DEFAULT, length: 0.6 }

const fix = (v: number, d = 2) => Number(v.toFixed(d))
const bar = await compileModel('src/audio/models/bar.dsp', 'strike')
freshDir(OUT)

// ---- single strikes ---------------------------------------------------------
const SINGLES: { name: string; geometry: BarParams; params: Params }[] = [
  { name: '01-low-145Hz', geometry: LONG, params: { key: 0 } },
  { name: '02-low-194Hz', geometry: LONG, params: { key: 5 } },
  { name: '03-mid-582Hz', geometry: DEFAULT, params: { key: 0 } },
  { name: '04-mid-776Hz', geometry: DEFAULT, params: { key: 5 } },
  { name: '05-high-1163Hz', geometry: DEFAULT, params: { key: 12 } },
  { name: '06-high-2326Hz', geometry: DEFAULT, params: { key: 24 } },
  { name: '07-soft-strike', geometry: DEFAULT, params: { hardness: 0.1, velocity: 0.4 } },
  { name: '08-hard-strike', geometry: DEFAULT, params: { hardness: 1, velocity: 1 } },
  { name: '09-strike-at-end', geometry: DEFAULT, params: { strikePosition: 0 } },
  { name: '10-strike-at-mode-1-node', geometry: DEFAULT, params: { strikePosition: 0.224 } },
  { name: '11-strike-at-middle', geometry: DEFAULT, params: { strikePosition: 0.5 } },
]
const notes: Record<string, unknown> = {}
for (const s of SINGLES) {
  const x = (await bar({ ...s.geometry, ...s.params })).play(4)
  writeWav(`${OUT}/${s.name}.wav`, x)
  const expected = barModeFrequencies(s.geometry, s.params.key ?? 0).filter((f) => f < 0.45 * SR)
  const found = spectralPeaks(x, 65536, 70)
  notes[s.name] = {
    expectedModesHz: expected.map((f) => fix(f, 1)).join(' '),
    // Peaks within 70 dB of the strongest; weakly excited modes are absent.
    measuredPeaksHz: found.map((p) => fix(p.freq, 1)).join(' '),
    peak: fix(peak(x), 3),
    rmsFirst500ms: fix(rms(x, 0, SR / 2), 4),
    decayTo20dB_s: fix(decayTime(x, 20)),
    finite: x.every(Number.isFinite),
  }
}

// ---- melody -----------------------------------------------------------------
const melody = await bar(DEFAULT)
const phrase: Float32Array[] = []
for (const key of [0, 4, 7, 12, 7, 4, 0, 5, 9, 12, 17, 12, 9, 5, 7, 11, 14, 19, 24]) {
  melody.set({ key })
  phrase.push(melody.play(0.22))
}
phrase.push(melody.render(4))
const melodyAudio = concat(phrase)
writeWav(`${OUT}/12-melody.wav`, melodyAudio)

// ---- performance ------------------------------------------------------------
// Wall-clock cost of rendering audio in this process, with every bar ringing.
const string = await compileModel('src/audio/models/string.dsp', 'pluck')
const performanceResult = {
  barAllBarsRinging_xRealtime: await realtimeFactor(bar, { lossFactor: 0.0001 }, 25),
  string_xRealtime: await realtimeFactor(string, {}, 1),
}

const melodyStats = { peak: fix(peak(melodyAudio), 3), finite: melodyAudio.every(Number.isFinite) }
writeFileSync(path(`${OUT}/metrics.json`), JSON.stringify({ notes, melody: melodyStats, performance: performanceResult }, null, 2))
console.table(notes)
console.table({ melody: melodyStats })
console.table({ performance: performanceResult })
console.log(`\nWAV files and metrics.json written to ${fsPath(OUT)}`)
