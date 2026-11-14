// Phase 3D.1: listening renders of the playing behaviours of the string
// instrument, each beside the approved Phase 3C.3 pluck where that is the
// comparison.
//
//   npm run render:string-playing
//
// Played the way the browser plays it: the builder's graph and Session and
// the AudioWorklet processor file (analysis/worklet.ts). Output:
// renders/string-playing/*.wav, listening.json (pascals and dB SPL at 1 m
// before any gain, and the gain) and comparison.json.
import { mkdirSync, writeFileSync } from 'node:fs'
import { STRING_EXAMPLES } from '../src/builder/examples.ts'
import { setParam, type Graph } from '../src/builder/graph.ts'
import { Session, type Backend } from '../src/builder/session.ts'
import { PRESSURE_FULL_SCALE } from '../src/builder/translate.ts'
import { buildStringBody, pluckCall, radiation, STRING_DENSITY } from '../src/experimental/string/stringBody.ts'
import type { Call } from '../src/experimental/wasm/engine.ts'
import { amplitudeAt, powerSpectrum, SR } from './lib.ts'
import { fsPath, groupWriter, path } from './offline.ts'
import { createWorklet, type Worklet } from './worklet.ts'

const OUT = 'renders/string-playing'
mkdirSync(path(OUT), { recursive: true })
const { info, writeGroup } = groupWriter(OUT)

class NodeBackend implements Backend {
  worklet!: Worklet
  async open() {
    this.worklet = await createWorklet([['reset', SR, 2], ['build']])
    return { sampleRate: SR, send: (calls: Call[]) => this.worklet.send(calls), rebuild: (calls: Call[]) => this.worklet.send(calls), close: async () => {} }
  }
  pascals(seconds: number) {
    return this.worklet.render(Math.round(seconds * SR)).map((v) => v * PRESSURE_FULL_SCALE)
  }
}
const example = () => STRING_EXAMPLES[0].make()
const stringId = example().components.find((c) => c.type === 'steelString')!.id
const edited = (params: Record<string, number>, graph: Graph = example()) => Object.entries(params).reduce((g, [key, value]) => setParam(g, stringId, key, value), graph)

/** A player: a session, and a tape that everything it does is recorded on. */
async function player(start: Record<string, number> = {}) {
  const backend = new NodeBackend()
  const session = new Session(backend)
  let graph = edited(start)
  await session.start(graph)
  const tape: Float32Array[] = []
  const wait = (seconds: number) => void tape.push(backend.pascals(seconds))
  return {
    backend,
    session,
    wait,
    /** Change properties of the string (all of these are live). */
    set(params: Record<string, number>) {
      graph = edited(params, graph)
      if (session.update(graph) === 'rebuilt') throw new Error('a playing render must not rebuild')
    },
    pluck: (then = 0) => (session.play(), then && wait(then)),
    recording() {
      const out = new Float32Array(tape.reduce((n, p) => n + p.length, 0))
      let at = 0
      for (const p of tape) {
        out.set(p, at)
        at += p.length
      }
      if (backend.worklet.engine.faults()) throw new Error('engine fault')
      return out
    },
  }
}
const N = 65536
function measure(sound: Float32Array, f0 = 109.91) {
  const spec = powerSpectrum(sound, Math.round(0.2 * SR), N)
  let best = Math.floor((0.93 * f0 * N) / SR)
  for (let k = best; k <= Math.ceil((1.07 * f0 * N) / SR); k++) if (spec[k] > spec[best]) best = k
  const [a, b, c] = [Math.log(spec[best - 1]), Math.log(spec[best]), Math.log(spec[best + 1])]
  const pitch = ((best + (0.5 * (a - c)) / (a - 2 * b + c)) * SR) / N
  const window = Math.round(SR / f0)
  const envelope: number[] = []
  for (let n = 0; n + window <= SR; n += 48) {
    let sum = 0
    for (let j = n; j < n + window; j++) sum += sound[j] * sound[j]
    envelope.push(sum)
  }
  const harmonic = (n: number) => { let m = 0; for (let k = Math.floor((0.97 * n * pitch * N) / SR); k <= Math.ceil((1.03 * n * pitch * N) / SR); k++) m = Math.max(m, spec[k]); return Number((10 * Math.log10(m / spec[best])).toFixed(1)) }
  let peak = 0
  for (const v of sound) peak = Math.max(peak, Math.abs(v))
  return {
    pitchHz: Number(pitch.toFixed(3)),
    centsFromA2: Number((1200 * Math.log2(pitch / f0)).toFixed(2)),
    peakPa: Number(peak.toPrecision(4)),
    peak_dB_SPL: Number((20 * Math.log10(peak / Math.SQRT2 / 2e-5)).toFixed(1)),
    loudestAtMs: envelope.indexOf(Math.max(...envelope)),
    t60OfFundamental_s: Number((Math.log(1000) / (Math.log(amplitudeAt(sound.subarray(0.2 * SR, 0.6 * SR), pitch) / amplitudeAt(sound.subarray(0.8 * SR, 1.2 * SR), pitch)) / 0.6)).toFixed(3)),
    harmonics2346_dB_re_fundamental: [2, 3, 4, 6].map(harmonic),
  }
}
const comparison: Record<string, unknown> = {}

