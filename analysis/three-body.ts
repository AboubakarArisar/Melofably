// Phase 3D.6: measurements of the three-component prototype
// (src/experimental/string/stringBarBody.ts): a string and a metal bar both
// standing on the damped enclosed body. Shared by tests/three-body.test.ts
// and analysis/render-three-body.ts. Everything runs through the browser's
// own AudioWorklet processor file (analysis/worklet.ts).
import { malletStiffness } from '../src/builder/translate.ts'
import { buildPlayableStringBody, pluckCall, radiation, stringPitch } from '../src/experimental/string/stringBody.ts'
import { BAR_STRIKE, BAR_SUPPORT_A, BAR_SUPPORT_B, BOARD_BRIDGE, BOARD_RADIATION, BOARD_SUPPORT_A, BOARD_SUPPORT_B, buildStringBarBody, PROTOTYPE, SMALL_BAR, TUNED, type BarOnBoard, type StringBarBody } from '../src/experimental/string/stringBarBody.ts'
import type { Call } from '../src/experimental/wasm/engine.ts'
import { SR } from './lib.ts'
import { createWorklet } from './worklet.ts'

/** Pascals at the audio node's ceiling in this prototype: a struck bar on a board can pass the string instrument's 2 Pa. */
export const FULL_SCALE = 16
/** The pluck of the approved string instrument, N, and the builder's default mallet stroke, m/s. */
export const PLUCK = 2
export const STROKE = 1.5

export { SMALL_BAR, TUNED }
/** The prototype as first built (PROTOTYPE in stringBarBody.ts). Its mallet is the builder's default. */
export const BASE: StringBarBody = PROTOTYPE
if (BASE.mallet!.stiffness !== malletStiffness(0.5)) throw new Error('the prototype\'s mallet is not the builder\'s default')
export const variant = (o: Partial<StringBarBody> = {}, bar: Partial<BarOnBoard> = {}): StringBarBody => ({ ...BASE, ...o, bar: { ...(o.bar ?? BASE.bar), ...bar } })

export type Playing = 'pluck' | 'strike' | 'both'

/** The same system with every loss removed: modes that do not decay, and no damper anywhere (air, screen, pads). */
export const lossless = (calls: Call[]): Call[] =>
  calls.map((call): Call => (call[0] === 'setMode' ? ['setMode', call[1], call[2], call[3], Infinity, call[5]] : call[0] === 'addSpring' ? ['addSpring', call[1], call[2], call[3], call[4], call[5], 0, call[7], call[8]] : call))

export interface Run {
  /** Sound pressure 1 m in front of the body, Pa. */
  pressure: Float32Array
  /** Velocities, m/s: the string 0.3 along it, the bar where it is struck, and the board's mean (its radiation port). */
  stringVelocity: Float32Array
  barVelocity: Float32Array
  boardVelocity: Float32Array
  /** Mechanical energy every 128 samples, J. `total` is everything, springs included; `mallet` is the mallet's own. */
  energy: { string: Float64Array; board: Float64Array; air: Float64Array; bar: Float64Array; mallet: Float64Array; total: Float64Array }
  /** Largest energy each held, J, and the largest of everything but the mallet. */
  peak: { string: number; board: number; bar: number; in: number }
  /** For a stroke: what the mallet gave the instrument, J: its energy as thrown less what it left with. */
  malletGave: number
  /** Net work done ON the board by the string's bridge, and ON the bar by its two supports, J, every 128 samples. */
  bridgeWork: Float64Array
  supportWork: Float64Array
  /** All the energy that ever crossed from board to bar, and from bar to board, J. */
  toBar: number
  fromBar: number
  /** Energy the engine counted as dissipated, J, over the whole run. */
  dissipated: number
  faults: number
  worstIterations: number
}

