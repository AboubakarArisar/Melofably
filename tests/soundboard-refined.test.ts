// Phase 3C.2.1: refinements of the soundboard prototype
// (src/experimental/string/soundboardRefined.ts) and the refined
// configuration chosen from them (REFINED in analysis/soundboard.ts).
// Isolated: not used by the application or the builder.
import { describe, expect, test } from 'vitest'
import { onSoundboard, perform, pluckOne, REFINED, soundOf, SOUNDBOARD, type OnBoard, type StringParams } from '../analysis/soundboard'
import { meanShape, plateFrequency, plateModes, SPRUCE_PLATE } from '../src/experimental/string/soundboard'
import { listenerWeight, modeLossFactor, radiatesEfficiently, refinedPlateModes, SOUND_SPEED, unbaffled, unbaffledCorner } from '../src/experimental/string/soundboardRefined'
import { bandPower, powerSpectrum, SR } from './helpers'

const N = 65536
const tunedTo = (f0: number, density: number): StringParams => ({ length: 0.65, density, tension: density * (2 * 0.65 * f0) ** 2 })
const PHRASE: [string, number, number][] = [['A2', 110, 0.0036], ['D3', 146.83, 0.0021], ['E3', 164.81, 0.0021], ['G3', 196, 0.0012], ['A3', 220, 0.0012], ['B3', 246.94, 0.0007]]
const phraseStrings = PHRASE.map(([, f, density]) => tunedTo(f, density))

/** The strongest peak of the radiated sound within 7 % of f0: its error in cents and its level in dB. */
function fundamentalOf(sound: Float32Array, f0: number) {
  const spec = powerSpectrum(sound, Math.round(0.2 * SR), N)
  let best = Math.floor((f0 * 0.93 * N) / SR)
  for (let k = best; k <= Math.ceil((f0 * 1.07 * N) / SR); k++) if (spec[k] > spec[best]) best = k
  const [a, b, c] = [Math.log(spec[best - 1]), Math.log(spec[best]), Math.log(spec[best + 1])]
  const f = ((best + (0.5 * (a - c)) / (a - 2 * b + c)) * SR) / N
  return { cents: 1200 * Math.log2(f / f0), level: 10 * Math.log10(spec[best]), spec }
}
/** Every phrase note on a board carrying all six strings. */
function phraseOn(o: OnBoard) {
  const setup = onSoundboard({ ...o, strings: phraseStrings })
  return PHRASE.map(([, f0], i) => fundamentalOf(soundOf(setup, pluckOne(setup.instrument, i, 2.2)), f0))
}
const spread = (levels: number[]) => Math.max(...levels) - Math.min(...levels)

