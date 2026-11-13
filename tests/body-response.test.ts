// Phase 3C.2.3: why the enclosed box boomed at 140 Hz, and the box with that
// resonance under control (DAMPED_BOX in analysis/soundboard.ts). Uses the
// frequency-domain model of src/experimental/string/bodyResponse.ts, checked
// here against the engine. Isolated: not used by the application or builder.
import { describe, expect, test } from 'vitest'
import { DAMPED_BOX, ENCLOSED, onSoundboard, perform, pluckOne, REFINED, soundOf, type OnBoard, type StringParams } from '../analysis/soundboard'
import { airCavity, enclosedCorner } from '../src/experimental/string/airCavity'
import { bodyResponse, pullCents, size } from '../src/experimental/string/bodyResponse'
import { plateFrequency } from '../src/experimental/string/soundboard'
import { unbaffledCorner } from '../src/experimental/string/soundboardRefined'
import { powerSpectrum, SR } from './helpers'

const N = 65536
const tunedTo = (f0: number, density: number): StringParams => ({ length: 0.65, density, tension: density * (2 * 0.65 * f0) ** 2 })
const note = (i: number) => 110 * 2 ** ((i - 5) / 12) // 0: E2 ... 24: E4
const stringFor = (f0: number) => tunedTo(f0, 0.0036 * (110 / f0) ** 1.5)
const waveImpedance = (f0: number) => 0.0036 * (110 / f0) ** 1.5 * 2 * 0.65 * f0
const dB = (power: number) => 10 * Math.log10(power)
const mean = (x: number[]) => x.reduce((a, b) => a + b) / x.length

/** Level (dB, arbitrary reference) of the sound a unit force at the bridge makes at `f`, by theory. */
function theory(o: OnBoard) {
  const setup = onSoundboard({ ...o, strings: [stringFor(110)] })
  const corner = enclosedCorner(setup.area)
  const open = unbaffledCorner(setup.area)
  // The magnitudes of enclosed() and unbaffled().
  const radiation = (f: number) => (setup.air ? Math.hypot(f, corner / Math.SQRT2) / Math.hypot(f, corner * Math.SQRT2) : setup.unbaffled ? f / Math.hypot(f, open) : 1)
  const at = (f: number) => bodyResponse(setup.instrument.body, 0, setup.radiation, f, setup.instrument.air)
  return { level: (f: number) => 20 * Math.log10(size(at(f).flow) * f * radiation(f)), pull: (f0: number) => pullCents(waveImpedance(f0), at(f0).bridge), setup }
}
/** The same from the engine: pluck a string tuned to note i, measure its fundamental in the sound. */
function played(o: OnBoard, i: number) {
  const f0 = note(i)
  const setup = onSoundboard({ ...o, strings: [stringFor(f0)] })
  const sound = soundOf(setup, pluckOne(setup.instrument, 0, 2.2))
  const spec = powerSpectrum(sound, Math.round(0.2 * SR), N)
  let best = Math.floor((0.93 * f0 * N) / SR)
  for (let k = best; k <= Math.ceil((1.07 * f0 * N) / SR); k++) if (spec[k] > spec[best]) best = k
  const [a, b, c] = [Math.log(spec[best - 1]), Math.log(spec[best]), Math.log(spec[best + 1])]
  const window = Math.round(SR / f0)
  const envelope: number[] = []
  for (let n = 0; n + window <= SR; n += 48) {
    let sum = 0
    for (let j = n; j < n + window; j++) sum += sound[j] * sound[j]
    envelope.push(sum)
  }
  return { cents: 1200 * Math.log2(((best + (0.5 * (a - c)) / (a - 2 * b + c)) * SR) / N / f0), level: dB(spec[best]), loudestAtMs: envelope.indexOf(Math.max(...envelope)) }
}
const everySemitone = (o: OnBoard) => Array.from({ length: 25 }, (_, i) => played(o, i))
/** How far a note's fundamental stands above the mean of the notes three semitones either side, largest over the range. */
function amplification(levels: number[]) {
  let most = -Infinity
  for (let i = 3; i < levels.length - 3; i++) most = Math.max(most, levels[i] - (levels[i - 3] + levels[i + 3]) / 2)
  return most
}
const largestStep = (levels: number[]) => Math.max(...levels.slice(1).map((l, i) => Math.abs(l - levels[i])))
const spread = (levels: number[]) => Math.max(...levels) - Math.min(...levels)

