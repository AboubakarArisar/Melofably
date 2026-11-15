// Phase 3D.11: a finger on the bar of the bar-as-bridge instrument
// (touchBar in src/experimental/string/stringBarBody.ts). Shared by
// tests/bar-damping.test.ts and analysis/render-bar-damping.ts. Everything
// runs through the browser's own AudioWorklet processor file.
import { barMass, barReleaseCalls, barTouchCalls, buildStringBarBody, RIGID_MODES, type BarTouch, type BuiltStringBarBody, type StringBarBody } from '../src/experimental/string/stringBarBody.ts'
import { radiation } from '../src/experimental/string/stringBody.ts'
import type { Call } from '../src/experimental/wasm/engine.ts'
import { SR } from './lib.ts'
import { withPorts } from './radiation.ts'
import { lossless, type Event } from './three-body.ts'
import { createWorklet } from './worklet.ts'

/** Pascals at the audio node's ceiling here: far above anything played. */
export const CEILING = 64
/** Bar modes followed one by one: up and down, rocking, and the first three bending modes. */
export const FOLLOWED = 5

export const barTouchAt = (at: number, touch: BarTouch, arrive?: number, landing = true): Event => ({ at, calls: (b) => barTouchCalls(b, touch, SR, arrive, landing) })
/**
 * The finger leaves the bar. The processor moves one finger's damper at a time and remembers only that
 * one, so if another finger (the one on the string) has moved since this one landed, a bare release
 * would drop this damper in one step. So the release is two messages a block apart: the first tells
 * the processor which finger is meant and how hard it is pressing (it changes nothing in the engine),
 * the second takes it away along its ramp. One finger moves at a time.
 */
export const barReleaseAt = (at: number, touch: BarTouch, leave?: number): Event[] => [
  { at, calls: (b) => [['touch', b.barFinger!, touch.damping, 0, -1, 0]] },
  { at: at + 128 / SR, calls: (b) => barReleaseCalls(b, SR, leave) },
]
/** For comparison only: the finger's spring and damper switched on in one sample, with no landing. */
export const barSlapAt = (at: number, touch: BarTouch): Event => ({ at, calls: (b) => [['setStiffness', b.barFinger!, touch.stiffness, 0, 0], ['setDamping', b.barFinger!, touch.damping]] })

export interface Played {
  /** Sound pressure 1 m in front of the body, Pa. */
  pressure: Float32Array
  /** The string's velocity 0.3 along it, m/s. */
  stringVelocity: Float32Array
  /** Velocity of the bar's first five modes, m/s: up and down, rocking, bending 1 to 3. */
  modes: Float32Array[]
  /** Every 128 samples, J: what each part holds, everything (springs and striker included), and the striker's own. */
  energy: { string: Float64Array; bar: Float64Array; board: Float64Array; total: Float64Array; striker: Float64Array }
  /** Running totals at the same instants, J: what the engine counted as dissipated, what stiffness changes of the finger's spring added (negative: took), and the work the bar did on the finger. */
  dissipated: Float64Array
  injected: Float64Array
  fingerTook: Float64Array
  /** What the finger's spring holds, J, and its force on the bar at its largest, N. */
  fingerStored: Float64Array
  fingerForcePeak: number
  faults: number
  worstIterations: number
  built: BuiltStringBarBody
}

