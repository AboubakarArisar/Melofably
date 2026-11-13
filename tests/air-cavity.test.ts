// Phase 3C.2.2: what was wrong with the refined soundboard's sound and why
// (diagnosis), and the smallest enclosed body tried as a remedy
// (src/experimental/string/airCavity.ts). Isolated: not used by the
// application or the builder.
import { describe, expect, test } from 'vitest'
import { systemFrequencies } from '../analysis/experimental'
import { ENCLOSED, onSoundboard, perform, pluckOne, REFINED, soundOf, type OnBoard, type StringParams } from '../analysis/soundboard'
import { airCavity, enclosed, enclosedCorner } from '../src/experimental/string/airCavity'
import { AIR, plateFrequency, radiatedPressure } from '../src/experimental/string/soundboard'
import { SOUND_SPEED, unbaffledCorner } from '../src/experimental/string/soundboardRefined'
import { powerSpectrum, SR } from './helpers'

const N = 65536
const tunedTo = (f0: number, density: number): StringParams => ({ length: 0.65, density, tension: density * (2 * 0.65 * f0) ** 2 })
const A2 = tunedTo(110, 0.0036)
const F0 = 109.95 // the A2 string on its bridge
const dB = (power: number) => 10 * Math.log10(power)
function peakIn(spec: Float64Array, low: number, high: number) {
  let best = Math.floor((low * N) / SR)
  for (let k = best; k <= Math.ceil((high * N) / SR); k++) if (spec[k] > spec[best]) best = k
  const [a, b, c] = [Math.log(spec[best - 1]), Math.log(spec[best]), Math.log(spec[best + 1])]
  return { frequency: ((best + (0.5 * (a - c)) / (a - 2 * b + c)) * SR) / N, power: spec[best] }
}
/** Size of the component of `x` at `f` over time: one value per millisecond, each over one period of the string. */
function componentOverTime(x: ArrayLike<number>, f: number, seconds = 0.5): number[] {
  const window = Math.round(SR / F0)
  const out: number[] = []
  for (let i = 0; i + window <= seconds * SR; i += 48) {
    let [re, im] = [0, 0]
    for (let n = i; n < i + window; n++) {
      re += x[n] * Math.cos((2 * Math.PI * f * n) / SR)
      im += x[n] * Math.sin((2 * Math.PI * f * n) / SR)
    }
    out.push(Math.hypot(re, im))
  }
  return out
}
const soundOfA2 = (o: OnBoard, seconds = 1) => {
  const setup = onSoundboard({ ...o, strings: [A2] })
  return soundOf(setup, pluckOne(setup.instrument, 0, seconds))
}
/** Every semitone from E2 to E4 on one string: pitch error in cents and level of the fundamental in dB. */
const semitones = (o: OnBoard) => Array.from({ length: 25 }, (_, i) => {
  const f0 = 110 * 2 ** ((i - 5) / 12)
  const setup = onSoundboard({ ...o, strings: [tunedTo(f0, 0.0036 * (110 / f0) ** 1.5)] })
  const found = peakIn(powerSpectrum(soundOf(setup, pluckOne(setup.instrument, 0, 2.2)), Math.round(0.2 * SR), N), 0.93 * f0, 1.07 * f0)
  return { cents: 1200 * Math.log2(found.frequency / f0), level: dB(found.power) }
})
const mean = (values: number[]) => values.reduce((a, b) => a + b) / values.length

