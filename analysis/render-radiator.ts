// Phase 3D.4: listening files for the experimental 16-point radiator, its
// comparison with the Phase 3D.3 reference, and its cost in Node.
//
//   npm run render:radiator
//
// For each instrument ONE way of playing it is rendered twice: as it is
// heard today (the approved output: the bar's velocity where it is struck),
// and through the real-time radiator (the AudioWorklet processor's
// 'radiator' on 16 engine taps): sound pressure in free air, 1 m from the
// bar's middle, 45 degrees off the line straight out from its face.
//
// Output: renders/radiator/*.wav, listening.json (each file's peak and RMS in
// its own unit before any gain, and the gain), measurements.json (against
// the reference) and performance.json. The pressure is a model's and is not
// calibrated against any measurement. The files are scaled for listening
// only; the gain of each is in listening.json.
import { mkdirSync, writeFileSync } from 'node:fs'
import { EXAMPLES, RADIATION_EXAMPLES, STRING_EXAMPLES } from '../src/builder/examples.ts'
import { addComponent, connect, emptyGraph, type Graph } from '../src/builder/graph.ts'
import { instrumentCalls, LISTENER, LISTENER_FULL_SCALE, translate } from '../src/builder/translate.ts'
import type { Call } from '../src/experimental/wasm/engine.ts'
import { SR } from './lib.ts'
import { fsPath, groupWriter, path } from './offline.ts'
import { frequenciesOf, geometryOf, modalVelocities, partial, pressureByRadiator, pressureByTransfer, velocityOutput, type Radiating } from './radiation.ts'
import { createWorklet } from './worklet.ts'

const OUT = 'renders/radiator'
mkdirSync(path(OUT), { recursive: true })
const { info, writeGroup } = groupWriter(OUT)
const dB = (ratio: number) => Number((20 * Math.log10(ratio)).toFixed(2))
const largest = (x: ArrayLike<number>) => {
  let m = 0
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]))
  return m
}
const barOf = (graph: Graph) => graph.components.find((c) => c.type === 'metalBar' || c.type === 'woodBar')!
function woodAndMallet(): Graph {
  const bar = addComponent(emptyGraph(), 'woodBar', 300, 300)
  const mallet = addComponent(bar.graph, 'mallet', 300, 100)
  return connect(mallet.graph, mallet.id, bar.id).graph
}
const measurements: Record<string, unknown> = {}

/** One instrument, one way of playing it: the approved output and the radiator's, and the radiator against the reference. */
async function pair(prefix: string, name: string, o: Radiating, at: number[], labels: string[]) {
  const velocity = await velocityOutput(o)
  const realTime = await pressureByRadiator(o, LISTENER_FULL_SCALE)
  const reference = pressureByTransfer((await modalVelocities(o)).modes, geometryOf(o.bar), o.listener)
  const late = Math.round(realTime.delay * SR)
  writeGroup('m/s (velocity of the bar where it is struck)', { [`${prefix}a-${name}-approved-output-velocity`]: velocity }, 'what is heard today; its own gain')
  writeGroup('Pa', { [`${prefix}b-${name}-experimental-pressure`]: realTime.pressure }, `the same playing, through the real-time 16-point radiator: free air, 1 m, 45 degrees; ${((1000 * late) / SR).toFixed(2)} ms late (the bar's length over the speed of sound); its own gain; a model's pressure, not calibrated against any measurement`)
  measurements[name] = {
    peak: { velocity_m_per_s: Number(largest(velocity).toPrecision(3)), pressure_Pa: Number(largest(realTime.pressure).toPrecision(3)), pressure_dB_re_reference: dB(largest(realTime.pressure) / largest(reference)) },
    components: Object.fromEntries(at.map((f, i) => [labels[i], { realTime_dB_re_frequencyDomainReference: dB(partial(realTime.pressure, f, 4800 + late) / partial(reference, f)), pressure_Pa: Number(partial(realTime.pressure, f, 4800 + late).toPrecision(3)), velocity_m_per_s: Number(partial(velocity, f).toPrecision(3)) }])),
  }
}

