// Phase 3C.2.3: four-way listening renders. The refined open plate, the box
// of Phase 3C.2.2, the damped box of this phase, and the approved Faust
// string, on five notes and the phrase.
//
//   npm run render:soundboard-damped
//
// Output: renders/soundboard-damped/*.wav, listening.json (pascals and dB SPL
// before any gain, and the gain) and performance.json. The three bodies of a
// note share one gain. The Faust string is not a pressure and has its own.
import { mkdirSync, writeFileSync } from 'node:fs'
import { buildInstrument, STRING_PLUCK } from '../src/experimental/string/instrument.ts'
import { airCavity } from '../src/experimental/string/airCavity.ts'
import { SR } from './lib.ts'
import { compileModel, concat, fsPath, groupWriter, path } from './offline.ts'
import { DAMPED_BOX, ENCLOSED, onSoundboard, perform, REFINED, soundOf, type OnBoard, type StringParams } from './soundboard.ts'
import { createEngine, run } from './wasm.ts'

const OUT = 'renders/soundboard-damped'
mkdirSync(path(OUT), { recursive: true })
const { info, writeGroup } = groupWriter(OUT)
const tunedTo = (f0: number, density: number): StringParams => ({ length: 0.65, density, tension: density * (2 * 0.65 * f0) ** 2 })
const forNote = (f0: number) => tunedTo(f0, 0.0036 * (110 / f0) ** 1.5)
const BODIES: [string, OnBoard][] = [['1-refined-open-plate', REFINED], ['2-box-of-3C22', ENCLOSED], ['3-damped-box', DAMPED_BOX]]
const faustString = await compileModel('src/audio/models/string.dsp', 'pluck')

// ---- Single notes ------------------------------------------------------------------------------------
const NOTES: [string, number, number | null, string][] = [
  ['E2', 82.41, null, 'the bottom note'],
  ['A2', 110, 0, 'its third harmonic is on plate mode (1,3) on the first two bodies'],
  ['Cs3', 138.59, 4, 'on the 140 Hz resonance of the Phase 3C.2.2 box'],
  ['B3', 246.94, 14, ''],
  ['E4', 329.63, null, 'on plate mode (1,3) at 331 Hz on the first two bodies'],
]
for (const [name, f0, fret, why] of NOTES) {
  const files: Record<string, Float32Array> = {}
  for (const [label, o] of BODIES) {
    const setup = onSoundboard({ ...o, strings: [forNote(f0)] })
    files[`${name}-${label}`] = soundOf(setup, perform(setup.instrument, 4, { plucks: [{ time: 0 }] }).output)
  }
  writeGroup('Pa', files, `one gain for the three${why ? '; ' + why : ''}`)
  if (fret !== null) writeGroup('Faust output (unitless)', { [`${name}-4-approved-faust-string`]: (await faustString({ fret })).play(4) }, `fret ${fret}; its own gain`)
}

// ---- The phrase ----------------------------------------------------------------------------------------
const ZITHER: [string, number, number][] = [['A2', 110, 0.0036], ['D3', 146.83, 0.0021], ['E3', 164.81, 0.0021], ['G3', 196, 0.0012], ['A3', 220, 0.0012], ['B3', 246.94, 0.0007]]
const zitherStrings = ZITHER.map(([, f, density]) => tunedTo(f, density))
const melody: [number, number][] = [[0, 0], [0.4, 2], [0.8, 3], [1.2, 4], [1.6, 5], [2.0, 4], [2.4, 3], [2.8, 1], [3.2, 2], [3.6, 0], [4.4, 0], [4.42, 2], [4.44, 4]]
{
  const files: Record<string, Float32Array> = {}
  BODIES.forEach(([label, o], i) => {
    const setup = onSoundboard({ ...o, strings: zitherStrings })
    files[`G${i + 1}-phrase-${label.slice(2)}`] = soundOf(setup, perform(setup.instrument, 8, { plucks: melody.map(([time, string]) => ({ time, string })) }).output)
  })
  writeGroup('Pa', files, 'six strings on the body, each plucked open; one gain for the three')
  const inst = await faustString({})
  const frets = [0, 7, 10, 12, 14, 12, 10, 5, 7, 0]
  const gaps = [0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 4.4]
  writeGroup('Faust output (unitless)', { 'G4-phrase-approved-faust-string': concat(frets.map((fret, i) => (inst.set({ fret }), inst.play(gaps[i])))) }, 'one fretted string; its own gain')
}

// ---- Performance (Node) ----------------------------------------------------------------------------------
function measure(make: () => () => void, seconds = 10) {
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
  return { cpuPercentOfOneCore: Number((100 / x).toFixed(2)), worstBlockMs: Number(worst.toFixed(3)) }
}
const timed = (o: OnBoard, notes: number[]) => {
  const built = buildInstrument(onSoundboard({ ...o, strings: notes.map(forNote) }).instrument, SR)
  return measure(() => {
    const engine = createEngine()
    run(engine, built.calls)
    let i = 0
    return () => {
      if (i % 37 === 0) engine.strike(built.strings[Math.floor(i / 37) % notes.length], STRING_PLUCK, 0.002, 0.002)
      i++
      engine.process(128)
    }
  })
}
const performanceResult: Record<string, unknown> = {}
for (const [label, o] of BODIES) for (const [count, notes] of [['one string', [110]], ['three strings', [110, 146.83, 196]]] as [string, number[]][]) performanceResult[`${label.slice(2)}, ${count} (100 modes each), board to 5 kHz`] = timed(o, notes)

const describe = (o: OnBoard) => {
  const box = airCavity(o.plate!, o.cavity!)
  return { bridgeAt: o.bridgeAt, depthM: o.cavity!.depth, volumeLitres: 1000 * box.volume, holeRadiusM: o.cavity!.holeRadius, holeScreenPaSPerM: o.cavity!.holeScreen ?? 0, helmholtzRigidHz: Number(box.helmholtz.toFixed(1)), airSpringNperM: Math.round(box.stiffness), plugGrams: Number((1000 * box.plug.mass).toFixed(2)), screenNsPerM: Number(box.resistance.toFixed(3)), radiationDamperNsPerM: Number(box.damping.toFixed(2)) }
}
writeFileSync(path(`${OUT}/listening.json`), JSON.stringify({ sampleRate: SR, pluckForceNewtons: 2, distanceM: 1, boxOf3C22: describe(ENCLOSED), dampedBox: describe(DAMPED_BOX), files: info }, null, 2))
writeFileSync(path(`${OUT}/performance.json`), JSON.stringify({ sampleRate: SR, node: process.version, blockBudgetMs: 2.667, results: performanceResult }, null, 2))
console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => [k, Object.fromEntries(Object.entries(v as object).filter(([key]) => !['note', 'quantity', 'gainApplied'].includes(key)))])))
console.table(performanceResult)
console.log(`\nwritten to ${fsPath(OUT)}`)