/** One pluck, one stroke, or both at once, followed for `seconds` with everything recorded sample by sample. */
export async function measure(s: StringBarBody, playing: Playing, seconds = 3, o: { lossless?: boolean; pluck?: number; stroke?: number } = {}): Promise<Run> {
  const built = buildStringBarBody(s, SR)
  const r = radiation(SR)
  const watch: Call[] = [['addTap', built.string, 2], ['addTap', built.bar, BAR_STRIKE], ['addTap', built.board, BOARD_RADIATION], ['addTap', built.board, BOARD_BRIDGE], ['addTap', built.bar, BAR_SUPPORT_A], ['addTap', built.bar, BAR_SUPPORT_B], ['addTap', built.board, BOARD_SUPPORT_A], ['addTap', built.board, BOARD_SUPPORT_B]]
  const worklet = await createWorklet([...(o.lossless ? lossless(built.calls) : built.calls), ...watch, ['radiate', r.perSample, r.b0, r.b1, r.a1, FULL_SCALE]])
  const engine = worklet.engine
  const taps = new Float64Array(engine.memory.buffer, engine.tapPointer(), 32 * 128)
  const play: Call[] = []
  if (playing !== 'strike') play.push(pluckCall(built, o.pluck ?? PLUCK))
  if (playing !== 'pluck') {
    if (built.mallet === undefined) throw new Error('no mallet')
    play.push(['launch', built.mallet, o.stroke ?? STROKE])
  }
  worklet.send(play)
  const samples = Math.round(seconds * SR)
  const blocks = Math.ceil(samples / 128)
  const out: Run = {
    pressure: new Float32Array(samples), stringVelocity: new Float32Array(samples), barVelocity: new Float32Array(samples), boardVelocity: new Float32Array(samples),
    energy: { string: new Float64Array(blocks), board: new Float64Array(blocks), air: new Float64Array(blocks), bar: new Float64Array(blocks), mallet: new Float64Array(blocks), total: new Float64Array(blocks) },
    peak: { string: 0, board: 0, bar: 0, in: 0 }, malletGave: 0, bridgeWork: new Float64Array(blocks), supportWork: new Float64Array(blocks), toBar: 0, fromBar: 0, dissipated: 0, faults: 0, worstIterations: 0,
  }
  let [bridge, support] = [0, 0]
  for (let i = 0; i < samples; i++) {
    out.pressure[i] = worklet.render(1)[0] * FULL_SCALE
    out.stringVelocity[i] = taps[0]
    out.barVelocity[i] = taps[128]
    out.boardVelocity[i] = taps[2 * 128]
    out.dissipated += engine.dissipated()
    // A spring pulls its first side with -F and its second with +F. The bridge is string-to-board; the supports are bar-to-board.
    bridge += (engine.connectionForce(built.bridge) * taps[3 * 128]) / SR
    if (built.supports) {
      const power = -(engine.connectionForce(built.supports[0]) * taps[4 * 128] + engine.connectionForce(built.supports[1]) * taps[5 * 128])
      support += power / SR
      if (power > 0) out.toBar += power / SR
      else out.fromBar -= power / SR
    }
    if (i % 128 === 127 || i === samples - 1) {
      const b = Math.floor(i / 128)
      const e = out.energy
      e.string[b] = engine.resonatorEnergy(built.string)
      e.board[b] = engine.resonatorEnergy(built.board)
      e.air[b] = engine.resonatorEnergy(built.plug)
      e.bar[b] = engine.resonatorEnergy(built.bar)
      e.mallet[b] = built.malletHead === undefined ? 0 : engine.resonatorEnergy(built.malletHead)
      e.total[b] = engine.energy()
      out.bridgeWork[b] = bridge
      out.supportWork[b] = support
      out.peak.string = Math.max(out.peak.string, e.string[b])
      out.peak.board = Math.max(out.peak.board, e.board[b])
      out.peak.bar = Math.max(out.peak.bar, e.bar[b])
      out.peak.in = Math.max(out.peak.in, e.total[b] - e.mallet[b])
    }
  }
  out.faults = engine.faults()
  out.worstIterations = engine.worstIterations()
  if (playing !== 'pluck') out.malletGave = 0.5 * s.mallet!.mass * (o.stroke ?? STROKE) ** 2 - out.energy.mallet[blocks - 1]
  return out
}

/** The approved string instrument (the builder's string on its damped box), plucked the same way: sound pressure, Pa, and the string's velocity. */
export async function approvedStringBody(seconds = 3, pluck = PLUCK, s = { tension: BASE.tension, length: BASE.length, pluckAt: BASE.pluckAt }) {
  const built = buildPlayableStringBody({ ...s, joined: true }, SR)
  const r = radiation(SR)
  const worklet = await createWorklet([...built.calls, ['addTap', built.string, 2], ['radiate', r.perSample, r.b0, r.b1, r.a1, FULL_SCALE]])
  const taps = new Float64Array(worklet.engine.memory.buffer, worklet.engine.tapPointer(), 32 * 128)
  worklet.send([pluckCall(built, pluck)])
  const samples = Math.round(seconds * SR)
  const [pressure, stringVelocity] = [new Float32Array(samples), new Float32Array(samples)]
  for (let i = 0; i < samples; i++) {
    pressure[i] = worklet.render(1)[0] * FULL_SCALE
    stringVelocity[i] = taps[0]
  }
  return { pressure, stringVelocity }
}

/** The prototype's sound in blocks of 128, as a browser makes it: pressure in Pa and the engine's state at the end. */
export async function sound(s: StringBarBody, playing: Playing, seconds = 3, o: { pluck?: number; stroke?: number } = {}) {
  const built = buildStringBarBody(s, SR)
  const r = radiation(SR)
  const worklet = await createWorklet([...built.calls, ['radiate', r.perSample, r.b0, r.b1, r.a1, FULL_SCALE]])
  const play: Call[] = []
  if (playing !== 'strike') play.push(pluckCall(built, o.pluck ?? PLUCK))
  if (playing !== 'pluck') play.push(['launch', built.mallet!, o.stroke ?? STROKE])
  worklet.send(play)
  const pressure = worklet.render(Math.round(seconds * SR)).map((v) => v * FULL_SCALE)
  return { pressure, faults: worklet.engine.faults(), worstIterations: worklet.engine.worstIterations(), built, worklet }
}

export const F0 = stringPitch({ tension: BASE.tension, length: BASE.length })
export const cents = (f: number, reference: number) => 1200 * Math.log2(f / reference)
