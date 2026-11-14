// Phase 3D.1: playing the string instrument. Retrigger and additive plucks,
// a finger that touches, damps, mutes and lets go, and a finger that pulls
// the string aside and releases it. Everything goes through what the browser
// uses: the builder's graph, translation and Session, and the AudioWorklet
// processor file itself (analysis/worklet.ts).
import { describe, expect, test } from 'vitest'
import { createEngine, render as renderEngine, run } from '../analysis/wasm'
import { createWorklet, type Worklet } from '../analysis/worklet'
import { EXAMPLES, STRING_EXAMPLES } from '../src/builder/examples'
import { commit, deserialize, redo, restore, serialize, setParam, startHistory, TYPES, undo, validateGraph, type Graph } from '../src/builder/graph'
import { Session, type Backend } from '../src/builder/session'
import { playPoint, PULL_LIMIT, PULL_SCALE, rectSize, STRING_GRIP } from '../src/builder/shapes'
import { instrumentCalls, PRESSURE_FULL_SCALE, structureKey, translate } from '../src/builder/translate'
import { pickCutoff } from '../src/experimental/string/modalString'
import { buildPlayableStringBody, buildStringBody, fingerDamping, pluckCall, PLUCK_SECONDS, pullForce, radiation, RETRIGGER, STRING_DENSITY, type StringBody } from '../src/experimental/string/stringBody'
import type { Call } from '../src/experimental/wasm/engine'
import { powerSpectrum, SR } from './helpers'

const example = () => STRING_EXAMPLES[0].make()
const stringOf = (graph: Graph) => graph.components.find((c) => c.type === 'steelString')!
const withParams = (params: Record<string, number>, graph = example()) => Object.entries(params).reduce((g, [key, value]) => setParam(g, stringOf(g).id, key, value), graph)
const DEFAULT: StringBody = { tension: 73.5, length: 0.65, pluckAt: 0.8, joined: true }
const TOUCH_SAMPLES = Math.round((RETRIGGER.arrive + RETRIGGER.rest + RETRIGGER.leave) * SR)
const largest = (x: ArrayLike<number>, from = 0, to = x.length) => {
  let m = 0
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}
const largestStep = (x: ArrayLike<number>, from = 1, to = x.length) => {
  let m = 0
  for (let i = Math.max(1, from); i < to; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]))
  return m
}
/** Energy of (a - b) against the energy of b, dB, over the first `count` samples. */
function difference(a: ArrayLike<number>, b: ArrayLike<number>, count: number, offsetA = 0, offsetB = 0) {
  let [d, ref] = [0, 0]
  for (let n = 0; n < count; n++) {
    d += (a[n + offsetA] - b[n + offsetB]) ** 2
    ref += b[n + offsetB] ** 2
  }
  return 10 * Math.log10(d / ref)
}
/** Level of harmonic n of 109.9 Hz in dB, from `from` samples on. */
function harmonic(x: Float32Array, n: number, from = 9600) {
  const N = 65536
  const spec = powerSpectrum(x, from, N)
  let m = 0
  for (let k = Math.floor((0.97 * n * 109.9 * N) / SR); k <= Math.ceil((1.03 * n * 109.9 * N) / SR); k++) m = Math.max(m, spec[k])
  return 10 * Math.log10(m)
}

class NodeBackend implements Backend {
  worklet!: Worklet
  async open() {
    this.worklet = await createWorklet([['reset', SR, 2], ['build']])
    return { sampleRate: SR, send: (calls: Call[]) => this.worklet.send(calls), rebuild: (calls: Call[]) => this.worklet.send(calls), close: async () => {} }
  }
  /** Sound pressure in pascals for the next `seconds`; `each` runs before every block of 128 samples. */
  pascals(seconds: number, each?: (block: number) => void) {
    return this.worklet.render(Math.round(seconds * SR), each).map((v) => v * PRESSURE_FULL_SCALE)
  }
  get engine() {
    return this.worklet.engine
  }
}
async function playing(graph: Graph = example()) {
  const backend = new NodeBackend()
  const session = new Session(backend)
  await session.start(graph)
  return { backend, session }
}
/** One approved pluck of a fresh instrument: the reference every behaviour is compared with. */
async function approvedPluck(seconds = 2, graph: Graph = example()) {
  const { backend, session } = await playing(graph)
  session.play()
  return backend.pascals(seconds)
}
/** Counts the blocks in which the system's energy is higher than in the block before. */
function energyRises(backend: NodeBackend) {
  let previous = backend.engine.energy()
  let rises = 0
  return {
    watch: () => {
      const energy = backend.engine.energy()
      if (energy > previous * (1 + 1e-12) + 1e-18) rises++
      previous = energy
    },
    get count() {
      return rises
    },
  }
}

