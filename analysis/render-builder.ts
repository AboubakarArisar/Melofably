// Phase 3B.1: listening renders of the builder's three example instruments.
//
//   npm run render:builder
//
// Output: renders/builder/*.wav and renders/builder/listening.json. Each file
// is made exactly as the builder page makes sound: the example graph is
// translated to engine calls, the engine is played through process() in
// 128-sample blocks, and strikes are the calls the Play button sends. What
// the browser adds afterwards (volume, limiter) is not applied.
import { mkdirSync, writeFileSync } from 'node:fs'
import { EXAMPLES } from '../src/builder/examples.ts'
import { removeConnection, setConnection, setParam, type Graph } from '../src/builder/graph.ts'
import { instrumentCalls, liveCalls, OUTPUT_GAIN, translate } from '../src/builder/translate.ts'
import { peak, SR } from './lib.ts'
import { fsPath, path, writeWav } from './offline.ts'
import { createEngine, render, run } from './wasm.ts'

const OUT = 'renders/builder'
mkdirSync(path(OUT), { recursive: true })
const fix = (v: number, d = 3) => Number(v.toFixed(d))
const info: Record<string, unknown> = {}
const example = (id: string) => EXAMPLES.find((e) => e.id === id)!.make()
const only = (graph: Graph, type: string) => graph.components.find((c) => c.type === type)!
const BLOCKS_PER_SECOND = SR / 128

/** Play `graph` for `seconds`; `events` maps a time to an edited graph (applied live) or 'play'. */
function perform(graph: Graph, seconds: number, events: [number, 'play' | Graph][]) {
  const translation = translate(graph, SR)
  if (!translation.ok) throw new Error(translation.issues.map((i) => i.message).join('; '))
  const { built } = translation
  const engine = createEngine()
  run(engine, built.calls)
  let current = graph
  const at = new Map<number, ('play' | Graph)[]>()
  for (const [time, what] of events) {
    const block = Math.round(time * BLOCKS_PER_SECOND)
    at.set(block, [...(at.get(block) ?? []), what])
  }
  const out = render(engine, new Float32Array(Math.round(seconds * SR)), (block) => {
    for (const what of at.get(block) ?? []) {
      if (what === 'play') run(engine, instrumentCalls(current, built))
      else {
        run(engine, liveCalls(current, what, built))
        current = what
      }
    }
  })
  if (engine.faults() || !out.every(Number.isFinite)) throw new Error('engine fault while rendering')
  return { out, newton: engine.worstIterations() }
}

/** Writes a group with one common gain (loudest peak 0.5) so that relative loudness within the group is real. */
function writeGroup(files: Record<string, { out: Float32Array; newton: number }>) {
  const gain = 0.5 / Math.max(...Object.values(files).map((f) => peak(f.out)))
  for (const [name, f] of Object.entries(files)) {
    writeWav(`${OUT}/${name}.wav`, Float32Array.from(f.out, (v) => v * gain))
    info[name] = { seconds: fix(f.out.length / SR, 1), peakBarVelocity_m_per_s: fix(peak(f.out) / OUTPUT_GAIN), peakInFile: fix(peak(f.out) * gain), gainApplied: fix(gain, 2), newtonIterationsWorst: f.newton }
  }
}
const three: [number, 'play'][] = [
  [0, 'play'],
  [2, 'play'],
  [4, 'play'],
]

// ---- 1. One metal bar and a mallet ---------------------------------------------------
{
  const graph = example('single')
  const mallet = only(graph, 'mallet')
  const withMallet = (params: Record<string, number>) => Object.entries(params).reduce((g, [key, value]) => setParam(g, mallet.id, key, value), graph)
  writeGroup({
    '1a-single-bar-as-loaded-three-strikes': perform(graph, 7, three),
    '1b-single-bar-soft-mallet-hardness-0.15': perform(withMallet({ hardness: 0.15 }), 7, three),
    '1c-single-bar-hard-mallet-hardness-0.9': perform(withMallet({ hardness: 0.9 }), 7, three),
    '1d-single-bar-heavier-mallet-0.08-kg': perform(withMallet({ mass: 0.08 }), 7, three),
  })
  // Strike velocity is a live property: three strikes at rising speed, same instrument.
  writeGroup({
    '1e-single-bar-strike-velocity-0.5-then-1.5-then-4': perform(setParam(graph, mallet.id, 'velocity', 0.5), 7, [[0, 'play'], [1.9, setParam(graph, mallet.id, 'velocity', 1.5)], [2, 'play'], [3.9, setParam(graph, mallet.id, 'velocity', 4)], [4, 'play']]),
  })
}

// ---- 2. Two metal bars joined by a spring -----------------------------------------------
{
  const graph = example('coupled')
  const spring = graph.connections.find((c) => c.type === 'spring')!
  writeGroup({
    '2a-two-bars-as-loaded-three-strikes': perform(graph, 7, three),
    '2b-two-bars-spring-removed-only-the-struck-bar-sounds': perform(removeConnection(graph, spring.id), 7, three),
    '2c-two-bars-spring-ten-times-stiffer': perform(setConnection(graph, spring.id, { stiffness: 4e6 }), 7, three),
    '2d-two-bars-spring-and-strong-damper': perform(setConnection(graph, spring.id, { type: 'springDamper', damping: 20 }), 7, three),
    // Stiffness is a live property: changed while ringing, without a rebuild.
    '2e-two-bars-stiffness-raised-x10-at-1s-and-lowered-at-2.5s-while-ringing': perform(graph, 5, [[0, 'play'], [1, setConnection(graph, spring.id, { stiffness: 4e6 })], [2.5, graph]]),
  })
}

// ---- 3. A wooden bar joined to a metal bar ------------------------------------------------
{
  const graph = example('mixed')
  const joint = graph.connections.find((c) => c.type === 'springDamper')!
  const wood = only(graph, 'woodBar')
  writeGroup({
    '3a-wood-and-metal-as-loaded-three-strikes': perform(graph, 7, three),
    '3b-wood-and-metal-connection-removed-wood-alone': perform(removeConnection(graph, joint.id), 7, three),
    '3c-wood-and-metal-spring-ten-times-stiffer': perform(setConnection(graph, joint.id, { stiffness: 2e6 }), 7, three),
    // Bar damping is a live property.
    '3d-wood-and-metal-wood-damping-x0.3-rings-longer': perform(setParam(graph, wood.id, 'damping', 0.3), 7, three),
  })
}

writeFileSync(path(`${OUT}/listening.json`), JSON.stringify(info, null, 2))
console.table(info)
console.log(`\nWAV files written to ${fsPath(OUT)}`)
