// Closed-form physics of the instrument models. The DSP (src/audio/models)
// computes the same quantities itself; these are for the interface readouts
// and as the reference the tests compare measured audio against.

/**
 * Fundamental frequency in Hz of an ideal string fixed at both ends:
 * f = sqrt(T / mu) / (2 L). Fretting shortens L by 2^(-fret / 12).
 */
export function stringFundamental(
  tension: number, // N
  density: number, // kg/m
  length: number, // m
  fret = 0,
): number {
  return Math.sqrt(tension / density) / (2 * length * 2 ** (-fret / 12))
}

/**
 * Roots k_n of cos(k) cosh(k) = 1: the frequency equation of a uniform
 * Euler-Bernoulli beam with both ends free. Mode n vibrates at a frequency
 * proportional to k_n squared.
 */
export const BAR_MODE_K = [
  4.730040744863, 7.853204624096, 10.995607838, 14.13716549126, 17.2787596574, 20.42035224563,
  23.56194490204, 26.70353755551,
]

// A type alias (not an interface) so it can be passed where a plain
// name-to-number record of DSP parameters is expected.
export type BarParams = {
  length: number // m
  thickness: number // mm
  density: number // kg/m^3
  youngsModulus: number // GPa
}

/**
 * Bending-mode frequencies in Hz of a free-free bar of rectangular section:
 * f_n = k_n^2 * h / (2 pi L^2) * sqrt(E / (12 rho)). Bar `key` is shorter by
 * 2^(-key / 24), which raises every mode by `key` semitones.
 */
export function barModeFrequencies(p: BarParams, key = 0): number[] {
  const length = p.length * 2 ** (-key / 24)
  const h = p.thickness / 1000
  const speed = Math.sqrt((p.youngsModulus * 1e9) / (12 * p.density))
  return BAR_MODE_K.map((k) => (k * k * h * speed) / (2 * Math.PI * length * length))
}

/**
 * Shape of free-free mode n (0-based) at x = xi * L, normalised to unit mean
 * square (2 at a free end):
 * phi = cosh(k xi) + cos(k xi) - sigma (sinh(k xi) + sin(k xi)),
 * sigma = (cosh k - cos k) / (sinh k - sin k).
 */
export function barModeShape(n: number, xi: number): number {
  const k = BAR_MODE_K[n]
  // (1 - sigma) / 2, using cos k = 1 / cosh k at a root to avoid cancellation.
  const c = (1 / Math.cosh(k) - Math.sin(k) - Math.exp(-k)) / (Math.sinh(k) - Math.sin(k)) / 2
  return Math.cos(k * xi) - (1 - 2 * c) * Math.sin(k * xi) + (1 - c) * Math.exp(-k * xi) + c * Math.exp(k * xi)
}