const metal: Radiating = { graph: EXAMPLES[0].make(), bar: barOf(EXAMPLES[0].make()), listener: LISTENER, seconds: 4 }
await pair('1', 'metal-bar-struck', metal, frequenciesOf(metal.bar).slice(0, 5), frequenciesOf(metal.bar).slice(0, 5).map((f, n) => `mode ${n + 1}, ${f.toFixed(0)} Hz`))
const wood: Radiating = { graph: woodAndMallet(), bar: barOf(woodAndMallet()), listener: LISTENER, seconds: 3 }
await pair('2', 'wooden-bar-struck', wood, frequenciesOf(wood.bar).slice(0, 1), [`mode 1, ${frequenciesOf(wood.bar)[0].toFixed(0)} Hz`])
const hybridGraph = STRING_EXAMPLES[1].make()
const hybrid = (play: (calls: Call[]) => Call[], seconds = 4): Radiating => ({ graph: hybridGraph, bar: barOf(hybridGraph), listener: LISTENER, seconds, play })
const partials = [1, 2, 3, 4, 6, 9, 12].map((n) => n * 109.89)
await pair('3', 'hybrid-string-plucked', hybrid((calls) => calls.slice(0, 1)), partials, partials.map((f, i) => `string partial ${[1, 2, 3, 4, 6, 9, 12][i]}, ${f.toFixed(0)} Hz`))
const barModesHz = frequenciesOf(barOf(hybridGraph)).slice(0, 4)
await pair('4', 'hybrid-bar-struck', hybrid((calls) => calls.slice(1)), barModesHz, barModesHz.map((f, n) => `bar mode ${n + 1}, ${f.toFixed(0)} Hz`))
await pair('5', 'hybrid-plucked-and-struck', hybrid((calls) => calls), [partials[0], barModesHz[0], barModesHz[1]], ['string partial 1, 110 Hz', 'bar mode 1, 327 Hz', 'bar mode 2, 902 Hz'])

// ---- The builder's experimental example, as the builder plays it; the numbers the test page gives for the browser ----
{
  const graph = RADIATION_EXAMPLES[0].make()
  const translation = translate(graph, SR)
  if (!translation.ok) throw new Error('the radiated example does not translate')
  const worklet = await createWorklet([...translation.built.calls, ...instrumentCalls(graph, translation.built)])
  const data = worklet.render(Math.round(2.2 * SR))
  let sum = 0
  for (const v of data) sum += v * v
  measurements['builder example, 2.2 s, as integratedRadiated() on the test page computes it'] = { fullScalePa: LISTENER_FULL_SCALE, peak: largest(data), sumOfSquares: sum, samples: [100, 1000, 10000, 50000, 100000].map((n) => data[n]) }
}

// ---- Cost in Node: the hybrid with and without the radiator, plucked and struck ten times a second ----
const performanceResult: Record<string, unknown> = {}
for (const [name, make] of [['approved hybrid, velocity output', STRING_EXAMPLES[1].make], ['hybrid with listener, 16 taps and the radiator', RADIATION_EXAMPLES[0].make]] as const) {
  const graph = make()
  const translation = translate(graph, SR)
  if (!translation.ok) throw new Error('does not translate')
  const play = instrumentCalls(graph, translation.built)
  const speeds: number[] = []
  let [worst, blocks] = [0, 0]
  for (let run = 0; run < 4; run++) {
    const worklet = await createWorklet(translation.built.calls)
    const t0 = performance.now()
    let last = t0
    worklet.render(20 * SR, (block) => {
      const now = performance.now()
      if (run > 0 && block > 0) {
        worst = Math.max(worst, now - last)
        blocks++
      }
      last = now
      if (block % 37 === 0) worklet.send([play[(block / 37) % 2]])
    })
    if (run > 0) speeds.push((performance.now() - t0) / 20000)
  }
  performanceResult[name] = { percentOfOneCore: Number((100 * speeds.sort((a, b) => a - b)[1]).toFixed(2)), longestBlock_ms: Number(worst.toFixed(3)), blocksTimed: blocks, blockLasts_ms: Number(((128 * 1000) / SR).toFixed(3)) }
}

writeFileSync(path(`${OUT}/listening.json`), JSON.stringify({ sampleRate: SR, listener: 'free air, 1 m from the middle of the bar, 45 degrees from the line straight out from its struck face, towards its end', pressureIsNotCalibrated: true, normalization: 'each file is scaled so that its own peak is 0.5 of full scale; gainApplied is that scale; nothing else is done to it', files: info }, null, 2))
writeFileSync(path(`${OUT}/measurements.json`), JSON.stringify(measurements, null, 2))
writeFileSync(path(`${OUT}/performance.json`), JSON.stringify({ sampleRate: SR, node: process.version, results: performanceResult }, null, 2))
console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => [k, Object.fromEntries(Object.entries(v as object).filter(([key]) => !['note', 'quantity', 'levelRelativeToFirstInGroup_dB'].includes(key)))])))
console.log(JSON.stringify(measurements, null, 1))
console.table(performanceResult)
console.log(`\nwritten to ${fsPath(OUT)}`)
