// Phase 3D.2: listening renders of the hybrid, one string tied to one metal
// bar, and its cost beside the single-string and single-bar instruments.
//
//   npm run render:string-bar
//
// Output: renders/string-bar/*.wav, listening.json (the peak and RMS of each
// file in its own unit before any gain, and the gain), measurements.json and
// performance.json. What is recorded is the bar's velocity where it is
// struck, in m/s: the listening output of every bar instrument. File 1 is
// the one exception and says so. Files in a group share one gain.
import { mkdirSync, writeFileSync } from 'node:fs'
import { EXAMPLES, STRING_EXAMPLES } from '../src/builder/examples.ts'
import { addComponent, emptyGraph, setParam } from '../src/builder/graph.ts'
import { barModes, instrumentCalls, malletStiffness, translate } from '../src/builder/translate.ts'
import { buildStringBar, type StringBar } from '../src/experimental/string/stringBar.ts'
import { pluckCall } from '../src/experimental/string/stringBody.ts'
import type { Call } from '../src/experimental/wasm/engine.ts'
import { powerSpectrum, SR } from './lib.ts'
import { fsPath, groupWriter, path } from './offline.ts'
import { createWorklet } from './worklet.ts'

const OUT = 'renders/string-bar'
mkdirSync(path(OUT), { recursive: true })
const { info, writeGroup } = groupWriter(OUT)

/** The builder's metal bar, 0.40 m x 40 x 10 mm aluminium, as the string model takes it: ports [joint, strike]. */
function bar(immovable = false) {
  const made = addComponent(emptyGraph(), 'metalBar', 0, 0)
  const modes = barModes(setParam(made.graph, made.id, 'length', 0.4).components[0], SR)
  return modes.map((mode) => ({ ...mode, mass: immovable ? 1e12 : mode.mass, shape: [mode.shape[1], mode.shape[0]] }))
}
const PLUCK = 4 // N, as the builder's example
const pair = (o: Partial<StringBar> = {}): StringBar => ({ tension: 73.5, length: 0.65, pluckAt: 0.8, bar: bar(), joint: { stiffness: 1e6, damping: 0 }, mallet: { mass: 0.02, stiffness: malletStiffness(0.5) }, outputGain: 1, ...o })
const measurements: Record<string, unknown> = {}
const N = 65536
function pitchNear(x: Float32Array, f0: number) {
  const spec = powerSpectrum(x, 9600, N)
  let best = Math.floor((0.85 * f0 * N) / SR)
  for (let k = best; k <= Math.ceil((1.12 * f0 * N) / SR); k++) if (spec[k] > spec[best]) best = k
  const [a, b, c] = [Math.log(spec[best - 1]), Math.log(spec[best]), Math.log(spec[best + 1])]
  return ((best + (0.5 * (a - c)) / (a - 2 * b + c)) * SR) / N
}

/** Plays the pair for 4 s, plucked or struck, and notes how much of the energy the other part came to hold. */
async function play(name: string, o: Partial<StringBar>, how: 'plucked' | 'struck', extra: Call[] = []) {
  const built = buildStringBar(pair(o), SR)
  const calls = [...built.calls.slice(0, -1), ...extra, ['build'] as Call]
  const worklet = await createWorklet(calls)
  worklet.send(how === 'plucked' ? [pluckCall(built, PLUCK)] : [['launch', built.mallet!, 1.5]])
  const other = how === 'plucked' ? built.bar : built.string
  let share = 0
  const out = worklet.render(4 * SR, () => {
    const total = worklet.engine.energy()
    if (total > 0) share = Math.max(share, worklet.engine.resonatorEnergy(other) / total)
  })
  if (worklet.engine.faults()) throw new Error(`${name}: engine fault`)
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  measurements[name] = {
    excitation: how === 'plucked' ? `string plucked, ${PLUCK} N` : 'bar struck, 20 g mallet at 1.5 m/s',
    peak: Number(peak.toPrecision(3)),
    [how === 'plucked' ? 'mostOfTheEnergyInTheBar_percent' : 'mostOfTheEnergyInTheString_percent']: Number((100 * share).toFixed(3)),
    ...(how === 'plucked' && peak > 0 ? { stringPitchHz: Number(pitchNear(out, 110).toFixed(2)), centsFromA2: Number((1200 * Math.log2(pitchNear(out, 110) / 109.91)).toFixed(1)) } : {}),
  }
  return out
}

