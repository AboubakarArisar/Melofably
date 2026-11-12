// Compile every Faust model in src/audio/models to WebAssembly:
//   src/audio/models/<name>.dsp -> src/audio/models/generated/<name>/dsp-module.wasm
//                                                                   /dsp-meta.json
// A model is skipped when its output is newer than its source and every .lib
// beside it. Adding an instrument needs no change here.
//
//   npm run dsp              compile what changed
//   npm run dsp -- --force   compile everything
import { existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import faust2wasmFiles from '@grame/faustwasm/src/faust2wasmFiles.js'

const dir = fileURLToPath(new URL('../src/audio/models/', import.meta.url))
const force = process.argv.includes('--force')
const modified = (file) => statSync(file).mtimeMs
const files = readdirSync(dir)
const newestLib = Math.max(0, ...files.filter((f) => f.endsWith('.lib')).map((f) => modified(dir + f)))

const log = console.log
for (const file of files.filter((f) => f.endsWith('.dsp'))) {
  const name = file.replace(/\.dsp$/, '')
  const out = `${dir}generated/${name}`
  const built = `${out}/dsp-module.wasm`
  if (!force && existsSync(built) && modified(built) > Math.max(modified(dir + file), newestLib)) {
    log(`${name}: up to date`)
    continue
  }
  const started = Date.now()
  console.log = () => {} // the compiler narrates every step
  try {
    await faust2wasmFiles(dir + file, out, [], false)
  } finally {
    console.log = log
  }
  log(`${name}: compiled in ${Date.now() - started} ms`)
}
