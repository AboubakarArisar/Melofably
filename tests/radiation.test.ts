// Phase 3D.3: sound radiated by a bar as pressure at a listener
// (src/experimental/radiation/barRadiation.ts), a research prototype. Not
// used by the application or the builder; no instrument's sound depends on it.
import { describe, expect, test } from 'vitest'
import { fft, frequenciesOf, geometryOf, modalVelocities, partial, pointVelocities, pressureByPoints, pressureByTransfer, pressureByWeights, velocityOutput, withPorts, type Radiating } from '../analysis/radiation'
import { createWorklet } from '../analysis/worklet'
import { barModeShape } from '../src/audio/engine/physics'
import { EXAMPLES, STRING_EXAMPLES } from '../src/builder/examples'
import { addComponent, connect, emptyGraph, type Graph } from '../src/builder/graph'
import { instrumentCalls, OUTPUT_GAIN, translate } from '../src/builder/translate'
import { AIR_DENSITY, crossover, dipoleArea, freeBarShape, modeTransfer, radiatedPower, radiationWeights, size, SOUND_SPEED, type BarGeometry } from '../src/experimental/radiation/barRadiation'
import type { Call } from '../src/experimental/wasm/engine'
import { SR } from './helpers'

const dB = (ratio: number) => 20 * Math.log10(ratio)
const largest = (x: ArrayLike<number>) => {
  let m = 0
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}
const METAL: BarGeometry = { length: 0.3, width: 0.04, thickness: 0.01 }
/** Where these prototypes listen from: a metre from the bar's middle, 45 degrees off the line straight out from its face. */
const LISTENER = { distance: 1, angle: 45 }
const barOf = (graph: Graph) => graph.components.find((c) => c.type === 'metalBar' || c.type === 'woodBar')!
const metalBar = (seconds = 1.5): Radiating => ({ graph: EXAMPLES[0].make(), bar: barOf(EXAMPLES[0].make()), listener: LISTENER, seconds })
function woodenBar(seconds = 1): Radiating {
  const bar = addComponent(emptyGraph(), 'woodBar', 300, 300)
  const mallet = addComponent(bar.graph, 'mallet', 300, 100)
  const graph = connect(mallet.graph, mallet.id, bar.id).graph
  return { graph, bar: barOf(graph), listener: LISTENER, seconds }
}
const hybrid = (seconds = 2.5): Radiating => ({ graph: STRING_EXAMPLES[1].make(), bar: barOf(STRING_EXAMPLES[1].make()), listener: LISTENER, seconds, play: (calls: Call[]) => calls.slice(0, 1) })

