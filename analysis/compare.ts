// Before/after comparison of string models. Compiles each .dsp, renders the
// same notes with the same settings, measures them, and writes WAV files for
// listening.
//
//   npm run compare
//
// Output: renders/<model>/<note>.wav, renders/metrics.json, and tables on stdout.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { FaustMonoDspGenerator, WavEncoder } from '@grame/faustwasm/dist/esm/index.js'
import faust2wasmFiles from '@grame/faustwasm/src/faust2wasmFiles.js'
import {
  bandPower,
  cents,
  dB,
  decayTime,
  makeString,
  maxStep,
  measureFrequency,
  peak,
  powerSpectrum,
  rms,
  spectralCentroid,
  SR,
  type Params,
} from './lib.ts'

const root = new URL('..', import.meta.url)
const path = (rel: string) => new URL(rel, root)
const fsPath = (rel: string) => decodeURIComponent(path(rel).pathname).replace(/^\/(\w:)/, '$1')

const MODELS = [
  { name: 'before-phase1', dsp: 'analysis/string-phase1.dsp' },
  { name: 'after-phase1.1', dsp: 'src/audio/models/string.dsp' },
]

// Three strings (low, middle, high) fretted across two octaves. Every other
// control is left at each model's own default, as a player would first hear it.
const LOW = { length: 0.65, tension: 71, density: 0.0064 } // ~81 Hz
const MID = { length: 0.65, tension: 73.5, density: 0.0036 } // ~110 Hz (default)
const HIGH = { length: 0.65, tension: 73, density: 0.0004 } // ~329 Hz
const NOTES: { name: string; params: Params }[] = [
  { name: '01-low-082Hz', params: { ...LOW, fret: 0 } },
  { name: '02-mid-110Hz', params: { ...MID, fret: 0 } },
  { name: '03-mid-147Hz', params: { ...MID, fret: 5 } },
  { name: '04-mid-220Hz', params: { ...MID, fret: 12 } },
  { name: '05-high-329Hz', params: { ...HIGH, fret: 0 } },
  { name: '06-mid-440Hz', params: { ...MID, fret: 24 } },
  { name: '07-high-658Hz', params: { ...HIGH, fret: 12 } },
  { name: '08-high-1315Hz', params: { ...HIGH, fret: 24 } },
]
const SECONDS = 3

const fundamental = (p: Params) => Math.sqrt(p.tension / p.density) / (2 * p.length * 2 ** (-p.fret / 12))
const fix = (v: number, d = 2) => Number(v.toFixed(d))

/** Seconds until the power above `hz` first falls 20 dB below its starting value. */
function highBandDecay(x: Float32Array, hz: number): number {
  const n = 2048
  const first = bandPower(powerSpectrum(x, 0, n), hz)
  for (let start = n / 2; start + n <= x.length; start += n / 2) {
    if (bandPower(powerSpectrum(x, start, n), hz) < first / 100) return start / SR
  }
  return Infinity
}

function measureNote(x: Float32Array, expected: number) {
  const early = powerSpectrum(x, 0, 16384) // first 0.34 s
  const pk = peak(x)
  const steady = x.subarray(Math.round(0.1 * SR), Math.round(0.6 * SR))
  const f = measureFrequency(x.subarray(0, SR))
  const h1 = harmonicAmp(steady, f, 1)
  return {
    expectedHz: fix(expected),
    measuredHz: fix(f),
    cents: fix(cents(f, expected), 3),
    peak: fix(pk, 3),
    rmsFirst500ms: fix(rms(x, 0, SR / 2), 3),
    clampedSamples: x.reduce((n, v) => n + (Math.abs(v) >= 0.999 ? 1 : 0), 0),
    finite: x.every(Number.isFinite),
    centroidHz: Math.round(spectralCentroid(early)),
    centroidOverF0: fix(spectralCentroid(early) / f, 1),
    above3kHz_dB: fix(dB(Math.sqrt(bandPower(early, 3000) / bandPower(early, 0))), 1),
    // Harmonic levels relative to the fundamental. Primes, so none sits on a
    // null of the default pluck position (1/5).
    h2dB: fix(dB(harmonicAmp(steady, f, 2) / h1), 1),
    h3dB: fix(dB(harmonicAmp(steady, f, 3) / h1), 1),
    h7dB: fix(dB(harmonicAmp(steady, f, 7) / h1), 1),
    h13dB: f * 13 < SR / 2 ? fix(dB(harmonicAmp(steady, f, 13) / h1), 1) : null,
    h29dB: f * 29 < SR / 2 ? fix(dB(harmonicAmp(steady, f, 29) / h1), 1) : null,
    // Attack: biggest sample-to-sample jump in the first 20 ms, relative to
    // the peak (1.0 = the whole waveform height in one sample).
    attackStepRelPeak: fix(maxStep(x, 1, Math.round(0.02 * SR)) / pk, 3),
    msTo90PctPeak: fix((1000 * x.findIndex((v) => Math.abs(v) >= 0.9 * pk)) / SR, 2),
    decayTo20dB_s: fix(decayTime(x, 20)),
    decayAbove3kHzTo20dB_s: fix(highBandDecay(x, 3000)),
  }
}