describe('The approved sound is still what plays when nothing new is asked for', () => {
  test('the string keeps its approved pluck as its starting values, and the builder sends the approved call', () => {
    const string = stringOf(example())
    expect(string.params).toMatchObject({ pluckSoftness: 0.3, retrigger: 0, pluckStrength: 2, pluckPosition: 0.8, tension: 73.5, length: 0.65 })
    const translation = translate(example(), SR)
    if (!translation.ok) throw new Error('the example does not translate')
    // Resonator, port, 2 N, the approved string's pick cutoff, 0.2 s, at once.
    expect(instrumentCalls(example(), translation.built)).toEqual([['pluck', translation.built.stringBody!.string, 1, 2, pickCutoff(), PLUCK_SECONDS, 0]])
  })

  test('with the finger off, the playable instrument is the Phase 3C.3 reference: the same samples', async () => {
    const r = radiation(SR)
    const sounds: Float32Array[] = []
    for (const built of [buildStringBody(DEFAULT, SR), buildPlayableStringBody(DEFAULT, SR)]) {
      const worklet = await createWorklet([...built.calls, ['radiate', r.perSample, r.b0, r.b1, r.a1, 1]])
      worklet.send([pluckCall(built, 2)])
      sounds.push(worklet.render(3 * SR))
    }
    let worst = 0
    for (let n = 0; n < sounds[0].length; n++) worst = Math.max(worst, Math.abs(sounds[0][n] - sounds[1][n]))
    console.log('playable instrument, finger off, against the Phase 3C.3 reference: largest difference', worst.toExponential(1), 'Pa of a peak of', largest(sounds[0]).toFixed(4), 'Pa')
    expect(worst).toBeLessThan(1e-12 * largest(sounds[0]))
  })

  test('a touch that has come and gone leaves no trace: the next note is the approved note', async () => {
    const reference = await approvedPluck(1)
    const { backend, session } = await playing()
    expect(session.touch(true)).toBe(true)
    backend.pascals(0.2)
    session.touch(false)
    backend.pascals(0.1)
    session.play()
    const after = backend.pascals(1)
    expect(difference(after, reference, SR)).toBeLessThan(-100)
  })
})

