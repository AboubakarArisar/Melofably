// Node-only helpers for the analysis scripts: compile a .dsp with the Faust
// WebAssembly compiler, run it offline, and write WAV files.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { FaustMonoDspGenerator, WavEncoder } from '@grame/faustwasm/dist/esm/index.js'
import faust2wasmFiles from '@grame/faustwasm/src/faust2wasmFiles.js'
import { makeInstrument, SR, type Params } from './lib.ts'

const root = new URL('..', import.meta.url)
/** URL of a path relative to the project root. */
export const path = (rel: string) => new URL(rel, root)
/** The same as a filesystem path string. */
export const fsPath = (rel: string) => decodeURIComponent(path(rel).pathname).replace(/^\/(\w:)/, '$1')

/**
 * Compile `dsp` (project-relative) and return a function that makes fresh
 * offline instances of it. `trigger` is the model's note-start counter.
 */
export async function compileModel(dsp: string, trigger: string) {
  const { factory } = await compileFactory(dsp)
  return async (params: Params = {}) =>
    makeInstrument(await new FaustMonoDspGenerator().createOfflineProcessor(SR, 128, factory), params, SR, trigger)
}

/**
 * Compile `dsp` (project-relative) with extra Faust arguments (e.g. "-double")
 * and return the factory for createOfflineProcessor, with how long the
 * compilation took.
 */
export async function compileFactory(dsp: string, args: string[] = []) {
  const build = `analysis/build/${dsp.replace(/\W/g, '-')}-${process.pid}`
  const log = console.log
  console.log = () => {} // the compiler is chatty
  const started = performance.now()
  try {
    await faust2wasmFiles(fsPath(dsp), fsPath(build), [...args], false)
  } finally {
    console.log = log
  }
  const compileMs = performance.now() - started
  const factory = {
    module: await WebAssembly.compile(readFileSync(path(`${build}/dsp-module.wasm`))),
    json: readFileSync(path(`${build}/dsp-meta.json`), 'utf8'),
    soundfiles: {},
  }
  rmSync(path(build), { recursive: true, force: true })
  return { factory, compileMs }
}

/** Empty and recreate a project-relative output folder. */
export function freshDir(rel: string) {
  rmSync(path(rel), { recursive: true, force: true })
  mkdirSync(path(rel), { recursive: true })
}

/** Write mono 24-bit WAV at the analysis sample rate. */
export function writeWav(rel: string, x: Float32Array) {
  writeFileSync(path(rel), new Uint8Array(WavEncoder.encode([x], { sampleRate: SR, bitDepth: 24 }) as ArrayBuffer))
}

/**
 * How many times faster than real time this process renders the model, on one
 * thread (the same WebAssembly the browser's audio thread runs), after
 * `notes` notes have been started on keys/frets 0..notes-1.
 */
export async function realtimeFactor(model: Awaited<ReturnType<typeof compileModel>>, setup: Params, notes: number) {
  const inst = await model(setup)
  for (let i = 0; i < notes; i++) {
    inst.set({ key: i, fret: i })
    inst.play(0.01)
  }
  const seconds = 20
  const t0 = performance.now()
  inst.render(seconds)
  return Math.round(seconds / ((performance.now() - t0) / 1000))
}

export const concat =(parts: Float32Array[]) => Float32Array.from(parts.flatMap((a) => [...a]))

/**
 * Writer for groups of listening files into `out` that share one gain (the
 * loudest of the group peaks at 0.5), so loudness differences inside a group
 * are the real ones. `info` collects, per file, its level before the gain
 * (for a pressure: in pascals and dB SPL) and the gain applied.
 */
export function groupWriter(out: string) {
  const info: Record<string, unknown> = {}
  const peakOf = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  const rmsOf = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)
  function writeGroup(unit: string, files: Record<string, Float32Array>, note?: string) {
    const entries = Object.entries(files)
    const gain = 0.5 / Math.max(...entries.map(([, x]) => peakOf(x)))
    const reference = rmsOf(entries[0][1])
    for (const [name, x] of entries) {
      if (!x.every(Number.isFinite)) throw new Error(`${name}: non-finite samples`)
      writeWav(`${out}/${name}.wav`, Float32Array.from(x, (v) => v * gain))
      info[name] = {
        quantity: unit,
        peak: Number(peakOf(x).toPrecision(3)),
        rms: Number(rmsOf(x).toPrecision(3)),
        ...(unit === 'Pa' ? { peak_dB_SPL: Number((20 * Math.log10(peakOf(x) / Math.SQRT2 / 20e-6)).toFixed(1)), rms_dB_SPL: Number((20 * Math.log10(rmsOf(x) / 20e-6)).toFixed(1)) } : {}),
        levelRelativeToFirstInGroup_dB: Number((20 * Math.log10(rmsOf(x) / reference)).toFixed(1)),
        gainApplied: Number(gain.toPrecision(3)),
        gainApplied_dB: Number((20 * Math.log10(gain)).toFixed(1)),
        ...(note ? { note } : {}),
      }
    }
  }
  return { info, writeGroup }
}
