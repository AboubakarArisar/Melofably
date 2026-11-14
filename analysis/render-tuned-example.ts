// Phase 3D.5.1: the tuned hybrid example against the original radiated
// example, as the builder plays each.
//
//   npm run render:tuned-example
//
// Output: renders/tuned-example/
//   comparison.wav      one file, one gain: original plucked, tuned plucked,
//                       original struck, tuned struck, 3 s each with 0.5 s
//                       of silence between
//   common/*.wav        the four separately, at that same one gain
//   matched/*.wav       the four each scaled to the same A-weighted sound
//                       exposure, for timbre only
//   listening.json      units, true peaks and levels, and every gain
//
// Every sound is sound pressure in pascals at the experimental listener
// (free air, 1 m, 45 degrees): a model's pressure, not calibrated. The only
// thing done to any file is one multiplication, recorded in listening.json.
import { mkdirSync, writeFileSync } from 'node:fs'
import { RADIATION_EXAMPLES } from '../src/builder/examples.ts'
import { instrumentCalls, LISTENER_FULL_SCALE, translate } from '../src/builder/translate.ts'
import { aWeighted, levels } from './hybrid-study.ts'
import { SR } from './lib.ts'
import { fsPath, path, writeWav } from './offline.ts'
import { createWorklet } from './worklet.ts'

const OUT = 'renders/tuned-example'
for (const dir of ['', '/common', '/matched']) mkdirSync(path(OUT + dir), { recursive: true })
const SECONDS = 3
const r = (x: number, digits = 3) => Number(x.toPrecision(digits))
const dB = (ratio: number) => Number((20 * Math.log10(ratio)).toFixed(1))
const largest = (x: ArrayLike<number>) => {
  let m = 0
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}

/** One example as the builder builds it, with one of its Play instrument calls (0: the pluck, 1: the mallet). Pascals. */
async function play(example: number, which: number, seconds = SECONDS) {
  const graph = RADIATION_EXAMPLES[example].make()
  const translation = translate(graph, SR)
  if (!translation.ok) throw new Error('the example does not translate')
  const worklet = await createWorklet(translation.built.calls)
  worklet.send([instrumentCalls(graph, translation.built)[which]])
  const pressure = worklet.render(Math.round(seconds * SR)).map((v) => v * LISTENER_FULL_SCALE)
  if (worklet.engine.faults()) throw new Error('engine fault')
  return pressure
}

const files: [string, Float32Array, string][] = [
  ['1-original-radiated-example-plucked', await play(0, 0), 'the Phase 3D.4 example (bar 0.40 m, string tied at 0.1), pluck of 4 N'],
  ['2-tuned-example-plucked', await play(1, 0), 'the new example (bar 0.485 m, string tied at the bar\'s end), the same pluck'],
  ['3-original-radiated-example-struck', await play(0, 1), 'the Phase 3D.4 example, mallet of 20 g at 1.5 m/s'],
  ['4-tuned-example-struck', await play(1, 1), 'the new example, the same mallet stroke'],
]
const exposure = (x: Float32Array) => Math.sqrt(aWeighted(x).reduce((s, v) => s + v * v, 0))
const commonGain = 0.9 / Math.max(...files.map(([, x]) => largest(x)))
const matchedTarget = Math.min(...files.map(([, x]) => (0.9 * exposure(x)) / largest(x)))
const gap = new Float32Array(Math.round(0.5 * SR))
const comparison = new Float32Array(files.reduce((n, [, x]) => n + x.length, 0) + 3 * gap.length)
const info: Record<string, unknown> = {}
let at = 0
for (const [name, x, note] of files) {
  const matched = matchedTarget / exposure(x)
  writeWav(`${OUT}/common/${name}.wav`, Float32Array.from(x, (v) => v * commonGain))
  writeWav(`${OUT}/matched/${name}.wav`, Float32Array.from(x, (v) => v * matched))
  comparison.set(Float32Array.from(x, (v) => v * commonGain), at)
  const l = levels(x)
  info[name] = {
    unit: 'Pa', note, startsInComparison_s: Number((at / SR).toFixed(2)),
    peak_Pa: r(l.peakPa), peak_dB: Number(l.peak_dB.toFixed(1)), SEL_A_dB: Number(l.selA_dB.toFixed(1)), LAFmax_dB: Number(l.lafMax_dB.toFixed(1)), secondsToFall20dB: l.fall20 === null ? null : r(l.fall20, 2),
    common: { gain_perPascal: r(commonGain), gain_dB: dB(commonGain), peakInFile_dBFS: dB(l.peakPa * commonGain) },
    matched: { gain_perPascal: r(matched), gain_dB: dB(matched), peakInFile_dBFS: dB(l.peakPa * matched) },
  }
  at += x.length + gap.length
}
writeWav(`${OUT}/comparison.wav`, comparison)

