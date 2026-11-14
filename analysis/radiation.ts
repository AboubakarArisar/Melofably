// Phase 3D.3: scenarios for the bar-radiation prototype, shared by its tests
// (tests/radiation.test.ts) and its renders (analysis/render-radiation.ts).
//
// Three ways to get the sound pressure of a bar from the same vibration:
//
//   reference   The bar's modal velocities are recorded, and each is passed
//               through its own transfer to the listener at every frequency
//               (in the frequency domain). Exact within the model, for a bar
//               ringing or driven; not something an audio thread can do.
//   one weight  One number per mode (radiationWeights) on an extra port of
//               the bar; the engine's ordinary output, differentiated by the
//               AudioWorklet processor's existing 'radiate'. Runs today.
//   velocity    What every bar instrument is heard as now: the bar's
//               velocity where it is struck. Not a pressure.
//
// The engine systems are built by the builder's own translation and then
// given extra ports on the bar, which touch nothing mechanical.
import type { Component, Graph } from '../src/builder/graph.ts'
import { barModes, instrumentCalls, OUTPUT_GAIN, translate } from '../src/builder/translate.ts'
import { freeBarShape, modeTransfer, pointAt, RADIATOR_POINTS, radiationWeights, radiatorCalls, radiatorDelay, type BarGeometry, type Complex, type Listener } from '../src/experimental/radiation/barRadiation.ts'
import { outputBuffer, type Call } from '../src/experimental/wasm/engine.ts'
import { SR } from './lib.ts'
import { createWorklet } from './worklet.ts'

export const geometryOf = (bar: Component): BarGeometry => ({ length: bar.params.length, width: bar.params.width / 1000, thickness: bar.params.thickness / 1000 })
/** Frequencies of the bar's modes as the engine holds them, Hz. */
export const frequenciesOf = (bar: Component, sampleRate = SR) => barModes(bar, sampleRate).map((mode) => mode.frequency)

/** In-place radix-2 FFT; `inverse` divides by the length. */
export function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len
    const [wr, wi] = [Math.cos(angle), Math.sin(angle)]
    for (let i = 0; i < n; i += len) {
      let [cr, ci] = [1, 0]
      for (let k = 0; k < len / 2; k++) {
        const [a, b] = [i + k, i + k + len / 2]
        const [xr, xi] = [re[b] * cr - im[b] * ci, re[b] * ci + im[b] * cr]
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
        ;[cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr]
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) {
    re[i] /= n
    im[i] /= n
  }
}

/**
 * The engine calls of a built instrument with extra ports on one resonator:
 * `ports[p][n]` is the shape of mode n at extra port p. Extra ports are
 * read-only as far as the mechanics go: nothing is connected to them. With
 * `output`, the instrument's outputs are replaced by that extra port alone.
 */
export function withPorts(calls: Call[], resonator: number, ports: number[][], output?: { port: number; gain: number }): { calls: Call[]; first: number } {
  let seen = -1
  const at = calls.findIndex((call) => call[0] === 'addResonator' && ++seen === resonator)
  if (at < 0) throw new Error(`no resonator ${resonator}`)
  const first = calls[at][1]
  const shapes: Call[] = ports.flatMap((weights, p) => weights.map((value, n): Call => ['setShape', resonator, first + p, n, value]))
  let out: Call[] = [...calls.slice(0, at), ['addResonator', first + ports.length, calls[at][2]], ...shapes, ...calls.slice(at + 1)]
  if (output) {
    out = out.filter((call) => call[0] !== 'addOutput')
    out.splice(out.findIndex((call) => call[0] === 'build'), 0, ['addOutput', resonator, first + output.port, output.gain])
  }
  return { calls: out, first }
}

/** Pascals at the audio node's ceiling in these prototypes: 114 dB SPL. */
export const FULL_SCALE = 16

