// Phase 3C.2: prototype of a wooden soundboard (a thin rectangular plate) for
// a modal string to sit on (src/experimental/string/soundboard.ts). Isolated:
// not used by the application or the builder.
import { describe, expect, test } from 'vitest'
import { BOARD_LIMIT, BRIDGE_AT, onSoundboard, perform, pressure, SOUNDBOARD, splOfPeak, type OnBoard } from '../analysis/soundboard'
import { cents, exactFrequencies, peakNear, woodenBar } from '../analysis/string-prototype'
import { decayRate, DEFAULT_LOSS, fundamental, GUITAR_A, impedance } from '../src/experimental/string/modalString'
import { AIR, characteristicMobility, meanShape, modalDensity, modalMobility, plateFrequency, plateMass, plateModeList, plateModes, radiatedPressure, rigidities, SPRUCE_PLATE, type PlateParams } from '../src/experimental/string/soundboard'
import { amplitudeAt, bandPower, dB, powerSpectrum, spectralPeaks, SR } from './helpers'

const f0 = fundamental(GUITAR_A)
const largest = (x: ArrayLike<number>, from = 0, to = x.length) => {
  let m = 0
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}
/** The strongest spectral peak within 8 % of `f`: a string partial among the board's own modes. */
function partialNear(x: Float32Array, f: number): number {
  const near = spectralPeaks(x, 131072, 60).filter((p) => Math.abs(p.freq / f - 1) < 0.08)
  return near.length ? near.reduce((best, p) => (p.amp > best.amp ? p : best)).freq : NaN
}
/** 60 dB decay time of the component of `x` at `f`, from its level in two windows. */
const t60At = (x: Float32Array, f: number) => Math.log(1000) / (Math.log(amplitudeAt(x.subarray(0.2 * SR, 0.6 * SR), f) / amplitudeAt(x.subarray(0.8 * SR, 1.2 * SR), f)) / 0.6)
const pluck = { plucks: [{ time: 0 }] }
const AFTER = Math.round(0.3 * SR) // by now the plucking force has gone