describe('Repeated notes: adding, and touching first', () => {
  test('additive (off, the default): the second pluck rides on the first, so the two notes differ', async () => {
    const reference = await approvedPluck(1)
    const { backend, session } = await playing()
    session.play()
    backend.pascals(0.5)
    const before = backend.engine.energy()
    session.play()
    const second = backend.pascals(1)
    // Nothing was taken away first: the string had energy, and the new note is not a fresh one. Its first
    // 100 ms differ from a first note's by a tenth of the note's own energy (a retriggered note: a few
    // thousandths, in the next test).
    console.log('additive, second note 0.5 s after the first: first 100 ms against a first note', difference(second, reference, 4800).toFixed(1), 'dB')
    expect(before).toBeGreaterThan(1e-5)
    expect(difference(second, reference, 4800)).toBeGreaterThan(-15)
  })

  test('retrigger (on): the finger damps the old note for 30 ms and plucks as it leaves; each note starts like a first note', async () => {
    const reference = await approvedPluck(1)
    const report: Record<string, Record<string, string>> = {}
    for (const gap of [1, 0.5, 0.25, 0.15]) {
      const { backend, session } = await playing(withParams({ retrigger: 1 }))
      expect(session.state.rebuilds).toBe(1)
      session.play() // the first note: the finger touches a string that is still
      backend.pascals(gap)
      const stringBefore = backend.engine.resonatorEnergy(0)
      const ringing = backend.pascals(0.02)
      const watch = energyRises(backend)
      session.play()
      const touch = backend.pascals(TOUCH_SAMPLES / SR - 128 / SR, watch.watch) // up to the block in which the pluck starts
      backend.pascals(128 / SR)
      const stringAfterTouch = backend.engine.resonatorEnergy(0)
      const note = backend.pascals(1)
      const name = `second note ${gap} s after the first`
      const offset = TOUCH_SAMPLES - (touch.length + 128) // the pluck started this many samples before `note` begins: none
      const match = difference(note, reference, 4800, 0, 0)
      report[name] = {
        'old note left after the touch, dB': (10 * Math.log10(stringAfterTouch / stringBefore)).toFixed(1),
        'first 100 ms against a first note, dB': match.toFixed(1),
        'peak, Pa (a first note: 0.102)': largest(note).toFixed(4),
        'largest step during the touch / while ringing before': (largestStep(touch) / largestStep(ringing)).toFixed(2),
        'largest step during the touch / in a pluck': (largestStep(touch) / largestStep(reference)).toFixed(2),
      }
      expect(offset).toBe(0)
      // While the finger rests, energy only leaves.
      expect(watch.count, name).toBe(0)
      // Each new note is a first note again, to 25 dB or better, where an added one is not within 6 dB.
      expect(match, name).toBeLessThan(-25)
      expect(Math.abs(largest(note) / largest(reference) - 1), name).toBeLessThan(0.05)
      // No click: the finger arriving makes a jump between samples of the size of the string's own motion
      // just before, and a small fraction of the jump a pluck itself makes.
      expect(largestStep(touch), name).toBeLessThan(2.5 * largestStep(ringing))
      expect(largestStep(touch), name).toBeLessThan(0.5 * largestStep(reference))
      expect(backend.engine.faults()).toBe(0)
    }
    console.table(report)
  }, 400000)

  test('a first note with retrigger on is the approved note, 30 ms later', async () => {
    const reference = await approvedPluck(1)
    const { backend, session } = await playing(withParams({ retrigger: 1 }))
    session.play()
    const sound = backend.pascals(1.1)
    expect(largest(sound, 0, TOUCH_SAMPLES - 1)).toBe(0) // nothing to damp, nothing heard
    expect(difference(sound, reference, SR, TOUCH_SAMPLES, 0)).toBeLessThan(-100)
  })

  test('eight retriggered notes a second for three seconds: every one the same size, and nothing builds up', async () => {
    const { backend, session } = await playing(withParams({ retrigger: 1 }))
    const peaks: number[] = []
    for (let i = 0; i < 24; i++) {
      session.play()
      peaks.push(largest(backend.pascals(0.125)))
    }
    const settled = peaks.slice(1)
    // Additive, the same playing: every note lands on a different remainder of the ones before.
    const added = await playing()
    const addedPeaks: number[] = []
    let carried = 0
    for (let i = 0; i < 24; i++) {
      if (i === 23) carried = added.backend.engine.resonatorEnergy(0)
      added.session.play()
      addedPeaks.push(largest(added.backend.pascals(0.125)))
    }
    const spread = (peaks: number[]) => Math.max(...peaks) / Math.min(...peaks)
    console.log('24 notes, 8 a second | retriggered: peaks from', Math.min(...settled).toFixed(4), 'to', Math.max(...settled).toFixed(4), 'Pa | additive: from', Math.min(...addedPeaks.slice(1)).toFixed(4), 'to', Math.max(...addedPeaks).toFixed(4), 'Pa, with', (1000 * carried).toFixed(3), 'mJ still in the string as the last is plucked')
    // Retriggered: the same size to a part in a hundred. Additive: not, and the string is never at rest.
    expect(spread(settled)).toBeLessThan(1.01)
    expect(spread(addedPeaks.slice(1))).toBeGreaterThan(spread(settled) + 0.01)
    expect(carried).toBeGreaterThan(1e-4)
    expect(backend.engine.faults() + added.backend.engine.faults()).toBe(0)
  }, 400000)
})