describe('The body at one frequency, by theory', () => {
  test('agrees with the engine: level of each note\'s fundamental, and how far each note is pulled', () => {
    for (const [name, o] of [['open plate', REFINED], ['box', ENCLOSED], ['damped box', DAMPED_BOX]] as const) {
      const model = theory(o)
      // Notes away from the sharp resonances, where a string no longer acts as a steady force.
      const notes = [0, 5, 7, 12, 15, 18, 21]
      const engine = notes.map((i) => played(o, i))
      const offset = mean(engine.map((e, k) => e.level - model.level(note(notes[k]))))
      engine.forEach((e, k) => {
        expect(Math.abs(e.level - model.level(note(notes[k])) - offset), `${name}, note ${notes[k]}: level`).toBeLessThan(1.5)
        // The engine's string is a little flat of its nominal pitch on any bridge (its spring); allow for that.
        expect(Math.abs(e.cents - model.pull(note(notes[k])) + 0.4), `${name}, note ${notes[k]}: pitch`).toBeLessThan(1)
      })
    }
  }, 400000)

  test('the 140 Hz peak taken apart: plate, air spring, air in the hole', () => {
    const plate = REFINED.plate!
    const peakNear = (o: OnBoard, low: number, high: number) => {
      const model = theory(o)
      let best = low
      for (let f = low; f <= high; f += 0.1) if (model.level(f) > model.level(best)) best = f
      return best
    }
    const box = airCavity(plate, ENCLOSED.cavity!)
    // 1. The plate alone: its lowest mode.
    expect(peakNear(REFINED, 80, 120)).toBeCloseTo(plateFrequency(plate, 1, 1), 0)
    // 2. On the air of a box with the hole all but shut: stiffer, so higher. (One mode's estimate: 118 Hz.)
    const shut = peakNear({ ...REFINED, cavity: { ...ENCLOSED.cavity!, holeRadius: 0.0005 } }, 100, 135)
    expect(Math.abs(shut - box.bodyResonance)).toBeLessThan(2)
    // 3. With the hole: the air in it is a second mass, and the pair has two resonances, one below
    //    the Helmholtz frequency and one above the shut-box resonance.
    const [lower, upper] = [peakNear(ENCLOSED, 50, 100), peakNear(ENCLOSED, 120, 170)]
    expect(lower).toBeLessThan(box.helmholtz)
    expect(upper).toBeGreaterThan(shut + 15)
    expect(Math.abs(upper - 140)).toBeLessThan(3)
    // 4. Why it is loud there: above the Helmholtz frequency the hole's flow adds to the plate's.
    //    Total flow / plate flow = w^2 / (w^2 - wH^2).
    expect(upper ** 2 / (upper ** 2 - box.helmholtz ** 2)).toBeGreaterThan(2)
    // 5. Damping: without the radiation damper the peak is higher, but only by a few dB: it is not what sets the boom.
    const top = (o: OnBoard) => { const m = theory(o); return m.level(peakNear(o, 120, 170)) }
    const withoutRadiation = top({ ...REFINED, cavity: { ...ENCLOSED.cavity!, noRadiationLoss: true } }) - top(ENCLOSED)
    expect(withoutRadiation).toBeGreaterThan(2)
    expect(withoutRadiation).toBeLessThan(12)
    console.log('plate alone', plateFrequency(plate, 1, 1).toFixed(1), '| hole shut', shut.toFixed(1), '| with hole', lower.toFixed(1), 'and', upper.toFixed(1), '| Helmholtz', box.helmholtz.toFixed(1), '| radiation damper lowers the peak by', withoutRadiation.toFixed(1), 'dB')
  })

  test('a screen over the hole takes the resonance down; the bridge on a nodal line never drives mode (1,3)', () => {
    const fine = (o: OnBoard) => {
      const model = theory(o)
      let most = -Infinity
      for (let f = 78; f <= 340; f *= 2 ** (1 / 240)) most = Math.max(most, model.level(f) - (model.level(f * 2 ** 0.25) + model.level(f / 2 ** 0.25)) / 2)
      return most
    }
    // Largest rise of the response above its surroundings three semitones away, anywhere from 78 to 340 Hz.
    expect(fine(REFINED)).toBeGreaterThan(20)
    expect(fine(ENCLOSED)).toBeGreaterThan(20)
    expect(fine(DAMPED_BOX)).toBeLessThan(5)
    // The screen alone leaves the 332 Hz mode; the bridge position alone leaves the 140 Hz one.
    expect(fine({ ...ENCLOSED, cavity: { ...ENCLOSED.cavity!, holeScreen: 100 } })).toBeGreaterThan(20)
    expect(fine({ ...ENCLOSED, bridgeAt: [0.08, 1 / 3] })).toBeGreaterThan(12)
    // sin(3 pi y) at y = 1/3.
    const body = onSoundboard(DAMPED_BOX).instrument.body
    const f13 = plateFrequency(REFINED.plate!, 1, 3)
    expect(Math.abs(body.find((m) => m.frequency === f13)!.shape[0])).toBeLessThan(1e-12)
  })
})

