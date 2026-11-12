// Phase 3A: listening renders and performance measurements of the
// experimental physics engine (src/experimental/physics).
//
//   npm run render:experimental
//
// Output: renders/experimental/*.wav and renders/experimental/metrics.json.
import { writeFileSync } from 'node:fs'
import {
  ALUMINIUM_BAR,
  barModes,
  HertzContact,
  ModalResonator,
  pointMass,
  runCoupled,
  SpringDamper,
  strikeBar,
  strikeWithMallet,
  System,
  type Mode,
} from './experimental.ts'
import { peak, SR } from './lib.ts'
import { compileModel, concat, freshDir, fsPath, path, writeWav } from './offline.ts'

const OUT = 'renders/experimental'
freshDir(OUT)
const fix = (v: number, d = 2) => Number(v.toFixed(d))
const scaled = (x: Float32Array, gain: number) => Float32Array.from(x, (v) => v * gain)
const silence = (seconds: number) => new Float32Array(Math.round(seconds * SR))
/** One gain for a group of related files, so their relative loudness is kept: the loudest peaks at 0.5. */
const commonGain = (files: Float32Array[]) => 0.5 / Math.max(...files.map((f) => peak(f)))

// ---- A. Metal bar parity ------------------------------------------------------
const stroke = { strikePosition: 0.35, hardness: 0.6, velocity: 0.8 }
const faustBar = await compileModel('src/audio/models/bar.dsp', 'strike')
const faust = (await faustBar(stroke)).play(3)
const engineBar = strikeBar({ ...stroke, seconds: 3 })
const engine = scaled(engineBar.velocity, engineBar.toFaust)
const raw = strikeBar({ ...stroke, seconds: 3, prewarp: 'none' })
writeWav(`${OUT}/A1-approved-faust-bar.wav`, faust)
writeWav(`${OUT}/A2-experimental-engine-bar.wav`, engine)
writeWav(`${OUT}/A3-faust-then-engine.wav`, concat([faust, silence(0.4), engine]))
// The difference between the two, made 100 times (40 dB) louder so it can be heard at all.
writeWav(`${OUT}/A4-difference-times-100.wav`, Float32Array.from(faust, (v, i) => (engine[i] - v) * 100))
writeWav(`${OUT}/A5-engine-without-frequency-correction.wav`, scaled(raw.velocity, raw.toFaust))

// ---- B. Coupling ----------------------------------------------------------------
const barA = barModes(ALUMINIUM_BAR, [0.1], SR)
const barB = barModes({ ...ALUMINIUM_BAR, length: 0.32 }, [0.3], SR)
const both = (r: { a: Float32Array; b: Float32Array }) => Float32Array.from(r.a, (v, i) => v + r.b[i])
// Mixing: each bar struck on its own, the two recordings added together.
const aAlone = runCoupled({ a: barA, b: barB, spring: null, impulse: 0.01, seconds: 3 })
const bAlone = runCoupled({ a: barB, b: barA, spring: null, impulse: 0.01, seconds: 3 })
const mixed = Float32Array.from(aAlone.a, (v, i) => v + bAlone.a[i])
// Coupling: the same two bars joined by a spring, only bar A struck.
const soft = both(runCoupled({ a: barA, b: barB, spring: new SpringDamper(4e5, 1), impulse: 0.01, seconds: 3 }))
const stiff = both(runCoupled({ a: barA, b: barB, spring: new SpringDamper(4e6, 1), impulse: 0.01, seconds: 3 }))
const onlyA = aAlone.a
const gB = commonGain([mixed, soft, stiff, onlyA])
writeWav(`${OUT}/B1-bar-A-alone.wav`, scaled(onlyA, gB))
writeWav(`${OUT}/B2-two-bars-mixed-not-coupled.wav`, scaled(mixed, gB))
writeWav(`${OUT}/B3-two-bars-coupled-by-spring.wav`, scaled(soft, gB))
writeWav(`${OUT}/B4-two-bars-coupled-by-stiffer-spring.wav`, scaled(stiff, gB))
// Two identical 440 Hz oscillators, weakly coupled: energy visibly and audibly
// passes from the struck one to the other and back, four times a second.
const osc: Mode[] = [{ frequency: 440, t60: 8, mass: 0.1, shape: [1] }]
const weak = (0.1 * ((2 * Math.PI * 444) ** 2 - (2 * Math.PI * 440) ** 2)) / 2
const beating = runCoupled({ a: osc, b: osc, spring: new SpringDamper(weak), impulse: 0.01, seconds: 4 })
const gBeat = commonGain([beating.a, beating.b])
writeWav(`${OUT}/B5-coupled-oscillators-the-struck-one.wav`, scaled(beating.a, gBeat))
writeWav(`${OUT}/B6-coupled-oscillators-the-other-one.wav`, scaled(beating.b, gBeat))