describe('A finger on the string', () => {
  test('touching damps: energy only ever falls, 35 dB in a tenth of a second, and the output is not touched', async () => {
    const { backend, session } = await playing()
    session.play()
    backend.pascals(0.5)
    const before = backend.engine.energy()
    const watch = energyRises(backend)
    session.touch(true)
    const during = backend.pascals(0.1, watch.watch)
    const after100 = backend.engine.energy()
    const more = backend.pascals(0.4, watch.watch)
    console.log('finger on a ringing string: energy after 0.1 s', (10 * Math.log10(after100 / before)).toFixed(1), 'dB, after 0.5 s', (10 * Math.log10(backend.engine.energy() / before)).toFixed(1), 'dB | sound peak', largest(during, 0, 480).toFixed(4), '->', largest(more, more.length - 480).toExponential(1), 'Pa')
    expect(watch.count).toBe(0)
    expect(10 * Math.log10(after100 / before)).toBeLessThan(-35)
    // Complete mute: after half a second nothing is left to hear, and it was the string that stopped,
    // not the sound that was turned down: the engine itself holds less than a millionth of the energy.
    expect(backend.engine.energy()).toBeLessThan(1e-6 * before)
    expect(largest(more, more.length - 480)).toBeLessThan(0.001 * largest(during, 0, 480))
    expect(backend.engine.faults()).toBe(0)
  })

  test('the finger is a damper of twice the string\'s wave impedance, and follows the tension', async () => {
    expect(fingerDamping({ tension: 73.5 })).toBeCloseTo(2 * Math.sqrt(73.5 * STRING_DENSITY), 12)
    // Half as strong or four times as strong takes longer to quiet the string: this is the strength that takes most.
    const timeToFall = async (scale: number) => {
      const { backend, session } = await playing()
      session.play()
      backend.pascals(0.3)
      const before = backend.engine.resonatorEnergy(0)
      backend.worklet.send([['touch', 3, scale * fingerDamping({ tension: 73.5 }), 0.002, -1, 0]])
      for (let ms = 3; ms <= 600; ms += 3) {
        backend.worklet.render(144)
        if (backend.engine.resonatorEnergy(0) < 1e-3 * before) return ms
      }
      return Infinity
    }
    const [half, matched, four] = [await timeToFall(0.5), await timeToFall(1), await timeToFall(4)]
    console.log('time for the string to lose 30 dB under a finger of 0.5, 1 and 4 times the matched strength, ms:', half, matched, four)
    expect(matched).toBeLessThan(half)
    expect(matched).toBeLessThan(four)
    expect(matched).toBeLessThan(40)
  })

  test('gradual release: lifting the finger adds nothing and makes no click; what is left rings on', async () => {
    const { backend, session } = await playing()
    session.play()
    backend.pascals(0.3)
    session.touch(true)
    const touching = backend.pascals(0.012) // a brief touch: the note is quieter, not gone
    const held = backend.engine.energy()
    const watch = energyRises(backend)
    session.touch(false)
    const lifting = backend.pascals(0.02, watch.watch)
    const after = backend.pascals(0.5, watch.watch)
    expect(watch.count).toBe(0)
    // The finger has gone: the string decays at its own slow rate again, not at the finger's. Half a
    // second later it has lost what its own decay takes in that time (9 dB at 16.7 dB a second, and a
    // little more from its faster high overtones): a twentieth or more is left. Under the finger it would
    // have lost ten thousand times that.
    expect(backend.engine.energy()).toBeGreaterThan(0.05 * held)
    expect(largest(after)).toBeGreaterThan(0)
    // No click: as the finger lifts, no jump between samples larger than those while it was resting.
    expect(largestStep(lifting)).toBeLessThan(1.5 * largestStep(touching, touching.length - 240))
  })

  test('damping can never add energy: a finger coming and going at random, at any strength, only takes', async () => {
    const { backend, session } = await playing()
    session.play()
    backend.pascals(0.25) // the pluck's force has gone
    const watch = energyRises(backend)
    let seed = 12345
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let i = 0; i < 300; i++) {
      // Strengths from a feather to a clamp, arriving and leaving in anything from nothing to 20 ms.
      const strength = random() < 0.3 ? 0 : 10 ** (-2 + 5 * random())
      backend.worklet.send([['touch', 3, strength, 0.02 * random(), random() < 0.5 ? -1 : 0.01 * random(), 0.02 * random()]])
      backend.pascals((64 + Math.floor(700 * random())) / SR, watch.watch)
    }
    expect(watch.count).toBe(0)
    expect(backend.engine.faults()).toBe(0)
    expect(backend.engine.worstIterations()).toBeLessThanOrEqual(3)
  }, 400000)

  test('plucked while the finger rests on it: a short, muted note', async () => {
    const open = await approvedPluck(0.5)
    const { backend, session } = await playing()
    session.touch(true)
    backend.pascals(0.05)
    session.play()
    const muted = backend.pascals(0.5)
    const energy = (x: Float32Array, from: number, to: number) => x.subarray(from, to).reduce((s, v) => s + v * v, 0)
    // It speaks (the attack is there) and is gone in a tenth of a second.
    expect(largest(muted, 0, 960)).toBeGreaterThan(0.2 * largest(open, 0, 960))
    expect(energy(muted, 9600, 24000)).toBeLessThan(1e-3 * energy(open, 9600, 24000))
  })

  test('a finger cannot quiet an overtone that does not move under it: touched at its middle, the string keeps its octave', async () => {
    // Pluck off-centre so that every overtone sounds, then rest the finger on the middle of the string.
    const { backend, session } = await playing(withParams({ pluckPosition: 0.3 }))
    session.play()
    const open = backend.pascals(1.6)
    expect(session.update(withParams({ pluckPosition: 0.5 }))).toBe('live') // the finger moves; the string is not disturbed
    session.touch(true)
    backend.pascals(0.3)
    const touched = backend.pascals(1.6)
    const [fundamental, octave] = [harmonic(touched, 1) - harmonic(open, 1), harmonic(touched, 2) - harmonic(open, 2)]
    console.log('finger resting on the middle of the string: fundamental', fundamental.toFixed(1), 'dB, octave (which has a still point there)', octave.toFixed(1), 'dB')
    // The fundamental is gone altogether. The octave, which does not move at the middle, is still there:
    // weaker (its still point is not exactly under the finger, because the bridge end gives a little),
    // but a hundred decibels above the fundamental. What sounds is the octave: a harmonic, as on a real string.
    expect(fundamental).toBeLessThan(-100)
    expect(octave).toBeGreaterThan(-40)
    expect(octave - fundamental).toBeGreaterThan(100)
  })
})

