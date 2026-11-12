import type { FaustMonoAudioWorkletNode } from '@grame/faustwasm'
import type { EngineStatus, InstrumentId } from '../../types'
import { createInstrumentNode, MODELS } from '../worklet/instruments'

/** Length of the fade applied to the outgoing instrument when switching. */
const FADE_SECONDS = 0.015

const delay = (seconds: number) => new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000))

/**
 * Main-thread owner of the audio graph:
 *
 *   instrument worklet -> output gain -> analyser -> destination
 *
 * One AudioContext and one live worklet node exist between start() and
 * dispose(); playing a note only sets parameters on that node, so nothing is
 * allocated per note. start() also sets up every other instrument once and
 * discards it, so that switching later has no first-time work to do.
 * Changing instrument fades the output out, swaps the one node and restores
 * the gain, so the outgoing sound is never cut mid-wave and the two
 * instruments never overlap.
 */
export class AudioEngine {
  /** Taps the real output for visualization. Null until started. */
  analyser: AnalyserNode | null = null

  private onStatus: (status: EngineStatus) => void
  private ctx: AudioContext | null = null
  private output: GainNode | null = null
  private node: FaustMonoAudioWorkletNode | null = null
  private instrument: InstrumentId | null = null // whose node is live
  private wanted: InstrumentId | null = null // most recently requested
  private loads = 0
  private notes = 0
  private reported = '' // last status sent, to avoid repeats

  constructor(onStatus: (status: EngineStatus) => void = () => {}) {
    this.onStatus = onStatus
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  async start(instrument: InstrumentId): Promise<void> {
    if (this.ctx) return
    this.onStatus({ state: 'starting' })
    const ctx = (this.ctx = new AudioContext({ latencyHint: 'interactive' }))
    try {
      this.output = new GainNode(ctx)
      this.analyser = new AnalyserNode(ctx, { fftSize: 8192, smoothingTimeConstant: 0.5 })
      this.output.connect(this.analyser).connect(ctx.destination)
      // The first node is created straight away, while the output stream is
      // still starting, so its one-off setup cost falls before any sound.
      if (!(await this.load(ctx, instrument))) return
      if (!(await this.prime(ctx, instrument))) return
      ctx.onstatechange = () => this.report()
      await ctx.resume()
      this.report()
    } catch (error) {
      if (this.ctx === ctx) this.fail(error)
    }
  }

  /** Replace the sounding instrument. No-op until started. */
  async setInstrument(instrument: InstrumentId): Promise<void> {
    const { ctx, output } = this
    // Compare with the latest request, not the live node: a load may be in flight.
    if (!ctx || !output || instrument === this.wanted) return
    try {
      // Fade the outgoing instrument rather than cutting it.
      const now = ctx.currentTime
      output.gain.cancelScheduledValues(now)
      output.gain.setValueAtTime(output.gain.value, now)
      output.gain.linearRampToValueAtTime(0, now + FADE_SECONDS)
      if (await this.load(ctx, instrument, FADE_SECONDS)) this.report()
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
    const { ctx, analyser, output } = this
    this.releaseNode()
    this.ctx = this.analyser = this.output = this.wanted = null
    this.reported = ''
    if (!ctx) return
    ctx.onstatechange = null
    output?.disconnect()
    analyser?.disconnect()
    await ctx.close().catch(() => {})
    this.onStatus({ state: 'stopped' })
  }

  /**
   * Create `instrument`'s node and swap it in once at least `hold` seconds
   * have passed (time for the fade-out). False if superseded meanwhile.
   */
  private async load(ctx: AudioContext, instrument: InstrumentId, hold = 0): Promise<boolean> {
    const load = ++this.loads
    this.wanted = instrument
    const [node] = await Promise.all([createInstrumentNode(ctx, instrument), hold ? delay(hold) : undefined])
    if (this.ctx !== ctx || load !== this.loads) {
      // dispose() or a newer load ran while the node was being created.
      node.destroy()
      return false
    }
    this.releaseNode()
    node.addEventListener('processorerror', () => this.fail('The audio processor crashed.'))
    node.setNonFiniteHandler(() => this.fail('The instrument model produced a non-finite sample.'))
    node.connect(this.output!)
    this.node = node
    this.instrument = instrument
    // The new instrument is silent until played, so the gain can return at once.
    const gain = this.output!.gain
    gain.cancelScheduledValues(ctx.currentTime)
    gain.setValueAtTime(1, ctx.currentTime)
    return true
  }

  /**
   * Create and immediately discard a node of every other instrument. The
   * first node of a model in a context registers its processor and
   * instantiates its WebAssembly on the audio thread, which can cost an
   * audible gap if sound is playing. Doing it for every model now, while the
   * engine is still starting and silent, leaves later switches with nothing
   * new to set up. False if the engine was disposed meanwhile.
   */
  private async prime(ctx: AudioContext, live: InstrumentId): Promise<boolean> {
    for (const id of Object.keys(MODELS) as InstrumentId[]) {
      if (id === live) continue
      // A model that cannot be loaded does not stop the selected one from
      // playing; the failure is reported if and when it is selected.
      const node = await createInstrumentNode(ctx, id).catch(() => null)
      node?.destroy()
      if (this.ctx !== ctx) return false
    }
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
    const state = this.ctx.state === 'running' ? 'running' : 'suspended'
    // Several things can prompt a report (a state change, a finished load);
    // only tell the listener when something actually changed.
    const key = `${state}:${this.instrument}`
    if (key === this.reported) return
    this.reported = key
    this.onStatus({ state, instrument: this.instrument })
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    void this.dispose().then(() => this.onStatus({ state: 'error', message }))
  }
}