// ---- 1. The approved pluck: the Phase 3C.3 reference build, and the instrument as it now is ---------------
{
  const built = buildStringBody({ tension: 73.5, length: 0.65, pluckAt: 0.8, joined: true }, SR)
  const r = radiation(SR)
  const worklet = await createWorklet([...built.calls, ['radiate', r.perSample, r.b0, r.b1, r.a1, 1]])
  worklet.send([pluckCall(built, 2)])
  const reference = worklet.render(4 * SR)
  const p = await player()
  p.pluck(4)
  const now = p.recording()
  let worst = 0
  for (let n = 0; n < now.length; n++) worst = Math.max(worst, Math.abs(now[n] - reference[n]))
  writeGroup('Pa', { '1a-approved-pluck-phase-3C3-reference': reference, '1b-approved-pluck-as-the-instrument-plays-it-now': now }, 'one pluck of 2 N at 0.8, nothing else: the two are the same samples; one gain for both')
  comparison.defaultSound = { phase3C3Reference: measure(reference), now: measure(now), largestSampleDifferencePa: worst }
}

// ---- 2, 3. The same playing, retriggered and additive (one gain) ------------------------------------------------
{
  const play = async (retrigger: number) => {
    const p = await player({ retrigger })
    for (let i = 0; i < 6; i++) p.pluck(0.5)
    for (let i = 0; i < 16; i++) p.pluck(0.125)
    p.wait(3)
    return p.recording()
  }
  const [retriggered, additive] = [await play(1), await play(0)]
  writeGroup('Pa', { '2-retrigger-six-slow-notes-then-sixteen-fast': retriggered, '3-additive-the-same-playing': additive }, 'six plucks half a second apart, sixteen an eighth apart, then left to ring; one gain for both. Retriggered notes sound 30 ms after they are asked for')
}

// ---- 4. Finger damping: touches of different lengths -------------------------------------------------------------
{
  const p = await player()
  // Pluck, let it ring, touch for a while, let go, listen to what is left; four times with longer touches.
  for (const touch of [0.005, 0.015, 0.04, 0.12]) {
    p.pluck(0.7)
    p.session.touch(true)
    p.wait(touch)
    p.session.touch(false)
    p.wait(1.3 - touch)
  }
  writeGroup('Pa', { '4-finger-damping-touches-of-5-15-40-and-120-ms': p.recording() }, 'each note is plucked, rings 0.7 s, is touched for the time named and released')
}

// ---- 5. Mute -----------------------------------------------------------------------------------------------------
{
  const p = await player()
  p.pluck(1)
  p.session.touch(true)
  p.wait(1)
  // Then five plucks with the finger still resting on the string, and five after it has left.
  for (let i = 0; i < 5; i++) p.pluck(0.3)
  p.session.touch(false)
  p.wait(0.2)
  for (let i = 0; i < 5; i++) p.pluck(0.3)
  p.wait(2)
  writeGroup('Pa', { '5-complete-mute-then-muted-plucks-then-open-plucks': p.recording() }, 'a note is stopped by a finger after 1 s; five plucks with the finger still on the string; five with it off')
}

// ---- 6, 7, 8. Strength, position, softness (retriggered, so that each note stands alone; one gain each) ----------
{
  const series = async (key: string, values: number[]) => {
    const p = await player({ retrigger: 1 })
    for (const value of values) {
      p.set({ [key]: value })
      p.pluck(1.2)
    }
    p.wait(1.5)
    return p.recording()
  }
  writeGroup('Pa', { '6-pluck-strength-0.5-1-2-4-8-N': await series('pluckStrength', [0.5, 1, 2, 4, 8]) }, 'each note twice the force of the one before: 6 dB louder each time')
  writeGroup('Pa', { '7-pluck-position-0.20-0.35-0.50-0.65-0.80-0.95': await series('pluckPosition', [0.2, 0.35, 0.5, 0.65, 0.8, 0.95]) }, 'from near the fixed end to near the bridge')
  writeGroup('Pa', { '8-pluck-softness-0-0.3-0.7-1': await series('pluckSoftness', [0, 0.3, 0.7, 1]) }, 'from a nail to soft flesh; 0.3 is the approved pluck')
}