describe('The plate itself', () => {
  test('frequencies: the textbook isotropic plate, and what wood\'s grain does to it', () => {
    // A square aluminium plate, 1 m x 1 m x 10 mm, edges simply supported:
    // f(m, n) = (pi / 2) sqrt(D / rho h) (m^2 + n^2) / a^2, D = E h^3 / 12 (1 - nu^2).
    const aluminium: PlateParams = { length: 1, width: 1, thickness: 0.01, density: 2700, alongGrain: 70, acrossGrain: 70, shear: 70 / (2 * 1.3), poisson: 0.3, lossFactor: 0.001 }
    const D = (70e9 * 0.01 ** 3) / (12 * (1 - 0.09))
    for (const [m, n] of [[1, 1], [1, 2], [2, 2], [3, 1], [4, 5]]) {
      const textbook = (Math.PI / 2) * Math.sqrt(D / 27) * (m * m + n * n)
      expect(plateFrequency(aluminium, m, n) / textbook).toBeCloseTo(1, 10)
    }
    expect(plateFrequency(aluminium, 1, 1)).toBeCloseTo(48.4, 0)
    // Wood: bending along the grain is 13.75 times stiffer than across it (the ratio of the moduli).
    const { Dx, Dy, H } = rigidities(SPRUCE_PLATE)
    expect(Dx / Dy).toBeCloseTo(11 / 0.8, 10)
    expect(H).toBeLessThan(Math.sqrt(Dx * Dy)) // less twisting stiffness than an isotropic plate would have
    // So a wave across the grain is slow: mode (1,2) is far below (2,1).
    expect(plateFrequency(SPRUCE_PLATE, 1, 2)).toBeLessThan(0.6 * plateFrequency(SPRUCE_PLATE, 2, 1))
    // Thickness: frequencies in proportion; size: as 1 / length^2 for a plate scaled in both directions.
    expect(plateFrequency({ ...SPRUCE_PLATE, thickness: 0.006 }, 3, 2) / plateFrequency(SPRUCE_PLATE, 3, 2)).toBeCloseTo(2, 10)
    expect(plateFrequency({ ...SPRUCE_PLATE, length: 1, width: 0.8 }, 3, 2) / plateFrequency(SPRUCE_PLATE, 3, 2)).toBeCloseTo(0.25, 10)
    console.log('prototype soundboard, lowest modes (m,n) Hz:', plateModeList(SOUNDBOARD, 400).map((m) => `(${m.m},${m.n}) ${m.frequency.toFixed(1)}`).join('  '))
  })

  test('how many modes: the count follows the modal density of plate theory', () => {
    const report: Record<string, Record<string, string | number>> = {}
    for (const [name, plate] of [['3 mm spruce', SPRUCE_PLATE], ['4 mm (prototype)', SOUNDBOARD], ['6 mm', { ...SPRUCE_PLATE, thickness: 0.006 }]] as const) {
      for (const limit of [2000, 5000, 20000]) {
        const counted = plateModeList(plate, limit).length
        const theory = modalDensity(plate) * limit
        report[`${name}, below ${limit} Hz`] = { counted, densityTimesFrequency: theory.toFixed(0), ratio: (counted / theory).toFixed(3) }
        // The count runs below the large-plate figure because of the edges, less so as more modes are counted.
        expect(counted / theory).toBeGreaterThan(limit >= 5000 ? 0.9 : 0.78)
        expect(counted / theory).toBeLessThan(1.02)
      }
    }
    console.table(report)
  })

  test('what a force at the bridge meets: the mean mobility is that of an infinite plate (Cremer and Heckl)', () => {
    const report: Record<string, Record<string, string>> = {}
    for (const [name, plate] of [['3 mm spruce', SPRUCE_PLATE], ['4 mm (prototype)', SOUNDBOARD], ['6 mm', { ...SPRUCE_PLATE, thickness: 0.006 }]] as const) {
      const modes = plateModes(plate, [BRIDGE_AT], SR)
      const expected = characteristicMobility(plate)
      const row: Record<string, string> = { 'infinite plate, m/(N s)': expected.toFixed(4) }
      for (const [low, high] of [[200, 1000], [1000, 3000], [3000, 8000]]) {
        let sum = 0
        let count = 0
        for (let f = low; f < high; f += 0.5) {
          sum += modalMobility(modes, 0, f)[0]
          count++
        }
        row[`modal plate, mean ${low}-${high} Hz`] = (sum / count).toFixed(4)
        expect(Math.abs(sum / count / expected - 1), `${name} ${low}-${high}`).toBeLessThan(0.2)
      }
      report[name] = row
    }
    console.table(report)
    // An isotropic plate: 1 / (8 sqrt(D rho h)), the usual form.
    const steel: PlateParams = { length: 2, width: 1.5, thickness: 0.002, density: 7850, alongGrain: 200, acrossGrain: 200, shear: 200 / 2.6, poisson: 0.3, lossFactor: 0.01 }
    const D = (200e9 * 0.002 ** 3) / (12 * (1 - 0.09))
    expect(characteristicMobility(steel) * 8 * Math.sqrt(D * 7850 * 0.002)).toBeCloseTo(1, 3)
    // Mobility falls as thickness squared.
    expect(characteristicMobility(SPRUCE_PLATE) / characteristicMobility({ ...SPRUCE_PLATE, thickness: 0.006 })).toBeCloseTo(4, 6)
  })

  test('in the engine: struck, the plate rings at its mode frequencies and decays as its loss factor says', () => {
    const setup = onSoundboard({ limit: 1500, bridge: { stiffness: 0 } }) // the string is there but not joined
    const lossless = onSoundboard({ limit: 1500, bridge: { stiffness: 0 }, lossless: true })
    const rec = perform(lossless.instrument, 3, { strikes: [{ time: 0, port: 0, impulse: 0.01 }] })
    const peaks = spectralPeaks(rec.bridgeVelocity, 131072, 100).map((p) => p.freq)
    const modes = plateModeList(SOUNDBOARD, 600)
    for (const mode of modes) {
      // Modes within 3 Hz of another are one peak to the finder: measure those on a fine grid.
      const crowded = modes.some((other) => other !== mode && Math.abs(other.frequency - mode.frequency) < 22)
      const measured = crowded ? peakNear(rec.bridgeVelocity, mode.frequency) : peaks.reduce((best, p) => (Math.abs(p - mode.frequency) < Math.abs(best - mode.frequency) ? p : best), Infinity)
      expect(Math.abs(cents(measured, mode.frequency)), `mode (${mode.m},${mode.n})`).toBeLessThan(0.5)
    }
    expect(modes.length).toBeGreaterThan(12)
    // Decay of mode (1,1), alone at the bottom: T60 = 2.2 / (loss factor x frequency).
    const damped = perform(setup.instrument, 2.5, { strikes: [{ time: 0, port: 0, impulse: 0.01 }] })
    const f11 = plateFrequency(SOUNDBOARD, 1, 1)
    const expected = 2.2 / (SOUNDBOARD.lossFactor * f11)
    console.log('mode (1,1) at', f11.toFixed(1), 'Hz: T60 expected', expected.toFixed(2), 's, measured', t60At(damped.bridgeVelocity, f11).toFixed(2), 's')
    expect(Math.abs(t60At(damped.bridgeVelocity, f11) / expected - 1)).toBeLessThan(0.03)
    expect(damped.engine.faults()).toBe(0)
  })

  test('radiation: only modes that move air radiate, and the pressure is that of a baffled piston moving the same volume', () => {
    // Mean of sin(m pi x) sin(n pi y) over the plate.
    expect(meanShape(1, 1)).toBeCloseTo(4 / Math.PI ** 2, 12)
    expect(meanShape(3, 5)).toBeCloseTo(4 / (15 * Math.PI ** 2), 12)
    for (const [m, n] of [[2, 1], [1, 2], [2, 2], [4, 3]]) expect(meanShape(m, n)).toBe(0)
    // A surface of area S moving at U sin(wt): on its axis far away, p = rho S w U / (2 pi r) (the piston's far field).
    const [U, f, S, r] = [0.01, 440, 0.2, 2]
    const velocity = Float64Array.from({ length: SR }, (_, n) => U * Math.sin((2 * Math.PI * f * n) / SR))
    const p = radiatedPressure(velocity, S, SR, r)
    const expected = (AIR * S * 2 * Math.PI * f * U) / (2 * Math.PI * r)
    expect(largest(p, 100) / expected).toBeCloseTo(1, 2)
    // Twice the frequency at the same velocity: twice the pressure. Twice as far: half.
    const twice = radiatedPressure(Float64Array.from({ length: SR }, (_, n) => U * Math.sin((2 * Math.PI * 2 * f * n) / SR)), S, SR, r)
    expect(largest(twice, 100) / largest(p, 100)).toBeCloseTo(2, 1)
    expect(largest(radiatedPressure(velocity, S, SR, 2 * r), 100) / largest(p, 100)).toBeCloseTo(0.5, 6)
    // In the engine: a bridge on the nodal line x = 1/2 cannot drive any mode with m even, and none of
    // those appears at the bridge; at the default bridge they do.
    const f21 = plateFrequency(SOUNDBOARD, 2, 1)
    const at = (bridgeAt: [number, number]) => {
      const rec = perform(onSoundboard({ bridgeAt, limit: 1500, bridge: { stiffness: 0 }, lossless: true }).instrument, 2, { strikes: [{ time: 0, port: 0, impulse: 0.01 }] })
      return amplitudeAt(rec.bridgeVelocity, f21) / amplitudeAt(rec.bridgeVelocity, plateFrequency(SOUNDBOARD, 1, 1))
    }
    expect(at([0.5, 0.44])).toBeLessThan(1e-3)
    expect(at(BRIDGE_AT)).toBeGreaterThan(0.2)
  })
})

