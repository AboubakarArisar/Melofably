import { readFileSync } from 'node:fs'
import { FaustMonoDspGenerator } from '@grame/faustwasm'

export const SR = 48000

// The exact artifacts the browser loads (built by `npm run dsp`).
const dir = new URL('../src/audio/models/generated/', import.meta.url)
const module = await WebAssembly.compile(readFileSync(new URL('dsp-module.wasm', dir)))
const json = readFileSync(new URL('dsp-meta.json', dir), 'utf8')

export interface Params {
  length?: number
  tension?: number
  density?: number
  damping?: number
  pluckPosition?: number
  strength?: number
  fret?: number
}

/** A fresh string instance, settled (parameter smoothers converged) and silent. */
export async function createString(params: Params = {}, sampleRate = SR) {
  const dsp = await new FaustMonoDspGenerator().createOfflineProcessor(sampleRate, 128, {
    module,
    json,
    soundfiles: {},
  })
  let plucks = 0
  const render = (seconds: number) => dsp.render([], Math.round(seconds * sampleRate))[0]
  const set = (p: Params) => {
    for (const [k, v] of Object.entries(p)) dsp.setParamValue(`/string/${k}`, v)
  }
  set(params)
  render(0.5)
  return {
    set,
    render,
    pluck: () => dsp.setParamValue('/string/pluck', ++plucks),
    /** Pluck and return the following `seconds` of audio. */
    pluckAndRender(seconds: number) {
      this.pluck()
      return render(seconds)
    },
  }
}

export function rms(x: Float32Array, start = 0, end = x.length): number {
  let s = 0
  for (let i = start; i < end; i++) s += x[i] * x[i]
  return Math.sqrt(s / (end - start))
}

export function peak(x: Float32Array): number {
  let m = 0
  for (const v of x) m = Math.max(m, Math.abs(v))
  return m
}

function autocorr(x: Float32Array, lag: number): number {
  let s = 0
  for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag]
  return s / (x.length - lag)
}

/** Location of the autocorrelation peak nearest `guess`, to sub-sample precision. */
function refinePeak(x: Float32Array, guess: number): number {
  let lag = Math.round(guess)
  for (;;) {
    const here = autocorr(x, lag)
    if (autocorr(x, lag + 1) > here) lag++
    else if (autocorr(x, lag - 1) > here) lag--
    else break
  }
  const [a, b, c] = [autocorr(x, lag - 1), autocorr(x, lag), autocorr(x, lag + 1)]
  return lag + (0.5 * (a - c)) / (a - 2 * b + c) // parabola through the 3 points
}

/**
 * Measured fundamental in Hz, by autocorrelation. Makes no use of the expected
 * pitch: the period is the shortest lag whose correlation is close to the
 * global maximum, then refined over 8 periods for precision.
 */
export function measureFrequency(x: Float32Array, sampleRate = SR): number {
  const maxLag = Math.ceil(sampleRate / 20)
  const r = new Float64Array(maxLag + 1)
  for (let lag = 1; lag <= maxLag; lag++) r[lag] = autocorr(x, lag)
  // Skip the lobe around lag 0 (any signal correlates with itself there).
  let lag = 1
  while (r[lag] > 0) lag++
  const best = Math.max(...r.subarray(lag))
  while (r[lag] < 0.9 * best) lag++
  const period = refinePeak(x, lag)
  return sampleRate / (refinePeak(x, period * 8) / 8)
}

/** Amplitude of the component at `freq` (Hann-windowed single-bin DFT). */
export function amplitudeAt(x: Float32Array, freq: number, sampleRate = SR): number {
  let re = 0
  let im = 0
  let wsum = 0
  for (let i = 0; i < x.length; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (x.length - 1))
    const ph = (2 * Math.PI * freq * i) / sampleRate
    re += w * x[i] * Math.cos(ph)
    im -= w * x[i] * Math.sin(ph)
    wsum += w
  }
  return (2 * Math.hypot(re, im)) / wsum
}

/** RMS in consecutive windows of `seconds`. */
export function envelope(x: Float32Array, seconds = 0.05, sampleRate = SR): number[] {
  const n = Math.round(seconds * sampleRate)
  const out: number[] = []
  for (let i = 0; i + n <= x.length; i += n) out.push(rms(x, i, i + n))
  return out
}

/** Seconds until the envelope first falls `db` below its starting level. */
export function decayTime(x: Float32Array, db: number): number {
  const env = envelope(x, 0.02)
  const target = env[0] * 10 ** (-db / 20)
  const i = env.findIndex((v) => v < target)
  if (i < 0) throw new Error(`signal did not decay by ${db} dB`)
  return i * 0.02
}

export const cents = (measured: number, expected: number) => 1200 * Math.log2(measured / expected)