describe('Diagnosis of the refined soundboard', () => {
  test('slow attack of A2: its third harmonic builds up on a plate mode 7 cents away; move the mode and it is gone', () => {
    const plate = REFINED.plate!
    // Mode (1,3) of the refined plate against three times the string's fundamental.
    expect(Math.abs(1200 * Math.log2(plateFrequency(plate, 1, 3) / (3 * F0)))).toBeLessThan(10)
    const report: Record<string, Record<string, string | number>> = {}
    const growth = (name: string, o: OnBoard) => {
      const sound = soundOfA2(o)
      const third = componentOverTime(sound, 3 * F0)
      const first = componentOverTime(sound, F0)
      const [top3, top1] = [Math.max(...third), Math.max(...first)]
      report[name] = { 'harmonic 3 largest at, ms': third.indexOf(top3), 'harmonic 3 at 20 ms, dB re its largest': (2 * dB(third[20] / top3)).toFixed(1), 'harmonic 1 largest at, ms': first.indexOf(top1), 'harmonic 3 re harmonic 1 at their largest, dB': (2 * dB(top3 / top1)).toFixed(1) }
      return { at: third.indexOf(top3), early: 2 * dB(third[20] / top3), firstAt: first.indexOf(top1), excess: 2 * dB(top3 / top1) }
    }
    const refined = growth('refined, 8 mm: mode (1,3) at 331 Hz', REFINED)
    const moved = growth('8.4 mm: mode (1,3) at 348 Hz', { ...REFINED, plate: { ...plate, thickness: 0.0084 } })
    const noLowMode = (() => {
      // Without the plate's lowest mode (96 Hz), the suspected partner in a beat with the 110 Hz fundamental.
      const setup = onSoundboard({ ...REFINED, strings: [A2] })
      setup.instrument.body = setup.instrument.body.filter((mode) => mode.frequency > 150)
      const third = componentOverTime(soundOf(setup, pluckOne(setup.instrument, 0, 1)), 3 * F0)
      return third.indexOf(Math.max(...third))
    })()
    console.table(report)
    // The fundamental is there at once; the third harmonic, the strongest part of the sound, takes over 100 ms.
    expect(refined.firstAt).toBeLessThan(50)
    expect(refined.at).toBeGreaterThan(100)
    expect(refined.early).toBeLessThan(-6)
    expect(refined.excess).toBeGreaterThan(6)
    // It is not a beat with the 96 Hz mode: taking that mode away leaves the slow build-up.
    expect(noLowMode).toBeGreaterThan(100)
    // 5 % thicker, the mode is 90 cents from the harmonic: no build-up, and the harmonic is no longer the strongest.
    expect(moved.at).toBeLessThan(50)
    expect(moved.excess).toBeLessThan(0)
  })

  test('weak fundamental and lower level: what the missing baffle takes at each frequency', () => {
    const corner = unbaffledCorner(0.2)
    const loss = (f: number) => -10 * Math.log10(1 + (corner / f) ** 2)
    // 13.5 dB from the fundamental of A2, 5.3 dB from its third harmonic: 8 dB of the 10 dB between them.
    expect(loss(110)).toBeCloseTo(-13.5, 0)
    expect(loss(110) - loss(330)).toBeCloseTo(-8.2, 0)
    // The pressure itself is physical: the files' levels are pascals before any gain.
    const setup = onSoundboard({ ...REFINED, strings: [A2] })
    const velocity = pluckOne(setup.instrument, 0, 1)
    const [inWall, inOpen] = [radiatedPressure(velocity, setup.area, SR, 1), soundOf(setup, velocity)]
    const power = (x: Float32Array) => x.reduce((s, v) => s + v * v, 0)
    expect(dB(power(inOpen) / power(inWall))).toBeLessThan(-4)
    expect(dB(power(inOpen) / power(inWall))).toBeGreaterThan(-9)
  })
})