// ---- C. Mallet contact -------------------------------------------------------------
const struckBar = barModes(ALUMINIUM_BAR, [0.35], SR)
const hits = [
  { name: 'C1-soft-mallet-slow', stiffness: 1e7, velocity: 0.5 },
  { name: 'C2-soft-mallet-fast', stiffness: 1e7, velocity: 2 },
  { name: 'C3-hard-mallet-slow', stiffness: 1e9, velocity: 0.5 },
  { name: 'C4-hard-mallet-fast', stiffness: 1e9, velocity: 2 },
].map((h) => ({ ...h, result: strikeWithMallet({ target: struckBar, malletMass: 0.02, velocity: h.velocity, stiffness: h.stiffness, seconds: 3 }) }))
const gC = commonGain(hits.map((h) => h.result.velocity))
const contact: Record<string, unknown> = {}
for (const h of hits) {
  writeWav(`${OUT}/${h.name}.wav`, scaled(h.result.velocity, gC))
  contact[h.name] = {
    contact_ms: fix(1000 * h.result.lastContactTime, 3),
    peakForce_N: fix(h.result.peakForce, 1),
    reboundVelocity: fix(h.result.malletVelocityAfter, 3),
    newtonIterationsWorst: h.result.worstIterations,
    peakAfterGain: fix(peak(h.result.velocity) * gC, 3),
  }
}

// ---- D. Live editing ---------------------------------------------------------------
function liveEdit(policy: 'instant' | 'ramp' | 'zero-crossing') {
  const spring = new SpringDamper(4e5, 1)
  const system = new System()
  const a = { resonator: system.add(new ModalResonator(barA, SR)), port: 0 }
  const b = { resonator: system.add(new ModalResonator(barB, SR)), port: 0 }
  system.connect(spring, a, b)
  system.build(SR)
  const out = new Float32Array(3 * SR)
  for (let n = 0; n < out.length; n++) {
    if (n === 0) system.applyForce(a, 0.01 * SR)
    // Ten times stiffer at 0.3 s, back again at 0.9 s, while it rings.
    if (n === Math.round(0.3 * SR)) spring.setStiffness(4e6, policy, 480)
    if (n === Math.round(0.9 * SR)) spring.setStiffness(4e5, policy, 480)
    system.step()
    out[n] = system.velocity(a) + system.velocity(b)
  }
  return out
}
const edits = { instant: liveEdit('instant'), ramp: liveEdit('ramp'), 'zero-crossing': liveEdit('zero-crossing') }
const gD = commonGain(Object.values(edits))
writeWav(`${OUT}/D1-stiffness-changed-instantly.wav`, scaled(edits.instant, gD))
writeWav(`${OUT}/D2-stiffness-ramped-over-10ms.wav`, scaled(edits.ramp, gD))
writeWav(`${OUT}/D3-stiffness-changed-at-zero-crossing.wav`, scaled(edits['zero-crossing'], gD))

