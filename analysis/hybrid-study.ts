// Phase 3D.5: measurements of the string-and-bar hybrid along its whole
// chain, from the player's hand to the listener's ear, for the study of why
// a pluck is so much quieter than a stroke through the radiator. Shared by
// tests/hybrid-study.test.ts and analysis/render-hybrid-study.ts.
//
// Every instrument here is a builder graph (the experimental radiated
// example with some of its properties changed, all inside the builder's own
// ranges) translated by the builder's own translation: the same engine
// system and the same radiator a user would get. Only read-only taps are
// added, to watch it. Nothing is boosted, filtered or evened out.
import type { Graph } from '../src/builder/graph.ts'
import { CANDIDATES, design, jointOf, part, SHARP_PLUCK, SOFT_MALLET, type Design } from '../src/experimental/radiation/hybridCandidates.ts'
import { barModes, instrumentCalls, LISTENER, LISTENER_FULL_SCALE, OUTPUT_GAIN, translate } from '../src/builder/translate.ts'
import { crossover, dipoleArea, freeBarShape, modeTransfer, radiatedPower, size, SOUND_SPEED, AIR_DENSITY, type BarGeometry, type Listener } from '../src/experimental/radiation/barRadiation.ts'
import { stringPitch } from '../src/experimental/string/stringBody.ts'
import type { Call } from '../src/experimental/wasm/engine.ts'
import { SR } from './lib.ts'
import { fft, geometryOf, modalVelocities, pressureByRadiator, pressureByTransfer, withPorts, type Radiating } from './radiation.ts'
import { createWorklet } from './worklet.ts'

export { CANDIDATES, design, jointOf, part, SHARP_PLUCK, SOFT_MALLET, type Design }

/** The same instrument without its listener: the approved kind of hybrid, heard as the bar's velocity. */
export const withoutListener = (graph: Graph): Graph => ({ ...graph, components: graph.components.filter((c) => c.type !== 'listener') })

/**
 * The real-time radiator against the frequency-domain reference of Phase 3D.3 for one pluck or stroke of
 * `graph`: both pressures (Pa), the reference at any listener, and the radiator's delay in samples.
 */
export async function againstReference(graph: Graph, playing: Playing, seconds = 3, listeners: Listener[] = [LISTENER]) {
  const plain = withoutListener(graph)
  const o: Radiating = { graph: plain, bar: part(plain, 'metalBar'), listener: LISTENER, seconds, play: (calls) => (playing === 'pluck' ? calls.slice(0, 1) : calls.slice(1)) }
  const realTime = await pressureByRadiator(o, LISTENER_FULL_SCALE)
  const recorded = await modalVelocities(o)
  return { realTime: realTime.pressure, late: Math.round(realTime.delay * SR), references: listeners.map((listener) => pressureByTransfer(recorded.modes, geometryOf(o.bar), listener)) }
}

export type Playing = 'pluck' | 'strike'
// Engine resonators of the hybrid, in the order buildStringBar makes them.
const [STRING, BAR, , MALLET] = [0, 1, 2, 3]

function prepared(graph: Graph, playing: Playing, lossless: boolean) {
  const translation = translate(graph, SR)
  if (!translation.ok) throw new Error(translation.issues.map((i) => i.message).join(' '))
  const built = translation.built
  const play = instrumentCalls(graph, built)
  let calls = built.calls
  if (lossless) calls = calls.map((call): Call => (call[0] === 'setMode' ? ['setMode', call[1], call[2], call[3], Infinity, call[5]] : call))
  return { built, calls, play: playing === 'pluck' ? play.slice(0, 1) : play.slice(1), bar: part(graph, 'metalBar'), string: part(graph, 'steelString') }
}

// ---- Levels ------------------------------------------------------------------------------------------------

/** A-weighting as a gain at `f` Hz (IEC 61672): 1 at 1 kHz. */
export function aWeight(f: number): number {
  const f2 = f * f
  return (1.2589 * 12194 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2))
}

/** The signal as an A-weighting filter would pass it (zero phase, by FFT). */
export function aWeighted(x: ArrayLike<number>): Float64Array {
  const N = 2 ** Math.ceil(Math.log2(x.length))
  const [re, im] = [new Float64Array(N), new Float64Array(N)]
  for (let i = 0; i < x.length; i++) re[i] = x[i]
  fft(re, im)
  for (let k = 0; k <= N / 2; k++) {
    const g = aWeight((k * SR) / N)
    re[k] *= g
    im[k] *= g
    if (k > 0 && k < N / 2) {
      re[N - k] *= g
      im[N - k] *= g
    }
  }
  fft(re, im, true)
  return re.subarray(0, x.length)
}