describe('The refinements themselves', () => {
  test('with none asked for, the refined plate is the Phase 3C.2 plate', () => {
    const points: [number, number][] = [[0.3, 0.44]]
    const [before, after] = [plateModes(SOUNDBOARD, points, SR, 3000), refinedPlateModes(SOUNDBOARD, points, SR, 3000, {})]
    expect(after.length).toBe(before.length)
    for (let i = 0; i < before.length; i++) {
      expect(after[i].frequency).toBe(before[i].frequency)
      expect(after[i].t60).toBeCloseTo(before[i].t60, 12)
      expect(after[i].shape[0]).toBeCloseTo(before[i].shape[0], 12)
      expect(after[i].shape[1]).toBeCloseTo(before[i].shape[1], 3) // numeric integral against the closed form
    }
  })

  test('listener: straight in front it hears the mean shape; to the side, modes that cancel on the axis appear', () => {
    for (const [m, n] of [[1, 1], [3, 1], [1, 3], [3, 5]]) expect(listenerWeight(SOUNDBOARD, m, n, 800, 0, 0)).toBeCloseTo(meanShape(m, n), 4)
    expect(Math.abs(listenerWeight(SOUNDBOARD, 2, 1, 800, 0, 0))).toBeLessThan(1e-9)
    expect(Math.abs(listenerWeight(SOUNDBOARD, 2, 1, 800, 40, 0))).toBeGreaterThan(0.05)
    // Turning round the plate's other axis leaves a mode that is antisymmetric along the grain silent.
    expect(Math.abs(listenerWeight(SOUNDBOARD, 2, 1, 800, 40, 90))).toBeLessThan(1e-9)
  })

  test('bridge footprint: a bridge as long as a mode\'s wavelength across the grain cannot drive it', () => {
    const at: [number, number][] = [[0.3, 0.5]]
    const point = refinedPlateModes(SOUNDBOARD, at, SR, 3000, {})
    // Mode (1, n) has wavelength 2 x width / n across the grain: a bridge of that length averages it to nothing.
    const line = refinedPlateModes(SOUNDBOARD, at, SR, 3000, { bridgeLength: (2 * SOUNDBOARD.width) / 5 })
    const list = point.map((mode, i) => ({ f: mode.frequency, ratio: mode.shape[0] === 0 ? 1 : line[i].shape[0] / mode.shape[0] }))
    const f15 = plateFrequency(SOUNDBOARD, 1, 5)
    expect(Math.abs(list.find((x) => x.f === f15)!.ratio)).toBeLessThan(1e-9)
    // Long waves are hardly changed: sin(x) / x at x = pi / 5.
    expect(list.find((x) => x.f === plateFrequency(SOUNDBOARD, 1, 1))!.ratio).toBeCloseTo(Math.sin(Math.PI / 5) / (Math.PI / 5), 10)
  })

  test('losses by direction: each mode takes the loss of the bending it is made of', () => {
    const loss = { along: 0.008, across: 0.022, twist: 0.016 }
    for (const [m, n] of [[1, 1], [2, 3], [5, 1], [1, 6]]) {
      const eta = modeLossFactor(SOUNDBOARD, m, n, loss)
      expect(eta).toBeGreaterThanOrEqual(loss.along)
      expect(eta).toBeLessThanOrEqual(loss.across)
    }
    expect(modeLossFactor(SOUNDBOARD, 6, 1, loss)).toBeLessThan(modeLossFactor(SOUNDBOARD, 1, 6, loss))
    expect(modeLossFactor(SOUNDBOARD, 3, 2, { along: 0.01, across: 0.01, twist: 0.01 })).toBeCloseTo(0.01, 12)
    // Radiation: a mode radiates well only once sound is slower across the plate than its bending wave.
    expect(radiatesEfficiently(SOUNDBOARD, 1, 1, plateFrequency(SOUNDBOARD, 1, 1))).toBe(false)
    expect(radiatesEfficiently(SOUNDBOARD, 1, 1, 2000)).toBe(true)
  })

  test('no baffle: the bass falls as a dipole\'s does, by the right amount, and the treble is left alone', () => {
    const area = 0.2
    const corner = unbaffledCorner(area)
    const a = Math.sqrt(area / Math.PI)
    expect(corner).toBeCloseTo((3 * SOUND_SPEED) / (8 * a), 10)
    const gain = (f: number) => {
      const x = Float64Array.from({ length: SR }, (_, n) => Math.sin((2 * Math.PI * f * n) / SR))
      const y = unbaffled(x, area, SR)
      let sum = 0
      for (let n = SR / 2; n < SR; n++) sum += y[n] * y[n]
      return Math.sqrt((2 * sum) / (SR / 2))
    }
    // Far below the corner: 4 k a / (3 pi), the rigid disc in free air against the same disc in a wall.
    for (const f of [20, 50]) expect(gain(f) / ((4 * ((2 * Math.PI * f) / SOUND_SPEED) * a) / (3 * Math.PI))).toBeCloseTo(1, 1)
    expect(gain(corner)).toBeCloseTo(Math.SQRT1_2, 1)
    expect(gain(8000)).toBeGreaterThan(0.99)
    expect(gain(8000)).toBeLessThanOrEqual(1.001)
    console.log('unbaffled corner of the 0.5 x 0.4 m plate:', corner.toFixed(0), 'Hz | gain at 48, 110, 220, 1000 Hz, dB:', [48, 110, 220, 1000].map((f) => (20 * Math.log10(gain(f))).toFixed(1)).join(' '))
  })
})

