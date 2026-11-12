// Phase 3C.1: listening renders and performance of the coupled-string prototype.
//
//   npm run render:string
//
// Output: renders/coupled-string/*.wav, listening.json and performance.json.
import { mkdirSync, writeFileSync } from 'node:fs'
import { ModalResonator } from '../src/experimental/physics/resonator.ts'
import { SpringDamper } from '../src/experimental/physics/connections.ts'
import { System } from '../src/experimental/physics/system.ts'
import { Design } from '../src/experimental/wasm/engine.ts'
import { peak, SR } from './lib.ts'
import { compileModel, concat, fsPath, path, realtimeFactor, writeWav } from './offline.ts'
import {
  ALUMINIUM_BAR,
  BRIDGE,
  bridgeStiffness,
  DEFAULT_LOSS,
  fundamental,
  GUITAR_A,
  LISTEN,
  metalBar,
  residualCompliance,
  runCoupled,
  stringModes,
  WaveguideString,
  woodenBar,
  type Coupled,
  type Mode,
  type StringParams,
} from './string-prototype.ts'
import { createEngine } from './wasm.ts'

const OUT = 'renders/coupled-string'
mkdirSync(path(OUT), { recursive: true })
const fix = (v: number, d = 3) => Number(v.toFixed(d))
const info: Record<string, unknown> = {}
const silence = (seconds: number) => new Float32Array(Math.round(seconds * SR))
const tunedTo = (f0: number, s: StringParams = GUITAR_A): StringParams => ({ ...s, tension: s.density * (2 * s.length * f0) ** 2 })
const STIFF = { stiffness: 1e6 }

/** Writes files with one common gain (loudest peak 0.5), so relative loudness within the group is real. */
function writeGroup(files: Record<string, Float32Array>, note?: string) {
  const gain = 0.5 / Math.max(...Object.values(files).map((x) => peak(x)))
  for (const [name, x] of Object.entries(files)) {
    if (!x.every(Number.isFinite)) throw new Error(`${name}: non-finite samples`)
    writeWav(`${OUT}/${name}.wav`, Float32Array.from(x, (v) => v * gain))
    info[name] = { seconds: fix(x.length / SR, 1), peakBeforeGain: Number(peak(x).toPrecision(3)), gainApplied: Number(gain.toPrecision(3)), ...(note ? { note } : {}) }
  }
}
/** Each file on its own gain: for signals of different kinds (a force, a velocity) that cannot share one. */
const writeEach = (files: Record<string, Float32Array>, note?: string) => Object.entries(files).forEach(([name, x]) => writeGroup({ [name]: x }, note))

const faustString = await compileModel('src/audio/models/string.dsp', 'pluck')
const pluck = { pluck: { force: 1 } }

// ---- S. The string alone: approved Faust model against the two prototypes -------------------
// The approved string with its body off outputs the force at the bridge; so do the prototypes.
{
  const faust = (await faustString({ body: 0 })).play(4)
  const modal = runCoupled({ string: GUITAR_A, loss: DEFAULT_LOSS, body: null, bridge: STIFF, kind: 'modal' }, 4, pluck).bridgeForce
  const guide = runCoupled({ string: GUITAR_A, loss: DEFAULT_LOSS, body: null, bridge: STIFF, kind: 'waveguide' }, 4, pluck).bridgeForce
  // Three different scalings of the same quantity: each normalised on its own.
  const norm = (x: Float32Array) => Float32Array.from(x, (v) => (v * 0.5) / peak(x))
  writeEach({ 'S1-approved-faust-string-body-off': faust, 'S2-prototype-modal-string-rigid-bridge': modal, 'S3-prototype-waveguide-string-rigid-bridge': guide }, 'force at the bridge')
  writeGroup({ 'S4-faust-then-modal-then-waveguide': concat([norm(faust), silence(0.4), norm(modal), silence(0.4), norm(guide)]) })
  writeGroup({ 'S5-approved-faust-string-with-its-body-for-reference': (await faustString({})).play(4) }, 'the complete approved instrument, whose body is a fixed filter after the string')
}