const P0 = 20e-6
export interface Levels {
  /** Largest instantaneous pressure, Pa, and the same as a level. */
  peakPa: number
  peak_dB: number
  /** Sound exposure level: all the sound energy that arrived, as if it had come in one second. dB re 20 uPa. */
  sel_dB: number
  /** The same, A-weighted: weighted as the ear's sensitivity to quiet sounds varies with frequency. */
  selA_dB: number
  /** Largest A-weighted level with the 'fast' (125 ms) time weighting of a sound level meter: close to how loud a short sound seems. */
  lafMax_dB: number
  /** Seconds from the start to that maximum, and from it until the level has fallen 20 dB (null: it had not, by the end). */
  attack: number
  fall20: number | null
}

/** Peak, energy and meter-style levels of a sound pressure signal in Pa. */
export function levels(pressure: ArrayLike<number>): Levels {
  let [peak, sum, sumA] = [0, 0, 0]
  const a = aWeighted(pressure)
  const alpha = 1 - Math.exp(-1 / (0.125 * SR))
  let [fast, best, at, fallen] = [0, 0, 0, -1]
  for (let i = 0; i < pressure.length; i++) {
    peak = Math.max(peak, Math.abs(pressure[i]))
    sum += pressure[i] * pressure[i]
    sumA += a[i] * a[i]
    fast += alpha * (a[i] * a[i] - fast)
    if (fast > best) {
      best = fast
      at = i
      fallen = -1
    } else if (fallen < 0 && fast < best / 100) fallen = i
  }
  const dB = (meanSquare: number) => 10 * Math.log10(Math.max(meanSquare, 1e-30) / (P0 * P0))
  return { peakPa: peak, peak_dB: dB(peak * peak), sel_dB: dB(sum / SR), selA_dB: dB(sumA / SR), lafMax_dB: dB(best), attack: at / SR, fall20: fallen < 0 ? null : (fallen - at) / SR }
}

export const BANDS = [0, 200, 500, 1000, 2000, 5000, 24000]
/** Share of a signal's energy in each of BANDS' intervals (fractions that add to 1). */
export function bandShares(x: ArrayLike<number>): number[] {
  const N = 2 ** Math.ceil(Math.log2(x.length))
  const [re, im] = [new Float64Array(N), new Float64Array(N)]
  for (let i = 0; i < x.length; i++) re[i] = x[i]
  fft(re, im)
  const out = new Array<number>(BANDS.length - 1).fill(0)
  let total = 0
  for (let k = 1; k < N / 2; k++) {
    const f = (k * SR) / N
    const e = re[k] * re[k] + im[k] * im[k]
    total += e
    out[Math.max(0, BANDS.findIndex((edge) => f < edge) - 1)] += e
  }
  return out.map((e) => e / total)
}

/** Frequency of the strongest spectral peak within `span` (a ratio) of `near`, Hz, from `from` seconds on. */
export function pitchNear(x: ArrayLike<number>, near: number, span = 1.06, from = 0.3): number {
  const N = 131072
  const [re, im] = [new Float64Array(N), new Float64Array(N)]
  const start = Math.round(from * SR)
  const count = Math.min(N, x.length - start)
  for (let i = 0; i < count; i++) re[i] = x[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / count))
  fft(re, im)
  const power = (k: number) => re[k] * re[k] + im[k] * im[k]
  let best = Math.floor(((near / span) * N) / SR)
  for (let k = best; k <= Math.ceil((near * span * N) / SR); k++) if (power(k) > power(best)) best = k
  const [a, b, c] = [Math.log(power(best - 1)), Math.log(power(best)), Math.log(power(best + 1))]
  return ((best + (0.5 * (a - c)) / (a - 2 * b + c)) * SR) / N
}

// ---- The whole chain, sample by sample ---------------------------------------------------------------------