// The numbers the test page's integratedRadiated(1) computes in the browser, here in Node.
const graph = RADIATION_EXAMPLES[1].make()
const translation = translate(graph, SR)
if (!translation.ok) throw new Error('the example does not translate')
const worklet = await createWorklet([...translation.built.calls, ...instrumentCalls(graph, translation.built)])
const data = worklet.render(Math.round(2.2 * SR))
const browserCheck = { example: RADIATION_EXAMPLES[1].id, fullScalePa: LISTENER_FULL_SCALE, peak: largest(data), sumOfSquares: data.reduce((s, v) => s + v * v, 0), samples: [100, 1000, 10000, 50000, 100000].map((n) => data[n]) }

const [p0, p1, s0, s1] = files.map(([, x]) => levels(x))
writeFileSync(path(`${OUT}/listening.json`), JSON.stringify({
  sampleRate: SR, bitDepth: 24, unit: 'Pa: sound pressure in free air, 1 m from the bar\'s middle, 45 degrees off its face; a model\'s pressure, not calibrated',
  comparison: `comparison.wav: the four sounds in order, ${SECONDS} s each with 0.5 s of silence between, all multiplied by the same ${r(commonGain)} per pascal (the loudest peaks at 0.9 of full scale). The first is ${dB(largest(files[0][1]) * commonGain)} dBFS at its peak: turn the playback up, not the file`,
  common: 'the same four as separate files at that same gain: compare loudness',
  matched: 'each scaled to the same A-weighted sound exposure: compare timbre only',
  'tuned over original, dB': { pluck_peak: Number((p1.peak_dB - p0.peak_dB).toFixed(1)), pluck_LAFmax: Number((p1.lafMax_dB - p0.lafMax_dB).toFixed(1)), pluck_SEL_A: Number((p1.selA_dB - p0.selA_dB).toFixed(1)), stroke_peak: Number((s1.peak_dB - s0.peak_dB).toFixed(1)), stroke_LAFmax: Number((s1.lafMax_dB - s0.lafMax_dB).toFixed(1)) },
  'stroke over pluck, LAFmax dB': { original: Number((s0.lafMax_dB - p0.lafMax_dB).toFixed(1)), tuned: Number((s1.lafMax_dB - p1.lafMax_dB).toFixed(1)) },
  files: info,
  'builder example 2, 2.2 s, as integratedRadiated(1) on the test page computes it': browserCheck,
}, null, 2))
console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => { const x = v as Record<string, unknown>; return [k, { peak_Pa: x.peak_Pa, LAFmax_dB: x.LAFmax_dB, common_dBFS: (x.common as Record<string, unknown>).peakInFile_dBFS, matched_gain_dB: (x.matched as Record<string, unknown>).gain_dB }] })))
console.log(JSON.stringify(browserCheck))
console.log(`common gain ${r(commonGain)} per pascal (${dB(commonGain)} dB)\nwritten to ${fsPath(OUT)}`)