describe('The radiation model', () => {
  test('dimensions and limits: a short rigid piece is the textbook dipole below the crossover and a piston in a wall above it', () => {
    // A piece 1 cm long moving as a whole (shape 1), heard from far away straight in front.
    const piece: BarGeometry = { ...METAL, length: 0.01 }
    const whole = () => 1
    const B = dipoleArea(piece)
    expect(B).toBeCloseTo(0.04 * 0.01 + (Math.PI * 0.04 ** 2) / 4, 12) // m^2: displaced air and dragged air, per metre
    const r = 200
    // Low frequency: p = rho B l w a / (4 pi c r), the far field of a small body pushing on the air with force rho B l a.
    const w = 2 * Math.PI * 100
    expect(size(modeTransfer(piece, { distance: r, angle: 0 }, whole, w)) / ((AIR_DENSITY * B * piece.length * w) / (4 * Math.PI * SOUND_SPEED * r))).toBeCloseTo(1, 2)
    // High frequency: p = rho (w l) a / (2 pi r), a piston of the piece's face area in a wall.
    const high = 2 * Math.PI * 200000
    expect(size(modeTransfer(piece, { distance: r, angle: 0 }, whole, high)) / ((AIR_DENSITY * piece.width * piece.length) / (2 * Math.PI * r))).toBeCloseTo(1, 2)
    // The two are equal at the crossover, by definition: 2636 Hz for this bar.
    expect(crossover(METAL)).toBeCloseTo((2 * 0.04 * SOUND_SPEED) / B / (2 * Math.PI), 9)
    expect(crossover(METAL)).toBeGreaterThan(2500)
    expect(crossover(METAL)).toBeLessThan(2800)
    // A dipole: cos(angle) to the side, nothing along its own plane, the same in front and behind.
    const at = (angle: number) => size(modeTransfer(piece, { distance: r, angle }, whole, w))
    expect(at(60) / at(0)).toBeCloseTo(0.5, 3)
    expect(at(90) / at(0)).toBeLessThan(1e-12)
    expect(at(180) / at(0)).toBeCloseTo(1, 9)
    // Far away, pressure falls as one over the distance.
    expect(size(modeTransfer(piece, { distance: 2 * r, angle: 0 }, whole, w)) / at(0)).toBeCloseTo(0.5, 3)
  })

  test('a free bar: its moving parts cancel straight in front, so there the sound falls off faster; to the side it does not', () => {
    const f = [582, 1603, 3143]
    // A free bar's modes move no net air and have no net momentum: the mean of each shape is zero.
    for (const n of [0, 1, 2, 3]) {
      let mean = 0
      for (let i = 0; i < 2000; i++) mean += barModeShape(n, (i + 0.5) / 2000) / 2000
      expect(Math.abs(mean)).toBeLessThan(1e-6)
    }
    const level = (n: number, distance: number, angle: number) => size(modeTransfer(METAL, { distance, angle }, freeBarShape(n), 2 * Math.PI * f[n]))
    // Straight in front, far away: 12 dB per doubling of distance for the symmetric modes (1 and 3), not 6.
    for (const n of [0, 2]) expect(dB(level(n, 16, 0) / level(n, 8, 0))).toBeCloseTo(-12, 0)
    // The antisymmetric mode (2) is not heard there at all: its two halves are equal and opposite and equally far.
    expect(level(1, 1, 0)).toBeLessThan(1e-12 * level(1, 1, 45))
    // To the side, the ordinary 6 dB per doubling, and far more sound.
    for (const n of [0, 1, 2]) expect(dB(level(n, 16, 45) / level(n, 8, 45))).toBeCloseTo(-6, 0)
    expect(dB(level(0, 1, 45) / level(0, 1, 0))).toBeGreaterThan(8)
    // The same to one side as to the other, with the antisymmetric mode's sign reversed.
    for (const n of [0, 1, 2]) expect(level(n, 1, -30) / level(n, 1, 30)).toBeCloseTo(1, 9)
    const [left, right] = [modeTransfer(METAL, { distance: 1, angle: -30 }, freeBarShape(1), 2 * Math.PI * f[1]), modeTransfer(METAL, { distance: 1, angle: 30 }, freeBarShape(1), 2 * Math.PI * f[1])]
    expect(left[0] / right[0]).toBeCloseTo(-1, 6)
    const direction = [0, 15, 30, 45, 60, 75].map((angle) => `${angle}: ${[0, 1, 2].map((n) => dB(level(n, 1, angle) / level(0, 1, 45)).toFixed(0)).join('/')}`)
    console.log('metal bar, modes 1/2/3 at 1 m by direction, dB re mode 1 at 45 degrees:', direction.join('  '))
  })

  test('what radiation would take from the bar: little for its low modes, so leaving it out of the mechanics is defensible there', () => {
    // Sound power far away does not depend on how far.
    const near = radiatedPower(METAL, freeBarShape(0), 582, 0.1, 20)
    expect(radiatedPower(METAL, freeBarShape(0), 582, 0.1, 40) / near).toBeCloseTo(1, 2)
    // Decay time radiation alone would give a mode: 13.8 E / P, with E = m V^2 / 2 (the mode's mass is the bar's).
    const mass = 2700 * METAL.length * METAL.width * METAL.thickness
    const report: Record<string, string> = {}
    const radiationT60 = (n: number, f: number) => (13.8 * 0.5 * mass * 0.01) / radiatedPower(METAL, freeBarShape(n), f, 0.1)
    const material = (f: number) => 1 / (1 / 6 + (0.001 * f) / 2.2) // the metal bar's approved decay law
    const modes: [number, number][] = [[0, 582], [1, 1603], [2, 3143]]
    for (const [n, f] of modes) report[`mode ${n + 1}, ${f} Hz`] = `material and supports ${material(f).toFixed(2)} s | radiation alone ${radiationT60(n, f).toFixed(0)} s`
    console.table(report)
    expect(radiationT60(0, 582)).toBeGreaterThan(100 * material(582))
    expect(radiationT60(1, 1603)).toBeGreaterThan(10 * material(1603))
    // By the third mode it is no longer negligible in this model: noted, not hidden.
    expect(radiationT60(2, 3143)).toBeLessThan(20 * material(3143))
  })
})

