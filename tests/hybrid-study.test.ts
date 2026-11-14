// Phase 3D.5: why the radiated hybrid's pluck is so far below its mallet
// stroke, and two research candidates that are the same instrument with
// ordinary properties changed (src/experimental/radiation/hybridCandidates.ts).
// Nothing here is in the builder, and nothing boosts or filters a sound.
import { describe, expect, test } from 'vitest'
import { againstReference, bandShares, chain, levels, pitchNear, quick, radiationOf, withoutListener } from '../analysis/hybrid-study'
import { frequenciesOf, geometryOf } from '../analysis/radiation'
import { createWorklet } from '../analysis/worklet'
import { EXAMPLES, RADIATION_EXAMPLES, STRING_EXAMPLES } from '../src/builder/examples'
import { TYPES, validateGraph, type Graph } from '../src/builder/graph'
import { instrumentCalls, LISTENER_FULL_SCALE, OUTPUT_GAIN, translate } from '../src/builder/translate'
import { CANDIDATES, design, jointOf, part, SHARP_PLUCK, SOFT_MALLET } from '../src/experimental/radiation/hybridCandidates'
import { stringPitch } from '../src/experimental/string/stringBody'
import type { Call } from '../src/experimental/wasm/engine'
import { SR } from './helpers'

const F0 = stringPitch({ tension: 73.5, length: 0.65 })
const built = (graph: Graph) => {
  const translation = translate(graph, SR)
  if (!translation.ok) throw new Error(translation.issues[0].message)
  return translation.built
}
const sum = (x: ArrayLike<number>) => {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i]
  return s
}
const most = (x: ArrayLike<number>, from = 0) => {
  let m = -Infinity
  for (let i = from; i < x.length; i++) m = Math.max(m, x[i])
  return m
}
const least = (x: ArrayLike<number>, from = 0) => {
  let m = Infinity
  for (let i = from; i < x.length; i++) m = Math.min(m, x[i])
  return m
}