export interface Radiating {
  graph: Graph
  /** The bar that radiates. */
  bar: Component
  listener: Listener
  /** What plays it: defaults to the builder's Play instrument. */
  play?: (calls: Call[]) => Call[]
  seconds: number
}

function built(o: Radiating) {
  const translation = translate(o.graph, SR)
  if (!translation.ok) throw new Error(translation.issues[0].message)
  const play = instrumentCalls(o.graph, translation.built)
  return { ...translation.built, play: o.play ? o.play(play) : play, resonator: translation.built.bars[o.bar.id], strikePort: translation.built.strikePorts?.[o.bar.id] ?? 0 }
}

/** What is heard today: the instrument's own output, as the bar's velocity in m/s. */
export async function velocityOutput(o: Radiating): Promise<Float32Array> {
  const b = built(o)
  const worklet = await createWorklet(b.calls)
  worklet.send(b.play)
  return worklet.render(Math.round(o.seconds * SR)).map((v) => v / OUTPUT_GAIN)
}

/** Sound pressure, Pa, by one weight per mode: the engine's output through the processor's differentiator. */
export async function pressureByWeights(o: Radiating): Promise<{ pressure: Float32Array; strikeVelocity: Float32Array; weights: number[] }> {
  const b = built(o)
  const weights = radiationWeights(geometryOf(o.bar), o.listener, frequenciesOf(o.bar))
  const { calls } = withPorts(b.calls, b.resonator, [weights], { port: 0, gain: 1 })
  // 'radiate' with no shelf: y[n] = SR (x[n] - x[n-1]), the time derivative. The audio node carries
  // pascals / FULL_SCALE, so that a hard stroke (a pascal or two here) is not cut off at the node's ceiling.
  const worklet = await createWorklet([...calls, ['radiate', SR, 1, 0, 0, FULL_SCALE]])
  worklet.send(b.play)
  const samples = Math.round(o.seconds * SR)
  const strikeVelocity = new Float32Array(Math.ceil(samples / 128))
  const pressure = worklet
    .render(samples, (block) => {
      if (block > 0) strikeVelocity[block - 1] = worklet.engine.velocity(b.resonator, b.strikePort)
    })
    .map((v) => v * FULL_SCALE)
  if (worklet.engine.faults()) throw new Error('engine fault')
  return { pressure, strikeVelocity, weights }
}

/** The bar's modal velocities, m/s per mode, recorded sample by sample from the same instrument. */
export async function modalVelocities(o: Radiating): Promise<{ modes: Float64Array[]; strikeVelocity: Float32Array; energy: Float64Array }> {
  const b = built(o)
  const count = frequenciesOf(o.bar).length
  // One extra port per mode whose shape is 1 for that mode and 0 for the others: its velocity is the mode's.
  const probes = Array.from({ length: count }, (_, p) => Array.from({ length: count }, (_, n) => (n === p ? 1 : 0)))
  const { calls, first } = withPorts(b.calls, b.resonator, probes)
  const worklet = await createWorklet(calls)
  worklet.send(b.play)
  const samples = Math.round(o.seconds * SR)
  const modes = Array.from({ length: count }, () => new Float64Array(samples))
  const strikeVelocity = new Float32Array(Math.ceil(samples / 128))
  const energy = new Float64Array(Math.ceil(samples / 128))
  for (let i = 0; i < samples; i++) {
    worklet.render(1)
    for (let n = 0; n < count; n++) modes[n][i] = worklet.engine.velocity(b.resonator, first + n)
    if (i % 128 === 127) {
      strikeVelocity[(i - 127) / 128] = worklet.engine.velocity(b.resonator, b.strikePort)
      energy[(i - 127) / 128] = worklet.engine.energy()
    }
  }
  if (worklet.engine.faults()) throw new Error('engine fault')
  return { modes, strikeVelocity, energy }
}

/**
 * Sound pressure, Pa, from recorded modal velocities: each mode's
 * acceleration through its own transfer to the listener at every frequency.
 * The transfer is worked out every `coarse` bins and interpolated; it
 * changes slowly with frequency (its fastest variation is the travel time
 * along the bar, about a millisecond).
 */
