// Phase 3C.3: runs the browser's AudioWorklet processor
// (src/experimental/wasm/processor.js, the very file the browser loads) in
// Node, so that what the builder plays can be tested and rendered without a
// browser: its plucks and its conversion to sound pressure included.
import type { Call, Engine } from '../src/experimental/wasm/engine.ts'
import { engineBytes } from './wasm.ts'

interface Processor {
  engine: Engine
  port: { onmessage: ((event: { data: unknown }) => void) | null }
  posted: Record<string, unknown>[]
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}

let loading: Promise<new (options: unknown) => Processor> | undefined

/** The processor's class, loaded once with the two globals an AudioWorkletGlobalScope provides. */
function processorClass() {
  loading ??= (async () => {
    let registered: (new (options: unknown) => Processor) | undefined
    Object.assign(globalThis, {
      AudioWorkletProcessor: class {
        posted: unknown[] = []
        port = { onmessage: null, postMessage: (message: unknown) => void this.posted.push(message) }
      },
      registerProcessor: (_name: string, cls: new (options: unknown) => Processor) => (registered = cls),
    })
    await import(/* @vite-ignore */ new URL('../src/experimental/wasm/processor.js', import.meta.url).href)
    if (!registered) throw new Error('processor.js did not register a processor')
    return registered
  })()
  return loading
}

export interface Worklet {
  /** The engine inside the processor, for reading energies and faults. Do not step it directly. */
  engine: Engine
  /** What the main thread's send() does: run calls between blocks. */
  send(calls: Call[]): void
  /** The next `samples` of the node's output, produced in blocks of 128 as a browser does. */
  render(samples: number, before?: (block: number) => void): Float32Array
}

/** A processor running the system that `calls` builds. */
export async function createWorklet(calls: Call[]): Promise<Worklet> {
  const Class = await processorClass()
  const processor = new Class({ processorOptions: { bytes: engineBytes, calls, measure: false } })
  const failure = processor.posted.find((message) => 'error' in message)
  if (failure) throw new Error(String(failure.error))
  const block = new Float32Array(128)
  return {
    engine: processor.engine,
    send: (list) => processor.port.onmessage!({ data: { calls: list } }),
    render(samples, before) {
      const out = new Float32Array(samples)
      for (let at = 0, index = 0; at < samples; at += 128, index++) {
        before?.(index)
        const count = Math.min(128, samples - at)
        const part = count === 128 ? block : new Float32Array(count)
        processor.process([], [[part]])
        out.set(part, at)
      }
      const error = processor.posted.find((message) => 'error' in message)
      if (error) throw new Error(String(error.error))
      return out
    },
  }
}