describe('Why the pluck is 42 dB below the stroke', () => {
  test('it is not the energy put in: the pluck puts in nearly three times what the mallet leaves behind', async () => {
    const [pluck, strike] = [await chain(design(), 'pluck', 3), await chain(design(), 'strike', 3)]
    // Pulled aside with 4 N and let go: about 20 mJ. The mallet arrives with 22.5 mJ and leaves with two thirds of it.
    expect(pluck.energyIn).toBeGreaterThan(0.019)
    expect(pluck.energyIn).toBeLessThan(0.022)
    expect(strike.malletThrown).toBeCloseTo(0.0225, 10)
    expect(strike.energyIn).toBeGreaterThan(0.0065)
    expect(strike.energyIn).toBeLessThan(0.008)
    expect(strike.energy.mallet.at(-1)!).toBeGreaterThan(0.014)
    // The sound: 41.6 dB apart in peak pressure, 41.7 dB in energy, and more, not less, as a meter hears it.
    const [lp, ls] = [levels(pluck.pressure), levels(strike.pressure)]
    expect(ls.peak_dB - lp.peak_dB).toBeGreaterThan(41)
    expect(ls.peak_dB - lp.peak_dB).toBeLessThan(42.2)
    expect(ls.sel_dB - lp.sel_dB).toBeGreaterThan(41)
    expect(ls.sel_dB - lp.sel_dB).toBeLessThan(42.5)
    expect(ls.lafMax_dB - lp.lafMax_dB).toBeGreaterThan(44.5) // measured 45.6: A-weighting favours the stroke's 3 kHz
    expect(ls.lafMax_dB - lp.lafMax_dB).toBeLessThan(46.5)
    expect(pluck.faults + strike.faults).toBe(0)
  }, 400000)

  test('the string keeps its energy: the bar never holds a tenth of it, and what it holds is in its lowest mode', async () => {
    const [pluck, strike] = [await chain(design(), 'pluck', 3), await chain(design(), 'strike', 3)]
    expect(pluck.barSharePeak).toBeLessThan(0.1)
    expect(pluck.barSharePeak).toBeGreaterThan(0.08)
    expect(most(pluck.energy.bar)).toBeLessThan(0.0008) // J, of 0.020 put in
    expect(most(strike.energy.bar)).toBeGreaterThan(0.007)
    // The joint: energy goes to and fro. Several times more crosses to the bar than ever stays there.
    expect(pluck.jointForward).toBeGreaterThan(4 * pluck.jointWorkPeak)
    expect(pluck.jointWorkPeak).toBeLessThan(0.001)
    const share = (c: typeof pluck, n: number) => c.modes[n].peakEnergy / sum(c.modes.map((m) => m.peakEnergy))
    // Plucked: 99.9 % of the bar's energy is in mode 1 (327 Hz, beside the string's third harmonic).
    expect(share(pluck, 0)).toBeGreaterThan(0.995)
    // Struck: most is in modes 2 and 4, which the string hardly reaches.
    expect(share(strike, 1)).toBeGreaterThan(0.5)
    expect(share(strike, 3)).toBeGreaterThan(0.05)
    expect(strike.modes[3].peakVelocity / pluck.modes[3].peakVelocity).toBeGreaterThan(100)
    // So the stroke's sound is nearly all between 2 and 5 kHz, and the pluck's is not.
    expect(bandShares(strike.pressure)[4]).toBeGreaterThan(0.9)
    expect(bandShares(pluck.pressure)[4]).toBeLessThan(0.4)
    expect(bandShares(pluck.velocity)[1]).toBeGreaterThan(0.99) // the bar's motion: 200 to 500 Hz
  }, 400000)

  test('the joint\'s work is accounted for: with no losses, what the joint has done on the bar is what the bar holds', async () => {
    const pluck = await chain(design(), 'pluck', 1.5, true)
    let worst = 0
    for (let b = 40; b < pluck.jointWork.length; b++) worst = Math.max(worst, Math.abs(pluck.jointWork[b] - pluck.energy.bar[b]))
    expect(worst / most(pluck.energy.bar)).toBeLessThan(0.01)
    expect(most(pluck.energy.bar)).toBeGreaterThan(0.0005)
  }, 400000)

  test('a narrow bar moving slowly moves air to and fro rather than sending sound out', () => {
    const bar = part(design(), 'metalBar')
    const g = geometryOf(bar)
    const f = frequenciesOf(bar)
    const atOwn = [0, 1, 2, 3].map((n) => radiationOf(g, n, f[n]))
    // Efficiency (sound power over that of a piston of the bar's face): mode 1 a few millionths, mode 4 a quarter.
    expect(atOwn[0].efficiency).toBeLessThan(1e-5)
    expect(atOwn[3].efficiency).toBeGreaterThan(0.1)
    for (let n = 1; n < 4; n++) expect(atOwn[n].pressurePerVelocity).toBeGreaterThan(3 * atOwn[n - 1].pressurePerVelocity)
    // At the bar's lowest note, 58 000 times more power sloshes in the air beside the bar than leaves as sound.
    expect(atOwn[0].reactiveOverRadiated).toBeGreaterThan(1e4)
    expect(atOwn[3].reactiveOverRadiated).toBeLessThan(10)
    // The string's own low harmonics are worse still: at 110 Hz the wavelength is 8 bar lengths and 78 bar widths.
    const low = radiationOf(g, 0, F0)
    expect(low.efficiency).toBeLessThan(1e-9)
    expect(low.wavelengthOverLength).toBeGreaterThan(7)
    expect(low.wavelengthOverWidth).toBeGreaterThan(70)
    // The lowest mode's shape gains about 20 dB of pressure per m/s for each doubling of frequency down here.
    const octave = 20 * Math.log10(radiationOf(g, 0, 2 * F0).pressurePerVelocity / low.pressurePerVelocity)
    expect(octave).toBeGreaterThan(18)
    expect(octave).toBeLessThan(22)
  })

  test('the gap is between a pluck and a hard, fast stroke: a soft mallet at 1 m/s is within 12 dB of the pluck', async () => {
    const [pluck, soft, hard] = [await quick(design(), 'pluck'), await quick(design({ mallet: SOFT_MALLET }), 'strike'), await quick(design(), 'strike')]
    expect(hard.levels.lafMax_dB - soft.levels.lafMax_dB).toBeGreaterThan(30) // measured 34.3
    expect(soft.levels.lafMax_dB - pluck.levels.lafMax_dB).toBeGreaterThan(8) // measured 11.3
    expect(soft.levels.lafMax_dB - pluck.levels.lafMax_dB).toBeLessThan(13)
  }, 400000)
})