describe('Pulling the string aside and letting go', () => {
  test('the force is the string\'s own: tension times displacement times (1/a + 1/b), up to the strongest pluck', async () => {
    const { session } = await playing()
    // 2.83 mm at 0.8 of a 0.65 m string under 73.5 N.
    expect(pullForce(DEFAULT, 0.8, 0.00283)).toBeCloseTo(73.5 * 0.00283 * (1 / 0.52 + 1 / 0.13), 9)
    expect(session.pull(0.00283)!).toBeCloseTo(2, 2)
    expect(session.pull(-0.001)!).toBeCloseTo(-pullForce(DEFAULT, 0.8, 0.001), 9)
    expect(session.pull(0.5)!).toBe(TYPES.steelString.params.find((p) => p.key === 'pluckStrength')!.max) // capped, not refused
    // No audio, or no string: nothing is pulled.
    expect(new Session(new NodeBackend()).pull(0.001)).toBeNull()
    const bars = await playing(EXAMPLES[0].make())
    expect(bars.session.pull(0.001)).toBeNull()
    expect(bars.session.touch(true)).toBe(false)
    expect(bars.session.release()).toBe(false)
  })

  test('held, the string really is displaced: it stores the work of pulling it, and makes almost no sound', async () => {
    const { backend, session } = await playing()
    const force = session.pull(0.00283)!
    const pulling = backend.pascals(0.5)
    // Work of pulling a spring-like string to force F at displacement d: F d / 2.
    const stored = backend.engine.energy()
    console.log('string held 2.83 mm aside with', force.toFixed(3), 'N: energy stored', (1000 * stored).toFixed(3), 'mJ, F d / 2 =', (1000 * 0.5 * force * 0.00283).toFixed(3), 'mJ | sound while pulling', largest(pulling).toExponential(1), 'Pa')
    expect(stored / (0.5 * force * 0.00283)).toBeGreaterThan(0.95)
    expect(stored / (0.5 * force * 0.00283)).toBeLessThan(1.05)
    expect(largest(pulling)).toBeLessThan(0.02 * 0.102)
    // Held still, it stays: nothing drifts.
    backend.pascals(0.5)
    expect(backend.engine.energy() / stored).toBeCloseTo(1, 3)
  })

  test('let go, it is the approved pluck of that force: same harmonics, and the other way round when pulled the other way', async () => {
    const reference = await approvedPluck(2)
    const released = async (displacement: number) => {
      const { backend, session } = await playing()
      session.pull(displacement)
      backend.pascals(0.4)
      expect(session.release()).toBe(true)
      return backend.pascals(2)
    }
    const [up, down] = [await released(0.00283), await released(-0.00283)]
    const report = [1, 2, 3, 4, 6, 8, 12].map((n) => harmonic(up, n) - harmonic(reference, n))
    console.log('pulled 2.83 mm (2 N) and released, against the approved 2 N pluck: harmonics 1 2 3 4 6 8 12, dB:', report.map((v) => v.toFixed(2)).join(' '), '| peak', largest(up).toFixed(4), 'against', largest(reference).toFixed(4), 'Pa')
    for (const d of report) expect(Math.abs(d)).toBeLessThan(0.5)
    expect(Math.abs(largest(up) / largest(reference) - 1)).toBeLessThan(0.05)
    // Pulled the other way, the same motion with the sign changed.
    let worst = 0
    for (let n = 0; n < up.length; n++) worst = Math.max(worst, Math.abs(up[n] + down[n]))
    expect(worst).toBeLessThan(1e-6 * largest(up))
  })

  test('taking hold of a ringing string damps it, as a finger does; letting go without pulling is no pluck', async () => {
    const { backend, session } = await playing()
    session.play()
    backend.pascals(0.5)
    const before = backend.engine.resonatorEnergy(0)
    session.pull(0) // a finger on the string, not yet pulling
    backend.pascals(0.1)
    expect(backend.engine.resonatorEnergy(0)).toBeLessThan(1e-3 * before)
    session.release()
    expect(largest(backend.pascals(0.5))).toBeLessThan(0.001)
    // A rebuild while the string is held lets go of everything: the new instrument starts at rest and stays there.
    session.pull(0.003)
    backend.pascals(0.1)
    expect(session.update(withParams({ length: 0.7 }))).toBe('rebuilt')
    expect(largest(backend.pascals(0.5))).toBe(0)
    expect(backend.engine.energy()).toBe(0)
  })
})