describe('The damped box in the engine', () => {
  test('every semitone from E2 to E4: in tune, no booming note, still stronger than the open plate', () => {
    const [open, box, damped] = [everySemitone(REFINED), everySemitone(ENCLOSED), everySemitone(DAMPED_BOX)]
    const levels = (notes: typeof open) => notes.map((n) => n.level)
    console.table({
      'refined open plate': { 'worst pitch, cents': Math.max(...open.map((n) => Math.abs(n.cents))).toFixed(1), 'mean fundamental, dB': 0, spread: spread(levels(open)).toFixed(1), 'largest step': largestStep(levels(open)).toFixed(1), amplification: amplification(levels(open)).toFixed(1) },
      'box of Phase 3C.2.2': { 'worst pitch, cents': Math.max(...box.map((n) => Math.abs(n.cents))).toFixed(1), 'mean fundamental, dB': (mean(levels(box)) - mean(levels(open))).toFixed(1), spread: spread(levels(box)).toFixed(1), 'largest step': largestStep(levels(box)).toFixed(1), amplification: amplification(levels(box)).toFixed(1) },
      'damped box': { 'worst pitch, cents': Math.max(...damped.map((n) => Math.abs(n.cents))).toFixed(1), 'mean fundamental, dB': (mean(levels(damped)) - mean(levels(open))).toFixed(1), spread: spread(levels(damped)).toFixed(1), 'largest step': largestStep(levels(damped)).toFixed(1), amplification: amplification(levels(damped)).toFixed(1) },
    })
    expect(Math.max(...damped.map((n) => Math.abs(n.cents)))).toBeLessThan(3.5)
    // No note's fundamental more than 5 dB from its neighbour's; before, 13 dB.
    expect(largestStep(levels(box))).toBeGreaterThan(10)
    expect(largestStep(levels(damped))).toBeLessThan(5)
    expect(amplification(levels(box))).toBeGreaterThan(10)
    expect(amplification(levels(damped))).toBeLessThan(5)
    expect(spread(levels(damped))).toBeLessThan(spread(levels(open)) - 3)
    // The price: less of the bass gain is kept.
    const gain = mean(levels(damped)) - mean(levels(open))
    expect(gain).toBeGreaterThan(3)
    expect(gain).toBeLessThan(mean(levels(box)) - mean(levels(open)))
    // Notes that take more than 60 ms to reach their loudest: one (a harmonic on a mode), against several before.
    expect(damped.filter((n) => n.loudestAtMs > 60).length).toBeLessThanOrEqual(1)
    expect(box.filter((n) => n.loudestAtMs > 60).length).toBeGreaterThan(2)
  }, 600000)

  test('energy and stability: nothing is created, and with losses energy only falls', () => {
    const after = Math.round(0.3 * SR)
    const free = onSoundboard({ ...DAMPED_BOX, strings: [stringFor(110)], loss: null, lossless: true })
    const plucked = perform(free.instrument, 2, { plucks: [{ time: 0 }] })
    let drift = 0
    for (let n = after; n < plucked.energy.length; n++) drift = Math.max(drift, Math.abs(plucked.energy[n] / plucked.energy[after] - 1))
    expect(drift).toBeLessThan(1e-6)
    for (const strings of [[stringFor(110)], [110, 146.83, 196].map(stringFor), [82.41, 110, 146.83, 196, 246.94, 329.63].map(stringFor)]) {
      const setup = onSoundboard({ ...DAMPED_BOX, strings })
      const rec = perform(setup.instrument, 2, { plucks: strings.map((_, i) => ({ time: 0.01 * i, string: i, force: 10 })), strikes: [{ time: 0.05, port: 0, impulse: 0.05 }] })
      let rise = 0
      for (let n = after + 1; n < rec.energy.length; n++) rise = Math.max(rise, rec.energy[n] - rec.energy[n - 1])
      expect(rise, `${strings.length} strings`).toBeLessThanOrEqual(1e-9 * rec.energy[after])
      expect(rec.engine.faults()).toBe(0)
      expect(rec.energy.at(-1)!).toBeLessThan(rec.energy[after])
      expect(soundOf(setup, rec.output).every(Number.isFinite)).toBe(true)
    }
  }, 600000)
})
