// Signal measurements and the offline string harness, shared by the tests
// (tests/) and the before/after comparison (analysis/compare.ts). No
// dependencies, so it runs under both Vitest and plain `node`.

export const SR = 48000

// ---- offline harness --------------------------------------------------------

export type Params = Record<string, number>

interface OfflineDsp {
  getParams(): string[]
  setParamValue(path: string, value: number): void
  render(inputs?: Float32Array[], length?: number): Float32Array[]
}

/**
 * Wrap a Faust offline processor of a string model. Parameters the model does
 * not have are ignored, so one settings object can drive old and new models.
 * The instance is rendered for 0.5 s first so parameter smoothers settle.
 */
export function makeString(dsp: OfflineDsp, params: Params = {}, sampleRate = SR) {
  const paths = new Map(dsp.getParams().map((p) => [p.split('/').pop()!, p]))
  let plucks = 0
  const render = (seconds: number) => dsp.render([], Math.round(seconds * sampleRate))[0]
  const set = (p: Params) => {
    for (const [k, v] of Object.entries(p)) {
      const path = paths.get(k)
      if (path) dsp.setParamValue(path, v)
    }
  }
  set(params)
  render(0.5)
  return {
    set,
    render,
    pluck: () => dsp.setParamValue(paths.get('pluck')!, ++plucks),
    /** Pluck and return the following `seconds` of audio. */
    pluckAndRender(seconds: number) {
      this.pluck()
      return render(seconds)
    },
  }
}

// ---- time domain ------------------------------------------------------------

export function rms(x: Float32Array, start = 0, end = x.length): number {
  let s = 0
  for (let i = start; i < end; i++) s += x[i] * x[i]
  return Math.sqrt(s / (end - start))
}

export function peak(x: Float32Array, start = 0, end = x.length): number {
  let m = 0
  for (let i = start; i < end; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}

/** Largest jump between consecutive samples: a measure of clicks. */
export function maxStep(x: Float32Array, start = 1, end = x.length): number {
  let m = 0
  for (let i = Math.max(1, start); i < end; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]))
  return m
}

/** RMS in consecutive windows of `seconds`. */
export function envelope(x: Float32Array, seconds = 0.05, sampleRate = SR): number[] {
  const n = Math.round(seconds * sampleRate)
  const out: number[] = []
  for (let i = 0; i + n <= x.length; i += n) out.push(rms(x, i, i + n))
  return out
}

/** Seconds until the envelope first falls `db` below its starting level. */
export function decayTime(x: Float32Array, db: number, sampleRate = SR): number {
  const env = envelope(x, 0.02, sampleRate)
  const target = env[0] * 10 ** (-db / 20)
  const i = env.findIndex((v) => v < target)
  if (i < 0) throw new Error(`signal did not decay by ${db} dB`)
  return i * 0.02
}

// ---- pitch ------------------------------------------------------------------

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

export const cents = (measured: number, expected: number) => 1200 * Math.log2(measured / expected)

// ---- spectrum ---------------------------------------------------------------

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

/** Power spectrum (bins 0..n/2) of the first `n` samples from `start`, Hann-windowed. `n` is a power of 2. */
export function powerSpectrum(x: Float32Array, start: number, n: number): Float64Array {
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  for (let i = 0; i < n; i++) re[i] = (x[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n))
  // In-place radix-2 FFT.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) [re[i], re[j]] = [re[j], re[i]]
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k)
        const wi = Math.sin(ang * k)
        const a = i + k
        const b = a + len / 2
        const tr = re[b] * wr - im[b] * wi
        const ti = re[b] * wi + im[b] * wr
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
      }
    }
  }
  const p = new Float64Array(n / 2 + 1)
  for (let k = 0; k <= n / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k]
  return p
}

/** Amplitude-weighted mean frequency in Hz: higher means brighter. */
export function spectralCentroid(power: Float64Array, sampleRate = SR): number {
  const binHz = sampleRate / (2 * (power.length - 1))
  let num = 0
  let den = 0
  for (let k = 1; k < power.length; k++) {
    const a = Math.sqrt(power[k])
    num += k * binHz * a
    den += a
  }
  return num / den
}

/** Power at or above `hz`. */
export function bandPower(power: Float64Array, hz: number, sampleRate = SR): number {
  const binHz = sampleRate / (2 * (power.length - 1))
  let s = 0
  for (let k = Math.ceil(hz / binHz); k < power.length; k++) s += power[k]
  return s
}

export const dB = (ratio: number) => 20 * Math.log10(ratio)