export interface Chain {
  /** Sound pressure at the listener, Pa (late by the radiator's delay), and the bar's velocity where it is struck, m/s (the approved output). */
  pressure: Float32Array
  velocity: Float32Array
  /** The string's velocity 0.3 of the way along it, m/s: for its pitch. */
  stringVelocity: Float32Array
  /** Mechanical energy every 128 samples, J: of the string, the bar, the mallet, and everything. */
  energy: { string: Float64Array; bar: Float64Array; mallet: Float64Array; total: Float64Array }
  /** Most the whole system held, J: what the pluck or the stroke put in (less what was lost while it was being put in). */
  energyIn: number
  /** For a stroke: the mallet's energy as thrown, J. */
  malletThrown: number
  /** Net work the joint has done on the bar, J, every 128 samples; the most it reached; all that ever went string-to-bar; and the largest power, W. */
  jointWork: Float64Array
  jointWorkPeak: number
  jointForward: number
  jointPowerPeak: number
  /** Largest share of the system's energy the bar held after the first 20 ms, and the string. */
  barSharePeak: number
  stringSharePeak: number
  /** Per bar mode: frequency (Hz), largest modal velocity (m/s) and the kinetic energy that is (J). */
  modes: { frequency: number; peakVelocity: number; peakEnergy: number }[]
  faults: number
  worstIterations: number
  dissipated: number
}

/** One pluck or one stroke of `graph`, followed for `seconds`, with everything along the way recorded. */
export async function chain(graph: Graph, playing: Playing, seconds = 3, lossless = false): Promise<Chain> {
  const p = prepared(graph, playing, lossless)
  const modes = barModes(p.bar, SR)
  // Read-only extras: one port per bar mode (its modal velocity), and taps on them, on the string and on the bar's two own ports.
  const probes = modes.map((_, n) => modes.map((_, m) => (m === n ? 1 : 0)))
  const { calls, first } = withPorts(p.calls, BAR, probes)
  const watch: Call[] = [['addTap', STRING, 2], ['addTap', BAR, 1], ['addTap', BAR, 0], ...modes.map((_, n): Call => ['addTap', BAR, first + n])]
  const worklet = await createWorklet([...calls, ...watch])
  const engine = worklet.engine
  const taps = new Float64Array(engine.memory.buffer, engine.tapPointer(), 32 * 128)
  const joint = p.built.stringBody!.bridge
  worklet.send(p.play)
  const samples = Math.round(seconds * SR)
  const blocks = Math.ceil(samples / 128)
  const out: Chain = {
    pressure: new Float32Array(samples), velocity: new Float32Array(samples), stringVelocity: new Float32Array(samples),
    energy: { string: new Float64Array(blocks), bar: new Float64Array(blocks), mallet: new Float64Array(blocks), total: new Float64Array(blocks) },
    energyIn: 0, malletThrown: playing === 'strike' ? 0.5 * part(graph, 'mallet').params.mass * part(graph, 'mallet').params.velocity ** 2 : 0,
    jointWork: new Float64Array(blocks), jointWorkPeak: 0, jointForward: 0, jointPowerPeak: 0, barSharePeak: 0, stringSharePeak: 0,
    modes: modes.map((mode) => ({ frequency: mode.frequency, peakVelocity: 0, peakEnergy: 0 })), faults: 0, worstIterations: 0, dissipated: 0,
  }
  let work = 0
  for (let i = 0; i < samples; i++) {
    out.pressure[i] = worklet.render(1)[0] * LISTENER_FULL_SCALE
    out.stringVelocity[i] = taps[16 * 128]
    out.velocity[i] = taps[17 * 128]
    // The engine pulls side a (the string) with -F and side b (the bar) with +F: F times the bar's velocity at the joint is power into the bar.
    const power = engine.connectionForce(joint) * taps[18 * 128]
    work += power / SR
    if (power > 0) out.jointForward += power / SR
    out.jointPowerPeak = Math.max(out.jointPowerPeak, Math.abs(power))
    out.jointWorkPeak = Math.max(out.jointWorkPeak, work)
    for (let n = 0; n < modes.length; n++) out.modes[n].peakVelocity = Math.max(out.modes[n].peakVelocity, Math.abs(taps[(19 + n) * 128]))
    if (i % 128 === 127 || i === samples - 1) {
      const b = Math.floor(i / 128)
      const [s, bar, total] = [engine.resonatorEnergy(STRING), engine.resonatorEnergy(BAR), engine.energy()]
      out.energy.string[b] = s
      out.energy.bar[b] = bar
      out.energy.mallet[b] = playing === 'strike' ? engine.resonatorEnergy(MALLET) : 0
      out.energy.total[b] = total
      out.jointWork[b] = work
      out.energyIn = Math.max(out.energyIn, playing === 'strike' ? total - out.energy.mallet[b] : total)
      if (i > 0.02 * SR && total > 0) {
        out.barSharePeak = Math.max(out.barSharePeak, bar / (total - out.energy.mallet[b]))
        out.stringSharePeak = Math.max(out.stringSharePeak, s / (total - out.energy.mallet[b]))
      }
    }
  }
  for (const [n, mode] of out.modes.entries()) mode.peakEnergy = 0.5 * modes[n].mass * mode.peakVelocity ** 2
  out.faults = engine.faults()
  out.worstIterations = engine.worstIterations()
  out.dissipated = engine.dissipated()
  return out
}

