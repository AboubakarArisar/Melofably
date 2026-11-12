// EXPERIMENTAL (Phase 3C.2 prototype). Not used by the application or the
// builder. A wooden soundboard as modal data for the physics engine: a thin
// rectangular plate. What is derived and what is assumed: docs/SOUNDBOARD.md.
import type { Mode } from '../physics/resonator.ts'

/**
 * A thin flat rectangular plate of wood, grain along x. Wood is much stiffer
 * along the grain than across it, so three elastic constants are needed.
 */
export interface PlateParams {
  length: number // m, along the grain (x)
  width: number // m, across the grain (y)
  thickness: number // m
  density: number // kg/m^3
  alongGrain: number // Young's modulus along the grain, GPa
  acrossGrain: number // Young's modulus across the grain, GPa
  shear: number // in-plane shear modulus, GPa
  poisson: number // Poisson's ratio (strain across the grain per strain along it)
  /** Material loss factor: the fraction of a mode's energy lost per radian. Decay time T60 = 2.2 / (lossFactor x frequency). */
  lossFactor: number
}

/**
 * Sitka-spruce-like values of the order found in handbooks for quarter-sawn
 * tonewood. They are nominal: real boards vary by tens of percent, and the
 * loss factor in particular depends on frequency, humidity and the piece.
 */
export const SPRUCE_PLATE: PlateParams = { length: 0.5, width: 0.4, thickness: 0.003, density: 420, alongGrain: 11, acrossGrain: 0.8, shear: 0.7, poisson: 0.37, lossFactor: 0.012 }

/** Bending rigidities of the plate, N m: along the grain, across it, and the mixed term. */
export function rigidities(p: PlateParams) {
  const h3 = p.thickness ** 3 / 12
  const across = (p.poisson * p.acrossGrain) / p.alongGrain // the other Poisson's ratio, by symmetry
  const scale = 1 - p.poisson * across
  const Dx = (p.alongGrain * 1e9 * h3) / scale
  const Dy = (p.acrossGrain * 1e9 * h3) / scale
  return { Dx, Dy, H: across * Dx + 2 * p.shear * 1e9 * h3 }
}

/** Mass of the whole plate, kg. */
export const plateMass = (p: PlateParams) => p.density * p.thickness * p.length * p.width

/**
 * Frequency of mode (m, n) of the plate with all four edges simply supported
 * (held in place but free to rotate), Hz. For this edge condition the mode
 * shapes are sin(m pi x / a) sin(n pi y / b) and thin-plate theory gives,
 * exactly,
 *
 *   w^2 = [Dx (m pi/a)^4 + 2 H (m pi/a)^2 (n pi/b)^2 + Dy (n pi/b)^4] / (rho h).
 */
export function plateFrequency(p: PlateParams, m: number, n: number): number {
  const { Dx, Dy, H } = rigidities(p)
  const [kx, ky] = [(m * Math.PI) / p.length, (n * Math.PI) / p.width]
  return Math.sqrt((Dx * kx ** 4 + 2 * H * kx * kx * ky * ky + Dy * ky ** 4) / (p.density * p.thickness)) / (2 * Math.PI)
}

/** Every mode below `limit` Hz, lowest first. */
export function plateModeList(p: PlateParams, limit: number): { m: number; n: number; frequency: number }[] {
  const list: { m: number; n: number; frequency: number }[] = []
  for (let m = 1; plateFrequency(p, m, 1) < limit; m++) {
    for (let n = 1; ; n++) {
      const frequency = plateFrequency(p, m, n)
      if (frequency >= limit) break
      list.push({ m, n, frequency })
    }
  }
  return list.sort((x, y) => x.frequency - y.frequency)
}

/**
 * How much mode (m, n) moves air: its shape averaged over the plate. Even
 * modes move as much air one way as the other and average to nothing.
 */
export const meanShape = (m: number, n: number) => (m % 2 && n % 2 ? 4 / (Math.PI * Math.PI * m * n) : 0)

