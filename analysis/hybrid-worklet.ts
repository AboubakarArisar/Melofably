// Phase 3D.12: runs the hybrid lab's AudioWorklet processor in Node, from
// the very files the browser loads and in the browser's order: capture.js,
// the engine's processor.js (unchanged), hybrid-processor.js.
import type { Call, Engine } from '../src/experimental/wasm/engine.ts'
import { engineBytes } from './wasm.ts'

interface Processor {
  engine: Engine
  /** Nine numbers per finger: stage, connection, damping now, ... (hybrid-processor.js). */
  fingers: Float64Array
  touch: Float64Array
  port: { onmessage: ((event: { data: unknown }) => void) | null }
  posted: Record<string, unknown>[]
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean
}
type ProcessorClass = new (options: unknown) => Processor

let loading: Promise<Record<string, ProcessorClass>> | undefined

/** Both processor classes, loaded once: 'sonicmatter-physics' (the engine's own) and 'sonicmatter-hybrid'. */
export function processorClasses() {
  loading ??= (async () => {
    Object.assign(globalThis, {
      AudioWorkletProcessor: class {
        posted: unknown[] = []
        port = { onmessage: null, postMessage: (message: unknown) => void this.posted.push(message) }
      },
      registerProcessor: () => undefined,
    })
    const load = (file: string) => import(/* @vite-ignore */ new URL(`../src/experimental/${file}`, import.meta.url).href)
    await load('hybrid/capture.js')
    // (A query makes this a fresh evaluation: analysis/worklet.ts may already have loaded the same file with its own registerProcessor.)
    await load('wasm/processor.js?hybrid-lab')
    await load('hybrid/hybrid-processor.js')
    return (globalThis as unknown as { __sonicmatterProcessors: Record<string, ProcessorClass> }).__sonicmatterProcessors
  })()
  return loading
}

export interface HybridWorklet {
  processor: Processor
  engine: Engine
  send(calls: Call[]): void
  /** Asks for the timing and state report, as the page does. */
  diag(ask?: { resonators?: number[]; connections?: number[]; clear?: boolean }): Record<string, unknown>
  render(samples: number, before?: (block: number) => void): Float32Array
}

/** A processor running the system `calls` builds: the hybrid lab's by default, or the engine's own (`name`). */
export async function createHybridWorklet(calls: Call[], name: 'sonicmatter-hybrid' | 'sonicmatter-physics' = 'sonicmatter-hybrid'): Promise<HybridWorklet> {
  const Class = (await processorClasses())[name]
  if (!Class) throw new Error(`no processor "${name}"`)
  const processor = new Class({ processorOptions: { bytes: engineBytes, calls, measure: false } })
  const failed = () => {
    const failure = processor.posted.find((message) => 'error' in message)
    if (failure) throw new Error(String(failure.error))
  }
  failed()
  const block = new Float32Array(128)
  let asked = 0
  return {
    processor,
    engine: processor.engine,
    send: (list) => {
      processor.port.onmessage!({ data: { calls: list } })
      failed()
    },
    diag(ask = {}) {
      const id = ++asked
      processor.port.onmessage!({ data: { diag: id, ...ask } })
      const reply = processor.posted.find((message) => message.diag === id)
      if (!reply) throw new Error('the processor did not answer')
      return reply
    },
    render(samples, before) {
      const out = new Float32Array(samples)
      for (let at = 0, index = 0; at < samples; at += 128, index++) {
        before?.(index)
        const count = Math.min(128, samples - at)
        const part = count === 128 ? block : new Float32Array(count)
        processor.process([], [[part]])
        out.set(part, at)
      }
      failed()
      return out
    },
  }
}