// ---- Quick: what a design sounds like, for sweeps ------------------------------------------------------------

export interface Quick {
  pressure: Float32Array
  levels: Levels
  /** Largest share of the energy the bar held after 20 ms. */
  barSharePeak: number
  /** Seconds until the whole system's energy has fallen to a hundredth of its largest (null: not within the run). */
  energyFall20: number | null
  energyIn: number
  faults: number
  worstIterations: number
}

/** One pluck or stroke, in blocks as a browser runs it: the pressure and a few summary numbers. */
export async function quick(graph: Graph, playing: Playing, seconds = 3): Promise<Quick> {
  const p = prepared(graph, playing, false)
  const worklet = await createWorklet(p.calls)
  worklet.send(p.play)
  const engine = worklet.engine
  let [most, share, fell] = [0, 0, -1]
  const pressure = worklet.render(Math.round(seconds * SR), (block) => {
    const mallet = playing === 'strike' ? engine.resonatorEnergy(MALLET) : 0
    const total = engine.energy() - mallet
    if (total > most) {
      most = total
      fell = -1
    } else if (fell < 0 && total < most / 100) fell = block
    if (block > 8 && total > 0) share = Math.max(share, engine.resonatorEnergy(BAR) / total)
  }).map((v) => v * LISTENER_FULL_SCALE)
  return { pressure, levels: levels(pressure), barSharePeak: share, energyFall20: fell < 0 ? null : (fell * 128) / SR, energyIn: most, faults: engine.faults(), worstIterations: engine.worstIterations() }
}

/** The approved hybrid's own output for the same graph without its listener: the bar's velocity where it is struck, m/s. */
export async function approvedOutput(graph: Graph, playing: Playing, seconds = 3): Promise<Float32Array> {
  const p = prepared(withoutListener(graph), playing, false)
  const worklet = await createWorklet(p.calls)
  worklet.send(p.play)
  return worklet.render(Math.round(seconds * SR)).map((v) => v / OUTPUT_GAIN)
}

// ---- Radiation of the bar, by the Phase 3D.3 model -------------------------------------------------------------

export interface Radiation {
  frequency: number
  /** Pressure at the listener per m/s of the mode's own coordinate, Pa per m/s. */
  pressurePerVelocity: number
  /** Sound power per (m/s)^2 of mean-square velocity over the bar, and that as a radiation efficiency: power / (rho c S <v^2>), S one face. */
  efficiency: number
  /**
   * Reactive power over radiated power: (angular frequency x the kinetic energy of the air the bar drags to and
   * fro, twice) / (the power that leaves as sound). Far above 1: the bar mostly sloshes air round itself.
   */
  reactiveOverRadiated: number
  /** Wavelength of the sound over the bar's length, and over its width. */
  wavelengthOverLength: number
  wavelengthOverWidth: number
}

/** How well the bar's mode `n` (0-based), moving at `frequency`, turns motion into sound at the listener and into power. */
export function radiationOf(g: BarGeometry, n: number, frequency: number, listener: Listener = LISTENER): Radiation {
  const w = 2 * Math.PI * frequency
  const shape = freeBarShape(n)
  let meanSquare = 0
  for (let i = 0; i < 200; i++) meanSquare += shape((i + 0.5) / 200) ** 2 / 200
  const power = radiatedPower(g, shape, frequency, 1) // W for a modal velocity amplitude of 1 m/s
  const rmsSquare = meanSquare / 2 // mean over the bar and over a cycle, for amplitude 1
  // Air dragged along: rho pi w^2 / 4 per metre, moving with the bar.
  const dragged = AIR_DENSITY * ((Math.PI * g.width ** 2) / 4) * g.length
  return {
    frequency,
    pressurePerVelocity: size(modeTransfer(g, listener, shape, w)) * w,
    efficiency: power / (AIR_DENSITY * SOUND_SPEED * g.length * g.width * rmsSquare),
    reactiveOverRadiated: (w * dragged * rmsSquare) / power,
    wavelengthOverLength: SOUND_SPEED / frequency / g.length,
    wavelengthOverWidth: SOUND_SPEED / frequency / g.width,
  }
}

export { crossover, dipoleArea, geometryOf, stringPitch }