// ---- 1. The string by itself ---------------------------------------------------------------------------
// Tied to a bar that cannot move, and listened to at a point on the string itself (0.3 of its length).
{
  const built = buildStringBar(pair({ bar: bar(true), mallet: undefined }), SR)
  // The string moves at metres a second, more than the audio node can carry at a gain of 1: recorded at a
  // twentieth and put back.
  const out = (await play('1-isolated-string', { bar: bar(true), mallet: undefined }, 'plucked', [['addOutput', built.string, 2, 0.05]])).map((v) => 20 * v)
  ;(measurements['1-isolated-string'] as { peak: number }).peak = Number(out.reduce((m, v) => Math.max(m, Math.abs(v)), 0).toPrecision(3))
  writeGroup('m/s (velocity of the string itself, 0.3 along it)', { '1-isolated-string-its-own-motion': out }, 'the string tied to a bar that cannot move. This is the string\'s own velocity, not a sound: a string alone moves almost no air. Its own gain')
}

// ---- 3, 5a, 6a, 7a. The string plucked, heard through the bar (one gain) --------------------------------
const WEAK = { stiffness: 1e4, damping: 0 }
const STRONG = { stiffness: 1e8, damping: 0 }
const DAMPED = { stiffness: 1e5, damping: 30 }
writeGroup('m/s (velocity of the bar where it is struck)', {
  '3-string-tied-to-bar-string-plucked': await play('3-connected-plucked', {}, 'plucked'),
  '5a-weak-coupling-1e4-N-per-m-string-plucked': await play('5a-weak-plucked', { joint: WEAK }, 'plucked'),
  '6a-strong-coupling-1e8-N-per-m-string-plucked': await play('6a-strong-plucked', { joint: STRONG }, 'plucked'),
  '7a-damped-coupling-1e5-N-per-m-and-30-N-s-per-m-string-plucked': await play('7a-damped-plucked', { joint: DAMPED }, 'plucked'),
}, 'the string is heard only through the bar; one gain for the four')

// ---- 2, 4, 5b, 6b, 7b, 8. The bar struck (one gain) ---------------------------------------------------------
writeGroup('m/s (velocity of the bar where it is struck)', {
  '2-isolated-metal-bar-struck': await play('2-isolated-bar', { joint: null }, 'struck'),
  '4-string-tied-to-bar-bar-struck': await play('4-connected-struck', {}, 'struck'),
  '5b-weak-coupling-bar-struck': await play('5b-weak-struck', { joint: WEAK }, 'struck'),
  '6b-strong-coupling-bar-struck': await play('6b-strong-struck', { joint: STRONG }, 'struck'),
  '7b-damped-coupling-bar-struck': await play('7b-damped-struck', { joint: DAMPED }, 'struck'),
  '8-connection-removed-bar-struck': await play('8-removed-struck', { joint: null }, 'struck'),
}, 'a 20 g mallet at 1.5 m/s; one gain for the six. 8 is 2 again: with the connection removed the bar is alone')

// ---- 8, plucked: nothing to write ------------------------------------------------------------------------------
const silent = await play('8-removed-plucked', { joint: null }, 'plucked')
measurements['8-removed-plucked'] = { ...(measurements['8-removed-plucked'] as object), everySampleIsZero: silent.every((v) => v === 0) }

