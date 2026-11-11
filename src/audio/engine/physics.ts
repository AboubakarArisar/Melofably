/**
 * Fundamental frequency in Hz of an ideal string fixed at both ends:
 * f = sqrt(T / mu) / (2 L). Fretting shortens L by 2^(-fret / 12).
 * Mirrors the formula in src/audio/models/string.dsp.
 */
export function stringFundamental(
  tension: number, // N
  density: number, // kg/m
  length: number, // m
  fret = 0,
): number {
  return Math.sqrt(tension / density) / (2 * length * 2 ** (-fret / 12))
}
