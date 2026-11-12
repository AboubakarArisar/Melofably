// Phase 3A.1: listening renders of the WebAssembly physics engine.
//
//   npm run render:wasm
//
// Output: renders/wasm-engine/*.wav and renders/wasm-engine/listening.json.
// Every file is rendered through process() in 128-sample blocks, exactly as
// the AudioWorklet runs the engine; events fall on block boundaries.
import { mkdirSync, writeFileSync } from 'node:fs'
import { INSTANT, RAMP, ZERO_CROSSING } from '../src/experimental/wasm/engine.ts'
import { LAYOUTS, toCalls, toSystem, tuneCalls, type Layout } from '../src/experimental/wasm/layouts.ts'
import { peak, SR } from './lib.ts'
import { fsPath, path, writeWav } from './offline.ts'
import { createEngine, render, run, type Engine } from './wasm.ts'

const OUT = 'renders/wasm-engine'
mkdirSync(path(OUT), { recursive: true })
const fix = (v: number, d = 3) => Number(v.toFixed(d))
const scaled = (x: Float32Array, gain: number) => Float32Array.from(x, (v) => v * gain)
const info: Record<string, unknown> = {}

type Built = ReturnType<typeof toCalls> & { engine: Engine; layout: Layout }
function build(layout: Layout, corrected = true): Built {
  const built = toCalls(layout, SR, corrected)
  const engine = createEngine()
  run(engine, built.calls)
  return { ...built, engine, layout }
}
const BLOCKS_PER_SECOND = SR / 128
/** Renders `seconds`; `events` maps a time in seconds to what happens then (rounded to a block). */
function play(b: Built, seconds: number, events: [number, (b: Built) => void][]): Float32Array {
  const at = new Map<number, ((b: Built) => void)[]>()
  for (const [time, action] of events) {
    const block = Math.round(time * BLOCKS_PER_SECOND)
    at.set(block, [...(at.get(block) ?? []), action])
  }
  return render(b.engine, new Float32Array(Math.round(seconds * SR)), (block) => at.get(block)?.forEach((action) => action(b)))
}
/** Writes a group of files with one common gain (loudest peaks at 0.5), so their relative loudness is real. */
function writeGroup(files: Record<string, Float32Array>) {
  const gain = 0.5 / Math.max(...Object.values(files).map((x) => peak(x)))
  for (const [name, x] of Object.entries(files)) {
    if (!x.every(Number.isFinite)) throw new Error(`${name}: non-finite samples`)
    writeWav(`${OUT}/${name}.wav`, scaled(x, gain))
    info[name] = { seconds: fix(x.length / SR, 2), peakAfterGain: fix(peak(x) * gain), gain: fix(gain, 2) }
  }
}
const PULSE = 0.0005 // s, contact time of the approved-style pulse strike
const strike = (index: number, impulse = 0.05) => (b: Built) => b.engine.strike(...b.layout.strikePorts[index], impulse, PULSE)
const mallet = (index: number, speed: number) => (b: Built) => b.engine.launch(b.mallets[index], speed)

// ---- P. TypeScript reference against WebAssembly ---------------------------------
// Two coupled bars struck with the hard mallet, then the soft one. Uncorrected
// springs, so the two engines are computing the same thing.
{
  const layout = LAYOUTS.twoBars(SR)
  const N = 4 * SR
  const ts = toSystem(layout, SR)
  const reference = new Float32Array(N)
  const [a, bPort] = [{ resonator: 0, port: 1 }, { resonator: 1, port: 1 }]
  for (let n = 0; n < N; n++) {
    if (n === 0) ts.mallets[1].setVelocity(1.5)
    if (n === 2 * SR) ts.mallets[0].setVelocity(1) // the soft mallet, also from a metre away
    ts.system.step()
    reference[n] = 0.7 * (ts.system.velocity(a) + ts.system.velocity(bPort))
  }
  const b = build(layout, false)
  // The reference's mallets start a metre away and are simply given a velocity; do the same here.
  const malletResonators = [2, 3]
  const wasm = new Float32Array(N)
  for (let n = 0; n < N; n++) {
    if (n === 0) b.engine.setVelocity(malletResonators[1], 1.5)
    if (n === 2 * SR) b.engine.setVelocity(malletResonators[0], 1)
    b.engine.step()
    wasm[n] = b.engine.output()
  }
  let worst = 0
  for (let n = 0; n < N; n++) worst = Math.max(worst, Math.abs(wasm[n] - reference[n]))
  const difference = Float32Array.from(wasm, (v, n) => (v - reference[n]) * 1e6)
  const gain = 0.5 / peak(reference)
  writeWav(`${OUT}/P1-typescript-reference.wav`, scaled(reference, gain))
  writeWav(`${OUT}/P2-webassembly-engine.wav`, scaled(wasm, gain))
  writeWav(`${OUT}/P3-difference-times-one-million.wav`, scaled(difference, gain))
  info['P: parity'] = { largestSampleDifference: worst, relativeToPeak: worst / peak(reference), note: 'P3 is (P2 - P1) x 1,000,000 at the same gain. The mallets fly a metre before they land: the first sound is at 0.67 s.' }
}

