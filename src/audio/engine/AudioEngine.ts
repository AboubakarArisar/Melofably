import type { FaustMonoAudioWorkletNode } from '@grame/faustwasm'
import type { EngineStatus, InstrumentId } from '../../types'
import { createInstrumentNode, MODELS } from '../worklet/instruments'

/**
 * Main-thread owner of the audio graph: instrument worklet -> analyser ->
 * output. One AudioContext and one worklet node exist between start() and
 * dispose(); playing a note only sets parameters on that node, so nothing is
 * allocated per note. Changing instrument swaps the one node.
 */
export class AudioEngine {
  /** Taps the real output for visualization. Null until started. */
  analyser: AnalyserNode | null = null

  private onStatus: (status: EngineStatus) => void
  private ctx: AudioContext | null = null
  private node: FaustMonoAudioWorkletNode | null = null
  private instrument: InstrumentId | null = null // whose node is live
  private wanted: InstrumentId | null = null // most recently requested
  private loads = 0
  private notes = 0

  constructor(onStatus: (status: EngineStatus) => void = () => {}) {
    this.onStatus = onStatus
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  async start(instrument: InstrumentId): Promise<void> {
    if (this.ctx) return
    this.onStatus({ state: 'starting' })
    const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }))
    try {
      this.analyser = new AnalyserNode(ctx, { fftSize: 8192, smoothingTimeConstant: 0.5 })
      this.analyser.connect(ctx.destination)
      if (!(await this.load(ctx, instrument))) return
      ctx.onstatechange = () => this.report()
      await ctx.resume()
      this.report()
    } catch (error) {
      if (this.ctx === ctx) this.fail(error)
    }
  }

  /** Replace the sounding instrument. No-op until started. */
  async setInstrument(instrument: InstrumentId): Promise<void> {
    const ctx = this.ctx
    // Compare with the latest request, not the live node: a load may be in flight.
    if (!ctx || instrument === this.wanted) return
    try {
      if (await this.load(ctx, instrument)) this.report()
    } catch (error) {
      if (this.ctx === ctx) this.fail(error)
    }
  }

  setParam(name: string, value: number): void {
    if (Number.isFinite(value)) this.node?.setParamValue(`/${this.instrument}/${name}`, value)
  }

  /** Play note `note` (semitones above the instrument's lowest). */
  play(note: number): void {
    if (!this.instrument) return
    const { note: noteParam, trigger } = MODELS[this.instrument]
    this.setParam(noteParam, note)
    // The model starts a note whenever this counter changes.
    this.notes = (this.notes % 1_000_000) + 1
    this.setParam(trigger, this.notes)
  }

  suspend(): Promise<void> {
    return this.ctx?.suspend() ?? Promise.resolve()
  }

  resume(): Promise<void> {
    return this.ctx?.resume() ?? Promise.resolve()
  }

  /** Release the worklet, the graph and the AudioContext. Safe to call twice. */
  async dispose(): Promise<void> {
    const { ctx, analyser } = this
    this.releaseNode()
    this.ctx = this.analyser = this.wanted = null
    if (!ctx) return
    ctx.onstatechange = null
    analyser?.disconnect()
    await ctx.close().catch(() => {})
    this.onStatus({ state: 'stopped' })
  }

  /** Create `instrument`'s node and swap it in. False if superseded meanwhile. */
  private async load(ctx: AudioContext, instrument: InstrumentId): Promise<boolean> {
    const load = ++this.loads
    this.wanted = instrument
    const node = await createInstrumentNode(ctx, instrument)
    if (this.ctx !== ctx || load !== this.loads) {
      // dispose() or a newer load ran while the module was loading.
      node.destroy()
      return false
    }
    this.releaseNode()
    node.addEventListener('processorerror', () => this.fail('The audio processor crashed.'))
    node.setNonFiniteHandler(() => this.fail('The instrument model produced a non-finite sample.'))
    node.connect(this.analyser!)
    this.node = node
    this.instrument = instrument
    return true
  }

  private releaseNode(): void {
    this.node?.destroy()
    this.node?.disconnect()
    this.node = this.instrument = null
  }

  private report(): void {
    if (!this.ctx || !this.instrument) return
    // The browser can suspend or interrupt the context on its own.
    this.onStatus({ state: this.ctx.state === 'running' ? 'running' : 'suspended', instrument: this.instrument })
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    void this.dispose().then(() => this.onStatus({ state: 'error', message }))
  }
}
