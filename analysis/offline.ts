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
  const build = `analysis/build/${dsp.replace(/\W/g, '-')}`
  const log = console.log
  console.log = () => {} // the compiler is chatty
  try {
    await faust2wasmFiles(fsPath(dsp), fsPath(build), [], false)
  } finally {
    console.log = log
  }
  const factory = {
    module: await WebAssembly.compile(readFileSync(path(`${build}/dsp-module.wasm`))),
    json: readFileSync(path(`${build}/dsp-meta.json`), 'utf8'),
    soundfiles: {},
  }
  rmSync(path('analysis/build'), { recursive: true, force: true })
  return async (params: Params = {}) =>
    makeInstrument(await new FaustMonoDspGenerator().createOfflineProcessor(SR, 128, factory), params, SR, trigger)
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

export const concat = (parts: Float32Array[]) => Float32Array.from(parts.flatMap((a) => [...a]))
