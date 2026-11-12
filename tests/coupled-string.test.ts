// Phase 3C.1: prototype of a vibrating string physically joined to one
// resonator (src/experimental/string). Two candidate strings are measured
// side by side: one described by its modes, one as a digital waveguide.
// Neither is used by the application or the builder.
import { describe, expect, test } from 'vitest'
import { ALUMINIUM_BAR, BRIDGE, cents, DEFAULT_LOSS, exactFrequencies, fundamental, GUITAR_A, metalBar, peakNear, runCoupled, stringModes, woodenBar, type Coupled, type Mode, type StringParams } from '../analysis/string-prototype'
import { decayRate, impedance, residualCompliance } from '../src/experimental/string/modalString'
import { amplitudeAt, createString, dB, spectralPeaks, SR } from './helpers'

const KINDS = ['modal', 'waveguide'] as const
const undamped = (modes: Mode[]) => modes.map((m) => ({ ...m, t60: Infinity }))
const nearest = (peaks: number[], f: number) => peaks.reduce((best, p) => (Math.abs(p - f) < Math.abs(best - f) ? p : best), Infinity)
const largest = (x: ArrayLike<number>, from = 0) => {
  let m = 0
  for (let i = from; i < x.length; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}
/** The same string retuned to a fundamental by changing its tension. */
const tunedTo = (f0: number, s: StringParams = GUITAR_A): StringParams => ({ ...s, tension: s.density * (2 * s.length * f0) ** 2 })
/** A bridge stiff enough to count as rigid for a string: its give is 1/8800 of the string's own. */
const STIFF = { stiffness: 1e6 }

describe('The string alone, on a rigid bridge', () => {
  const strings: [string, StringParams][] = [
    ['A2, the approved string (109.9 Hz)', GUITAR_A],
    ['the same fretted an octave up (219.8 Hz)', { ...GUITAR_A, length: GUITAR_A.length / 2 }],
    ['a heavier, lower string (82.4 Hz)', tunedTo(82.41, { ...GUITAR_A, density: 0.0064 })],
    ['a light, high string (329.6 Hz)', tunedTo(329.63, { ...GUITAR_A, density: 0.0004 })],
  ]

  test('pitch: every partial is where an ideal string puts it', () => {
    const report: Record<string, Record<string, string | number>> = {}
    for (const kind of KINDS) {
      for (const [name, string] of strings) {
        const f0 = fundamental(string)
        // Struck at a point that is not a node of any partial measured, so that all of them sound.
        const run = runCoupled({ string, loss: null, body: null, bridge: STIFF, kind, pluckAt: 0.837 }, 3, { impulseOnString: 0.001 })
        const peaks = spectralPeaks(run.bridgeForce, 131072, 80).map((p) => p.freq)
        const partials = [1, 2, 3, 5, 8, 12, 20, 30, 40].filter((n) => n * f0 < 0.4 * SR)
        const errors = partials.map((n) => cents(nearest(peaks, n * f0), n * f0))
        report[`${kind}: ${name}`] = { modes: run.modes || '-', fundamental_cents: errors[0].toFixed(2), worst_cents: errors.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)).toFixed(2), spread_cents: (Math.max(...errors) - Math.min(...errors)).toFixed(2) }
        // Within a cent, and the partials within half a cent of each other: it stays harmonic.
        for (const e of errors) expect(Math.abs(e), `${kind} ${name}`).toBeLessThan(1)
        // The waveguide's interpolated delay line is slightly dispersive towards high frequencies (as the approved string's is).
        expect(Math.max(...errors) - Math.min(...errors), `${kind} ${name}`).toBeLessThan(kind === 'modal' ? 0.3 : 1)
      }
    }
    console.table(report)
  })

  test('modal string: how many modes it needs, and what the stiff bridge costs in pitch', () => {
    // Too few modes raise the pitch; making up the residual compliance in the bridge spring removes that.
    const f0 = fundamental(GUITAR_A)
    const report: Record<string, Record<string, string>> = {}
    for (const count of [25, 50, 100, 197]) {
      const row: Record<string, string> = {}
      for (const compensate of [false, true]) {
        const stiffness = 1e6
        // What a bridge of this stiffness itself does to an ideal string: lowers it by T / (k L).
        const expected = f0 * (1 - GUITAR_A.tension / (stiffness * GUITAR_A.length))
        const run = runCoupled({ string: GUITAR_A, loss: null, body: null, bridge: { stiffness }, kind: 'modal', modes: count, compensate, pluckAt: 0.837 }, 3, { impulseOnString: 0.001 })
        const peaks = spectralPeaks(run.bridgeForce, 131072, 80).map((p) => p.freq)
        const errors = [1, 10].map((n) => cents(nearest(peaks, n * f0), n * expected))
        row[`${compensate ? 'compensated' : 'plain'} bridge spring: partial 1 / 10, cents`] = `${errors[0].toFixed(2)} / ${errors[1].toFixed(2)}`
        // A partial needs modes well above it: the tenth is not yet right with 25.
        if (compensate && count >= 50) errors.forEach((e) => expect(Math.abs(e), `${count} modes`).toBeLessThan(0.25))
      }
      row['residual compliance, % of the string\'s'] = ((100 * residualCompliance(GUITAR_A, stringModes(GUITAR_A, [1], SR, null, count), SR)) / (GUITAR_A.length / GUITAR_A.tension)).toFixed(3)
      report[`${count} modes (to ${Math.round((count - 0.5) * f0)} Hz)`] = row
    }
    console.table(report)
    expect(stringModes(GUITAR_A, [1], SR, null)).toHaveLength(197)
  })

  test('decay: each partial dies at the rate the approved string\'s loss law gives', () => {
    const f0 = fundamental(GUITAR_A)
    const report: Record<string, Record<string, string>> = {}
    for (const kind of KINDS) {
      const run = runCoupled({ string: GUITAR_A, loss: DEFAULT_LOSS, body: null, bridge: STIFF, kind }, 2.2, { impulseOnString: 0.001 })
      for (const n of [1, 5, 10, 20, 30]) {
        const f = n * f0
        const level = (from: number, to: number) => amplitudeAt(run.bridgeForce.subarray(from * SR, to * SR), f)
        // dB per second between two windows, as a rate.
        const span = n >= 20 ? [0.05, 0.25, 0.3] : [0.2, 0.6, 1.2]
        const measured = (Math.log(level(span[0], span[1]) / level(span[0] + span[2], span[1] + span[2])) / span[2])
        const expected = decayRate(DEFAULT_LOSS, f)
        report[`partial ${n} (${f.toFixed(0)} Hz)`] = { ...report[`partial ${n} (${f.toFixed(0)} Hz)`], 'law, 1/s': expected.toFixed(3), [`${kind}, 1/s`]: measured.toFixed(3), [`${kind} T60, s`]: (Math.log(1000) / measured).toFixed(2) }
        // The waveguide's loss filter follows the law only where it is gentle; see the report.
        expect(Math.abs(measured / expected - 1), `${kind} partial ${n}`).toBeLessThan(kind === 'modal' ? 0.03 : n <= 10 ? 0.06 : 0.6)
      }
    }
    console.table(report)
  })

  test('against the approved Faust string: same pitch, same decay, same balance of partials', async () => {
    const f0 = fundamental(GUITAR_A)
    // The approved string with its body switched off is the force at the bridge: the same quantity.
    const faust = (await createString({ body: 0 })).play(3)
    const report: Record<string, Record<string, string>> = {}
    const row = (name: string, x: Float32Array) => {
      const peaks = spectralPeaks(x, 131072, 70).map((p) => p.freq)
      const level = (n: number) => amplitudeAt(x.subarray(0.05 * SR, 0.45 * SR), n * f0)
      const rate = (n: number) => Math.log(amplitudeAt(x.subarray(0.2 * SR, 0.6 * SR), n * f0) / amplitudeAt(x.subarray(1.2 * SR, 1.6 * SR), n * f0))
      report[name] = {
        fundamental_Hz: nearest(peaks, f0).toFixed(3),
        // (Partials 5, 10, ... are absent: the pluck, a fifth of the way along, is at their node.)
        partial9_cents: cents(nearest(peaks, 9 * f0), 9 * f0).toFixed(2),
        'T60 of partial 1, s': (Math.log(1000) / rate(1)).toFixed(2),
        'T60 of partial 6, s': (Math.log(1000) / rate(6)).toFixed(2),
        'partials 2,3,4,6,8,12 relative to 1, dB': [2, 3, 4, 6, 8, 12].map((n) => dB(level(n) / level(1)).toFixed(1)).join(' '),
      }
      return { f: nearest(peaks, f0), t60: Math.log(1000) / rate(1), t606: Math.log(1000) / rate(6), balance: [2, 3, 4, 6, 8, 12].map((n) => dB(level(n) / level(1))) }
    }
    const reference = row('approved Faust string (body off)', faust)
    for (const kind of KINDS) {
      const run = runCoupled({ string: GUITAR_A, loss: DEFAULT_LOSS, body: null, bridge: STIFF, kind }, 3, { pluck: { force: 1 } })
      const mine = row(`${kind} prototype`, run.bridgeForce)
      expect(Math.abs(cents(mine.f, reference.f)), kind).toBeLessThan(1)
      expect(Math.abs(mine.t60 / reference.t60 - 1), kind).toBeLessThan(0.05)
      expect(Math.abs(mine.t606 / reference.t606 - 1), kind).toBeLessThan(0.1)
      mine.balance.forEach((level, i) => expect(Math.abs(level - reference.balance[i]), `${kind} partial balance ${i}`).toBeLessThan(1.5))
    }
    console.table(report)
  })
})