export function pressureByTransfer(modes: Float64Array[], geometry: BarGeometry, listener: Listener, sampleRate = SR, coarse = 32): Float32Array {
  const samples = modes[0].length
  // Room at the end for sound that arrives late and, wrapped round, for the little that arrives early.
  const N = 2 ** Math.ceil(Math.log2(samples + 2048))
  const [sumRe, sumIm] = [new Float64Array(N), new Float64Array(N)]
  modes.forEach((velocity, n) => {
    const [re, im] = [new Float64Array(N), new Float64Array(N)]
    re.set(velocity)
    fft(re, im)
    const shape = freeBarShape(n)
    let [k0, h0, h1]: [number, Complex, Complex] = [-coarse, [0, 0], [0, 0]]
    for (let k = 0; k <= N / 2; k++) {
      if (k >= k0 + coarse) {
        k0 = k
        h0 = modeTransfer(geometry, listener, shape, (2 * Math.PI * k * sampleRate) / N, 120)
        h1 = modeTransfer(geometry, listener, shape, (2 * Math.PI * Math.min(k + coarse, N / 2) * sampleRate) / N, 120)
      }
      const t = (k - k0) / coarse
      const [hr, hi] = [h0[0] + t * (h1[0] - h0[0]), h0[1] + t * (h1[1] - h0[1])]
      const w = (2 * Math.PI * k * sampleRate) / N
      // pressure = H x (j w) x velocity
      const [ar, ai] = [-w * im[k], w * re[k]]
      sumRe[k] += hr * ar - hi * ai
      sumIm[k] += hr * ai + hi * ar
    }
  })
  for (let k = 1; k < N / 2; k++) {
    sumRe[N - k] = sumRe[k]
    sumIm[N - k] = -sumIm[k]
  }
  fft(sumRe, sumIm, true)
  return Float32Array.from(sumRe.subarray(0, samples))
}

/**
 * The bar's velocity at `count` points along it, from its modal velocities:
 * what an engine with `count` outputs on the bar would give. Point j is at
 * (j + 1/2) / count of the bar's length.
 */
export function pointVelocities(modes: Float64Array[], count: number): Float64Array[] {
  return Array.from({ length: count }, (_, j) => {
    const out = new Float64Array(modes[0].length)
    modes.forEach((velocity, n) => {
      const shape = freeBarShape(n)((j + 0.5) / count)
      for (let i = 0; i < out.length; i++) out[i] += shape * velocity[i]
    })
    return out
  })
}

/**
 * Sound pressure, Pa, in the time domain from the bar's velocity at a few
 * points: each point is a dipole of the length of bar it stands for, with
 * its own distance, direction and travel time to the listener. Per point and
 * per sample: one difference (acceleration), one first-order filter (the
 * dipole's rise, rolled off at the crossover), one read from a delay line,
 * and three multiplications. This is what an audio thread could do if the
 * engine gave it the points' velocities separately. The result is late by
 * `delay` seconds (returned), so that points nearer than the bar's middle can
 * be heard first.
 */