function harmonicAmp(x: Float32Array, f: number, k: number): number {
  // Single-bin DFT with a Hann window.
  let re = 0
  let im = 0
  let wsum = 0
  for (let i = 0; i < x.length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1))
    const ph = (2 * Math.PI * k * f * i) / SR
    re += w * x[i] * Math.cos(ph)
    im -= w * x[i] * Math.sin(ph)
    wsum += w
  }
  return (2 * Math.hypot(re, im)) / wsum
}

function writeWav(rel: string, x: Float32Array) {
  writeFileSync(path(rel), new Uint8Array(WavEncoder.encode([x], { sampleRate: SR, bitDepth: 24 }) as ArrayBuffer))
}

const results: Record<string, unknown> = {}
rmSync(path('renders'), { recursive: true, force: true })

for (const model of MODELS) {
  const out = `renders/${model.name}`
  mkdirSync(path(out), { recursive: true })
  const build = `analysis/build/${model.name}`
  const log = console.log
  console.log = () => {} // the compiler is chatty
  await faust2wasmFiles(fsPath(model.dsp), fsPath(build), [], false)
  console.log = log
  const factory = {
    module: await WebAssembly.compile(readFileSync(path(`${build}/dsp-module.wasm`))),
    json: readFileSync(path(`${build}/dsp-meta.json`), 'utf8'),
    soundfiles: {},
  }
  const fresh = async (params: Params) =>
    makeString(await new FaustMonoDspGenerator().createOfflineProcessor(SR, 128, factory), params)

  // 1. Single notes.
  const notes: Record<string, ReturnType<typeof measureNote>> = {}
  for (const note of NOTES) {
    const x = (await fresh(note.params)).pluckAndRender(SECONDS)
    writeWav(`${out}/${note.name}.wav`, x)
    notes[note.name] = measureNote(x, fundamental(note.params))
  }

  // 2. Retrigger: a ringing note cut by a new one, and fast repeats.
  const s = await fresh({ ...MID, fret: 0 })
  const first = s.pluckAndRender(0.4)
  s.set({ fret: 7 })
  const second = s.pluckAndRender(1.2)
  const repeats: Float32Array[] = []
  for (let i = 0; i < 16; i++) {
    s.set({ fret: [0, 3, 7, 12][i % 4] })
    repeats.push(s.pluckAndRender(0.12))
  }
  repeats.push(s.render(1.5))
  const retrigger = Float32Array.from([first, second, ...repeats].flatMap((a) => [...a]))
  writeWav(`${out}/09-retrigger.wav`, retrigger)
  const at = first.length
  const retrig = {
    freshPluckStep: fix(maxStep(first, 1, 960), 3),
    // Jump at the instant the old note is cut and the new one starts.
    retriggerStep: fix(maxStep(retrigger, at - 2, at + 960), 3),
    peakSingleNote: fix(peak(first), 3),
    peakDuringRepeats: fix(peak(retrigger, at), 3),
    clampedSamples: retrigger.reduce((n, v) => n + (Math.abs(v) >= 0.999 ? 1 : 0), 0),
  }

  // 3. A short phrase, for listening only.
  const phrase: Float32Array[] = []
  const p = await fresh(MID)
  for (const fret of [0, 4, 7, 12, 16, 19, 24, 19, 16, 12, 7, 4]) {
    p.set({ fret })
    phrase.push(p.pluckAndRender(0.3))
  }
  phrase.push(p.render(2.5))
  writeWav(`${out}/10-phrase.wav`, Float32Array.from(phrase.flatMap((a) => [...a])))

  // 4. Stability: least damping the model allows, 20 s.
  const long = (await fresh({ ...MID, damping: 0, strength: 1 })).pluckAndRender(20)
  const env = []
  for (let i = 0; i + SR / 4 <= long.length; i += SR / 4) env.push(rms(long, i, i + SR / 4))
  const stability = {
    finite: long.every(Number.isFinite),
    peak: fix(peak(long), 3),
    envelopeNeverGrows: env.every((v, i) => i === 0 || v <= env[i - 1] * 1.001),
    levelAfter20s_dB: fix(dB(env.at(-1)! / env[0]), 1),
  }

  results[model.name] = { notes, retrigger: retrig, stability }
  console.log(`\n=== ${model.name} ===`)
  console.table(notes)
  console.table({ retrigger: retrig })
  console.table({ stability })
}

writeFileSync(path('renders/metrics.json'), JSON.stringify(results, null, 2))
rmSync(path('analysis/build'), { recursive: true, force: true })
console.log(`\nWAV files and metrics.json written to ${fsPath('renders')}`)