describe('A struck metal bar', () => {
  test('the probe ports give the bar\'s modes back: their sum at the strike point is the engine\'s own strike-point velocity', async () => {
    const o = metalBar(0.3)
    const recorded = await modalVelocities(o)
    const heard = await velocityOutput(o)
    const strikeAt = o.bar.params.strikePosition
    let worst = 0
    for (let i = 0; i < heard.length; i++) {
      let sum = 0
      recorded.modes.forEach((velocity, n) => (sum += barModeShape(n, strikeAt) * velocity[i]))
      worst = Math.max(worst, Math.abs(sum - heard[i]))
    }
    // To the precision of the 32-bit output it is compared with.
    expect(worst).toBeLessThan(1e-6 * largest(heard))
    expect(largest(heard)).toBeGreaterThan(0.1)
  })

  test('extra ports change nothing mechanical: the same velocity and the same energy, to the last bit, with them and without', async () => {
    const o = metalBar(1)
    const translation = translate(o.graph, SR)
    if (!translation.ok) throw new Error('does not translate')
    const plain = await createWorklet(translation.built.calls)
    plain.send(instrumentCalls(o.graph, translation.built))
    const energy: number[] = []
    const strike: number[] = []
    plain.render(SR, (block) => {
      if (block === 0) return
      energy.push(plain.engine.energy())
      strike.push(plain.engine.velocity(translation.built.bars[o.bar.id], 0))
    })
    const [weighted, probed] = [await pressureByWeights(o), await modalVelocities(o)]
    for (let i = 0; i < energy.length; i++) {
      expect(probed.energy[i]).toBe(energy[i])
      expect(probed.strikeVelocity[i]).toBe(Math.fround(strike[i]))
      expect(weighted.strikeVelocity[i]).toBe(Math.fround(strike[i]))
    }
    // The engine was told nothing about the air: energy only ever falls, as before.
    for (let i = 20; i < energy.length; i++) expect(energy[i]).toBeLessThanOrEqual(energy[i - 1])
  })

  test('pressure three ways from one vibration: each ringing mode agrees within half a decibel', async () => {
    const o = metalBar()
    const f = frequenciesOf(o.bar).slice(0, 4)
    const recorded = await modalVelocities(o)
    const reference = pressureByTransfer(recorded.modes, geometryOf(o.bar), LISTENER)
    const { pressure: byWeights } = await pressureByWeights(o)
    const { pressure: byPoints } = pressureByPoints(pointVelocities(recorded.modes, 16), geometryOf(o.bar), LISTENER)
    const velocity = await velocityOutput(o)
    const report: Record<string, Record<string, string>> = {}
    f.forEach((frequency, n) => {
      report[`mode ${n + 1}, ${frequency.toFixed(0)} Hz`] = {
        'velocity output, dB re mode 1': dB(partial(velocity, frequency) / partial(velocity, f[0])).toFixed(1),
        'pressure (reference), dB re mode 1': dB(partial(reference, frequency) / partial(reference, f[0])).toFixed(1),
        'one weight per mode, dB re reference': dB(partial(byWeights, frequency) / partial(reference, frequency)).toFixed(2),
        '16 points, dB re reference': dB(partial(byPoints, frequency) / partial(reference, frequency)).toFixed(2),
      }
      expect(Math.abs(dB(partial(byWeights, frequency) / partial(reference, frequency))), `one weight, mode ${n + 1}`).toBeLessThan(0.5)
      expect(Math.abs(dB(partial(byPoints, frequency) / partial(reference, frequency))), `16 points, mode ${n + 1}`).toBeLessThan(0.5)
    })
    console.table(report)
    console.log('peak at 1 m, 45 degrees: reference', largest(reference).toFixed(3), 'Pa | one weight', largest(byWeights).toFixed(3), 'Pa | 16 points', largest(byPoints).toFixed(3), 'Pa | velocity output', largest(velocity).toFixed(3), 'm/s')
    // Pressure favours the higher modes over the velocity output: sound goes as frequency times velocity or faster.
    expect(dB(partial(reference, f[1]) / partial(reference, f[0]))).toBeGreaterThan(dB(partial(velocity, f[1]) / partial(velocity, f[0])) + 6)
    // The attack is where one weight per mode falls short: during the mallet's contact the modes are being
    // driven at every frequency, not ringing at their own. The points keep it.
    expect(Math.abs(dB(largest(byPoints) / largest(reference)))).toBeLessThan(0.5)
    expect(dB(largest(byWeights) / largest(reference))).toBeLessThan(-0.5)
    expect(reference.every(Number.isFinite) && byWeights.every(Number.isFinite) && byPoints.every(Number.isFinite)).toBe(true)
  }, 400000)

  test('twice as far to the side is 6 dB less; the same run twice is the same samples', async () => {
    const o = metalBar(1)
    const f = frequenciesOf(o.bar).slice(0, 3)
    const recorded = await modalVelocities(o)
    const [near, far] = [pressureByTransfer(recorded.modes, geometryOf(o.bar), LISTENER), pressureByTransfer(recorded.modes, geometryOf(o.bar), { distance: 2, angle: 45 })]
    for (const frequency of f) expect(dB(partial(far, frequency) / partial(near, frequency))).toBeCloseTo(-6, 0)
    const [first, second] = [await pressureByWeights(o), await pressureByWeights(o)]
    expect(Array.from(second.pressure)).toEqual(Array.from(first.pressure))
    expect(Array.from(pressureByTransfer(recorded.modes, geometryOf(o.bar), LISTENER))).toEqual(Array.from(near))
  }, 400000)
})

