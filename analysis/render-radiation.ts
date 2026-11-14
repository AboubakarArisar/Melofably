// Phase 3D.3: comparison renders of the bar-radiation prototype, and its
// cost in Node.
//
//   npm run render:radiation
//
// For each of three instruments (the builder's metal bar and mallet, a
// wooden bar and mallet, and the string tied to a metal bar) ONE run of the
// engine is recorded, and from that same vibration are made:
//
//   a  what is heard today: the bar's velocity where it is struck, m/s
//   b  sound pressure at the listener by the reference method, Pa
//   c  the same by 16 points along the bar (what a real-time version would do)
//   d  the same by one weight per mode (what runs in the AudioWorklet today)
//
// Output: renders/radiation/*.wav, listening.json (each file's peak and RMS
// in its own unit before any gain, and the gain), measurements.json and
// performance.json. The pressures are a model's, in free air, a metre from
// the bar's middle and 45 degrees off the line straight out from its face.
// They are not calibrated against any measurement.
import { mkdirSync, writeFileSync } from 'node:fs'
import { barModeShape } from '../src/audio/engine/physics.ts'
import { EXAMPLES, STRING_EXAMPLES } from '../src/builder/examples.ts'
import { addComponent, connect, emptyGraph, type Graph } from '../src/builder/graph.ts'
import { barModes, translate } from '../src/builder/translate.ts'
import { crossover, dipoleArea, radiationWeights } from '../src/experimental/radiation/barRadiation.ts'
import type { Call } from '../src/experimental/wasm/engine.ts'
import { SR } from './lib.ts'
import { fsPath, groupWriter, path } from './offline.ts'
import { frequenciesOf, geometryOf, modalVelocities, partial, pointVelocities, pressureByPoints, pressureByTransfer, pressureByWeights, withPorts, type Radiating } from './radiation.ts'
import { createWorklet } from './worklet.ts'

const OUT = 'renders/radiation'
mkdirSync(path(OUT), { recursive: true })
const { info, writeGroup } = groupWriter(OUT)
const LISTENER = { distance: 1, angle: 45 }
const dB = (ratio: number) => Number((20 * Math.log10(ratio)).toFixed(1))
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

async function compare(prefix: string, name: string, o: Radiating, levelsAt: number[], labels: string[]) {
  const geometry = geometryOf(o.bar)
  const recorded = await modalVelocities(o)
  // What is heard today, from the same run: the modes' velocities added up at the strike point.
  const velocity = new Float32Array(recorded.modes[0].length)
  recorded.modes.forEach((mode, n) => {
    const shape = barModeShape(n, o.bar.params.strikePosition)
    for (let i = 0; i < velocity.length; i++) velocity[i] += shape * mode[i]
  })
  const reference = pressureByTransfer(recorded.modes, geometry, o.listener)
  const { pressure: byPoints } = pressureByPoints(pointVelocities(recorded.modes, 16), geometry, o.listener)
  const { pressure: byWeights } = await pressureByWeights(o)
  writeGroup('m/s (velocity of the bar where it is struck)', { [`${prefix}a-${name}-as-heard-today-velocity`]: velocity }, 'the current output; its own gain')
  writeGroup('Pa', {
    [`${prefix}b-${name}-pressure-reference`]: reference,
    [`${prefix}c-${name}-pressure-16-points`]: byPoints,
    [`${prefix}d-${name}-pressure-one-weight-per-mode`]: byWeights,
  }, 'the same vibration as a; one gain for the three. A model\'s pressure: free air, 1 m, 45 degrees; not calibrated against any measurement')
  measurements[name] = {
    bar: `${geometry.length} m x ${1000 * geometry.width} mm x ${1000 * geometry.thickness} mm`,
    dipoleArea_cm2: Number((1e4 * dipoleArea(geometry)).toFixed(2)),
    crossoverHz: Math.round(crossover(geometry)),
    barModesHz: frequenciesOf(o.bar).slice(0, 4).map(Math.round),
    peak: { velocity_m_per_s: Number(largest(velocity).toPrecision(3)), reference_Pa: Number(largest(reference).toPrecision(3)), points16_dB_re_reference: dB(largest(byPoints) / largest(reference)), oneWeight_dB_re_reference: dB(largest(byWeights) / largest(reference)) },
    components: Object.fromEntries(levelsAt.map((f, i) => [labels[i], {
      velocity_dB_re_first: dB(partial(velocity, f) / partial(velocity, levelsAt[0])),
      pressure_dB_re_first: dB(partial(reference, f) / partial(reference, levelsAt[0])),
      points16_dB_re_reference: dB(partial(byPoints, f) / partial(reference, f)),
      oneWeight_dB_re_reference: dB(partial(byWeights, f) / partial(reference, f)),
    }])),
  }
  return { recorded, geometry }
}