describe('The candidates', () => {
  test('they are the experimental example with ordinary properties changed, inside the builder\'s ranges; no gain is touched', () => {
    expect(design()).toEqual(RADIATION_EXAMPLES[0].make())
    const example = built(design())
    for (const [name, d] of Object.entries(CANDIDATES)) {
      const graph = design(d)
      expect(validateGraph(graph), name).toEqual([])
      const bar = part(graph, 'metalBar')
      for (const spec of TYPES.metalBar.params) {
        expect(bar.params[spec.key]).toBeGreaterThanOrEqual(spec.min)
        expect(bar.params[spec.key]).toBeLessThanOrEqual(spec.max)
      }
      // Only the bar differs, and only in where the string is tied (and, for one, its length).
      const changed = Object.keys(bar.params).filter((key) => bar.params[key] !== part(design(), 'metalBar').params[key])
      expect(changed).toEqual(name === 'tuned' ? ['length', 'connectionPosition'] : ['connectionPosition'])
      for (const type of ['steelString', 'mallet', 'listener'] as const) expect(part(graph, type)).toEqual(part(design(), type))
      expect(jointOf(graph)).toEqual(jointOf(design()))
      const b = built(graph)
      // The same output gain, the same ceiling in pascals, the same pluck and the same stroke.
      expect(b.calls.filter((call) => call[0] === 'addOutput')).toEqual(example.calls.filter((call) => call[0] === 'addOutput'))
      expect(b.calls.find((call) => call[0] === 'addOutput')![3]).toBe(OUTPUT_GAIN)
      expect(b.calls.at(-1)![1]).toBe(LISTENER_FULL_SCALE)
      expect(instrumentCalls(graph, b)).toEqual(instrumentCalls(design(), example))
    }
    // The builder's examples: the six of Phase 3D.5 and the tuned candidate, added on approval in Phase 3D.5.1.
    expect([...EXAMPLES, ...STRING_EXAMPLES, ...RADIATION_EXAMPLES].map((x) => x.id)).toEqual(['single', 'coupled', 'mixed', 'string', 'string-bar', 'string-bar-pressure', 'string-bar-pressure-tuned'])
  })

  test('tying the string at the bar\'s end: the pluck is 14 dB louder, the stroke is the same, the string keeps its pitch', async () => {
    const [was, now] = [await chain(design(), 'pluck', 3), await chain(design(CANDIDATES.endTied), 'pluck', 3)]
    const gain = levels(now.pressure).lafMax_dB - levels(was.pressure).lafMax_dB
    expect(gain).toBeGreaterThan(13) // measured 14.4
    expect(gain).toBeLessThan(16)
    // Because the string now reaches the bar's higher modes: twenty times the motion of mode 3.
    expect(now.modes[2].peakVelocity / was.modes[2].peakVelocity).toBeGreaterThan(10)
    expect(Math.abs(1200 * Math.log2(pitchNear(now.stringVelocity, F0) / F0))).toBeLessThan(1.5) // cents; measured -0.77
    const [struckWas, struckNow] = [await quick(design(), 'strike'), await quick(design(CANDIDATES.endTied), 'strike')]
    expect(Math.abs(struckNow.levels.lafMax_dB - struckWas.levels.lafMax_dB)).toBeLessThan(0.5)
  }, 400000)

  test('and with the bar\'s modes on the string\'s harmonics: 25 dB louder, the gap to the stroke halved, pitch within 2 cents', async () => {
    const graph = design(CANDIDATES.tuned)
    const ratios = frequenciesOf(part(graph, 'metalBar')).map((f) => f / F0)
    // Modes 1, 3, 4 and 5 are at 2.02, 10.94, 18.08 and 27.01 times the string's pitch: beside harmonics 2, 11, 18 and 27.
    for (const [mode, harmonic, within] of [[0, 2, 0.013], [2, 11, 0.006], [3, 18, 0.005], [4, 27, 0.001]]) expect(Math.abs(ratios[mode] / harmonic - 1)).toBeLessThan(within)
    const [was, now, struck] = [await chain(design(), 'pluck', 3), await chain(graph, 'pluck', 3), await quick(graph, 'strike')]
    const [lw, ln] = [levels(was.pressure), levels(now.pressure)]
    expect(ln.lafMax_dB - lw.lafMax_dB).toBeGreaterThan(23) // measured 25.1
    expect(ln.peakPa).toBeGreaterThan(0.1) // Pa; was 0.0096
    expect(struck.levels.lafMax_dB - ln.lafMax_dB).toBeLessThan(23) // was 45.6
    expect(struck.levels.lafMax_dB - ln.lafMax_dB).toBeGreaterThan(19)
    expect(Math.abs(1200 * Math.log2(pitchNear(now.stringVelocity, F0) / F0))).toBeLessThan(2) // measured -1.36
    // The bar now takes a real share of the string's energy.
    expect(now.barSharePeak).toBeGreaterThan(0.25)
  }, 400000)

  test('the tuned candidate depends on its tuning, and falls back to the end-tied level when it is off', async () => {
    const at = async (tension: number) => (await quick(design({ ...CANDIDATES.tuned, string: { tension } }), 'pluck', 2.5)).levels.lafMax_dB
    const tuned = await at(73.5)
    // Half a newton either way (12 cents): within 3 dB. Measured 60.1 to 65.3 dB from 73.0 to 74.5 N.
    for (const tension of [73, 74]) expect(Math.abs((await at(tension)) - tuned)).toBeLessThan(5)
    // Two newtons off (47 cents), it has lost 9 to 12 dB and is where the end-tied candidate is.
    for (const tension of [71.5, 75.5]) {
      const off = await at(tension)
      expect(tuned - off).toBeGreaterThan(7)
      expect(off).toBeGreaterThan(50)
    }
  }, 400000)

  test('played differently: a sharper pluck is 3 dB louder, and a soft mallet is then quieter than the pluck', async () => {
    const graph = (d = {}) => design({ ...CANDIDATES.tuned, ...d })
    const [pluck, sharp, soft] = [await quick(graph(), 'pluck'), await quick(graph({ string: SHARP_PLUCK }), 'pluck'), await quick(graph({ mallet: SOFT_MALLET }), 'strike')]
    expect(sharp.levels.lafMax_dB - pluck.levels.lafMax_dB).toBeGreaterThan(2.5) // measured 3.5
    expect(sharp.levels.lafMax_dB - pluck.levels.lafMax_dB).toBeLessThan(5)
    expect(soft.levels.lafMax_dB).toBeLessThan(pluck.levels.lafMax_dB - 10) // measured 14.1 below
  }, 400000)
})

