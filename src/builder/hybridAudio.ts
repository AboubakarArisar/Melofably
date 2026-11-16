// The hybrid instrument's audio in the builder (MVP): one AudioContext and
// one node of the Hybrid Lab's processor, which is the engine's own
// processor with a finger per connection (src/experimental/hybrid). The
// engine and its processor are not changed, and the classic builder's audio
// (audio.ts) is not used or touched. There is no limiter, compressor or
// make-up gain here: one plain volume, as in the Hybrid Lab.
import captureUrl from '../experimental/hybrid/capture.js?url'
import hybridUrl from '../experimental/hybrid/hybrid-processor.js?url'
import { Controls, type Lab } from '../experimental/hybrid/instrument.ts'
import type { Call } from '../experimental/wasm/engine.ts'
import { engineBytes } from '../experimental/wasm/host.ts'
import processorUrl from '../experimental/wasm/processor.js?url'

export interface HybridStatus {
  state: string
  sampleRate: number
  /** Mean time to make one block, ms, and the block's own length, ms. */
  meanMs: number
  quantumMs: number
  /** Largest output since audio started or the instrument was rebuilt, as a fraction of the node's ceiling. */
  peak: number
  faults: number
  energy: number
  stringEnergy: number
  barEnergy: number
  /** How many fingers the engine has down. */
  fingers: number
}

export class HybridVoice {
  private node: AudioWorkletNode | null = null
  private pending = new Map<number, (data: Record<string, number> & { resonatorEnergy: number[]; fingers: unknown[] }) => void>()
  private asked = 0
  private lab: Lab | null = null
  controls: Controls | null = null
  onError: (message: string) => void = () => {}
  private readonly ctx: AudioContext
  private readonly volume: GainNode

  private constructor(ctx: AudioContext, volume: GainNode) {
    this.ctx = ctx
    this.volume = volume
  }

  /** Starts audio (call from a click) and builds the instrument `compile` gives for the context's sample rate. */
  static async start(compile: (sampleRate: number) => Lab, gain: number): Promise<HybridVoice> {
    if (typeof AudioWorkletNode === 'undefined') throw new Error('This browser has no AudioWorklet; the instrument cannot run here.')
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    try {
      // The engine's processor, unchanged, between the two files that let the lab's processor extend it.
      await ctx.audioWorklet.addModule(captureUrl)
      await ctx.audioWorklet.addModule(processorUrl)
      await ctx.audioWorklet.addModule(hybridUrl)
      const volume = new GainNode(ctx, { gain })
      volume.connect(ctx.destination)
      const voice = new HybridVoice(ctx, volume)
      await voice.rebuild(compile(ctx.sampleRate))
      await ctx.resume()
      return voice
    } catch (error) {
      void ctx.close()
      throw error
    }
  }

  get sampleRate() {
    return this.ctx.sampleRate
  }
  get running() {
    return this.ctx.state === 'running' && this.node !== null
  }

  /** Replaces the instrument with a new engine. Sound restarts from silence and every finger is up. */
  async rebuild(lab: Lab): Promise<void> {
    this.silence()
    const node = new AudioWorkletNode(this.ctx, 'sonicmatter-hybrid', { numberOfInputs: 0, outputChannelCount: [1], processorOptions: { bytes: await engineBytes(), calls: lab.calls, measure: false } })
    await new Promise<void>((resolve, reject) => {
      const late = setTimeout(() => reject(new Error('The audio processor did not answer within 10 seconds.')), 10000)
      node.onprocessorerror = () => {
        reject(new Error('The audio processor stopped with an error.'))
        this.onError('The audio processor stopped with an error. Stop and start the audio again.')
      }
      node.port.onmessage = ({ data }) => {
        if (data.ready) {
          clearTimeout(late)
          resolve()
        } else if (data.error) {
          clearTimeout(late)
          reject(new Error(`Physics engine: ${data.error}`))
          this.onError(`Physics engine: ${data.error}`)
        } else if (data.diag) {
          this.pending.get(data.diag)?.(data)
          this.pending.delete(data.diag)
        }
      }
    }).catch((error) => {
      node.port.postMessage({ stop: true })
      node.disconnect()
      throw error
    })
    node.connect(this.volume)
    this.node = node
    this.lab = lab
    // Nothing is sent to an engine that is not making sound: it would keep it and play it later.
    this.controls = new Controls(lab, (calls: Call[]) => this.running && node.port.postMessage({ calls }))
  }

  /** Stops the instrument that is playing, if any, and leaves the audio on. */
  silence() {
    if (this.node) {
      this.node.port.postMessage({ stop: true })
      this.node.port.onmessage = null
      this.node.disconnect()
    }
    this.node = this.lab = this.controls = null
    this.pending.clear()
  }

  setGain(gain: number) {
    this.volume.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.02)
  }
  resume() {
    return this.ctx.resume()
  }

  async status(): Promise<HybridStatus | null> {
    const { node, lab } = this
    if (!node || !lab) return null
    const d = await new Promise<(Record<string, number> & { resonatorEnergy: number[]; fingers: unknown[] }) | null>((resolve) => {
      const id = ++this.asked
      this.pending.set(id, resolve)
      setTimeout(() => this.pending.delete(id) && resolve(null), 2000)
      node.port.postMessage({ diag: id, resonators: [lab.string, lab.bar!] })
    })
    if (!d) return null
    return { state: this.ctx.state, sampleRate: this.ctx.sampleRate, meanMs: d.mean_ms, quantumMs: d.quantum_ms, peak: d.peak, faults: d.faults + d.nonFiniteSamples, energy: d.energy, stringEnergy: d.resonatorEnergy[0], barEnergy: d.resonatorEnergy[1], fingers: d.fingers.length }
  }

  async stop() {
    this.silence()
    await this.ctx.close().catch(() => undefined)
  }
}
