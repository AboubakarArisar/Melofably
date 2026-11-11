import { FaustMonoDspGenerator, type FaustMonoAudioWorkletNode } from '@grame/faustwasm'
import type { InstrumentParam } from '../../types'
// Both files are produced from string.dsp by `npm run dsp`.
import meta from '../models/generated/dsp-meta.json'
import wasmUrl from '../models/generated/dsp-module.wasm?url'

/** The string model's parameters as declared in the Faust source, by label. */
export const stringParams: Record<string, InstrumentParam> = Object.fromEntries(
  meta.ui[0].items.map((item) => [
    item.label,
    { ...item, unit: 'meta' in item ? item.meta?.[0]?.unit : undefined },
  ]),
)

/**
 * Instantiate the compiled string model as an AudioWorkletNode. faustwasm
 * registers its processor from a Blob URL and instantiates the WebAssembly
 * module on the audio thread; all synthesis happens there.
 */
export async function createStringNode(ctx: BaseAudioContext): Promise<FaustMonoAudioWorkletNode> {
  const module = await WebAssembly.compileStreaming(fetch(wasmUrl))
  const node = await new FaustMonoDspGenerator().createNode(ctx, 'string', {
    module,
    json: JSON.stringify(meta),
    soundfiles: {},
  })
  if (!node) throw new Error('Could not create the string AudioWorklet node')
  return node
}