// ---- M. One metal bar -------------------------------------------------------------------
writeGroup({
  'M1-one-bar-pulse-strikes-soft-to-hard': play(build(LAYOUTS.oneBar(SR)), 6, [
    [0, strike(0, 0.02)],
    [1.5, strike(0, 0.05)],
    [3, strike(0, 0.1)],
  ]),
})

// ---- C. Two bars ---------------------------------------------------------------------------
{
  const uncoupled: Layout = { ...LAYOUTS.twoBars(SR), springs: [] }
  writeGroup({
    'C1-two-bars-not-connected-A-struck': play(build(uncoupled), 4, [[0, strike(0)]]),
    'C2-two-bars-coupled-A-struck': play(build(LAYOUTS.twoBars(SR)), 4, [[0, strike(0)]]),
    'C3-two-bars-coupled-B-struck': play(build(LAYOUTS.twoBars(SR)), 4, [[0, strike(1)]]),
    'C4-two-bars-coupled-ten-times-stiffer-A-struck': play(build({ ...LAYOUTS.twoBars(SR), springs: [{ a: [0, 0], b: [1, 0], stiffness: 4e6, damping: 1 }] }), 4, [[0, strike(0)]]),
  })
}

// ---- T. Three coupled bars -----------------------------------------------------------------
writeGroup({
  'T1-three-coupled-bars-A-then-B-then-C': play(build(LAYOUTS.threeBars(SR)), 9, [
    [0, strike(0)],
    [3, strike(1)],
    [6, strike(2)],
  ]),
  'T2-three-coupled-bars-all-at-once': play(build(LAYOUTS.threeBars(SR)), 4, [
    [0, strike(0)],
    [0, strike(1)],
    [0, strike(2)],
  ]),
})

// ---- H. Physical mallets (a free mass meeting the bar through a Hertz contact) ---------------
{
  const hits = (index: number) => {
    const b = build(LAYOUTS.oneBar(SR))
    const x = play(b, 8, [
      [0, mallet(index, 0.5)],
      [2, mallet(index, 1)],
      [4, mallet(index, 2)],
      [6, mallet(index, 4)],
    ])
    return { x, newton: b.engine.worstIterations() }
  }
  const [soft, hard] = [hits(0), hits(1)]
  // Separate gains: at one common gain the soft mallet's quietest hit would be hard to hear.
  writeGroup({ 'H1-soft-mallet-0.5-1-2-4-metres-per-second': soft.x })
  writeGroup({ 'H2-hard-mallet-0.5-1-2-4-metres-per-second': hard.x })
  info['H: mallets'] = { softNewtonIterationsWorst: soft.newton, hardNewtonIterationsWorst: hard.newton, hardToSoftPeakRatio: fix(peak(hard.x) / peak(soft.x), 2) }
}