describe('A closed box of air with a hole behind the soundboard', () => {
  const plate = REFINED.plate!
  const box = airCavity(plate, ENCLOSED.cavity!)

  test('the box: air spring, plug of air, Helmholtz resonance', () => {
    const [S, V, r] = [0.2, 0.2 * 0.15, 0.06]
    expect(box.volume).toBeCloseTo(V, 12)
    expect(box.stiffness).toBeCloseTo((AIR * SOUND_SPEED ** 2 * S * S) / V, 6)
    expect(box.plug.mass).toBeCloseTo(AIR * Math.PI * r * r * 1.7 * r, 12)
    // c / (2 pi) sqrt(hole area / (volume x effective length)).
    expect(box.helmholtz).toBeCloseTo((SOUND_SPEED / (2 * Math.PI)) * Math.sqrt((Math.PI * r * r) / (V * 1.7 * r)), 6)
    // On the closed box the plate's lowest mode is stiffer than in the open.
    expect(box.bodyResonance).toBeGreaterThan(plateFrequency(plate, 1, 1) * 1.2)
    // The radiation damper is that of a small source in open air at that frequency.
    expect(box.damping).toBeCloseTo((AIR * (2 * Math.PI * box.bodyResonance) ** 2 * S * S) / (4 * Math.PI * SOUND_SPEED), 6)
    console.log('box: air spring', box.stiffness.toFixed(0), 'N/m | plug', (1000 * box.plug.mass).toFixed(2), 'g | Helmholtz (rigid walls)', box.helmholtz.toFixed(1), 'Hz | plate (1,1) on a closed box', box.bodyResonance.toFixed(1), 'Hz | radiation damper', box.damping.toFixed(1), 'N s/m')
  })

  test('radiation from a box: half the pressure of a wall-mounted source at the bottom, all of it at the top', () => {
    const gain = (f: number) => {
      const x = Float64Array.from({ length: SR }, (_, n) => Math.sin((2 * Math.PI * f * n) / SR))
      const y = enclosed(x, 0.2, SR)
      let sum = 0
      for (let n = SR / 2; n < SR; n++) sum += y[n] * y[n]
      return Math.sqrt((2 * sum) / (SR / 2))
    }
    expect(gain(10)).toBeCloseTo(0.5, 2)
    expect(gain(enclosedCorner(0.2))).toBeCloseTo(Math.SQRT1_2, 2)
    expect(gain(9000)).toBeCloseTo(1, 2)
    expect(enclosedCorner(0.2)).toBeCloseTo(SOUND_SPEED / (2 * Math.PI * Math.sqrt(0.2 / Math.PI)), 9)
  })

  test('plate, air and plug are one system: its resonances are where the exact equation puts them, and energy is kept', () => {
    // No string joined, nothing lossy: strike the plate and listen to the box.
    const setup = onSoundboard({ ...ENCLOSED, strings: [A2], bridge: { stiffness: 0 }, lossless: true, limit: 1500 })
    const rec = perform(setup.instrument, 3, { strikes: [{ time: 0, port: 0, impulse: 0.01 }] })
    const spec = powerSpectrum(soundOf(setup, rec.output), 0, N)
    const exact = systemFrequencies([setup.instrument.body, [setup.instrument.air!.plug]], [{ a: [0, setup.radiation], b: [1, 0], stiffness: box.stiffness }])
    const open = plateFrequency(plate, 1, 1)
    // Two resonances where the open plate had one: the air's below it, the plate's above.
    expect(exact[0]).toBeLessThan(Math.min(open, box.helmholtz))
    expect(exact[1]).toBeGreaterThan(Math.max(open, box.helmholtz))
    const measured = [peakIn(spec, exact[0] - 8, exact[0] + 8).frequency, peakIn(spec, exact[1] - 8, exact[1] + 8).frequency]
    console.log('box resonances, Hz: exact', exact.slice(0, 2).map((f) => f.toFixed(2)).join(' and '), '| in the engine', measured.map((f) => f.toFixed(2)).join(' and '), '| open plate', open.toFixed(1), '| Helmholtz', box.helmholtz.toFixed(1))
    for (const i of [0, 1]) expect(Math.abs(1200 * Math.log2(measured[i] / exact[i]))).toBeLessThan(2)
    let drift = 0
    const after = Math.round(0.1 * SR)
    for (let n = after; n < rec.energy.length; n++) drift = Math.max(drift, Math.abs(rec.energy[n] / rec.energy[after] - 1))
    expect(drift).toBeLessThan(1e-6)
    // Below the Helmholtz frequency the hole's flow opposes the plate's; the box cannot be heard there.
    const low = peakIn(spec, 20, 40).power
    expect(dB(low / peakIn(spec, exact[1] - 8, exact[1] + 8).power)).toBeLessThan(-40)
  })

  test('with a string: energy only falls, nothing faults, and the string still gives to the box and takes from it', () => {
    const free = onSoundboard({ ...ENCLOSED, strings: [A2], loss: null, lossless: true })
    const after = Math.round(0.3 * SR)
    const plucked = perform(free.instrument, 2, { plucks: [{ time: 0 }] })
    let drift = 0
    for (let n = after; n < plucked.energy.length; n++) drift = Math.max(drift, Math.abs(plucked.energy[n] / plucked.energy[after] - 1))
    let share = 0
    for (let n = after; n < plucked.energy.length; n++) share = Math.max(share, 1 - plucked.energyStrings[n] / plucked.energy[n])
    console.log('string on the box, lossless: energy drift', drift.toExponential(1), '| most of the energy outside the string', (100 * share).toFixed(2), '%')
    expect(drift).toBeLessThan(1e-6)
    expect(share).toBeGreaterThan(0.002)
    const strings = [82.41, 110, 146.83, 196, 246.94, 329.63].map((f, i) => tunedTo(f, [0.0064, 0.0036, 0.0021, 0.0012, 0.0007, 0.0004][i]))
    const setup = onSoundboard({ ...ENCLOSED, strings })
    const rec = perform(setup.instrument, 2, { plucks: strings.map((_, i) => ({ time: 0.01 * i, string: i, force: 10 })), strikes: [{ time: 0.05, port: 0, impulse: 0.05 }] })
    let rise = 0
    for (let n = after + 1; n < rec.energy.length; n++) rise = Math.max(rise, rec.energy[n] - rec.energy[n - 1])
    expect(rise).toBeLessThanOrEqual(1e-9 * rec.energy[after])
    expect(rec.engine.faults()).toBe(0)
    expect(soundOf(setup, rec.output).every(Number.isFinite)).toBe(true)
  }, 400000)

  test('every semitone from E2 to E4: still in tune, fundamentals 6 dB or more stronger, no resonance worse than the open plate\'s', () => {
    const [open, boxed] = [semitones(REFINED), semitones(ENCLOSED)]
    const gain = mean(boxed.map((n) => n.level)) - mean(open.map((n) => n.level))
    const spread = (notes: typeof open) => Math.max(...notes.map((n) => n.level)) - Math.min(...notes.map((n) => n.level))
    console.log('E2 to E4 | worst pitch error, cents: open', Math.max(...open.map((n) => Math.abs(n.cents))).toFixed(1), 'box', Math.max(...boxed.map((n) => Math.abs(n.cents))).toFixed(1), '| mean fundamental, box against open:', gain.toFixed(1), 'dB | spread of fundamentals: open', spread(open).toFixed(1), 'box', spread(boxed).toFixed(1), 'dB')
    console.log('fundamental of each note, box against open plate, dB:', boxed.map((n, i) => (n.level - open[i].level).toFixed(0)).join(' '))
    expect(Math.max(...boxed.map((n) => Math.abs(n.cents)))).toBeLessThan(5)
    expect(gain).toBeGreaterThan(6)
    expect(spread(boxed)).toBeLessThan(spread(open) + 3)
    // The bottom note gains too: the air resonance is below it.
    expect(boxed[0].level - open[0].level).toBeGreaterThan(5)
  }, 400000)
})