describe('The refined soundboard', () => {
  test('phrase: every note in tune and of even strength, where the Phase 3C.2 board was neither', () => {
    const [before, after] = [phraseOn({}), phraseOn(REFINED)]
    console.table(Object.fromEntries(PHRASE.map(([name], i) => [name, { 'before, cents': before[i].cents.toFixed(1), 'after, cents': after[i].cents.toFixed(1), 'before, fundamental dB': before[i].level.toFixed(1), 'after, fundamental dB': after[i].level.toFixed(1) }])))
    console.log('fundamental spread, dB: before', spread(before.map((n) => n.level)).toFixed(1), 'after', spread(after.map((n) => n.level)).toFixed(1))
    expect(Math.max(...before.map((n) => Math.abs(n.cents)))).toBeGreaterThan(30)
    for (const note of after) expect(Math.abs(note.cents)).toBeLessThan(2)
    expect(spread(before.map((n) => n.level))).toBeGreaterThan(20)
    expect(spread(after.map((n) => n.level))).toBeLessThan(8)
  }, 120000)

  test('every semitone from E2 to E4: none pulled more than 5 cents', () => {
    const errors = (o: OnBoard) => Array.from({ length: 25 }, (_, i) => {
      const f0 = 110 * 2 ** ((i - 5) / 12)
      const setup = onSoundboard({ ...o, strings: [tunedTo(f0, 0.0036 * (110 / f0) ** 1.5)] })
      return fundamentalOf(soundOf(setup, pluckOne(setup.instrument, 0, 2.2)), f0).cents
    })
    const [before, after] = [errors({}), errors(REFINED)]
    console.log('E2 to E4, cents | before:', before.map((e) => e.toFixed(0)).join(' '), '| after:', after.map((e) => e.toFixed(1)).join(' '))
    expect(before.filter((e) => Math.abs(e) > 5).length).toBeGreaterThan(10)
    expect(Math.max(...after.map(Math.abs))).toBeLessThan(5)
  }, 240000)

  test('bass: the sound below 80 Hz is gone, because nothing of the board resonates there', () => {
    expect(plateFrequency(SOUNDBOARD, 1, 1)).toBeLessThan(60)
    expect(plateFrequency(REFINED.plate!, 1, 1)).toBeGreaterThan(90)
    const share = (o: OnBoard) => {
      const setup = onSoundboard(o)
      const spec = powerSpectrum(soundOf(setup, pluckOne(setup.instrument, 0, 3)), 0, N)
      return 10 * Math.log10((bandPower(spec, 20) - bandPower(spec, 80)) / bandPower(spec, 20))
    }
    const [before, after] = [share({}), share(REFINED)]
    console.log('A2, share of radiated energy below 80 Hz, dB: before', before.toFixed(1), 'after', after.toFixed(1))
    expect(before).toBeGreaterThan(-6)
    expect(after).toBeLessThan(-30)
  })

  test('still one coupled system: energy passes both ways, only ever falls, and nothing faults', () => {
    const { unbaffled: _, ...board } = REFINED
    const free = onSoundboard({ ...board, loss: null, lossless: true })
    const after = Math.round(0.3 * SR)
    const share = (part: Float64Array, total: Float64Array) => {
      let m = 0
      for (let n = after; n < part.length; n++) m = Math.max(m, part[n] / total[n])
      return m
    }
    const plucked = perform(free.instrument, 2, { plucks: [{ time: 0 }] })
    const struck = perform(free.instrument, 2, { strikes: [{ time: 0, port: 0, impulse: 0.01 }] })
    let drift = 0
    for (let n = after; n < plucked.energy.length; n++) drift = Math.max(drift, Math.abs(plucked.energy[n] / plucked.energy[after] - 1))
    const [toBoard, toString] = [share(plucked.energyBody, plucked.energy), share(struck.energyStrings, struck.energy)]
    console.log('refined board, lossless: string plucked, most the board held', (100 * toBoard).toFixed(2), '% | board struck, most the string held', (100 * toString).toFixed(2), '% | energy drift', drift.toExponential(1))
    expect(toBoard).toBeGreaterThan(0.002)
    expect(toString).toBeGreaterThan(0.002)
    expect(drift).toBeLessThan(1e-6)
    // With losses: six strings plucked hard and the board struck.
    const setup = onSoundboard({ ...REFINED, strings: phraseStrings })
    const rec = perform(setup.instrument, 2, { plucks: phraseStrings.map((_, i) => ({ time: 0.01 * i, string: i, force: 10 })), strikes: [{ time: 0.05, port: 0, impulse: 0.05 }] })
    let rise = 0
    for (let n = after + 1; n < rec.energy.length; n++) rise = Math.max(rise, rec.energy[n] - rec.energy[n - 1])
    expect(rise).toBeLessThanOrEqual(1e-9 * rec.energy[after])
    expect(rec.engine.faults()).toBe(0)
    expect(soundOf(setup, rec.bodyVelocity).every(Number.isFinite)).toBe(true)
    void SPRUCE_PLATE
  }, 120000)
})