export function pressureByPoints(points: Float64Array[], geometry: BarGeometry, listener: Listener, sampleRate = SR): { pressure: Float32Array; delay: number } {
  const samples = points[0].length
  const out = new Float64Array(samples)
  const angle = (listener.angle * Math.PI) / 180
  const B = geometry.width * geometry.thickness + (Math.PI * geometry.width ** 2) / 4
  const wc = (2 * geometry.width * 343) / B
  // Bilinear one-pole lowpass at the crossover; far term = wc (a - lowpass(a)), which is (j w) / (1 + j w / wc) x a.
  const t = Math.tan(wc / (2 * sampleRate))
  const [b0, a1] = [t / (1 + t), (t - 1) / (1 + t)]
  const delay = geometry.length / 343 // more than the half-length any point can be early by
  points.forEach((velocity, j) => {
    const xi = (j + 0.5) / points.length
    const [along, away] = [listener.distance * Math.sin(angle) - (xi - 0.5) * geometry.length, listener.distance * Math.cos(angle)]
    const R = Math.hypot(along, away)
    const strength = (1.2 * B * (away / R) * (geometry.length / points.length)) / (4 * Math.PI)
    const [far, near] = [(strength * wc) / (343 * R), strength / (R * R)]
    const late = (delay + (R - listener.distance) / 343) * sampleRate
    const [whole, part] = [Math.floor(late), late - Math.floor(late)]
    const signal = new Float64Array(samples)
    let [x1, y1, v1] = [0, 0, 0]
    for (let i = 0; i < samples; i++) {
      const a = (velocity[i] - v1) * sampleRate
      v1 = velocity[i]
      const low = b0 * (a + x1) - a1 * y1
      x1 = a
      y1 = low
      signal[i] = far * (a - low) + near * a
    }
    // Linear interpolation between the two samples either side of the travel time.
    for (let i = whole + 1; i < samples; i++) out[i] += (1 - part) * signal[i - whole] + part * signal[i - whole - 1]
  })
  return { pressure: Float32Array.from(out), delay }
}

/**
 * Phase 3D.4. Sound pressure, Pa, by the real-time radiator: the bar's
 * velocity at 16 points as engine taps, turned into pressure by the
 * AudioWorklet processor's 'radiator', block by block as a browser does it.
 * Late by `delay` seconds, as pressureByPoints() is. `output` is what the
 * engine's own (first) output was during the same run, as the node would
 * have carried it without the radiator.
 */
export async function pressureByRadiator(o: Radiating, fullScale = FULL_SCALE, points = RADIATOR_POINTS): Promise<{ pressure: Float32Array; output: Float32Array; delay: number; energy: Float64Array }> {
  const b = built(o)
  const geometry = geometryOf(o.bar)
  const count = frequenciesOf(o.bar).length
  const shapes = Array.from({ length: points }, (_, j) => Array.from({ length: count }, (_, n) => freeBarShape(n)(pointAt(j, points))))
  const { calls, first } = withPorts(b.calls, b.resonator, shapes)
  const worklet = await createWorklet([...calls, ...radiatorCalls(geometry, o.listener, b.resonator, first, SR, fullScale, points)])
  worklet.send(b.play)
  const samples = Math.round(o.seconds * SR)
  const output = new Float32Array(samples)
  const energy = new Float64Array(Math.ceil(samples / 128))
  const own = outputBuffer(worklet.engine)
  // The engine's own output is read after each block; while a force is applied the processor steps it a
  // sample at a time and only the block's last sample is left there, so `output` is whole only for strikes.
  let at = 0
  const pressure = new Float32Array(samples)
  for (let block = 0; at < samples; block++, at += 128) {
    const part = worklet.render(Math.min(128, samples - at))
    pressure.set(part.map((v) => v * fullScale), at)
    output.set(own.subarray(0, part.length), at)
    energy[block] = worklet.engine.energy()
  }
  if (worklet.engine.faults()) throw new Error('engine fault')
  return { pressure, output, delay: radiatorDelay(geometry), energy }
}

/** Level of the spectral peak nearest `frequency` (within 3 %), as an amplitude, from `from` samples on. */
export function partial(x: ArrayLike<number>, frequency: number, from = 4800, sampleRate = SR): number {
  const N = 65536
  const [re, im] = [new Float64Array(N), new Float64Array(N)]
  const count = Math.min(N, x.length - from)
  for (let i = 0; i < count; i++) re[i] = x[from + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / count))
  fft(re, im)
  let best = 0
  for (let k = Math.floor((0.97 * frequency * N) / sampleRate); k <= Math.ceil((1.03 * frequency * N) / sampleRate); k++) best = Math.max(best, Math.hypot(re[k], im[k]))
  return (4 * best) / count
}