// ---- P. A phrase: approved string against the modal prototype ---------------------------------
{
  const frets = [0, 3, 5, 7, 5, 3, 0, 12, 7, 0]
  const note = 0.45
  const inst = await faustString({ body: 0 })
  const faust = concat(frets.map((fret) => (inst.set({ fret }), inst.play(note))))
  const fretted = (fret: number): StringParams => ({ ...GUITAR_A, length: GUITAR_A.length * 2 ** (-fret / 12) })
  // The prototype has no retriggering: each note is its own render, so each starts from rest.
  const phrase = (setup: (fret: number) => Coupled, pick: 'bridgeForce' | 'body') => concat(frets.map((fret) => runCoupled(setup(fret), note, pluck)[pick]))
  const modal = phrase((fret) => ({ string: fretted(fret), loss: DEFAULT_LOSS, body: null, bridge: STIFF, kind: 'modal' }), 'bridgeForce')
  const onWood = phrase((fret) => ({ string: fretted(fret), loss: DEFAULT_LOSS, body: woodenBar(SR, 0), bridge: STIFF, kind: 'modal' }), 'body')
  writeEach({ 'P1-phrase-approved-faust-string-body-off': faust, 'P2-phrase-prototype-modal-string-rigid-bridge': modal, 'P3-phrase-prototype-string-on-a-wooden-bar-the-bar-heard': onWood }, 'each note of the prototype starts from rest; the approved string carries on from the previous note')
}

// ---- C. The string joined to a resonator ----------------------------------------------------------
{
  const wood = woodenBar(SR, 0)
  const metal = metalBar(SR, ALUMINIUM_BAR, 0)
  const light = metalBar(SR, { ...ALUMINIUM_BAR, thickness: 3, width: 0.02 }, 0)
  const on = (body: Mode[], kind: 'modal' | 'waveguide', string = GUITAR_A) => runCoupled({ string, loss: DEFAULT_LOSS, body, bridge: STIFF, kind }, 5, pluck)
  const woodModal = on(wood, 'modal')
  const metalModal = on(metal, 'modal')
  // What the body radiates: its velocity. Same gain for all, so the bodies can be compared.
  writeGroup({
    'C1-string-on-wooden-bar-the-bar-heard-modal-string': woodModal.body,
    'C2-string-on-wooden-bar-the-bar-heard-waveguide-string': on(wood, 'waveguide').body,
    'C3-string-on-aluminium-bar-the-bar-heard': metalModal.body,
  }, 'velocity of the bar: what it would radiate')
  writeGroup({ 'C4-string-on-wooden-bar-force-at-the-bridge': woodModal.bridgeForce, 'C5-string-on-aluminium-bar-force-at-the-bridge': metalModal.bridgeForce }, 'force at the bridge')
  // Strong coupling: a light bar whose first mode is the string's second partial. Energy goes back and forth.
  const tuned = on(light, 'modal', tunedTo(light[0].frequency / 2))
  writeEach({ 'C6-string-tuned-to-a-light-bar-the-bar-heard': tuned.body, 'C7-string-tuned-to-a-light-bar-force-at-the-bridge': tuned.bridgeForce }, 'second partial of the string = first mode of the bar')
  // The other direction: only the bar is struck. With the string on it, the string takes up the sound.
  const strike = { strikeBody: { impulse: 0.01 } }
  const setup: Coupled = { string: tunedTo(metal[0].frequency / 5), loss: DEFAULT_LOSS, body: metal, bridge: STIFF, kind: 'modal' }
  const withString = runCoupled(setup, 5, strike)
  const without = runCoupled({ ...setup, bridge: { stiffness: 0 } }, 5, strike)
  writeGroup({ 'C8-bar-struck-with-the-string-on-it-the-bar-heard': withString.body, 'C9-bar-struck-without-the-string-the-bar-heard': without.body }, 'the string is not plucked')
  writeGroup({ 'C10-bar-struck-the-string-answers-force-at-the-bridge': withString.bridgeForce }, 'what the string does when only the bar is struck')
}

// ---- Performance ----------------------------------------------------------------------------------
type Tick = () => void
function measure(make: () => Tick, seconds = 10) {
  const blocks = Math.round((seconds * SR) / 128)
  const speeds: number[] = []
  let worst = 0
  for (let runIndex = 0; runIndex < 4; runIndex++) {
    const tick = make()
    const t0 = performance.now()
    for (let i = 0; i < blocks; i++) {
      const b0 = performance.now()
      tick()
      if (runIndex > 0) worst = Math.max(worst, performance.now() - b0)
    }
    if (runIndex > 0) speeds.push(seconds / ((performance.now() - t0) / 1000))
  }
  const x = speeds.sort((a, b) => a - b)[1]
  return { xRealtime: Math.round(x), cpuPercentOfOneCore: fix(100 / x, 2), worstBlockMs: fix(worst, 3) }
}
const GUITAR: [string, number, number][] = [['E2', 82.41, 0.0064], ['A2', 110, 0.0036], ['D3', 146.83, 0.0021], ['G3', 196, 0.0012], ['B3', 246.94, 0.0007], ['E4', 329.63, 0.0004]]
const guitarStrings = GUITAR.map(([, f, density]) => tunedTo(f, { ...GUITAR_A, density }))

