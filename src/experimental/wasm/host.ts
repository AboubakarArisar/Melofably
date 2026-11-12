// EXPERIMENTAL (Phase 3A.1). Not used by the application.
// Main-thread side of the WebAssembly physics engine's AudioWorklet node.
import wasmUrl from './generated/engine.wasm?url'
import processorUrl from './processor.js?url'
import type { Call } from './engine.ts'

export interface EngineReport {
  blocks: number
  busyMs: number
  slowBlocks: number
  faults: number
  worstIterations: number
  memoryBytes: number
}

export interface PhysicsNode {
  node: AudioWorkletNode
  /** Run engine functions on the audio thread, between blocks. */
  send(calls: Call[]): void
  report(): Promise<EngineReport>
  /** Stop processing and disconnect. The node cannot be used afterwards. */
  dispose(): void
  /** Milliseconds from the request to the processor reporting ready. */
  initMs: number
}

let bytes: Promise<ArrayBuffer> | undefined
const modules = new WeakMap<BaseAudioContext, Promise<void>>()

/** The engine's bytes, fetched once. */
export function engineBytes(): Promise<ArrayBuffer> {
  bytes ??= fetch(wasmUrl).then((response) => {
    if (!response.ok) throw new Error(`Physics engine: could not load engine.wasm (HTTP ${response.status})`)
    return response.arrayBuffer()
  })
  bytes.catch(() => (bytes = undefined)) // a failed load may be retried
  return bytes
}

/**
 * Create a node running the system that `calls` builds. Resolves once the
 * processor has compiled the engine and built the system; rejects with the
 * reason if either fails. `source` replaces the engine's bytes (used to test
 * the failure path).
 */
export async function createPhysicsNode(ctx: BaseAudioContext, calls: Call[], options: { measure?: boolean; source?: ArrayBuffer } = {}): Promise<PhysicsNode> {
  const started = performance.now()
  const wasm = options.source ?? (await engineBytes())
  let module = modules.get(ctx)
  if (!module) modules.set(ctx, (module = ctx.audioWorklet.addModule(processorUrl)))
  await module
  const node = new AudioWorkletNode(ctx, 'sonicmatter-physics', {
    numberOfInputs: 0,
    outputChannelCount: [1],
    processorOptions: { bytes: wasm, calls, measure: options.measure ?? false },
  })
  const pending = new Map<number, (r: EngineReport) => void>()
  let nextReport = 1
  const dispose = () => {
    node.port.postMessage({ stop: true })
    node.port.onmessage = null
    node.disconnect()
  }
  await new Promise<void>((resolve, reject) => {
    node.onprocessorerror = () => reject(new Error('Physics engine: the audio processor failed'))
    node.port.onmessage = ({ data }) => {
      if (data.ready) resolve()
      else if (data.error) {
        console.error('Physics engine:', data.error)
        reject(new Error(`Physics engine: ${data.error}`))
      } else if (data.report) {
        pending.get(data.report)?.(data)
        pending.delete(data.report)
      }
    }
  }).catch((error) => {
    dispose()
    throw error
  })
  return {
    node,
    send: (list) => node.port.postMessage({ calls: list }),
    report: () =>
      new Promise((resolve) => {
        pending.set(nextReport, resolve)
        node.port.postMessage({ report: nextReport++ })
      }),
    dispose,
    initMs: performance.now() - started,
  }
}
