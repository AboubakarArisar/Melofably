// Phase 3A.1: Node benchmarks of the TypeScript reference engine, the
// WebAssembly engine and the approved Faust metal bar, on one thread.
//
//   npm run bench:wasm
//
// Output: renders/wasm-engine/benchmarks-node.json. The browser figures come
// from the test page (experimental.html, "Run benchmarks").
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { FaustMonoDspGenerator } from '@grame/faustwasm/dist/esm/index.js'
import { instantiate, run } from '../src/experimental/wasm/engine.ts'
import { LAYOUTS, toCalls, toSystem, type Layout } from '../src/experimental/wasm/layouts.ts'
import { makeInstrument, SR } from './lib.ts'
import { fsPath, path } from './offline.ts'
import { engineBytes } from './wasm.ts'

const BLOCK = 128
const fix = (v: number, d = 3) => Number(v.toFixed(d))
type Tick = () => void

/** Median speed and the slowest single block over three measured runs of `seconds` of audio. */
function measure(make: () => Tick, seconds = 10) {
  const blocks = Math.round((seconds * SR) / BLOCK)
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
    if (runIndex > 0) speeds.push(seconds / ((performance.now() - t0) / 1000)) // run 0 is the warm-up
  }
  const x = speeds.sort((a, b) => a - b)[1]
  return { xRealtime: Math.round(x), cpuPercentOfOneCore: fix(100 / x, 2), avgBlockMs: fix(2.6667 / x, 4), worstBlockMs: fix(worst, 3) }
}

type Mode = 'playing' | 'idle' | 'decayed'
const IMPULSE = 0.01 * SR // one-sample force of impulse 0.01 N s

/** A block function for the WebAssembly engine: every bar struck every 37 blocks (0.1 s), or not at all. */
const wasm = (layout: Layout, mode: Mode) => (): Tick => {
  const engine = instantiate(engineBytes)
  run(engine, toCalls(layout, SR).calls)
  const strike = () => layout.strikePorts.forEach(([r, p]) => engine.applyForce(r, p, IMPULSE))
  if (mode === 'decayed') {
    strike()
    for (let i = 0; i < (60 * SR) / BLOCK; i++) engine.process(BLOCK) // a minute of ringing down, not timed
  }
  let i = 0
  return () => {
    if (mode === 'playing' && i++ % 37 === 0) strike()
    engine.process(BLOCK)
  }
}

const typescript = (layout: Layout, mode: Mode) => (): Tick => {
  const { system, output, strikePorts } = toSystem(layout, SR)
  const block = new Float32Array(BLOCK)
  const strike = () => strikePorts.forEach((port) => system.applyForce(port, IMPULSE))
  if (mode === 'decayed') {
    strike()
    for (let i = 0; i < (60 * SR) / BLOCK; i++) system.process(block, output)
  }
  let i = 0
  return () => {
    if (mode === 'playing' && i++ % 37 === 0) strike()
    system.process(block, output)
  }
}

// The exact Faust artifact the browser loads.
const faustDir = 'src/audio/models/generated/bar'
const faustBytes = readFileSync(path(`${faustDir}/dsp-module.wasm`))
const faustFactory = { module: await WebAssembly.compile(faustBytes), json: readFileSync(path(`${faustDir}/dsp-meta.json`), 'utf8'), soundfiles: {} }
const faustInstrument = async () => makeInstrument(await new FaustMonoDspGenerator().createOfflineProcessor(SR, BLOCK, faustFactory), {}, SR, 'strike')
async function faust(mode: Mode, seconds = 10) {
  const speeds: number[] = []
  for (let runIndex = 0; runIndex < 4; runIndex++) {
    const inst = await faustInstrument()
    if (mode !== 'idle') {
      for (let k = 0; k < 25; k++) {
        inst.set({ key: k })
        inst.play(0.01)
      }
    }
    if (mode === 'decayed') inst.render(60)
    const t0 = performance.now()
    inst.render(seconds) // one call: the per-block time cannot be observed from outside
    if (runIndex > 0) speeds.push(seconds / ((performance.now() - t0) / 1000))
  }
  const x = speeds.sort((a, b) => a - b)[1]
  return { xRealtime: Math.round(x), cpuPercentOfOneCore: fix(100 / x, 2), avgBlockMs: fix(2.6667 / x, 4), worstBlockMs: 'not observable (rendered in one call)' }
}

