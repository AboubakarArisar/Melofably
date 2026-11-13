// Phase 3C.3: reference renders of the builder's string-and-body instrument,
// and its numerical comparison with the approved Phase 3C.2.3 prototype.
//
//   npm run render:string-body
//
// Everything is played the way the browser plays it: the builder's graph,
// its translation, its Session, and the AudioWorklet processor file itself
// (analysis/worklet.ts). Output: renders/string-body/*.wav, listening.json
// (pascals and dB SPL at 1 m before any gain, and the gain) and
// comparison.json (integrated instrument against the prototype).
import { mkdirSync, writeFileSync } from 'node:fs'
import { STRING_EXAMPLES } from '../src/builder/examples.ts'
import { removeConnection, setParam, type Graph } from '../src/builder/graph.ts'
import { Session, type Backend } from '../src/builder/session.ts'
import { PRESSURE_FULL_SCALE } from '../src/builder/translate.ts'
import { stringPitch } from '../src/experimental/string/stringBody.ts'
import type { Call } from '../src/experimental/wasm/engine.ts'
import { amplitudeAt, powerSpectrum, SR } from './lib.ts'
import { compileModel, fsPath, groupWriter, path } from './offline.ts'
import { DAMPED_BOX, GUITAR_A, onSoundboard, pluckOne, soundOf } from './soundboard.ts'
import { createWorklet, type Worklet } from './worklet.ts'

const OUT = 'renders/string-body'
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
async function playing(graph: Graph) {
  const backend = new NodeBackend()
  const session = new Session(backend)
  await session.start(graph)
  return { backend, session }
}
const example = () => STRING_EXAMPLES[0].make()
const stringId = example().components.find((c) => c.type === 'steelString')!.id
const edited = (params: Record<string, number>) => Object.entries(params).reduce((g, [key, value]) => setParam(g, stringId, key, value), example())
const join = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
async function pluckOnce(graph: Graph, seconds = 4) {
  const { backend, session } = await playing(graph)
  session.play()
  return backend.pascals(seconds)
}

// ---- What a sound is, in numbers ------------------------------------------------------------------
const N = 65536
function measure(sound: Float32Array, f0: number) {
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
  const top = Math.max(...envelope)
  const harmonic = (n: number) => { let m = 0; for (let k = Math.floor((0.97 * n * pitch * N) / SR); k <= Math.ceil((1.03 * n * pitch * N) / SR); k++) m = Math.max(m, spec[k]); return 10 * Math.log10(m / spec[best]) }
  let peak = 0
  for (const v of sound) peak = Math.max(peak, Math.abs(v))
  return {
    pitchHz: Number(pitch.toFixed(3)),
    centsFromStringFormula: Number((1200 * Math.log2(pitch / f0)).toFixed(2)),
    peakPa: Number(peak.toPrecision(4)),
    peak_dB_SPL: Number((20 * Math.log10(peak / Math.SQRT2 / 2e-5)).toFixed(1)),
    loudestAtMs: envelope.indexOf(top),
    riseMs_10_to_90: envelope.findIndex((v) => v > 0.81 * top) - envelope.findIndex((v) => v > 0.01 * top),
    t60OfFundamental_s: Number((Math.log(1000) / (Math.log(amplitudeAt(sound.subarray(0.2 * SR, 0.6 * SR), pitch) / amplitudeAt(sound.subarray(0.8 * SR, 1.2 * SR), pitch)) / 0.6)).toFixed(3)),
    harmonics2346_dB_re_fundamental: [2, 3, 4, 6].map((n) => Number(harmonic(n).toFixed(1))),
  }
}

// ---- 1. The instrument as loaded, against the prototype it was built from ----------------------------
const integrated = await pluckOnce(example())
const setup = onSoundboard({ ...DAMPED_BOX, strings: [GUITAR_A] })
const prototype = soundOf(setup, pluckOne(setup.instrument, 0, 4))
let difference = 0
for (let n = 0; n < integrated.length; n++) difference = Math.max(difference, Math.abs(integrated[n] - prototype[n]))
writeGroup('Pa', { '1a-builder-instrument-A2-one-pluck': integrated, '1b-phase-3C23-prototype-A2-one-pluck': prototype }, 'the string example as the builder plays it, and the approved prototype; one gain for both')
const comparison = {
  note: 'A2, 2 N pluck at 0.8 of the string, 4 s, sound pressure at 1 m',
  builderInstrument: measure(integrated, stringPitch({ tension: 73.5, length: 0.65 })),
  prototype: measure(prototype, stringPitch({ tension: 73.5, length: 0.65 })),
  largestSampleDifferencePa: Number(difference.toExponential(2)),
  largestSampleDifference_dB_re_peak: Number((20 * Math.log10(difference / measure(prototype, 110).peakPa)).toFixed(1)),
}

