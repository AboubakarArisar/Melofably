import { FaustMonoDspGenerator, type FaustMonoAudioWorkletNode } from '@grame/faustwasm'
import type { InstrumentId, InstrumentParam } from '../../types'
// Produced from src/audio/models/*.dsp by `npm run dsp`.
import barMeta from '../models/generated/bar/dsp-meta.json'
import barWasm from '../models/generated/bar/dsp-module.wasm?url'
import glassMeta from '../models/generated/glass/dsp-meta.json'
import glassWasm from '../models/generated/glass/dsp-module.wasm?url'
import woodMeta from '../models/generated/wood/dsp-meta.json'
import woodWasm from '../models/generated/wood/dsp-module.wasm?url'
import stringMeta from '../models/generated/string/dsp-meta.json'
import stringWasm from '../models/generated/string/dsp-module.wasm?url'

/**
 * The compiled models. `note` is the parameter that selects the pitch (fret
 * of the string, which bar to strike) and `trigger` the counter each model
 * watches to start a note.
 */
export const MODELS = {
  string: { meta: stringMeta, wasmUrl: stringWasm, note: 'fret', trigger: 'pluck' },
  bar: { meta: barMeta, wasmUrl: barWasm, note: 'key', trigger: 'strike' },
  glass: { meta: glassMeta, wasmUrl: glassWasm, note: 'key', trigger: 'strike' },
  wood: { meta: woodMeta, wasmUrl: woodWasm, note: 'key', trigger: 'strike' },
}

type MetaItem = Omit<InstrumentParam, 'unit'> & { meta?: { unit?: string }[] }
const paramsOf = (meta: { ui: { items: MetaItem[] }[] }): Record<string, InstrumentParam> =>
  Object.fromEntries(meta.ui[0].items.map((item) => [item.label, { ...item, unit: item.meta?.[0]?.unit }]))

/** Each model's parameters as declared in its Faust source, by label. */
export const instrumentParams: Record<InstrumentId, Record<string, InstrumentParam>> = {
  string: paramsOf(stringMeta),
  bar: paramsOf(barMeta),
  glass: paramsOf(glassMeta),
  wood: paramsOf(woodMeta),
}

/**
 * Instantiate a compiled model as an AudioWorkletNode. faustwasm registers
 * its processor from a Blob URL and instantiates the WebAssembly module on
 * the audio thread; all synthesis happens there.
 */
export async function createInstrumentNode(ctx: BaseAudioContext, id: InstrumentId): Promise<FaustMonoAudioWorkletNode> {
  const { meta, wasmUrl } = MODELS[id]
  const module = await WebAssembly.compileStreaming(fetch(wasmUrl))
  const node = await new FaustMonoDspGenerator().createNode(ctx, id, { module, json: JSON.stringify(meta), soundfiles: {} })
  if (!node) throw new Error(`Could not create the ${id} AudioWorklet node`)
  return node
}