/** Modal strings on one bar in the WebAssembly engine: the path a builder would use. */
const wasmModal = (strings: StringParams[], body: Mode[] | null, limit = Infinity) => (): Tick => {
  const design = new Design(SR, false)
  const ids = strings.map((s) => design.modal(stringModes(s, [1, 0.8], SR, DEFAULT_LOSS, limit)))
  const b = body ? design.modal(body) : design.mass(1e12)
  strings.forEach((s, i) => design.spring([ids[i], 0], [b, body ? BRIDGE : 0], bridgeStiffness(1e6, residualCompliance(s, stringModes(s, [1], SR, null, limit), SR))))
  if (body) design.output([b, LISTEN])
  else ids.forEach((id) => design.output([id, 1]))
  const engine = createEngine(design)
  let i = 0
  return () => {
    if (i++ % 150 === 0) ids.forEach((id) => engine.applyForce(id, 1, 200)) // plucked again every 0.4 s
    engine.process(128)
  }
}
/** The same in the TypeScript engine, with either kind of string. */
const tsStrings = (strings: StringParams[], body: Mode[], kind: 'modal' | 'waveguide') => (): Tick => {
  const system = new System()
  const made = strings.map((s) => (kind === 'modal' ? new ModalResonator(stringModes(s, [1, 0.8], SR, DEFAULT_LOSS), SR) : new WaveguideString(s, SR, DEFAULT_LOSS)))
  const ids = made.map((r) => system.add(r))
  const b = system.add(new ModalResonator(body, SR))
  ids.forEach((id) => system.connect(new SpringDamper(1e6), { resonator: id, port: 0 }, { resonator: b, port: BRIDGE }))
  system.build(SR)
  const block = new Float32Array(128)
  let i = 0
  return () => {
    if (i++ % 150 === 0) made.forEach((r, n) => (r instanceof WaveguideString ? r.excite(0.5) : system.applyForce({ resonator: ids[n], port: 1 }, 200)))
    system.process(block, { resonator: b, port: LISTEN })
  }
}
const wood = woodenBar(SR, 0)
const modeCount = (strings: StringParams[], limit = Infinity) => strings.reduce((n, s) => n + stringModes(s, [1], SR, null, limit).length, 0)
const performanceResult: Record<string, unknown> = {
  [`wasm, modal: A2 string alone on a rigid bridge (${modeCount([GUITAR_A])} modes)`]: measure(wasmModal([GUITAR_A], null)),
  [`wasm, modal: A2 string on a wooden bar (${modeCount([GUITAR_A])} + 8 modes)`]: measure(wasmModal([GUITAR_A], wood)),
  [`wasm, modal: E2 string on a wooden bar (${modeCount([guitarStrings[0]])} + 8 modes)`]: measure(wasmModal([guitarStrings[0]], wood)),
  [`wasm, modal: six guitar strings on one bar (${modeCount(guitarStrings)} + 8 modes, 6 connections)`]: measure(wasmModal(guitarStrings, wood)),
  [`wasm, modal: six strings, 60 modes each at most (${modeCount(guitarStrings, 60)} + 8 modes)`]: measure(wasmModal(guitarStrings, wood, 60)),
  'typescript, modal: A2 string on a wooden bar': measure(tsStrings([GUITAR_A], wood, 'modal'), 5),
  'typescript, waveguide: A2 string on a wooden bar': measure(tsStrings([GUITAR_A], wood, 'waveguide'), 5),
  'typescript, waveguide: six guitar strings on one bar': measure(tsStrings(guitarStrings, wood, 'waveguide'), 5),
  'typescript, modal: six guitar strings on one bar': measure(tsStrings(guitarStrings, wood, 'modal'), 3),
  'approved Faust string (one string, body, WebAssembly)': { xRealtime: await realtimeFactor(faustString, {}, 1) },
}
// How long retuning a modal string takes: every mode is redesigned.
{
  const design = new Design(SR, false)
  const modes = stringModes(GUITAR_A, [1, 0.8], SR)
  const id = design.modal(modes)
  const engine = createEngine(design)
  const t0 = performance.now()
  for (let i = 0; i < 200; i++) modes.forEach((mode, n) => engine.tune(id, n, mode.frequency * (1 + 0.001 * (i % 50)), mode.t60))
  performanceResult[`wasm, modal: retune all ${modes.length} modes of a string (a pitch bend step)`] = { milliseconds: fix((performance.now() - t0) / 200, 4), audioBlockMs: 2.667 }
}

writeFileSync(path(`${OUT}/listening.json`), JSON.stringify(info, null, 2))
writeFileSync(path(`${OUT}/performance.json`), JSON.stringify({ sampleRate: SR, node: process.version, f0OfA2: fix(fundamental(GUITAR_A), 2), results: performanceResult }, null, 2))
console.table(info)
console.table(performanceResult)
console.log(`\nwritten to ${fsPath(OUT)}`)