// ---- Performance --------------------------------------------------------------------
/** Times faster than real time, median of three runs of `seconds` of audio in 128-sample blocks. */
function speed(make: () => (block: Float32Array) => void, seconds = 10) {
  const block = new Float32Array(128)
  const blocks = Math.round((seconds * SR) / 128)
  const runs: number[] = []
  let worstBlockMs = 0
  for (let run = 0; run < 4; run++) {
    const tick = make()
    const t0 = performance.now()
    for (let i = 0; i < blocks; i++) {
      const b0 = performance.now()
      tick(block)
      if (run > 0) worstBlockMs = Math.max(worstBlockMs, performance.now() - b0)
    }
    if (run > 0) runs.push(seconds / ((performance.now() - t0) / 1000)) // run 0 is warm-up
  }
  return { xRealtime: Math.round(runs.sort((x, y) => x - y)[1]), worstBlockMs: fix(worstBlockMs, 3) }
}
const synthetic = (count: number): Mode[] =>
  Array.from({ length: count }, (_, n) => ({ frequency: 100 + (17000 * n) / count, t60: 2, mass: 0.3, shape: [1] }))
const single = (modes: Mode[]) => () => {
  const system = new System()
  const p = { resonator: system.add(new ModalResonator(modes, SR)), port: 0 }
  system.build(SR)
  let i = 0
  return (block: Float32Array) => {
    if (i++ % 37 === 0) system.applyForce(p, 480)
    system.process(block, p)
  }
}
const performanceResult: Record<string, unknown> = {
  'one 8-mode bar': speed(single(barA)),
  'two 8-mode bars joined by a spring': speed(() => {
    const system = new System()
    const a = { resonator: system.add(new ModalResonator(barA, SR)), port: 0 }
    const b = { resonator: system.add(new ModalResonator(barB, SR)), port: 0 }
    system.connect(new SpringDamper(4e5, 1), a, b)
    system.build(SR)
    let i = 0
    return (block) => {
      if (i++ % 37 === 0) system.applyForce(a, 480)
      system.process(block, a)
    }
  }),
  'mallet striking an 8-mode bar (Hertz contact)': speed(() => {
    const system = new System()
    const mallet = pointMass(0.02, SR)
    const m = { resonator: system.add(mallet), port: 0 }
    const bar = { resonator: system.add(new ModalResonator(struckBar, SR)), port: 0 }
    system.connect(new HertzContact(1e8), m, bar, -0.001)
    system.build(SR)
    let i = 0
    return (block) => {
      if (i++ % 37 === 0) mallet.setVelocity(1)
      system.process(block, bar)
    }
  }),
}
for (const count of [8, 16, 32, 64, 128, 256]) performanceResult[`one resonator, ${count} modes`] = speed(single(synthetic(count)), 5)
for (const voices of [1, 8, 25]) {
  performanceResult[`${voices} independent 8-mode bars (${voices * 8} modes)`] = speed(() => {
    const system = new System()
    const ports = Array.from({ length: voices }, (_, v) => ({ resonator: system.add(new ModalResonator(barModes(ALUMINIUM_BAR, [0.35], SR, v), SR)), port: 0 }))
    system.build(SR)
    let i = 0
    return (block) => {
      if (i++ % 37 === 0) for (const p of ports) system.applyForce(p, 480)
      system.process(block, ports[0])
    }
  }, 5)
}
// The approved Faust bar (25 bars x 8 modes, WebAssembly) in the same process, for scale.
{
  const inst = await faustBar({})
  for (let k = 0; k < 25; k++) {
    inst.set({ key: k })
    inst.play(0.01)
  }
  inst.render(2)
  const t0 = performance.now()
  inst.render(10)
  performanceResult['approved Faust bar: 25 bars x 8 modes, WebAssembly'] = { xRealtime: Math.round(10 / ((performance.now() - t0) / 1000)) }
}

writeFileSync(path(`${OUT}/metrics.json`), JSON.stringify({ contact, performance: performanceResult }, null, 2))
console.table(contact)
console.table(performanceResult)
console.log('xRealtime: times faster than real time on one thread. A 128-sample block must finish within 2.667 ms.')
console.log(`\nWAV files and metrics.json written to ${fsPath(OUT)}`)