/** The instrument played through timed events, followed sample by sample. Events are sent before the sample at their time. */
export async function play(s: StringBarBody, events: Event[], seconds: number, o: { lossless?: boolean; extra?: (built: BuiltStringBarBody, calls: Call[]) => Call[] } = {}): Promise<Played> {
  const built = buildStringBarBody(s, SR)
  const r = radiation(SR)
  const count = built.modes.bar
  let calls = o.lossless ? lossless(built.calls) : built.calls
  if (o.extra) calls = o.extra(built, calls)
  const probed = withPorts(calls, built.bar, Array.from({ length: FOLLOWED }, (_, p) => Array.from({ length: count }, (_, n) => (n === p ? 1 : 0))))
  const worklet = await createWorklet([...probed.calls, ['radiate', r.perSample, r.b0, r.b1, r.a1, CEILING]])
  const engine = worklet.engine
  const samples = Math.round(seconds * SR)
  const blocks = Math.ceil(samples / 128)
  const due = events.map((e) => ({ sample: Math.round(e.at * SR), calls: e.calls(built) })).sort((a, b) => a.sample - b.sample)
  const out: Played = {
    pressure: new Float32Array(samples), stringVelocity: new Float32Array(samples), modes: Array.from({ length: FOLLOWED }, () => new Float32Array(samples)),
    energy: { string: new Float64Array(blocks), bar: new Float64Array(blocks), board: new Float64Array(blocks), total: new Float64Array(blocks), striker: new Float64Array(blocks) },
    dissipated: new Float64Array(blocks), injected: new Float64Array(blocks), fingerTook: new Float64Array(blocks), fingerStored: new Float64Array(blocks), fingerForcePeak: 0, faults: 0, worstIterations: 0, built,
  }
  const k = built.barFinger
  let [lost, took, next] = [0, 0, 0]
  for (let i = 0; i < samples; i++) {
    while (next < due.length && due[next].sample <= i) worklet.send(due[next++].calls)
    out.pressure[i] = worklet.render(1)[0] * CEILING
    out.stringVelocity[i] = engine.velocity(built.string, 2)
    for (let n = 0; n < FOLLOWED; n++) out.modes[n][i] = engine.velocity(built.bar, probed.first + n)
    lost += engine.dissipated()
    if (k !== undefined) {
      // The connection pulls the bar with -F, so the bar does F x (its speed there) of work on the finger.
      const force = engine.connectionForce(k)
      took += (force * engine.velocity(built.bar, built.barTouchPort!)) / SR
      out.fingerForcePeak = Math.max(out.fingerForcePeak, Math.abs(force))
    }
    if (i % 128 === 127 || i === samples - 1) {
      const b = Math.floor(i / 128)
      out.energy.string[b] = engine.resonatorEnergy(built.string)
      out.energy.bar[b] = engine.resonatorEnergy(built.bar)
      out.energy.board[b] = engine.resonatorEnergy(built.board)
      out.energy.striker[b] = built.malletHead === undefined ? 0 : engine.resonatorEnergy(built.malletHead)
      out.energy.total[b] = engine.energy()
      out.dissipated[b] = lost
      out.injected[b] = k === undefined ? 0 : engine.injected(k)
      out.fingerTook[b] = took
      out.fingerStored[b] = k === undefined ? 0 : 0.5 * engine.stiffness(k) * engine.connectionStretch(k) ** 2
    }
  }
  out.faults = engine.faults()
  out.worstIterations = engine.worstIterations()
  return out
}

export const blockAt = (seconds: number) => Math.max(0, Math.round((seconds * SR) / 128) - 1)

/**
 * The books between two moments, J: what the instrument held at the start, less what it holds at the
 * end, less what was dissipated, plus what the finger's changing spring added. Zero when every joule is
 * accounted for (no force may be acting from outside in between: not during a pluck).
 */
export function unaccounted(p: Played, from: number, to: number) {
  const [a, b] = [blockAt(from), blockAt(to)]
  const fell = p.energy.total[a] - p.energy.total[b]
  const lost = p.dissipated[b] - p.dissipated[a]
  const added = p.injected[b] - p.injected[a]
  return { fell, lost, added, residual: fell - lost + added, fingerTook: p.fingerTook[b] - p.fingerTook[a] }
}

/** A bar mode's energy near a moment, J: the bar's mass times the largest (velocity)^2 / 2 within 10 ms after it. `n`: 0 up and down, 1 rocking, 2.. bending. */
export function modeEnergy(p: Played, s: StringBarBody, n: number, at: number, window = 0.01): number {
  let most = 0
  for (let i = Math.round(at * SR), end = Math.min(p.pressure.length, i + Math.round(window * SR)); i < end; i++) most = Math.max(most, Math.abs(p.modes[n][i]))
  return 0.5 * barMass(s.bar) * most * most
}
export const bendingEnergy = (p: Played, s: StringBarBody, at: number) => modeEnergy(p, s, RIGID_MODES, at)

/** Seconds after `from` until a signal's 10 ms mean square has fallen `down` dB below its value at `from` (null: not within the run). */
export function fallFrom(x: ArrayLike<number>, from: number, down = 20): number | null {
  const w = Math.round(0.01 * SR)
  const mean = (i: number) => {
    let sum = 0
    for (let j = 0; j < w; j++) sum += x[i + j] * x[i + j]
    return sum / w
  }
  const start = Math.round(from * SR)
  const first = mean(start)
  for (let i = start; i + w <= x.length; i += w) if (mean(i) < first * 10 ** (-down / 10)) return (i - start) / SR
  return null
}

/** Largest change between neighbouring samples within `window` seconds after `at`, over the same in the `window` before it: a click shows as a ratio well above 1. */
export function stepRatio(x: ArrayLike<number>, at: number, window = 0.01): number {
  const step = (from: number, to: number) => {
    let most = 0
    for (let i = Math.max(1, from); i < Math.min(x.length, to); i++) most = Math.max(most, Math.abs(x[i] - x[i - 1]))
    return most
  }
  const [i, w] = [Math.round(at * SR), Math.round(window * SR)]
  return step(i, i + w) / step(i - w, i)
}

/**
 * How rough a signal is just after a moment: the sum of its squared second differences over `window`
 * seconds (which weighs high frequencies by the fourth power). Compared with the same instrument
 * played the same way and not touched, a click shows as many dB.
 */
export function roughness(x: ArrayLike<number>, at: number, window = 0.005): number {
  let sum = 0
  for (let i = Math.max(2, Math.round(at * SR)), end = Math.min(x.length, i + Math.round(window * SR)); i < end; i++) sum += (x[i] - 2 * x[i - 1] + x[i - 2]) ** 2
  return sum
}