const noMallets = (layout: Layout): Layout => ({ ...layout, mallets: [] })
const scenarios: [string, Layout, Mode][] = [
  ['one bar (8 modes)', noMallets(LAYOUTS.oneBar(SR)), 'playing'],
  ['two coupled bars (16 modes, spring and damper)', noMallets(LAYOUTS.twoBars(SR)), 'playing'],
  ['three coupled bars (24 modes, two springs)', noMallets(LAYOUTS.threeBars(SR)), 'playing'],
  ['three coupled bars with two mallets attached', LAYOUTS.threeBars(SR), 'playing'],
  ['25 independent bars (200 modes), all struck every 0.1 s', LAYOUTS.keyboard(SR), 'playing'],
  ['25 independent bars, idle (never struck)', LAYOUTS.keyboard(SR), 'idle'],
  ['25 independent bars, idle after ringing down for a minute', LAYOUTS.keyboard(SR), 'decayed'],
  ['one resonator, 200 modes', LAYOUTS.manyModes(200)(), 'playing'],
  ['one resonator, 500 modes', LAYOUTS.manyModes(500)(), 'playing'],
]

const speed: Record<string, Record<string, unknown>> = {}
for (const [name, layout, mode] of scenarios) {
  speed[name] = { typescript: measure(typescript(layout, mode)), wasm: measure(wasm(layout, mode)) }
  if (layout.resonators.length === 25) speed[name].faust = await faust(mode)
  console.log(name, JSON.stringify(speed[name]))
}

// ---- Start-up time and memory ------------------------------------------------------
const median = (f: () => void, runs = 15) => {
  const times = Array.from({ length: runs }, () => {
    const t0 = performance.now()
    f()
    return performance.now() - t0
  })
  return fix(times.sort((a, b) => a - b)[Math.floor(runs / 2)], 3)
}
const keyboard = LAYOUTS.keyboard(SR)
const keyboardCalls = toCalls(keyboard, SR).calls
const faustTimes: number[] = []
for (let i = 0; i < 9; i++) {
  const t0 = performance.now()
  await faustInstrument()
  faustTimes.push(performance.now() - t0)
}
const engine = instantiate(engineBytes)
const startup = {
  'wasm: compile the module': `${median(() => new WebAssembly.Module(engineBytes))} ms`,
  'wasm: instantiate and build 25 bars': `${median(() => run(instantiate(engineBytes), keyboardCalls))} ms`,
  'wasm: engine calls to build 25 bars': keyboardCalls.length,
  'typescript: build 25 bars': `${median(() => void toSystem(keyboard, SR))} ms`,
  'faust: compile the approved bar module': `${median(() => new WebAssembly.Module(faustBytes), 7)} ms`,
  'faust: create an instance of the approved bar': `${fix(faustTimes.sort((a, b) => a - b)[4], 3)} ms`,
}
const sizes = {
  'wasm engine binary, bytes': statSync(path('src/experimental/wasm/generated/engine.wasm')).size,
  'wasm engine memory, bytes (fixed; holds up to 16384 modes, 128 resonators, 32 connections)': engine.memory.buffer.byteLength,
  'approved Faust bar binary, bytes': faustBytes.length,
  'typescript engine source, bytes (resonator + connections + system)': ['resonator', 'connections', 'system'].reduce((s, f) => s + statSync(path(`src/experimental/physics/${f}.ts`)).size, 0),
  // 14 Float64Arrays per mode-ish in the reference; counted exactly for the 25-bar system:
  'typescript engine typed-array bytes for 25 bars (200 modes)': 25 * (9 * 8 * 8 + 8 * 8 + 8 + 8 + 8) + 25 * 4 * 8,
}

mkdirSync(path('renders/wasm-engine'), { recursive: true })
const result = { machine: { node: process.version, platform: process.platform, arch: process.arch }, sampleRate: SR, blockSize: BLOCK, blockBudgetMs: 2.667, speed, startup, sizes }
writeFileSync(path('renders/wasm-engine/benchmarks-node.json'), JSON.stringify(result, null, 2))
console.table(Object.fromEntries(Object.entries(speed).map(([name, engines]) => [name, Object.fromEntries(Object.entries(engines).map(([e, r]) => [e, `${(r as { xRealtime: number }).xRealtime}x (worst block ${(r as { worstBlockMs: number }).worstBlockMs} ms)`]))])))
console.table(startup)
console.table(sizes)
console.log(`written to ${fsPath('renders/wasm-engine/benchmarks-node.json')}`)