// ---- 9. Pulled aside and released, beside the approved pluck -------------------------------------------------------
{
  const p = await player()
  p.session.pull(0.00283) // 2.83 mm, which takes 2 N
  p.wait(0.5)
  p.session.release()
  p.wait(4)
  const pulled = p.recording()
  const q = await player()
  q.wait(0.5)
  q.pluck(4)
  const plucked = q.recording()
  writeGroup('Pa', { '9a-pulled-2.83-mm-aside-held-half-a-second-and-released': pulled, '9b-the-approved-pluck-of-the-same-2-N': plucked }, 'one gain for both')
  comparison.pullAndRelease = { pulledAndReleased: measure(pulled.subarray(0.5 * SR)), approvedPluck: measure(plucked.subarray(0.5 * SR)) }
}

// ---- 10. A harmonic: the finger rests on the middle of a ringing string ----------------------------------------------
{
  const p = await player({ pluckPosition: 0.3 })
  p.pluck(1.5)
  p.set({ pluckPosition: 0.5 }) // the finger goes to the middle; the string is not disturbed
  p.session.touch(true)
  p.wait(2.5)
  writeGroup('Pa', { '10-a-finger-on-the-middle-of-the-string-leaves-its-octave': p.recording() }, 'plucked at 0.3; after 1.5 s a finger rests on the middle and stays: the fundamental stops, the octave rings on')
}

// ---- 11. A short performance ---------------------------------------------------------------------------------------
{
  // One string: pitch is its tension, which is live. Tension for a pitch: mu (2 L f)^2.
  const tensionFor = (f: number) => Number((STRING_DENSITY * (2 * 0.65 * f) ** 2).toFixed(2))
  const [E2, G2, A2, B2, C3] = [82.41, 98, 110, 123.47, 130.81].map(tensionFor)
  const p = await player({ retrigger: 1, tension: A2 })
  const note = (tension: number, beats: number, strength = 2, position = 0.8, softness = 0.3) => {
    p.set({ tension, pluckStrength: strength, pluckPosition: position, pluckSoftness: softness })
    p.pluck(0.3 * beats)
  }
  // A phrase, soft and near the middle, growing louder and nearer the bridge.
  note(A2, 2, 1.2, 0.6, 0.6)
  note(C3, 1, 1.5, 0.65, 0.5)
  note(B2, 1, 1.8, 0.7, 0.4)
  note(A2, 2, 2.2, 0.75, 0.3)
  note(G2, 1, 2.6, 0.8, 0.3)
  note(A2, 1, 3, 0.85, 0.2)
  note(B2, 2, 3.6, 0.88, 0.15)
  // Four short, muted notes: the finger stays on the string.
  p.session.touch(true)
  for (const t of [E2, E2, G2, E2]) note(t, 0.75, 3, 0.85, 0.2)
  p.session.touch(false)
  // A long note bent up a tone and back by its tension, as a peg or a pressed string does.
  note(A2, 1.5, 3, 0.8, 0.3)
  const bend = (from: number, to: number, step: number) => {
    for (let i = 1; i <= 30; i++) {
      p.set({ tension: Number((from + ((to - from) * i) / 30).toFixed(2)) })
      p.wait(step)
    }
  }
  bend(A2, B2, 0.008)
  p.wait(0.4)
  bend(B2, A2, 0.012)
  p.wait(0.5)
  // Additive: a roll that builds, then stopped dead by the finger.
  p.set({ retrigger: 0, pluckStrength: 1.5, pluckPosition: 0.8, tension: E2 })
  for (let i = 0; i < 14; i++) {
    p.set({ pluckStrength: Number((1.2 + 0.25 * i).toFixed(2)) })
    p.pluck(0.09)
  }
  p.wait(0.5)
  p.session.touch(true)
  p.wait(0.25)
  p.session.touch(false)
  // A last note, soft, in the middle of the string, and its octave left by a finger.
  p.set({ retrigger: 1, tension: A2, pluckStrength: 2.5, pluckPosition: 0.3, pluckSoftness: 0.5 })
  p.pluck(1.4)
  p.set({ pluckPosition: 0.5 })
  p.session.touch(true)
  p.wait(2.2)
  writeGroup('Pa', { '11-a-short-performance-on-one-string': p.recording() }, 'retriggered notes of growing strength, muted notes, a bend by tension, an additive roll stopped by the finger, and a harmonic')
}

writeFileSync(path(`${OUT}/listening.json`), JSON.stringify({ sampleRate: SR, distanceM: 1, files: info }, null, 2))
writeFileSync(path(`${OUT}/comparison.json`), JSON.stringify(comparison, null, 2))
console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => [k, Object.fromEntries(Object.entries(v as object).filter(([key]) => !['note', 'quantity', 'gainApplied'].includes(key)))])))
console.log(JSON.stringify(comparison))
console.log(`\nwritten to ${fsPath(OUT)}`)