// ---- L. Editing while it sounds -----------------------------------------------------------------
{
  const ramp = Math.round(0.01 * SR)
  const stiffness = (policy: number) => {
    const b = build(LAYOUTS.twoBars(SR))
    const k = b.springs[0].spring
    return play(b, 5, [
      [0, strike(0)],
      [0.8, () => b.engine.setStiffness(k, 4e6, policy, ramp)],
      [1.6, () => b.engine.setStiffness(k, 4e5, policy, ramp)],
      [2.4, () => b.engine.setStiffness(k, 4e6, policy, ramp)],
      [3.2, () => b.engine.setStiffness(k, 4e5, policy, ramp)],
    ])
  }
  const damping = (() => {
    const b = build(LAYOUTS.twoBars(SR))
    return play(b, 4, [
      [0, strike(0)],
      [1, () => b.engine.setDamping(b.springs[0].damper, 40)],
    ])
  })()
  const topology = (() => {
    const b = build(LAYOUTS.threeBars(SR))
    const joint = b.springs[1].spring
    b.engine.setStiffness(joint, 0, INSTANT, 0) // start with the third bar not connected
    return play(b, 8, [
      [0, strike(1)],
      [1.5, () => (b.engine.attach(joint), b.engine.setStiffness(joint, 2e5, INSTANT, 0))],
      [3, () => b.engine.setStiffness(joint, 0, ZERO_CROSSING, 0)],
      [4, strike(1)],
      [5.5, () => (b.engine.attach(joint), b.engine.setStiffness(joint, 2e5, INSTANT, 0))],
    ])
  })()
  const glide = (() => {
    const b = build(LAYOUTS.twoBars(SR))
    const events: [number, (b: Built) => void][] = [[0, strike(0)]]
    // Up a fourth over one second, one small step per block, then back down.
    for (let i = 0; i <= BLOCKS_PER_SECOND; i++) {
      const up = 1 + (0.335 * i) / BLOCKS_PER_SECOND
      events.push([1 + i / BLOCKS_PER_SECOND, () => run(b.engine, tuneCalls(b.layout, 0, up))])
      events.push([3 + i / BLOCKS_PER_SECOND, () => run(b.engine, tuneCalls(b.layout, 0, 1.335 - (0.335 * i) / BLOCKS_PER_SECOND))])
    }
    return play(b, 6, events)
  })()
  const decay = (() => {
    const b = build(LAYOUTS.oneBar(SR))
    return play(b, 4, [
      [0, strike(0)],
      [1, () => run(b.engine, tuneCalls(b.layout, 0, 1, 0.05))], // decay times x 0.05: a hand laid on the bar
      [2, strike(0)],
      [2.5, () => run(b.engine, tuneCalls(b.layout, 0, 1, 1))], // lifted again
      [2.6, strike(0)],
    ])
  })()
  writeGroup({
    'L1-connection-stiffness-x10-and-back-ramped-10ms': stiffness(RAMP),
    'L2-connection-stiffness-x10-and-back-instant': stiffness(INSTANT),
    'L3-connection-stiffness-x10-and-back-at-zero-crossing': stiffness(ZERO_CROSSING),
    'L4-connection-damping-raised-at-1s': damping,
    'L5-third-bar-connected-at-1.5s-released-at-3s-connected-at-5.5s': topology,
    'L6-bar-A-glides-up-a-fourth-and-back-while-ringing': glide,
    'L7-bar-damped-at-1s-and-released': decay,
  })
}

// ---- X. A short phrase --------------------------------------------------------------------------
{
  // The 25 bars are a quarter-tone apart, so a semitone is two bars.
  const semitone = (n: number) => 2 * n
  const melody: [number, number, number][] = [
    // [time s, semitones above the lowest bar, impulse]
    [0.0, 0, 0.06], [0.3, 4, 0.05], [0.6, 7, 0.05], [0.9, 12, 0.07],
    [1.2, 11, 0.04], [1.5, 7, 0.05], [1.8, 9, 0.05], [2.1, 5, 0.04],
    [2.4, 4, 0.05], [2.7, 2, 0.04], [3.0, 4, 0.05], [3.3, 7, 0.06],
    [3.6, 0, 0.08], [3.6, 4, 0.06], [3.6, 7, 0.06], [3.6, 12, 0.05],
  ]
  const phrase = play(build(LAYOUTS.keyboard(SR)), 8, melody.map(([time, note, impulse]) => [time, strike(semitone(note), impulse)]))
  // The same idea on the three coupled bars, bar A played with the physical mallets.
  const coupled = play(build(LAYOUTS.threeBars(SR)), 8, [
    [0.0, mallet(1, 1.5)], [0.4, strike(1, 0.04)], [0.8, strike(2, 0.04)], [1.2, mallet(0, 2)],
    [1.6, strike(1, 0.05)], [2.0, mallet(1, 0.8)], [2.2, mallet(1, 1.2)], [2.4, mallet(1, 2)],
    [2.8, strike(2, 0.05)], [3.2, strike(1, 0.05)], [3.6, mallet(1, 2.5)], [3.6, strike(1, 0.05)], [3.6, strike(2, 0.05)],
  ])
  writeGroup({ 'X1-phrase-on-the-25-bars': phrase })
  writeGroup({ 'X2-phrase-on-three-coupled-bars-with-mallets': coupled })
}

writeFileSync(path(`${OUT}/listening.json`), JSON.stringify(info, null, 2))
console.table(Object.fromEntries(Object.entries(info).filter(([, v]) => typeof (v as { gain?: number }).gain === 'number')))
console.log(info['P: parity'], info['H: mallets'])
console.log(`\nWAV files written to ${fsPath(OUT)}`)