describe('Pluck softness', () => {
  test('0.3 is the approved pluck; softer is duller, harder is brighter; it is a live property', async () => {
    const reference = await approvedPluck(1)
    const brightness = (x: Float32Array) => {
      const spec = powerSpectrum(x, 0, 32768)
      let [high, all] = [0, 0]
      for (let k = 1; k < spec.length; k++) {
        all += spec[k]
        if ((k * SR) / 32768 > 2000) high += spec[k]
      }
      return 10 * Math.log10(high / all)
    }
    const at = async (softness: number) => {
      const { backend, session } = await playing()
      expect(session.update(withParams({ pluckSoftness: softness }))).toBe(softness === 0.3 ? 'unchanged' : 'unchanged') // read when plucked
      session.play()
      return backend.pascals(1)
    }
    const [hard, same, soft] = [await at(0), await at(0.3), await at(1)]
    expect(Array.from(same)).toEqual(Array.from(reference))
    console.log('share of the sound above 2 kHz, dB: softness 0:', brightness(hard).toFixed(1), '| 0.3 (approved):', brightness(same).toFixed(1), '| 1:', brightness(soft).toFixed(1))
    expect(brightness(hard)).toBeGreaterThan(brightness(same) + 1)
    expect(brightness(soft)).toBeLessThan(brightness(same) - 3)
    expect(structureKey(withParams({ pluckSoftness: 1, retrigger: 1 }))).toBe(structureKey(example()))
  })
})

