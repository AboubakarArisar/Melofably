// EXPERIMENTAL (Phase 3B). The builder's audio output in the browser: one
// AudioContext and one AudioWorklet node running the WebAssembly engine
// (src/experimental/wasm). The approved instruments' audio engine is not used
// or touched.
import type { Call } from '../experimental/wasm/engine.ts'
import { createPhysicsNode, type EngineReport, type PhysicsNode } from '../experimental/wasm/host.ts'
import type { Backend, Voice } from './session.ts'
import { OUTPUT_GAIN } from './translate.ts'

/**
 * Gain after the engine at full volume. For bars it undoes the engine's headroom. For a string
 * instrument the node carries pascals / PRESSURE_FULL_SCALE and a plucked string a metre away is
 * quiet (about 0.1 Pa): this brings an ordinary pluck to a comfortable level at mid volume. It is
 * a listening level only; the physics, the meter and the renders are in pascals. The experimental
 * listener (Phase 3D.4) uses the same gain on a node that carries pascals / LISTENER_FULL_SCALE:
 * half of full scale per pascal, which puts a struck bar (about a pascal) where it can be heard
 * without the limiter. Its plucks are then quiet, as the model says they are; nothing is evened out.
 */
const MAKE_UP = { velocity: 1 / OUTPUT_GAIN, pressure: 8 }

/** Seconds over which the output fades out before a rebuild and back in after it, so the restart does not click. */
const FADE = 0.004

export interface Meter {
  state: AudioContextState
  sampleRate: number
  /**
   * Largest value heard in the last 43 ms, before the volume control and the limiter: the bars'
   * velocity in m/s, or for a string instrument the sound pressure at 1 m in Pa.
   */
  peak: number
  unit: 'm/s' | 'Pa'
  /** `peak` as a fraction of the most the audio node can carry (4 m/s, or PRESSURE_FULL_SCALE). */
  peakOfFullScale: number
  /** The node's output reached its ceiling and was cut off: the instrument is far too loud. */
  overloaded: boolean
  /** Decibels the limiter is currently taking off (0 when it is idle). */
  limiting: number
  underruns: number | null
  engine: EngineReport
}

export class BrowserBackend implements Backend {
  private ctx: AudioContext | null = null
  private physics: PhysicsNode | null = null
  private gain: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private limiter: DynamicsCompressorNode | null = null
  private scope = new Float32Array(2048)
  private volume = 0.5
  /** What the running system's output is; set when a system is built. */
  private output: 'velocity' | 'pressure' = 'velocity'
  /** Pascals at the node's ceiling, when the output is pressure. */
  private fullScale = 0
  /** Nodes and contexts made and released, to show that nothing is duplicated or left behind. */
  readonly counts = { nodesCreated: 0, nodesDisposed: 0, contextsCreated: 0, contextsClosed: 0 }

  async open(): Promise<Voice> {
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.counts.contextsCreated++
    try {
      const physics = await createPhysicsNode(ctx, [['reset', ctx.sampleRate, 2], ['build']], { measure: true })
      this.counts.nodesCreated++
      const analyser = new AnalyserNode(ctx, { fftSize: this.scope.length })
      // Make up the engine's headroom, then a fast limiter so that a very loud
      // instrument is turned down rather than distorted. The limiter acts on
      // loudness only; engine faults are counted separately and never hidden.
      this.output = 'velocity'
      const gain = new GainNode(ctx, { gain: this.volume * MAKE_UP.velocity })
      const limiter = new DynamicsCompressorNode(ctx, { threshold: -6, knee: 0, ratio: 20, attack: 0.001, release: 0.1 })
      physics.node.connect(analyser).connect(gain).connect(limiter).connect(ctx.destination)
      await ctx.resume()
      Object.assign(this, { ctx, physics, gain, analyser, limiter })
      return {
        sampleRate: ctx.sampleRate,
        // Anything sent while a rebuild is fading in waits for it, so it applies to the new system.
        send: (calls) => (this.pending ? void this.pending.after.push(...calls) : physics.send(calls)),
        rebuild: (calls) => this.rebuild(calls),
        close: () => this.close(),
      }
    } catch (error) {
      await ctx.close()
      this.counts.contextsClosed++
      throw error
    }
  }

  private pending: { calls: Call[]; after: Call[] } | null = null

  // Fade out, swap the system, fade in. The engine output itself is not
  // altered: the fade only hides the cut from a ringing system to a silent one.
  private rebuild(calls: Call[]) {
    const { ctx, gain, physics } = this
    if (!ctx || !gain || !physics) return
    if (this.pending) {
      this.pending = { calls, after: [] } // a newer rebuild replaces one still waiting
      return
    }
    this.pending = { calls, after: [] }
    gain.gain.setTargetAtTime(0, ctx.currentTime, FADE)
    setTimeout(() => {
      const pending = this.pending
      this.pending = null
      if (this.physics !== physics || !pending) return // stopped meanwhile
      physics.send([...pending.calls, ...pending.after])
      // A system that asks the processor for radiated pressure says how many pascals the node's ceiling is.
      const radiate = pending.calls.find((call) => call[0] === 'radiate')
      const radiator = pending.calls.find((call) => call[0] === 'radiator')
      this.output = radiate || radiator ? 'pressure' : 'velocity'
      this.fullScale = radiator ? radiator[1] : radiate ? radiate[5] : 0
      gain.gain.setTargetAtTime(this.volume * MAKE_UP[this.output], ctx.currentTime, FADE)
    }, 6 * FADE * 1000)
  }

  private async close() {
    const { ctx, physics } = this
    this.pending = null
    this.ctx = this.physics = this.gain = this.analyser = this.limiter = null
    if (physics) {
      physics.dispose()
      this.counts.nodesDisposed++
    }
    if (ctx) {
      await ctx.close()
      this.counts.contextsClosed++
    }
  }

  setVolume(volume: number) {
    this.volume = volume
    if (this.ctx && this.gain && !this.pending) this.gain.gain.setTargetAtTime(volume * MAKE_UP[this.output], this.ctx.currentTime, FADE)
  }

  /** Levels and health of the running engine, or null when audio is off. */
  async meter(): Promise<Meter | null> {
    const { ctx, physics, analyser } = this
    if (!ctx || !physics || !analyser) return null
    analyser.getFloatTimeDomainData(this.scope)
    const peak = this.scope.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    const stats = (ctx as AudioContext & { playbackStats?: { underrunEvents: number } }).playbackStats
    return {
      state: ctx.state,
      sampleRate: ctx.sampleRate,
      peak: this.output === 'pressure' ? peak * this.fullScale : peak / OUTPUT_GAIN,
      unit: this.output === 'pressure' ? 'Pa' : 'm/s',
      peakOfFullScale: peak,
      overloaded: peak >= 0.999,
      limiting: -(this.limiter?.reduction ?? 0),
      underruns: stats?.underrunEvents ?? null,
      engine: await physics.report(),
    }
  }
}