// ---- 1, 2. The builder's metal bar ---------------------------------------------------------------------
const metal: Radiating = { graph: EXAMPLES[0].make(), bar: barOf(EXAMPLES[0].make()), listener: LISTENER, seconds: 4 }
const metalModes = frequenciesOf(metal.bar).slice(0, 4)
const metalRun = await compare('1', 'metal-bar', metal, metalModes, metalModes.map((f, n) => `mode ${n + 1}, ${f.toFixed(0)} Hz`))

// ---- 3, 4. A wooden bar ------------------------------------------------------------------------------------
const wood: Radiating = { graph: woodAndMallet(), bar: barOf(woodAndMallet()), listener: LISTENER, seconds: 3 }
const woodModes = frequenciesOf(wood.bar).slice(0, 1)
await compare('2', 'wooden-bar', wood, woodModes, woodModes.map((f) => `mode 1, ${f.toFixed(0)} Hz (its overtones are gone within a tenth of a second)`))

// ---- 5, 6. The string tied to a metal bar: plucked, then struck -----------------------------------------------
const hybridGraph = STRING_EXAMPLES[1].make()
const partials = [1, 2, 3, 4, 6].map((n) => n * 109.89)
await compare('3', 'hybrid-string-plucked', { graph: hybridGraph, bar: barOf(hybridGraph), listener: LISTENER, seconds: 4, play: (calls: Call[]) => calls.slice(0, 1) }, [partials[2], partials[0], partials[1], partials[3], partials[4]], ['330 Hz (string partial 3, beside the bar\'s 327 Hz)', '110 Hz (string partial 1)', '220 Hz', '440 Hz', '659 Hz'])
await compare('4', 'hybrid-bar-struck', { graph: hybridGraph, bar: barOf(hybridGraph), listener: LISTENER, seconds: 4, play: (calls: Call[]) => calls.slice(1) }, frequenciesOf(barOf(hybridGraph)).slice(0, 3), ['bar mode 1, 327 Hz', 'bar mode 2, 902 Hz', 'bar mode 3, 1768 Hz'])

// ---- Where the listener is --------------------------------------------------------------------------------------
{
  const at = (distance: number, angle: number) => largest(pressureByTransfer(metalRun.recorded.modes, metalRun.geometry, { distance, angle }))
  const reference = at(1, 45)
  measurements['metal bar: peak pressure by listener position, dB re 1 m at 45 degrees'] = {
    byDistanceAt45: Object.fromEntries([0.5, 1, 2, 4].map((r) => [`${r} m`, dB(at(r, 45) / reference)])),
    byDistanceAt0: Object.fromEntries([0.5, 1, 2, 4].map((r) => [`${r} m`, dB(at(r, 0) / reference)])),
    byAngleAt1m: Object.fromEntries([0, 15, 30, 45, 60, 75, 90].map((a) => [`${a} degrees`, at(1, a) > 0 ? dB(at(1, a) / reference) : 'silent'])),
  }
}