/**
 * The plate's modes as data for the engine.
 *
 * Ports: one for each point in `points` (fractions of length and width,
 * 0..1), then one more, the RADIATION port, whose "displacement" is the
 * plate's displacement averaged over its surface. Reading that port's
 * velocity gives the mean surface velocity, from which radiatedPressure()
 * makes sound.
 *
 * Each mode's mass is a quarter of the plate's (shapes of unit peak). Decay
 * is the material's: T60 = 2.2 / (lossFactor f). Modes at or above
 * `limit` Hz, or above 0.45 x the sample rate, are left out.
 */
export function plateModes(p: PlateParams, points: [number, number][], sampleRate: number, limit = Infinity): Mode[] {
  const mass = plateMass(p) / 4
  return plateModeList(p, Math.min(limit, 0.45 * sampleRate)).map(({ m, n, frequency }) => ({
    frequency,
    t60: 2.2 / (p.lossFactor * frequency),
    mass,
    shape: [...points.map(([x, y]) => Math.sin(m * Math.PI * x) * Math.sin(n * Math.PI * y)), meanShape(m, n)],
  }))
}

/** Density of air, kg/m^3, at about 20 degrees C. */
export const AIR = 1.2

/**
 * Sound pressure (Pa) on the plate's axis, `distance` metres away, from its
 * mean surface velocity (m/s), sample by sample.
 *
 * For a flat radiator set in a large rigid wall, far away and straight in
 * front, every part of the surface is the same distance from the listener,
 * and the pressure is (Rayleigh's integral)
 *
 *   p(t) = rho_air / (2 pi r) x d/dt [ area x mean velocity ]
 *
 * delayed by r / c, which is left out here. The derivative is why a
 * soundboard radiates high frequencies better than low ones.
 */
export function radiatedPressure(meanVelocity: ArrayLike<number>, area: number, sampleRate: number, distance = 1): Float32Array {
  const out = new Float32Array(meanVelocity.length)
  const scale = (AIR * area * sampleRate) / (2 * Math.PI * distance)
  for (let n = 1; n < out.length; n++) out[n] = scale * (meanVelocity[n] - meanVelocity[n - 1])
  return out
}

/**
 * Modes per hertz of a large plate of this material and area, from the area
 * of wavenumber space below a frequency (Weyl's law). It does not depend on
 * frequency or on how the edges are held.
 */
export function modalDensity(p: PlateParams): number {
  const { Dx, Dy, H } = rigidities(p)
  // Area of the region Dx kx^4 + 2 H kx^2 ky^2 + Dy ky^4 <= 1.
  let area = 0
  const steps = 20000
  for (let i = 0; i < steps; i++) {
    const [c, s] = [Math.cos(((i + 0.5) * 2 * Math.PI) / steps) ** 2, Math.sin(((i + 0.5) * 2 * Math.PI) / steps) ** 2]
    area += (0.5 * ((2 * Math.PI) / steps)) / Math.sqrt(Dx * c * c + 2 * H * c * s + Dy * s * s)
  }
  // N(w) = S / (4 pi^2) x area x w sqrt(rho h); per hertz: x 2 pi.
  return ((p.length * p.width * area * Math.sqrt(p.density * p.thickness)) / (4 * Math.PI * Math.PI)) * 2 * Math.PI
}

/**
 * Driving-point mobility of an infinite plate of this material, m/(N s):
 * what a force at a point of a large plate meets, averaged over frequency
 * (Cremer and Heckl). Real, and independent of frequency:
 * mobility = modal density (per Hz) / (4 x mass).
 */
export const characteristicMobility = (p: PlateParams) => modalDensity(p) / (4 * plateMass(p))

/** Mobility of the modal plate at one port, at `frequency` Hz, from its modes (continuous-time): [real, imaginary]. */
export function modalMobility(modes: Mode[], port: number, frequency: number): [number, number] {
  const w = 2 * Math.PI * frequency
  let [re, im] = [0, 0]
  for (const mode of modes) {
    const wn = 2 * Math.PI * mode.frequency
    const sigma = Number.isFinite(mode.t60) ? Math.log(1000) / mode.t60 : 0
    // Velocity per force of one mode: j w / (m (wn^2 - w^2 + 2 j sigma w)).
    const [a, b] = [wn * wn - w * w, 2 * sigma * w]
    const scale = (mode.shape[port] ** 2 * w) / (mode.mass * (a * a + b * b))
    re += scale * b
    im += scale * a
  }
  return [re, im]
}
