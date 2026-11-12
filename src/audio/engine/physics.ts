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
 * 60 dB decay time in seconds of a wooden-bar mode at `f` Hz, for a wood
 * whose loss factor at 1 kHz is `lossFactor`: a frequency-independent term
 * (air and supports, 0.7 s) plus a viscoelastic one rising as f^2.
 */
export function woodDecayTime(f: number, lossFactor: number): number {
  return 1 / (1 / 0.7 + (lossFactor * f * f) / 2200)
}

/** Eigenvalues b_m of a clamped-free beam: roots of cos(b) cosh(b) = -1. */
export const CANTILEVER_B = [1.875104068712, 4.694091132974]

/**
 * The glass vessel's wall modes, in the order the DSP holds them. Mode (n, m)
 * has radial motion ~ cos(n theta) around the circumference and m nodal
 * circles along the height. (2, 0) is the fundamental.
 */
export const GLASS_MODES = [
  { n: 2, m: 0 },
  { n: 3, m: 0 },
  { n: 4, m: 0 },
  { n: 5, m: 0 },
  { n: 6, m: 0 },
  { n: 2, m: 1 },
  { n: 3, m: 1 },
  { n: 4, m: 1 },
]

export type GlassParams = {
  diameter: number // mm
  height: number // mm
  thickness: number // mm (wall)
  density: number // kg/m^3
  youngsModulus: number // GPa
}

/**
 * Wall-mode frequencies in Hz of a thin cylindrical vessel, rigid at the base
 * and free at the rim, bending without stretching (French 1983; Terwagne &
 * Bush 2011, eq. 5, with the axial term from clamped-free beam eigenvalues):
 * f(n, m) = 1 / (12 pi) * sqrt(3 E / rho) * a / R^2
 *           * sqrt(((n^2 - 1)^2 + (b_m R / H)^4) / (1 + 1 / n^2)).
 * Returned in GLASS_MODES order. Vessel `key` is the same shape scaled by
 * 2^(-key / 24) with the wall unchanged, which raises every mode by `key`
 * semitones.
 */
export function glassModeFrequencies(p: GlassParams, key = 0): number[] {
  const scale = 2 ** (-key / 24)
  const R = (p.diameter / 2000) * scale
  const H = (p.height / 1000) * scale
  const base = (Math.sqrt((3 * p.youngsModulus * 1e9) / p.density) / (12 * Math.PI)) * (p.thickness / 1000 / (R * R))
  return GLASS_MODES.map(({ n, m }) =>
    base * Math.sqrt(((n * n - 1) ** 2 + ((CANTILEVER_B[m] * R) / H) ** 4) / (1 + 1 / (n * n))),
  )
}

/**
 * Shape of the vessel wall's motion along its height for axial index m, at
 * z = zeta * H (0 = base, 1 = rim): the clamped-free beam mode
 * Z = cosh(b z) - cos(b z) - sigma (sinh(b z) - sin(b z)),
 * sigma = (cosh b + cos b) / (sinh b + sin b), normalised to unit mean square.
 */
export function cantileverShape(m: number, zeta: number): number {
  const b = CANTILEVER_B[m]
  const sigma = (Math.cosh(b) + Math.cos(b)) / (Math.sinh(b) + Math.sin(b))
  return Math.cosh(b * zeta) - Math.cos(b * zeta) - sigma * (Math.sinh(b * zeta) - Math.sin(b * zeta))
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