// ---- 2. The approved Faust string -----------------------------------------------------------------------
const faustString = await compileModel('src/audio/models/string.dsp', 'pluck')
writeGroup('Faust output (unitless)', { '2-approved-faust-string-A2': (await faustString({})).play(4) }, 'the approved instrument; not a pressure, its own gain')

// ---- 3. Tension and length (one gain) ---------------------------------------------------------------------
const variants: [string, Record<string, number>][] = [
  ['3a-tension-30N-70Hz', { tension: 30 }],
  ['3b-tension-73.5N-110Hz-as-loaded', {}],
  ['3c-tension-120N-140Hz', { tension: 120 }],
  ['3d-length-0.50m-143Hz', { length: 0.5 }],
  ['3e-length-0.80m-89Hz', { length: 0.8 }],
]
const variantSounds: Record<string, Float32Array> = {}
const variantNumbers: Record<string, unknown> = {}
for (const [name, params] of variants) {
  const graph = edited(params)
  const s = graph.components.find((c) => c.id === stringId)!.params
  variantSounds[name] = await pluckOnce(graph)
  variantNumbers[name] = measure(variantSounds[name], stringPitch({ tension: s.tension, length: s.length }))
}
writeGroup('Pa', variantSounds, 'one pluck of 2 N each; one gain for all')

// ---- 4. Pluck position and strength (one gain) ------------------------------------------------------------
writeGroup('Pa', {
  '4a-plucked-at-0.50-the-middle': await pluckOnce(edited({ pluckPosition: 0.5 })),
  '4b-plucked-at-0.80-as-loaded': integrated,
  '4c-plucked-at-0.95-by-the-bridge': await pluckOnce(edited({ pluckPosition: 0.95 })),
  '4d-plucked-softly-0.5N': await pluckOnce(edited({ pluckStrength: 0.5 })),
  '4e-plucked-hard-8N': await pluckOnce(edited({ pluckStrength: 8 })),
}, 'one gain for all: the soft pluck is 12 dB below the loaded one and the hard one 12 dB above, as the forces are')

// ---- 5. Playing: repeated plucks, and the tension changed while it rings --------------------------------------
{
  const { backend, session } = await playing(example())
  const parts: Float32Array[] = []
  // Eight plucks half a second apart, then sixteen an eighth of a second apart, then let it ring.
  for (let i = 0; i < 8; i++) parts.push((session.play(), backend.pascals(0.5)))
  for (let i = 0; i < 16; i++) parts.push((session.play(), backend.pascals(0.125)))
  parts.push(backend.pascals(3))
  writeGroup('Pa', { '5a-repeated-plucks-slow-then-fast': join(...parts) }, 'each pluck adds to the vibration already there')
}
{
  const { backend, session } = await playing(example())
  const parts: Float32Array[] = [(session.play(), backend.pascals(0.6))]
  // The tension turned from 73.5 to 100 N over one second while the string rings, in steps of 10 ms; then a new pluck.
  for (let i = 1; i <= 100; i++) parts.push((session.update(edited({ tension: Number((73.5 + (26.5 * i) / 100).toFixed(2)) })), backend.pascals(0.01)))
  parts.push(backend.pascals(1), (session.play(), backend.pascals(2.5)))
  writeGroup('Pa', { '5b-tension-turned-up-while-ringing-then-plucked-again': join(...parts) }, 'a live edit: no rebuild, the sound does not restart')
  if (session.state.rebuilds !== 1) throw new Error('the tension change rebuilt the instrument')
}

// ---- 6. Without the bridge: nothing to write ---------------------------------------------------------------
const apart = await pluckOnce(removeConnection(example(), example().connections[0].id), 1)
const silent = apart.every((v) => v === 0)

writeFileSync(path(`${OUT}/listening.json`), JSON.stringify({ sampleRate: SR, distanceM: 1, files: info }, null, 2))
writeFileSync(path(`${OUT}/comparison.json`), JSON.stringify({ ...comparison, variants: variantNumbers, withoutTheBridge: { everySampleIsZero: silent } }, null, 2))
console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => [k, Object.fromEntries(Object.entries(v as object).filter(([key]) => !['note', 'quantity', 'gainApplied'].includes(key)))])))
console.log(JSON.stringify(comparison, null, 1))
console.table(variantNumbers)
console.log('without the bridge, every sample is zero:', silent)
console.log(`\nwritten to ${fsPath(OUT)}`)
