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

export const INSTRUMENT_IDS = Object.keys(MODELS) as InstrumentId[]

const compiled = new Map<InstrumentId, Promise<WebAssembly.Module>>()

/**
 * Fetch and compile a model's WebAssembly, once per page. A compiled module
 * does not belong to any AudioContext, so it is reused for every node and
 * across stop/start. A failed load is not remembered, so it can be retried.
 */
export function compileInstrument(id: InstrumentId): Promise<WebAssembly.Module> {
  let module = compiled.get(id)
  if (!module) {
    module = (async () => {
      const response = await fetch(MODELS[id].wasmUrl)
      if (!response.ok) throw new Error(`Could not load the ${id} model (HTTP ${response.status})`)
      return WebAssembly.compileStreaming(response)
    })()
    module.catch(() => compiled.delete(id))
    compiled.set(id, module)
  }
  return module
}

/**
 * Get every model ready ahead of use: at page load, with no user gesture and
 * no audible AudioContext. Each model is compiled, then run for half a second
 * in an OfflineAudioContext with a note sounding. That exercises the compiled
 * code off the real-time thread, so the browser's first-run work on it
 * (optimising the WebAssembly once it runs hot) is done before it is ever
 * asked to produce live audio. Failures are left for the first real use to
 * report.
 */
export async function preloadInstruments(): Promise<void> {
  for (const id of INSTRUMENT_IDS) {
    try {
      await compileInstrument(id)
      if (typeof OfflineAudioContext === 'undefined') continue
      const offline = new OfflineAudioContext(1, 24000, 48000)
      const node = await createInstrumentNode(offline, id)
      node.connect(offline.destination)
      node.setParamValue(`/${id}/${MODELS[id].trigger}`, 1)
      await offline.startRendering()
      node.destroy()
    } catch {
      // Reported when the instrument is actually used.
    }
  }
}

/**
 * Instantiate a compiled model as an AudioWorkletNode. faustwasm registers
 * its processor from a Blob URL and instantiates the WebAssembly module on
 * the audio thread; all synthesis happens there.
 */
export async function createInstrumentNode(ctx: BaseAudioContext, id: InstrumentId): Promise<FaustMonoAudioWorkletNode> {
  const module = await compileInstrument(id)
  const node = await new FaustMonoDspGenerator().createNode(ctx, id, {
    module,
    json: JSON.stringify(MODELS[id].meta),
    soundfiles: {},
  })
  if (!node) throw new Error(`Could not create the ${id} AudioWorklet node`)
  return node
}