// ---- Cost (Node) ---------------------------------------------------------------------------------------------------
/** `count` bars like the builder's, each struck three times a second; optionally each with a radiation port. */
function manyBars(count: number, radiating: boolean): { calls: Call[]; strike: Call[] } {
  const bar = barOf(EXAMPLES[0].make())
  const modes = barModes(bar, SR)
  const weights = radiationWeights(geometryOf(bar), LISTENER, modes.map((m) => m.frequency))
  const calls: Call[] = [['reset', SR, 2]]
  for (let r = 0; r < count; r++) {
    calls.push(['addResonator', radiating ? 3 : 2, modes.length])
    modes.forEach((mode, n) => {
      mode.shape.forEach((value, port) => calls.push(['setShape', r, port, n, value]))
      if (radiating) calls.push(['setShape', r, 2, n, weights[n]])
      // Each bar a little shorter than the last, as on a real instrument.
      calls.push(['setMode', r, n, mode.frequency * 2 ** (r / 12), mode.t60, mode.mass])
    })
    calls.push(['addOutput', r, radiating ? 2 : 0, radiating ? 1 : 0.25])
  }
  calls.push(['build'])
  if (radiating) calls.push(['radiate', SR, 1, 0, 0, 64])
  return { calls, strike: Array.from({ length: count }, (_, r): Call => ['strike', r, 0, 0.03, 0.0004]) }
}
async function cost(count: number, radiating: boolean) {
  const { calls, strike } = manyBars(count, radiating)
  const speeds: number[] = []
  for (let run = 0; run < 4; run++) {
    const worklet = await createWorklet(calls)
    const t0 = performance.now()
    worklet.render(20 * SR, (block) => block % 125 === 0 && worklet.send([strike[(block / 125) % count]]))
    if (run > 0) speeds.push((performance.now() - t0) / 20000)
  }
  return 100 * speeds.sort((a, b) => a - b)[1]
}
const performanceResult: Record<string, unknown> = {}
for (const count of [1, 4, 16, 64]) {
  const [plain, radiating] = [await cost(count, false), await cost(count, true)]
  performanceResult[`${count} bar${count > 1 ? 's' : ''} (${8 * count} modes)`] = { velocityOutput_percentOfOneCore: Number(plain.toFixed(3)), withRadiationPorts_percentOfOneCore: Number(radiating.toFixed(3)), perMode_nanoseconds_per_sample: Number(((radiating / 100 / SR / (8 * count)) * 1e9).toFixed(2)) }
}
{
  // The 16-point method's own arithmetic, on 20 s of recorded motion, in plain JavaScript.
  const points = pointVelocities(metalRun.recorded.modes.map((m) => Float64Array.from({ length: 20 * SR }, (_, i) => m[i % m.length])), 16)
  const t0 = performance.now()
  pressureByPoints(points, metalRun.geometry, LISTENER)
  performanceResult['16-point pressure for one bar, the arithmetic alone (plain JavaScript, with its allocations)'] = { percentOfOneCore: Number(((performance.now() - t0) / 200).toFixed(3)), memory: '16 delay lines of about 45 samples and 4 numbers of filter state per point' }
}

const translation = translate(EXAMPLES[0].make(), SR)
if (!translation.ok) throw new Error('does not translate')
writeFileSync(path(`${OUT}/listening.json`), JSON.stringify({ sampleRate: SR, listener: 'free air, 1 m from the middle of the bar, 45 degrees from the line straight out from its struck face, towards its end', pressureIsNotCalibrated: true, files: info }, null, 2))
writeFileSync(path(`${OUT}/measurements.json`), JSON.stringify(measurements, null, 2))
writeFileSync(path(`${OUT}/performance.json`), JSON.stringify({ sampleRate: SR, node: process.version, results: performanceResult }, null, 2))
console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => [k, Object.fromEntries(Object.entries(v as object).filter(([key]) => !['note', 'quantity', 'gainApplied', 'rms_dB_SPL'].includes(key)))])))
console.log(JSON.stringify(measurements, null, 1))
console.table(performanceResult)
console.log(`\nwritten to ${fsPath(OUT)}`)
void withPorts
void createWorklet
