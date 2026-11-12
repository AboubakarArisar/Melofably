// Listening renders and measurements of the glass vessel model.
//
//   npm run render:glass
//
// Output: renders/glass-vessel/*.wav and renders/glass-vessel/metrics.json.
import { writeFileSync } from 'node:fs'
import { GLASS_MODES, glassModeFrequencies, type GlassParams } from '../src/audio/engine/physics.ts'
import { decayTime, peak, rms, spectralPeaks, SR, type Params } from './lib.ts'
import { compileModel, concat, freshDir, fsPath, path, realtimeFactor, writeWav } from './offline.ts'

const OUT = 'renders/glass-vessel'
const DEFAULT: GlassParams = { diameter: 70, height: 90, thickness: 1.2, density: 2500, youngsModulus: 70 }
// A large goblet-sized vessel for the low notes.
const LARGE: GlassParams = { ...DEFAULT, diameter: 110, height: 140, thickness: 1 }

const fix = (v: number, d = 2) => Number(v.toFixed(d))
const glass = await compileModel('src/audio/models/glass.dsp', 'strike')
freshDir(OUT)

// ---- single strikes ---------------------------------------------------------
const SINGLES: { name: string; geometry: GlassParams; params: Params }[] = [
  { name: '01-low-219Hz', geometry: LARGE, params: { key: 0 } },
  { name: '02-low-292Hz', geometry: LARGE, params: { key: 5 } },
  { name: '03-mid-649Hz', geometry: DEFAULT, params: { key: 0 } },
  { name: '04-mid-866Hz', geometry: DEFAULT, params: { key: 5 } },
  { name: '05-high-1298Hz', geometry: DEFAULT, params: { key: 12 } },
  { name: '06-high-2596Hz', geometry: DEFAULT, params: { key: 24 } },
  { name: '07-soft-strike', geometry: DEFAULT, params: { hardness: 0.1, velocity: 0.4 } },
  { name: '08-hard-strike', geometry: DEFAULT, params: { hardness: 1, velocity: 1 } },
  { name: '09-strike-at-rim', geometry: DEFAULT, params: { strikeHeight: 1 } },
  { name: '10-strike-at-nodal-circle', geometry: DEFAULT, params: { strikeHeight: 0.783 } },
  { name: '11-strike-at-mid-height', geometry: DEFAULT, params: { strikeHeight: 0.5 } },
  { name: '12-strike-near-base', geometry: DEFAULT, params: { strikeHeight: 0.25 } },
]
const notes: Record<string, unknown> = {}
for (const s of SINGLES) {
  const x = (await glass({ ...s.geometry, ...s.params })).play(5)
  writeWav(`${OUT}/${s.name}.wav`, x)
  const byMode = glassModeFrequencies(s.geometry, s.params.key ?? 0)
  const expected = byMode
    .map((f, j) => ({ f, label: `(${GLASS_MODES[j].n},${GLASS_MODES[j].m})` }))
    .filter((e) => e.f < 0.45 * SR)
    .sort((a, b) => a.f - b.f)
  notes[s.name] = {
    expectedModesHz: expected.map((e) => `${e.label} ${fix(e.f, 1)}`).join('  '),
    // Peaks within 70 dB of the strongest; weakly excited modes are absent.
    measuredPeaksHz: spectralPeaks(x, 65536, 70)
      .map((p) => fix(p.freq, 1))
      .join(' '),
    peak: fix(peak(x), 3),
    rmsFirst500ms: fix(rms(x, 0, SR / 2), 4),
    decayTo20dB_s: fix(decayTime(x, 20)),
    finite: x.every(Number.isFinite),
  }
}

// ---- phrase -----------------------------------------------------------------
const player = await glass(DEFAULT)
const phrase: Float32Array[] = []
for (const [key, beats] of [
  [0, 1], [4, 1], [7, 1], [12, 2], [11, 1], [7, 1], [9, 2], [5, 1], [4, 1], [2, 1], [0, 1], [7, 2], [12, 1], [16, 1], [19, 3],
]) {
  player.set({ key })
  phrase.push(player.play(0.24 * beats))
}
phrase.push(player.render(5))
const phraseAudio = concat(phrase)
writeWav(`${OUT}/13-phrase.wav`, phraseAudio)

// ---- performance ------------------------------------------------------------
const performanceResult = {
  glassAllVesselsRinging_xRealtime: await realtimeFactor(glass, { lossFactor: 0.0001 }, 25),
}

const phraseStats = { peak: fix(peak(phraseAudio), 3), finite: phraseAudio.every(Number.isFinite) }
writeFileSync(path(`${OUT}/metrics.json`), JSON.stringify({ notes, phrase: phraseStats, performance: performanceResult }, null, 2))
console.table(notes)
console.table({ phrase: phraseStats })
console.table({ performance: performanceResult })
console.log(`\nWAV files and metrics.json written to ${fsPath(OUT)}`)