describe('Every candidate is still honest mechanics', () => {
  const all = Object.entries({ example: {}, ...CANDIDATES })

  test('with no losses, energy is kept to a part in a billion, plucked and struck', async () => {
    for (const [name, d] of all) {
      for (const playing of ['pluck', 'strike'] as const) {
        const c = await chain(design(d), playing, 2.5, true)
        // From 0.3 s: the pluck's force has gone (0.2 s) and the mallet has left.
        const from = Math.ceil((0.3 * SR) / 128)
        const [high, low] = [most(c.energy.total, from), least(c.energy.total, from)]
        expect((high - low) / high, `${name}, ${playing}`).toBeLessThan(1e-9)
        expect(high).toBeGreaterThan(0.005)
        expect(c.faults).toBe(0)
        expect(c.worstIterations).toBeLessThanOrEqual(4)
      }
    }
  }, 400000)

  test('with losses, every joule that goes is one the engine counted as dissipated, and none appears: also with a damper in the joint', async () => {
    for (const [name, d] of [...all, ['tuned, joint damper 10 N s/m', { ...CANDIDATES.tuned, joint: { damping: 10 } }]] as const) {
      const graph = design(d)
      const b = built(graph)
      const worklet = await createWorklet(b.calls)
      worklet.send(instrumentCalls(graph, b)) // plucked and struck together
      worklet.render(Math.round(0.3 * SR))
      const engine = worklet.engine
      const start = engine.energy()
      let [lost, previous, rises] = [0, start, 0]
      for (let i = 0; i < SR; i++) {
        worklet.render(1)
        lost += engine.dissipated()
        const now = engine.energy()
        if (now > previous * (1 + 1e-12)) rises++
        previous = now
      }
      expect(rises, name).toBe(0)
      expect(start - previous, name).toBeGreaterThan(0.001) // J lost in a second
      expect(Math.abs(start - previous - lost) / (start - previous), name).toBeLessThan(1e-6)
      expect(engine.faults()).toBe(0)
    }
  }, 400000)

  test('the same playing gives the same samples, and the radiator on these bars is within half a decibel of the reference', async () => {
    for (const [name, d] of Object.entries(CANDIDATES)) {
      const graph = design(d)
      const [a, b] = [await quick(graph, 'pluck', 1), await quick(graph, 'pluck', 1)]
      expect(Array.from(a.pressure), name).toEqual(Array.from(b.pressure))
      for (const playing of ['pluck', 'strike'] as const) {
        const v = await againstReference(graph, playing, 2.5)
        const [realTime, reference] = [levels(v.realTime), levels(v.references[0])]
        // Measured: -0.17 to -0.30 dB in sound energy, -0.2 to -0.4 dB in peak.
        expect(Math.abs(realTime.sel_dB - reference.sel_dB), `${name}, ${playing}`).toBeLessThan(0.5)
        expect(Math.abs(realTime.peak_dB - reference.peak_dB), `${name}, ${playing}`).toBeLessThan(0.6)
      }
    }
  }, 400000)

  test('played hard and fast for five seconds: no fault, nothing at the ceiling, and it dies away', async () => {
    for (const [name, d] of Object.entries(CANDIDATES)) {
      const graph = design({ ...d, string: { pluckStrength: 8, ...SHARP_PLUCK }, mallet: { velocity: 5, mass: 0.5 } })
      const b = built(graph)
      const play = instrumentCalls(graph, b)
      const worklet = await createWorklet(b.calls)
      const out = worklet.render(5 * SR, (block) => block % 37 === 0 && worklet.send([play[(block / 37) % 2] as Call]))
      const ringing = worklet.engine.energy() - worklet.engine.resonatorEnergy(3)
      worklet.render(3 * SR)
      expect(worklet.engine.faults(), name).toBe(0)
      expect(out.every(Number.isFinite)).toBe(true)
      expect(most(out.map(Math.abs))).toBeLessThan(1)
      expect(most(out.map(Math.abs))).toBeGreaterThan(0.05)
      expect(worklet.engine.energy() - worklet.engine.resonatorEnergy(3)).toBeLessThan(0.2 * ringing)
      expect(worklet.engine.worstIterations()).toBeLessThanOrEqual(6)
    }
  }, 400000)

  test('without the listener each candidate is an ordinary hybrid, heard as the bar\'s velocity', () => {
    for (const d of Object.values(CANDIDATES)) {
      const b = built(withoutListener(design(d)))
      expect(b.output).toBe('velocity')
      expect(b.calls.some((call) => call[0] === 'addTap' || call[0] === 'radiator')).toBe(false)
    }
  })
})
