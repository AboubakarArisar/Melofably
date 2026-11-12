// EXPERIMENTAL (Phase 3A.1). Benchmark only, development server only.
// The TypeScript reference engine in an AudioWorklet, so that it can be timed
// in the browser against the WebAssembly engine. Never used to play.
import { toSystem, type Layout } from '../wasm/layouts.ts'

declare class AudioWorkletProcessor {
  constructor()
  readonly port: MessagePort
}
declare function registerProcessor(name: string, processor: unknown): void
declare const sampleRate: number

class ReferenceProcessor extends AudioWorkletProcessor {
  private readonly built: ReturnType<typeof toSystem>

  constructor(options: { processorOptions: { layout: Layout; impulse: number } }) {
    super()
    const { layout, impulse } = options.processorOptions
    this.built = toSystem(layout, sampleRate)
    for (const port of this.built.strikePorts) this.built.system.applyForce(port, impulse * sampleRate)
    this.port.postMessage({ ready: true })
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    this.built.system.process(outputs[0][0], this.built.output)
    return true
  }
}

registerProcessor('sonicmatter-physics-reference', ReferenceProcessor)
