import { readFileSync } from 'node:fs'
import { FaustMonoDspGenerator } from '@grame/faustwasm'
import { makeInstrument, SR, type Params } from '../analysis/lib'

export * from '../analysis/lib'

// The exact artifacts the browser loads (built by `npm run dsp`).
async function load(model: string) {
  const dir = new URL(`../src/audio/models/generated/${model}/`, import.meta.url)
  return {
    module: await WebAssembly.compile(readFileSync(new URL('dsp-module.wasm', dir))),
    json: readFileSync(new URL('dsp-meta.json', dir), 'utf8'),
    soundfiles: {},
  }
}
const models = { string: await load('string'), bar: await load('bar'), glass: await load('glass') }

const create = async (model: keyof typeof models, trigger: string, params: Params, sampleRate: number) =>
  makeInstrument(
    await new FaustMonoDspGenerator().createOfflineProcessor(sampleRate, 128, models[model]),
    params,
    sampleRate,
    trigger,
  )

/** A fresh instance of the shipped string model, settled and silent. */
export const createString = (params: Params = {}, sampleRate = SR) => create('string', 'pluck', params, sampleRate)

/** A fresh instance of the shipped glass vessel model, silent. */
export const createGlass = (params: Params = {}, sampleRate = SR) => create('glass', 'strike', params, sampleRate)

/** A fresh instance of the shipped metal bar model, silent. */
export const createBar = (params: Params = {}, sampleRate = SR) => create('bar', 'strike', params, sampleRate)