describe('A string on the soundboard', () => {
  test('coupled resonances: the peaks are where the exact equation of string, bridge and plate puts them', () => {
    const setup = onSoundboard({ limit: 2000, loss: null, lossless: true })
    const rec = perform(setup.instrument, 3, pluck)
    const exact = exactFrequencies(GUITAR_A, 1e6, setup.instrument.body, 2000)
    // The 30 strongest peaks of the force at the bridge below 2 kHz.
    const peaks = spectralPeaks(rec.bridgeForce, 131072, 70).filter((p) => p.freq < 1900).sort((a, b) => b.amp - a.amp).slice(0, 30)
    const errors = peaks.map((p) => {
      const root = exact.reduce((best, f) => (Math.abs(f - p.freq) < Math.abs(best - p.freq) ? f : best), Infinity)
      const coarse = Math.abs(cents(p.freq, root))
      return coarse < 0.5 ? coarse : Math.abs(cents(peakNear(rec.bridgeForce, root), root))
    })
    const worst = Math.max(...errors)
    const spacing = (exact.at(-1)! - exact[0]) / exact.length
    console.log('string on the soundboard: exact coupled modes below 2 kHz:', exact.length, '(one every', spacing.toFixed(1), 'Hz) |', peaks.length, 'strongest peaks, worst error:', worst.toFixed(3), 'cents | median:', [...errors].sort((a, b) => a - b)[Math.floor(errors.length / 2)].toFixed(3))
    expect(peaks.length).toBeGreaterThanOrEqual(20)
    expect(exact.length).toBeGreaterThan(60)
    expect(worst).toBeLessThan(1)
    // Energy: nothing is lost and nothing appears.
    let drift = 0
    for (let n = AFTER; n < rec.energy.length; n++) drift = Math.max(drift, Math.abs(rec.energy[n] / rec.energy[AFTER] - 1))
    console.log('lossless string + bridge + soundboard: largest relative change of total energy from 0.3 s to 3 s:', drift.toExponential(1))
    expect(drift).toBeLessThan(1e-6)
  })

  test('string pitch and decay: the soundboard pulls partials near its resonances and takes their energy', () => {
    const alone = onSoundboard({ bridge: { stiffness: 0 } })
    void alone
    const report: Record<string, Record<string, string>> = {}
    for (const [name, o] of [['prototype soundboard (4 mm)', {}], ['bare 3 mm plate', { plate: SPRUCE_PLATE }], ['6 mm plate', { plate: { ...SPRUCE_PLATE, thickness: 0.006 } }]] as [string, OnBoard][]) {
      const setup = onSoundboard(o)
      const rec = perform(setup.instrument, 3, pluck)
      const Z = impedance(GUITAR_A)
      for (const n of [1, 2, 3, 6, 8]) {
        const f = partialNear(rec.bridgeForce, n * f0)
        const own = decayRate(DEFAULT_LOSS, n * f0)
        // First-order estimate: the bridge takes energy at 2 f0 Z Re(Y) per second (amplitude rate).
        const estimate = own + 2 * f0 * Z * modalMobility(setup.instrument.body, 0, f)[0]
        const measured = Math.log(1000) / t60At(rec.bridgeForce, f)
        report[`${name}, partial ${n}`] = { 'pitch, cents from n f0': cents(f, n * f0).toFixed(1), 'T60 alone, s': (Math.log(1000) / own).toFixed(2), 'T60 on the board, s': (Math.log(1000) / measured).toFixed(2), 'first-order estimate, s': (Math.log(1000) / estimate).toFixed(2) }
        // On the board a partial never lasts longer than the string's own losses allow.
        expect(measured, `${name} partial ${n}`).toBeGreaterThan(0.97 * own)
      }
      expect(rec.engine.faults()).toBe(0)
    }
    console.table(report)
  })

  test('energy passes both ways, far more than with a bar, and not at all without the bridge', () => {
    const board = onSoundboard({ loss: null, lossless: true })
    const plucked = perform(board.instrument, 2, pluck)
    const struck = perform(board.instrument, 2, { strikes: [{ time: 0, port: 0, impulse: 0.01 }] })
    const share = (part: Float64Array, total: Float64Array) => {
      let m = 0
      for (let n = AFTER; n < part.length; n++) m = Math.max(m, part[n] / total[n])
      return m
    }
    const toBoard = share(plucked.energyBody, plucked.energy)
    const toString = share(struck.energyStrings, struck.energy)
    // The Phase 3C.1 wooden bar under the same string, for scale.
    const bar = perform({ ...board.instrument, body: woodenBar(SR, 0).map((m) => ({ ...m, t60: Infinity })), output: undefined }, 2, pluck)
    const toBar = share(bar.energyBody, bar.energy)
    const apart = onSoundboard({ loss: null, lossless: true, bridge: { stiffness: 0 } })
    const none = [largest(perform(apart.instrument, 0.5, pluck).energyBody), largest(perform(apart.instrument, 0.5, { strikes: [{ time: 0, port: 0, impulse: 0.01 }] }).energyStrings)]
    console.table({
      'string plucked: most of the energy the soundboard held': `${(100 * toBoard).toFixed(1)} %`,
      'the same on the wooden bar': `${(100 * toBar).toFixed(2)} %`,
      'soundboard struck: most the string held': `${(100 * toString).toFixed(1)} %`,
      'without the bridge': `${none[0]} / ${none[1]}`,
    })
    expect(toBoard).toBeGreaterThan(0.05)
    expect(toBoard).toBeGreaterThan(10 * toBar)
    expect(toString).toBeGreaterThan(0.01)
    expect(none).toEqual([0, 0])
    // With losses, the whole system only ever loses energy once the pluck has let go.
    const lossy = perform(onSoundboard().instrument, 3, pluck)
    let rises = 0
    for (let n = AFTER + 1; n < lossy.energy.length; n++) if (lossy.energy[n] > lossy.energy[n - 1]) rises++
    expect(rises).toBe(0)
  })

  test('what is heard depends on what is measured: string, bridge, board and radiated sound are different signals', () => {
    const setup = onSoundboard()
    const rec = perform(setup.instrument, 3, pluck)
    const sound = pressure(rec, setup.area)
    const report: Record<string, Record<string, string>> = {}
    const centroid = (x: Float32Array) => {
      const p = powerSpectrum(x, AFTER, 65536)
      let [num, den] = [0, 0]
      for (let k = 1; k < p.length; k++) {
        num += ((k * SR) / 65536) * p[k]
        den += p[k]
      }
      return num / den
    }
    const signals: [string, Float32Array, string][] = [
      ['string displacement, 0.3 along', rec.stringDisplacement, 'm'],
      ['force at the bridge', rec.bridgeForce, 'N'],
      ['bridge velocity', rec.bridgeVelocity, 'm/s'],
      ['soundboard mean velocity', rec.bodyVelocity, 'm/s'],
      ['radiated pressure, on axis at 1 m', sound, 'Pa'],
    ]
    for (const [name, x, unit] of signals) report[name] = { peak: `${largest(x).toExponential(2)} ${unit}`, 'peak after 0.3 s': `${largest(x, AFTER).toExponential(2)} ${unit}`, 'power-weighted mean frequency, Hz': centroid(x).toFixed(0) }
    report['radiated pressure, on axis at 1 m'].level = `${splOfPeak(largest(sound)).toFixed(1)} dB SPL at the peak`
    console.table(report)
    // Displacement is dominated by the low partials; each step towards the air favours higher frequencies.
    expect(centroid(rec.stringDisplacement)).toBeLessThan(centroid(rec.bridgeForce))
    expect(centroid(rec.bodyVelocity)).toBeLessThan(centroid(sound))
    // A plucked string through a soundboard a metre away: tens of pascals would be absurd, micropascals inaudible.
    expect(splOfPeak(largest(sound))).toBeGreaterThan(60)
    expect(splOfPeak(largest(sound))).toBeLessThan(100)
    expect(sound.every(Number.isFinite)).toBe(true)
  })

  test('bridge position, plate size and material change the result as plate theory says they should', () => {
    const report: Record<string, Record<string, string | number>> = {}
    const measure = (name: string, o: OnBoard) => {
      const setup = onSoundboard(o)
      const rec = perform(setup.instrument, 3, pluck)
      const sound = pressure(rec, setup.area)
      const spectrum = powerSpectrum(sound, AFTER, 65536)
      let radiated = 0
      for (let n = AFTER; n < sound.length; n++) radiated += sound[n] * sound[n]
      report[name] = {
        'plate mass, g': Math.round(1000 * plateMass(setup.plate)),
        'lowest mode, Hz': plateFrequency(setup.plate, 1, 1).toFixed(0),
        modes: rec.built.modes.body,
        'mean mobility': characteristicMobility(setup.plate).toFixed(4),
        'partial 1, cents': cents(partialNear(rec.bridgeForce, f0), f0).toFixed(1),
        'T60 of partial 2, s': t60At(rec.bridgeForce, partialNear(rec.bridgeForce, 2 * f0)).toFixed(2),
        'sound after 0.3 s, dB re prototype': 0,
        'share above 1 kHz, dB': dB(Math.sqrt(bandPower(spectrum, 1000) / bandPower(spectrum, 20))).toFixed(1),
      }
      expect(rec.engine.faults()).toBe(0)
      return radiated
    }
    const reference = measure('prototype: 4 mm spruce, 0.5 x 0.4 m, bridge at (0.30, 0.44)', {})
    const variants: [string, OnBoard][] = [
      ['bridge at the centre (0.50, 0.50)', { bridgeAt: [0.5, 0.5] }],
      ['bridge near an end (0.12, 0.44)', { bridgeAt: [0.12, 0.44] }],
      ['bridge near a side (0.30, 0.12)', { bridgeAt: [0.3, 0.12] }],
      ['smaller plate, 0.35 x 0.28 m', { plate: { ...SOUNDBOARD, length: 0.35, width: 0.28 } }],
      ['larger plate, 0.70 x 0.50 m', { plate: { ...SOUNDBOARD, length: 0.7, width: 0.5 } }],
      ['thinner, 3 mm', { plate: SPRUCE_PLATE }],
      ['thicker, 6 mm', { plate: { ...SOUNDBOARD, thickness: 0.006 } }],
      ['denser, stiffer wood (maple-like: 650 kg/m3, 12.6 / 1.3 GPa)', { plate: { ...SOUNDBOARD, density: 650, alongGrain: 12.6, acrossGrain: 1.3, shear: 1.0 } }],
      ['more lossy wood (loss factor 0.03)', { plate: { ...SOUNDBOARD, lossFactor: 0.03 } }],
      ['with a 25 g bridge', { bridgeMass: 0.025 }],
    ]
    const levels: Record<string, number> = {}
    for (const [name, o] of variants) {
      levels[name] = 10 * Math.log10(measure(name, o) / reference)
      report[name]['sound after 0.3 s, dB re prototype'] = levels[name].toFixed(1)
    }
    console.table(report)
    // A bridge near an edge, where the plate hardly moves, drives it less than one out in the plate.
    expect(levels['bridge near an end (0.12, 0.44)']).toBeLessThan(levels['bridge at the centre (0.50, 0.50)'])
    // Size and material change the modes as the formula says.
    expect(Number(report['smaller plate, 0.35 x 0.28 m']['lowest mode, Hz'])).toBeGreaterThan(Number(report['larger plate, 0.70 x 0.50 m']['lowest mode, Hz']) * 3)
    expect(Number(report['thicker, 6 mm'].modes)).toBeLessThan(Number(report['thinner, 3 mm'].modes))
  })

  test('how many soundboard modes are needed: what leaving out the high ones changes', () => {
    const report: Record<string, Record<string, string | number>> = {}
    const results: Record<number, { f1: number; high: number; total: number }> = {}
    for (const limit of [500, 1000, 2000, BOARD_LIMIT, 10000]) {
      const setup = onSoundboard({ limit })
      const rec = perform(setup.instrument, 3, pluck)
      const sound = pressure(rec, setup.area)
      const spectrum = powerSpectrum(sound, AFTER, 65536)
      const f1 = partialNear(rec.bridgeForce, f0)
      results[limit] = { f1, high: bandPower(spectrum, 1000), total: bandPower(spectrum, 20) }
      report[`modes below ${limit} Hz`] = {
        modes: rec.built.modes.body,
        'partial 1, cents': cents(f1, f0).toFixed(2),
        'partial 3, cents': cents(partialNear(rec.bridgeForce, 3 * f0), 3 * f0).toFixed(2),
        'T60 of partial 1, s': t60At(rec.bridgeForce, f1).toFixed(2),
        'T60 of partial 8, s': t60At(rec.bridgeForce, partialNear(rec.bridgeForce, 8 * f0)).toFixed(2),
        'radiated sound, dB re all modes to 10 kHz': 0,
        'of which above 1 kHz, dB': 0,
      }
    }
    for (const [limit, r] of Object.entries(results)) {
      report[`modes below ${limit} Hz`]['radiated sound, dB re all modes to 10 kHz'] = (10 * Math.log10(r.total / results[10000].total)).toFixed(1)
      report[`modes below ${limit} Hz`]['of which above 1 kHz, dB'] = (10 * Math.log10(r.high / results[10000].high)).toFixed(1)
    }
    console.table(report)
    // The string's pitch has settled by 5 kHz: the modes above do not move the fundamental.
    expect(Math.abs(cents(results[BOARD_LIMIT].f1, results[10000].f1))).toBeLessThan(0.5)
    // With too few modes the high partials meet nothing that takes their energy, so they ring on and
    // the sound above 1 kHz comes out too strong, not too weak. By 2 kHz of modes it is within a decibel.
    expect(10 * Math.log10(results[500].high / results[10000].high)).toBeGreaterThan(6)
    expect(Math.abs(10 * Math.log10(results[2000].high / results[10000].high))).toBeLessThan(1.5)
    expect(Math.abs(10 * Math.log10(results[BOARD_LIMIT].high / results[10000].high))).toBeLessThan(0.5)
    expect(Math.abs(10 * Math.log10(results[BOARD_LIMIT].total / results[10000].total))).toBeLessThan(0.5)
    expect(Math.abs(cents(results[2000].f1, results[10000].f1))).toBeLessThan(0.5)
  })

  test('stability: bridges from soft to rigid, thin to thick plates, bridge at an edge, heavy bridge, several strings', () => {
    const cases: [string, OnBoard][] = []
    for (const stiffness of [1e3, 1e6, 1e9, 1e12]) cases.push([`bridge ${stiffness.toExponential(0)} N/m`, { bridge: { stiffness }, limit: 2000 }])
    for (const thickness of [0.0015, 0.008]) cases.push([`plate ${1000 * thickness} mm`, { plate: { ...SOUNDBOARD, thickness }, limit: 2000 }])
    cases.push(['bridge 2 mm from the corner', { bridgeAt: [0.004, 0.005], limit: 2000 }])
    cases.push(['200 g bridge', { bridgeMass: 0.2, limit: 2000 }])
    cases.push(['bridge with a strong damper', { bridge: { stiffness: 1e6, damping: 100 }, limit: 2000 }])
    cases.push(['three strings', { strings: [GUITAR_A, { ...GUITAR_A, tension: 131 }, { ...GUITAR_A, tension: 165, density: 0.0021 }], limit: 2000 }])
    const outcomes: Record<string, string> = {}
    for (const [name, o] of cases) {
      const setup = onSoundboard(o)
      const strings = setup.instrument.strings.length
      const rec = perform(setup.instrument, 2, { plucks: Array.from({ length: strings }, (_, i) => ({ time: 0.01 * i, string: i, force: 10 })), strikes: [{ time: 0.05, port: 0, impulse: 0.05 }] })
      let rise = 0
      for (let n = AFTER + 1; n < rec.energy.length; n++) rise = Math.max(rise, rec.energy[n] - rec.energy[n - 1])
      const finite = rec.bridgeForce.every(Number.isFinite) && rec.bodyVelocity.every(Number.isFinite)
      outcomes[name] = `${finite ? 'finite' : 'NOT FINITE'}, faults ${rec.engine.faults()}, largest energy rise ${(rise / rec.energy[AFTER]).toExponential(1)}, Newton worst ${rec.engine.worstIterations()}`
      expect(finite, name).toBe(true)
      expect(rec.engine.faults(), name).toBe(0)
      expect(rise, name).toBeLessThanOrEqual(1e-9 * rec.energy[AFTER])
      expect(rec.energy.at(-1)!, name).toBeLessThan(rec.energy[AFTER])
    }
    console.table(outcomes)
  })
})
