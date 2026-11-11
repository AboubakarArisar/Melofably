import type { FaustMonoAudioWorkletNode } from '@grame/faustwasm'
import type { EngineStatus } from '../../types'
import { createStringNode } from '../worklet/stringNode'

/**
 * Main-thread owner of the audio graph: string worklet -> analyser -> output.
 * One AudioContext and one worklet node exist between start() and dispose();
 * playing a note only sets parameters on that node, so nothing is allocated
 * per note.
 */
export class StringEngine {
  private onStatus: (status: EngineStatus) => void
  /** Taps the real output for visualization. Null until started. */
  analyser: AnalyserNode | null = null

  private ctx: AudioContext | null = null
  private node: FaustMonoAudioWorkletNode | null = null
  private plucks = 0

  constructor(onStatus: (status: EngineStatus) => void = () => {}) {
    this.onStatus = onStatus
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  async start(): Promise<void> {
    if (this.ctx) return
    this.onStatus({ state: 'starting' })
    const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }))
    try {
      const node = await createStringNode(ctx)
      if (this.ctx !== ctx) {
        // dispose() ran while the module was loading.
        node.destroy()
        return
      }
      this.node = node
      node.addEventListener('processorerror', () => this.fail('The audio processor crashed.'))
      node.setNonFiniteHandler(() => this.fail('The string model produced a non-finite sample.'))
      this.analyser = new AnalyserNode(ctx, { fftSize: 8192, smoothingTimeConstant: 0.5 })
      node.connect(this.analyser).connect(ctx.destination)
      ctx.onstatechange = () => this.report()
      await ctx.resume()
      this.report()
    } catch (error) {
      if (this.ctx === ctx) this.fail(error instanceof Error ? error.message : String(error))
    }
  }

  setParam(name: string, value: number): void {
    if (Number.isFinite(value)) this.node?.setParamValue(`/string/${name}`, value)
  }

  /** Pluck the string, fretted `fret` semitones above the open string. */
  pluck(fret: number): void {
    this.setParam('fret', fret)
    // The model plucks whenever this counter changes.
    this.plucks = (this.plucks % 1_000_000) + 1
    this.setParam('pluck', this.plucks)
  }

  suspend(): Promise<void> {
    return this.ctx?.suspend() ?? Promise.resolve()
  }

  resume(): Promise<void> {
    return this.ctx?.resume() ?? Promise.resolve()
  }

  /** Release the worklet, the graph and the AudioContext. Safe to call twice. */
  async dispose(): Promise<void> {
    const { ctx, node, analyser } = this
    this.ctx = this.node = this.analyser = null
    if (!ctx) return
    ctx.onstatechange = null
    node?.destroy()
    node?.disconnect()
    analyser?.disconnect()
    await ctx.close().catch(() => {})
    this.onStatus({ state: 'stopped' })
  }

  private report(): void {
    if (!this.ctx) return
    // The browser can suspend or interrupt the context on its own.
    this.onStatus({ state: this.ctx.state === 'running' ? 'running' : 'suspended' })
  }

  private fail(message: string): void {
    void this.dispose().then(() => this.onStatus({ state: 'error', message }))
  }
}