// ---- 9. Played together, as the builder's example ---------------------------------------------------------------
{
  const graph = STRING_EXAMPLES[1].make()
  const translation = translate(graph, SR)
  if (!translation.ok) throw new Error('the hybrid example does not translate')
  const { built } = translation
  const worklet = await createWorklet(built.calls)
  const pluck: Call = instrumentCalls(graph, built)[0]
  const strike: Call = instrumentCalls(graph, built)[1]
  const parts: Float32Array[] = []
  const then = (calls: Call[], seconds: number) => (worklet.send(calls), parts.push(worklet.render(Math.round(seconds * SR))))
  // Pluck, pluck, strike; then plucks into the ringing bar; then a strike with a finger on the string.
  for (const [calls, seconds] of [[[pluck], 1], [[pluck], 1], [[strike], 1.5], [[pluck], 0.5], [[pluck], 0.5], [[pluck], 1], [[strike, pluck], 2]] as [Call[], number][]) then(calls, seconds)
  then([['touch', built.stringBody!.finger, 1.03, 0.002, -1, 0], strike], 2.5)
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0)
  // The builder's output is the bar's velocity times 0.25; put it back in m/s.
  writeGroup('m/s (velocity of the bar where it is struck)', { '9-the-builder-example-plucked-and-struck-in-turn': out.map((v) => v * 4) }, 'plucks of 4 N and mallet strokes at 1.5 m/s in turn; the last stroke with a finger resting on the string. Its own gain')
}

// ---- Performance (Node): the hybrid beside one string on its box and one bar with its mallet ----------------------
async function timed(graph: ReturnType<(typeof EXAMPLES)[number]['make']>) {
  const translation = translate(graph, SR)
  if (!translation.ok) throw new Error('does not translate')
  const speeds: number[] = []
  let worst = 0
  for (let runIndex = 0; runIndex < 4; runIndex++) {
    const worklet = await createWorklet(translation.built.calls)
    const play = instrumentCalls(graph, translation.built)
    const t0 = performance.now()
    let before = 0
    worklet.render(10 * SR, (block) => {
      const now = performance.now()
      if (runIndex > 0 && block > 0) worst = Math.max(worst, now - before)
      before = now
      if (block % 120 === 0) worklet.send(play) // three times a second
    })
    if (runIndex > 0) speeds.push(10 / ((performance.now() - t0) / 1000))
  }
  const x = speeds.sort((a, b) => a - b)[1]
  const modes = translation.built.calls.filter((c) => c[0] === 'setMode').length
  return { modes, connections: translation.built.calls.filter((c) => c[0] === 'addSpring' || c[0] === 'addContact').length, cpuPercentOfOneCore: Number((100 / x).toFixed(2)), longestBlockMs: Number(worst.toFixed(3)) }
}
const performanceResult = {
  'hybrid: string tied to a metal bar, with a mallet': await timed(STRING_EXAMPLES[1].make()),
  'string on its damped box': await timed(STRING_EXAMPLES[0].make()),
  'one metal bar and a mallet': await timed(EXAMPLES[0].make()),
}

writeFileSync(path(`${OUT}/listening.json`), JSON.stringify({ sampleRate: SR, string: 'A2: 73.5 N, 0.65 m, 3.6 g/m, plucked at 0.8', bar: 'aluminium, 0.40 m x 40 mm x 10 mm, tied at 0.1 of its length, struck and heard at 0.35', files: info }, null, 2))
writeFileSync(path(`${OUT}/measurements.json`), JSON.stringify(measurements, null, 2))
writeFileSync(path(`${OUT}/performance.json`), JSON.stringify({ sampleRate: SR, node: process.version, blockBudgetMs: 2.667, playedThreeTimesASecond: true, results: performanceResult }, null, 2))
console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => [k, Object.fromEntries(Object.entries(v as object).filter(([key]) => !['note', 'quantity', 'gainApplied'].includes(key)))])))
console.table(measurements)
console.table(performanceResult)
console.log(`\nwritten to ${fsPath(OUT)}`)