describe('The same model for a wooden bar, and for a bar driven by a string', () => {
  test('a wooden bar: nothing but its size and its own modes differs; no filter was added to make it sound like wood', async () => {
    const o = woodenBar()
    const geometry = geometryOf(o.bar)
    // Wider and thicker than the metal bar: more air per metre, and a lower crossover.
    expect(dipoleArea(geometry)).toBeGreaterThan(dipoleArea(METAL))
    expect(crossover(geometry)).toBeLessThan(crossover(METAL))
    const f = frequenciesOf(o.bar)
    const recorded = await modalVelocities(o)
    const reference = pressureByTransfer(recorded.modes, geometry, LISTENER)
    const { pressure: byPoints } = pressureByPoints(pointVelocities(recorded.modes, 16), geometry, LISTENER)
    const velocity = await velocityOutput(o)
    console.log('wooden bar (0.38 m x 50 x 19 mm): modes', f.slice(0, 3).map((x) => x.toFixed(0)).join(' '), 'Hz | crossover', crossover(geometry).toFixed(0), 'Hz | velocity peak', largest(velocity).toFixed(3), 'm/s | pressure peak (reference)', largest(reference).toFixed(3), 'Pa, (16 points)', largest(byPoints).toFixed(3), 'Pa')
    // Its fundamental, which is all that lasts (the overtones of wood are gone in a tenth of a second).
    expect(Math.abs(dB(partial(byPoints, f[0]) / partial(reference, f[0])))).toBeLessThan(0.5)
    expect(Math.abs(dB(largest(byPoints) / largest(reference)))).toBeLessThan(1.5)
    expect(reference.every(Number.isFinite)).toBe(true)
    // The decay is the bar's own: radiation was not given a say in it.
    const t = (x: Float32Array) => partial(x, f[0], 24000) / partial(x, f[0], 4800)
    expect(t(reference) / t(velocity)).toBeCloseTo(1, 1)
  }, 400000)

  test('the hybrid: a bar driven off its own notes. One weight per mode is wrong there by tens of decibels; the points are not', async () => {
    const o = hybrid()
    const geometry = geometryOf(o.bar)
    const recorded = await modalVelocities(o)
    const reference = pressureByTransfer(recorded.modes, geometry, LISTENER)
    const { pressure: byWeights } = await pressureByWeights(o)
    const { pressure: byPoints } = pressureByPoints(pointVelocities(recorded.modes, 16), geometry, LISTENER)
    // The string's partials, as the bar hears them: 109.89 Hz and its multiples.
    const partials = [1, 2, 3, 4, 6].map((n) => n * 109.89)
    const report: Record<string, Record<string, string>> = {}
    partials.forEach((frequency) => {
      report[`${frequency.toFixed(0)} Hz`] = {
        'reference pressure, dB re 330 Hz': dB(partial(reference, frequency) / partial(reference, partials[2])).toFixed(1),
        'one weight per mode, dB re reference': dB(partial(byWeights, frequency) / partial(reference, frequency)).toFixed(1),
        '16 points, dB re reference': dB(partial(byPoints, frequency) / partial(reference, frequency)).toFixed(2),
      }
      expect(Math.abs(dB(partial(byPoints, frequency) / partial(reference, frequency))), `16 points at ${frequency}`).toBeLessThan(1)
    })
    console.table(report)
    // At the bar's own note (330 Hz, beside its 327 Hz mode) one weight is right; away from it, it is not.
    expect(Math.abs(dB(partial(byWeights, partials[2]) / partial(reference, partials[2])))).toBeLessThan(1)
    expect(dB(partial(byWeights, partials[0]) / partial(reference, partials[0]))).toBeGreaterThan(15)
    expect(dB(partial(byWeights, partials[4]) / partial(reference, partials[4]))).toBeLessThan(-15)
    // The string and the bar still exchange energy exactly as they did: listening changed nothing.
    const translation = translate(o.graph, SR)
    if (!translation.ok) throw new Error('does not translate')
    const plain = await createWorklet(translation.built.calls)
    plain.send(o.play!(instrumentCalls(o.graph, translation.built)))
    const energy: number[] = []
    plain.render(Math.round(o.seconds * SR), (block) => block > 0 && energy.push(plain.engine.energy()))
    for (let i = 0; i < energy.length; i++) expect(recorded.energy[i]).toBe(energy[i])
  }, 400000)

  test('several radiators: each bar has its own port, and their pressures add at one listener, in pascals', async () => {
    // Two bars joined by a spring (the builder's second example), both heard by the same listener.
    const graph = EXAMPLES[1].make()
    const translation = translate(graph, SR)
    if (!translation.ok) throw new Error('does not translate')
    const bars = graph.components.filter((c) => c.type === 'metalBar')
    const play = instrumentCalls(graph, translation.built)
    const pressureOf = async (which: number[]) => {
      let calls = translation.built.calls.filter((call) => call[0] !== 'addOutput')
      for (const b of which) {
        const weights = radiationWeights(geometryOf(bars[b]), LISTENER, frequenciesOf(bars[b]))
        const added = withPorts(calls, translation.built.bars[bars[b].id], [weights])
        calls = added.calls
        calls.splice(calls.findIndex((call) => call[0] === 'build'), 0, ['addOutput', translation.built.bars[bars[b].id], added.first, 1])
      }
      const worklet = await createWorklet([...calls, ['radiate', SR, 1, 0, 0, 16]])
      worklet.send(play)
      return worklet.render(SR).map((v) => v * 16)
    }
    const [first, second, both] = [await pressureOf([0]), await pressureOf([1]), await pressureOf([0, 1])]
    expect(largest(first)).toBeGreaterThan(0.01)
    expect(largest(second)).toBeGreaterThan(0.001) // the bar that was not struck sounds too, through the spring
    let worst = 0
    for (let i = 0; i < both.length; i++) worst = Math.max(worst, Math.abs(both[i] - (first[i] + second[i])))
    // One listener, one unit, one clock: the sum of the two is the two together.
    expect(worst).toBeLessThan(1e-5 * largest(both))
    void OUTPUT_GAIN
  })

  test('the spectrum tool used here is right: a known sine comes back with its amplitude', () => {
    const sine = (frequency: number) => Float64Array.from({ length: 65536 }, (_, i) => 0.25 * Math.sin((2 * Math.PI * frequency * i) / SR))
    // Exactly on one of the spectrum's frequencies (750 Hz is the 1024th): its amplitude, exactly.
    expect(partial(sine(750), 750, 0)).toBeCloseTo(0.25, 4)
    // Between two of them it reads low, by up to 1.4 dB (the window's doing). That is why levels here are
    // only ever compared as ratios at one frequency, where it cancels.
    const x = sine(1000)
    expect(dB(partial(x, 1000, 0) / 0.25)).toBeLessThanOrEqual(0)
    expect(dB(partial(x, 1000, 0) / 0.25)).toBeGreaterThan(-1.5)
    const [re, im] = [Float64Array.from(x), new Float64Array(x.length)]
    fft(re, im)
    fft(re, im, true)
    expect(Math.max(...Array.from(re, (v, i) => Math.abs(v - x[i])))).toBeLessThan(1e-12)
  })
})