describe('The builder around it', () => {
  test('rapid playing: ten seconds of plucks, touches, pulls and edits in any order make no fault, and it falls silent after', async () => {
    const { backend, session } = await playing()
    let graph = example()
    let seed = 2024
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    let loudest = 0
    for (let i = 0; i < 1000; i++) {
      const r = random()
      if (r < 0.25) session.play()
      else if (r < 0.4) session.touch(random() < 0.5)
      else if (r < 0.55) session.pull((random() - 0.5) * 0.02)
      else if (r < 0.65) session.release()
      else {
        const [key, value] = r < 0.75 ? ['tension', Number((30 + 90 * random()).toFixed(1))] : r < 0.85 ? ['pluckPosition', Number((0.05 + 0.9 * random()).toFixed(2))] : r < 0.9 ? ['retrigger', random() < 0.5 ? 1 : 0] : r < 0.95 ? ['pluckSoftness', Number(random().toFixed(2))] : ['pluckStrength', Number((0.2 + 7.8 * random()).toFixed(1))]
        graph = setParam(graph, stringOf(graph).id, key as string, value as number)
        expect(session.update(graph)).not.toBe('rebuilt')
      }
      const out = backend.worklet.render(480) // 10 ms
      loudest = Math.max(loudest, largest(out))
      expect(out.every(Number.isFinite)).toBe(true)
    }
    expect(backend.engine.faults()).toBe(0)
    expect(session.state.rebuilds).toBe(1)
    // The audio node's ceiling is 1 (2 Pa): the hardest playing allowed stays under it.
    console.log('1000 random gestures in 10 s: loudest', (loudest * PRESSURE_FULL_SCALE).toFixed(3), 'Pa | Newton iterations at most', backend.engine.worstIterations())
    expect(loudest).toBeLessThan(1)
    // Hands off: it rings down to silence by itself, and its energy never rises on the way.
    session.release()
    session.touch(false)
    backend.pascals(0.3)
    const watch = energyRises(backend)
    const tail = backend.pascals(12, watch.watch)
    expect(watch.count).toBe(0)
    expect(largest(tail, tail.length - SR)).toBeLessThan(1e-6)
    // What the engine still counts as energy is not motion. Retuning a string while a finger holds it
    // aside keeps each part's stored energy as it is (the engine's rule for a live retune), which leaves the
    // parts pressing on each other a little when the finger goes: a stress that stays, moves nothing and
    // makes no sound. It is small beside a pluck's 0.3 mJ, and a rebuild clears it. (A limitation, noted
    // in docs/STRING_INSTRUMENT.md.)
    const still = backend.engine.energy()
    console.log('after the gestures, at rest: energy held as a still stress', (1e6 * still).toFixed(2), 'microjoules')
    expect(still).toBeLessThan(3e-5)
    backend.pascals(1)
    expect(backend.engine.energy()).toBeCloseTo(still, 12)
  }, 400000)

  test('undo and redo cover the new properties, and both are live', async () => {
    const graph = example()
    const id = stringOf(graph).id
    let history = startHistory(graph)
    history = commit(history, setParam(history.present, id, 'retrigger', 1), 'retrigger', 0)
    history = commit(history, setParam(history.present, id, 'pluckSoftness', 0.8), 'softness', 1000)
    const { session } = await playing(history.present)
    history = undo(history)
    expect(stringOf(history.present).params).toMatchObject({ retrigger: 1, pluckSoftness: 0.3 })
    expect(session.update(history.present)).toBe('unchanged')
    history = undo(history)
    expect(history.present).toEqual(graph)
    expect(session.update(history.present)).toBe('unchanged')
    history = redo(redo(history))
    expect(stringOf(history.present).params).toMatchObject({ retrigger: 1, pluckSoftness: 0.8 })
    expect(session.state.rebuilds).toBe(1)
  })

  test('saving and restoring: the new properties come back; an instrument saved before they existed gets the approved values; a half-on switch is refused', () => {
    const graph = withParams({ retrigger: 1, pluckSoftness: 0.65, tension: 91 })
    expect(restore(serialize(graph)).graph).toEqual(graph)
    // As Phase 3C.3 saved it: no pluckSoftness, no retrigger.
    const old = JSON.parse(serialize(example())) as Graph
    for (const c of old.components) {
      delete c.params.pluckSoftness
      delete c.params.retrigger
    }
    const loaded = restore(JSON.stringify(old))
    expect(loaded.problem).toBeUndefined()
    expect(loaded.graph).toEqual(example())
    expect(() => deserialize(serialize(withParams({ retrigger: 0.5 })))).toThrow(/either off \(0\) or on \(1\)/)
    expect(validateGraph(withParams({ pluckSoftness: 1.2 }))[0].message).toMatch(/Pluck softness must be between 0 and 1/)
    // Bars saved before are untouched by the change.
    for (const bars of EXAMPLES) expect(restore(serialize(bars.make())).graph).toEqual(bars.make())
  })

  test('switching to a bar instrument with a finger still on the string: the bars are exactly as they always were', async () => {
    const { backend, session } = await playing(withParams({ retrigger: 1 }))
    session.play()
    backend.pascals(0.1)
    session.pull(0.004) // touching and pulling when the instrument is swapped
    backend.pascals(0.05)
    for (const bars of EXAMPLES) {
      const graph = bars.make()
      expect(session.update(graph)).toBe('rebuilt')
      session.play()
      const fromWorklet = backend.worklet.render(SR)
      const translation = translate(graph, SR)
      if (!translation.ok) throw new Error('bars example does not translate')
      const engine = createEngine()
      run(engine, translation.built.calls)
      run(engine, instrumentCalls(graph, translation.built))
      const bare = renderEngine(engine, new Float32Array(SR)).map((v) => Math.max(-1, Math.min(1, v)))
      expect(Array.from(fromWorklet), bars.label).toEqual(Array.from(bare))
    }
    // And back: the string is at rest, with no finger on it, and plays its approved note 30 ms after it is asked to.
    expect(session.update(withParams({ retrigger: 1 }))).toBe('rebuilt')
    session.play()
    const reference = await approvedPluck(1)
    expect(difference(backend.pascals(1.1), reference, SR, TOUCH_SAMPLES, 0)).toBeLessThan(-100)
    expect(backend.engine.faults()).toBe(0)
  }, 400000)

  test('the processor: gestures in blocks of any size give the same sound, and a new system forgets the old one\'s fingers', async () => {
    const built = buildPlayableStringBody(DEFAULT, SR)
    const r = radiation(SR)
    const calls: Call[] = [...built.calls, ['radiate', r.perSample, r.b0, r.b1, r.a1, 1]]
    const gesture: Call[] = [pluckCall(built, 2), ['touch', built.finger, 1, 0.002, 0.03, 0.004], pluckCall(built, 3, 0.3, 0.05), ['hold', built.string, built.pluckPort, 1.5, 30]]
    const inBlocks = async (size: number) => {
      const worklet = await createWorklet(calls)
      worklet.send(gesture)
      const out = new Float32Array(SR)
      // The harness makes blocks of 128; other sizes are made by asking for that many samples at a time.
      for (let at = 0; at < SR; at += size) out.set(worklet.render(Math.min(size, SR - at)), at)
      return { out, worklet }
    }
    const [usual, small, odd] = [await inBlocks(128), await inBlocks(16), await inBlocks(100)]
    for (const other of [small, odd]) {
      let worst = 0
      for (let n = 0; n < SR; n++) worst = Math.max(worst, Math.abs(other.out[n] - usual.out[n]))
      // The finger's damper moves in steps of at most sixteen samples, which fall differently in blocks of
      // other sizes: the same to a part in ten thousand, not to the last digit.
      expect(worst).toBeLessThan(1e-3 * largest(usual.out))
    }
    // The same calls again: a 'reset' clears the finger, the held force and the waiting pluck.
    usual.worklet.send(calls)
    expect(largest(usual.worklet.render(SR))).toBe(0)
    expect(usual.worklet.engine.energy()).toBe(0)
    expect(usual.worklet.engine.faults()).toBe(0)
  })

  test('on the canvas: where a press plays the string, where it moves it, and what a drag across it means', () => {
    const string = stringOf(example())
    const { w } = rectSize(string)!
    const left = string.x - w / 2
    // The grey end is the grip; the rest of the string is played, at the fraction of its length under the pointer.
    expect(playPoint(string, { x: left + STRING_GRIP / 2, y: string.y })).toBeNull()
    expect(playPoint(string, { x: left + 0.5 * w, y: string.y })).toBe(0.5)
    expect(playPoint(string, { x: left + 0.8 * w, y: string.y + 10 })).toBe(0.8)
    expect(playPoint(string, { x: left + w - 1, y: string.y })).toBe(0.95) // kept inside the property's range
    expect(playPoint(string, { x: left + 0.5 * w, y: string.y + 30 })).toBeNull()
    expect(playPoint(example().components[1], { x: example().components[1].x, y: example().components[1].y })).toBeNull() // the body is not played
    // A drag across the string is a displacement: a quarter of a millimetre a unit, at most 10 mm.
    expect(PULL_SCALE).toBe(0.00025)
    expect(PULL_LIMIT * PULL_SCALE).toBeCloseTo(0.01, 12)
    // Twelve units across at the loaded pluck point: 3 mm, which takes 2.12 N.
    expect(pullForce(DEFAULT, 0.8, 12 * PULL_SCALE)).toBeCloseTo(2.12, 2)
  })
})
