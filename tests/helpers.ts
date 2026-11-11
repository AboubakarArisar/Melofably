import { readFileSync } from 'node:fs'
import { FaustMonoDspGenerator } from '@grame/faustwasm'
import { makeString, SR, type Params } from '../analysis/lib'

export * from '../analysis/lib'

// The exact artifacts the browser loads (built by `npm run dsp`).
const dir = new URL('../src/audio/models/generated/', import.meta.url)
const module = await WebAssembly.compile(readFileSync(new URL('dsp-module.wasm', dir)))
const json = readFileSync(new URL('dsp-meta.json', dir), 'utf8')

/** A fresh instance of the shipped string model, settled and silent. */
export async function createString(params: Params = {}, sampleRate = SR) {
  const dsp = await new FaustMonoDspGenerator().createOfflineProcessor(sampleRate, 128, {
    module,
    json,
    soundfiles: {},
  })
  return makeString(dsp, params, sampleRate)
}