describe('The string joined to a resonator', () => {
  /** Bridge at the bar's end, where every mode moves most. */
  const bar = metalBar(SR, ALUMINIUM_BAR, 0)
  const lightBar = metalBar(SR, { ...ALUMINIUM_BAR, thickness: 3, width: 0.02 }, 0)

  test('coupled frequencies: every mode of string and bar together is where theory puts it', () => {
    const report: Record<string, Record<string, string | number>> = {}
    for (const kind of KINDS) {
      for (const [name, body, string] of [['aluminium bar, bridge 0.2 along', undamped(metalBar()), GUITAR_A], ['light bar, string tuned an octave below its first mode', undamped(lightBar), tunedTo(lightBar[0].frequency / 2)]] as const) {
        const exact = exactFrequencies(string, STIFF.stiffness, body, 4000)
        const run = runCoupled({ string, loss: null, body, bridge: STIFF, kind }, 3, { impulseOnString: 0.001, strikeBody: { impulse: 0.0005 } })
        const found = [...spectralPeaks(run.bridgeForce, 131072, 100), ...spectralPeaks(run.body, 131072, 100)].map((p) => p.freq)
        // Two modes a few hertz apart are one peak to the general finder: look closer where it is off.
        const measure = (f: number) => {
          const coarse = nearest(found, f)
          if (Math.abs(cents(coarse, f)) < 0.7) return coarse
          const fine = [peakNear(run.bridgeForce, f), peakNear(run.body, f)].filter((p) => !Number.isNaN(p))
          return fine.length ? nearest(fine, f) : coarse
        }
        const errors = exact.map((f) => Math.abs(cents(measure(f), f))).sort((a, b) => b - a)
        const shifted = exact.filter((f, i) => Math.abs(cents(f, (i + 1) * fundamental(string))) > 3).length
        report[`${kind}: ${name}`] = { modesBelow4kHz: exact.length, worst_cents: errors[0].toFixed(2), median_cents: errors[Math.floor(errors.length / 2)].toFixed(3), movedMoreThan3CentsByTheBar: shifted }
        expect(exact.length).toBeGreaterThan(30)
        expect(errors[0], `${kind} ${name}`).toBeLessThan(kind === 'modal' ? 1 : 0.5)
      }
    }
    console.table(report)
  })

  test('energy passes both ways through the bridge, and not at all without it', () => {
    // The string's second partial is tuned to the light bar's first mode: the case where exchange is strongest.
    const string = tunedTo(lightBar[0].frequency / 2)
    const report: Record<string, Record<string, string>> = {}
    for (const kind of KINDS) {
      const setup: Coupled = { string, loss: null, body: undamped(lightBar), bridge: STIFF, kind }
      // A pluck puts most of its energy into the low partials, as a finger does. Shares are of the
      // energy in the system at 0.3 s, when the plucking force has gone.
      const start = Math.round(0.3 * SR)
      const plucked = runCoupled(setup, 3, { pluck: { force: 1, cutoff: 1500 } })
      const struck = runCoupled(setup, 3, { strikeBody: { impulse: 0.01 } })
      const share = (part: Float64Array, run: typeof plucked) => largest(part, start) / run.energy[start]
      const toBar = share(plucked.energyBody, plucked)
      const toString = share(struck.energyString, struck)
      // With the bridge removed (no stiffness), nothing crosses.
      const apart = { ...setup, bridge: { stiffness: 0 } }
      const none = [largest(runCoupled(apart, 0.5, { pluck: { force: 1, cutoff: 1500 } }).energyBody), largest(runCoupled(apart, 0.5, { strikeBody: { impulse: 0.01 } }).energyString)]
      // When the bar's energy peaks, the string's has dropped by as much: it is the same energy.
      let peakAt = start
      for (let n = start; n < plucked.energyBody.length; n++) if (plucked.energyBody[n] > plucked.energyBody[peakAt]) peakAt = n
      report[kind] = {
        'string plucked: most of the energy the bar ever held': `${(100 * toBar).toFixed(1)} %`,
        'bar struck: most the string ever held': `${(100 * toString).toFixed(1)} %`,
        'string + bar at the bar\'s peak, of the total': `${(100 * (plucked.energyString[peakAt] + plucked.energyBody[peakAt]) / plucked.energy[peakAt]).toFixed(1)} %`,
        'without the bridge': `${none[0]} / ${none[1]}`,
      }
      expect(toBar, kind).toBeGreaterThan(0.1)
      expect(toString, kind).toBeGreaterThan(0.3)
      expect(none).toEqual([0, 0])
      expect(struck.bridgeForce.every(Number.isFinite) && plucked.body.every(Number.isFinite)).toBe(true)
    }
    console.table(report)
    // The heavy bar too, less dramatically: it is 140 times the string's mass.
    const heavy = runCoupled({ string: tunedTo(bar[0].frequency / 5), loss: null, body: undamped(bar), bridge: STIFF, kind: 'modal' }, 3, { strikeBody: { impulse: 0.01 } })
    expect(largest(heavy.energyString, 4800) / heavy.energy[4800]).toBeGreaterThan(0.3)
  })

  test('energy: the modal string and bar conserve it exactly; with losses it only falls', () => {
    const string = tunedTo(lightBar[0].frequency / 2)
    const free = runCoupled({ string, loss: null, body: undamped(lightBar), bridge: STIFF, kind: 'modal' }, 3, { impulseOnString: 0.001, strikeBody: { impulse: 0.002 } })
    let drift = 0
    for (let n = 100; n < free.energy.length; n++) drift = Math.max(drift, Math.abs(free.energy[n] / free.energy[100] - 1))
    const lossy = runCoupled({ string: GUITAR_A, loss: DEFAULT_LOSS, body: woodenBar(SR, 0), bridge: { stiffness: 1e6, damping: 2 }, kind: 'modal' }, 3, { impulseOnString: 0.001, strikeBody: { impulse: 0.002 } })
    let rises = 0
    for (let n = 100; n < lossy.energy.length; n++) if (lossy.energy[n] > lossy.energy[n - 1]) rises++
    console.log('modal string + bar, no losses: largest relative change of total energy over 3 s:', drift.toExponential(1), '| with losses: steps where energy rose:', rises, '| left after 3 s:', (lossy.energy.at(-1)! / lossy.energy[100]).toExponential(1))
    expect(drift).toBeLessThan(1e-9)
    expect(rises).toBe(0)
    expect(lossy.energy.at(-1)!).toBeLessThan(0.05 * lossy.energy[100])
  })

  test('energy: the waveguide is not exactly conservative, and by how much', () => {
    // Its delay line is read by interpolation, which is not lossless; and its energy can only be estimated.
    const report: Record<string, Record<string, string>> = {}
    for (const [name, excitation] of [['broadband impulse', { impulseOnString: 0.001 }], ['pluck (rounded)', { pluck: { force: 1, cutoff: 2500 } }]] as const) {
      const run = runCoupled({ string: tunedTo(lightBar[0].frequency / 2), loss: null, body: undamped(lightBar), bridge: STIFF, kind: 'waveguide' }, 3, excitation)
      const start = Math.round(0.3 * SR) // after the pluck force has relaxed
      let [rise, low] = [0, Infinity]
      for (let n = start; n < run.energy.length; n++) {
        rise = Math.max(rise, run.energy[n] - run.energy[n - 1])
        low = Math.min(low, run.energy[n])
      }
      report[name] = { 'energy after 3 s, of that at 0.3 s': `${(100 * run.energy.at(-1)! / run.energy[start]).toFixed(1)} %`, 'largest single-step rise, of the total': (rise / run.energy[start]).toExponential(1) }
      expect(run.energy.at(-1)!).toBeLessThanOrEqual(run.energy[start] * 1.001) // it never ends with more than it had
      expect(run.bridgeForce.every(Number.isFinite)).toBe(true)
    }
    console.table(report)
  })

  test('stability: bridges from very soft to absurdly stiff, light and heavy bodies, both strings', () => {
    const outcomes: Record<string, string> = {}
    for (const kind of KINDS) {
      for (const stiffness of [1e2, 1e4, 1e6, 1e8, 1e10, 1e12]) {
        for (const [name, body] of [['light bar', lightBar], ['heavy bar', bar], ['wooden bar', woodenBar(SR, 0)]] as const) {
          for (const damping of [0, 100]) {
            const run = runCoupled({ string: GUITAR_A, loss: DEFAULT_LOSS, body, bridge: { stiffness, damping }, kind }, 1.5, { pluck: { force: 5 }, strikeBody: { impulse: 0.02 } })
            const start = Math.round(0.3 * SR)
            let rise = 0
            for (let n = start; n < run.energy.length; n++) rise = Math.max(rise, run.energy[n] - run.energy[n - 1])
            const label = `${kind}, bridge ${stiffness.toExponential(0)} N/m`
            outcomes[label] = `${outcomes[label] ?? ''}${run.bridgeForce.every(Number.isFinite) && run.body.every(Number.isFinite) ? 'ok' : 'NOT FINITE'} `
            expect(run.bridgeForce.every(Number.isFinite) && run.body.every(Number.isFinite), `${label} ${name} c=${damping}`).toBe(true)
            expect(run.energy.at(-1)!, `${label} ${name} c=${damping}`).toBeLessThan(run.energy[start])
            // The modal string never gains energy, step by step; the waveguide's estimate may wobble slightly.
            if (kind === 'modal') expect(rise, `${label} ${name} c=${damping}`).toBeLessThanOrEqual(1e-9 * run.energy[start])
            expect(run.system.worstIterations).toBeLessThan(10) // linear: one solve; a few more only where rounding dominates
          }
        }
      }
    }
    console.table(outcomes)
  })

  test('the string feels the body: a body mode near a partial pulls that partial, as theory says', () => {
    // Partial 2 sits a few hertz below the light bar's first mode. Joined, both move apart.
    const string = tunedTo((lightBar[0].frequency - 4) / 2)
    const exact = exactFrequencies(string, STIFF.stiffness, undamped(lightBar), 400)
    const alone = [2 * fundamental(string), lightBar[0].frequency]
    const pair = exact.filter((f) => Math.abs(f - lightBar[0].frequency) < 30)
    expect(pair).toHaveLength(2)
    expect(pair[0]).toBeLessThan(alone[0])
    expect(pair[1]).toBeGreaterThan(alone[1])
    for (const kind of KINDS) {
      const run = runCoupled({ string, loss: null, body: undamped(lightBar), bridge: STIFF, kind }, 3, { impulseOnString: 0.001 })
      const measured = pair.map((f) => peakNear(run.body, f))
      console.log(`${kind}: partial 2 and bar mode alone ${alone.map((f) => f.toFixed(2)).join(' / ')} Hz; joined, theory ${pair.map((f) => f.toFixed(2)).join(' / ')}; measured ${measured.map((f) => f.toFixed(2)).join(' / ')}`)
      pair.forEach((f, i) => expect(Math.abs(cents(measured[i], f)), kind).toBeLessThan(1))
    }
    expect(impedance(GUITAR_A)).toBeCloseTo(Math.sqrt(73.5 * 0.0036), 12)
    expect(lightBar[0].shape[BRIDGE]).toBeCloseTo(2, 6)
  })
})
