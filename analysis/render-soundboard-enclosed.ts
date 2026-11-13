// Phase 3C.2.2: controlled before-and-after renders. "Before" is the refined
// open plate of Phase 3C.2.1; "after" is the same plate as the front of a
// closed box of air with a hole. Plus one pair that shows the cause of the
// slow attack of A2.
//
//   npm run render:soundboard-enclosed
//
// Output: renders/soundboard-enclosed/*.wav, listening.json and
// performance.json. Files in one group share one gain.
import { mkdirSync, writeFileSync } from 'node:fs'
import { buildInstrument, STRING_PLUCK } from '../src/experimental/string/instrument.ts'
import { airCavity } from '../src/experimental/string/airCavity.ts'
import { peak, SR } from './lib.ts'
import { compileModel, concat, fsPath, path, writeWav } from './offline.ts'
import { ENCLOSED, onSoundboard, perform, REFINED, soundOf, splOfPeak, type OnBoard, type StringParams } from './soundboard.ts'
import { createEngine, run } from './wasm.ts'

const OUT = 'renders/soundboard-enclosed'
mkdirSync(path(OUT), { recursive: true })
const fix = (v: number, d = 3) => Number(v.toFixed(d))
const info: Record<string, unknown> = {}
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)
const tunedTo = (f0: number, density: number): StringParams => ({ length: 0.65, density, tension: density * (2 * 0.65 * f0) ** 2 })
const forNote = (f0: number) => tunedTo(f0, 0.0036 * (110 / f0) ** 1.5)

function writeGroup(unit: string, files: Record<string, Float32Array>, note?: string) {
  const entries = Object.entries(files)
  const gain = 0.5 / Math.max(...entries.map(([, x]) => peak(x)))
  const reference = rms(entries[0][1])
  for (const [name, x] of entries) {
    if (!x.every(Number.isFinite)) throw new Error(`${name}: non-finite samples`)
    writeWav(`${OUT}/${name}.wav`, Float32Array.from(x, (v) => v * gain))
    info[name] = {
      quantity: unit,
      peak: Number(peak(x).toPrecision(3)),
      rms: Number(rms(x).toPrecision(3)),
      ...(unit === 'Pa' ? { peak_dB_SPL: fix(splOfPeak(peak(x)), 1) } : {}),
      levelRelativeToFirstInGroup_dB: fix(20 * Math.log10(rms(x) / reference), 1),
      gainApplied: Number(gain.toPrecision(3)),
      gainApplied_dB: fix(20 * Math.log10(gain), 1),
      peakInFile: fix(peak(x) * gain),
      ...(note ? { note } : {}),
    }
  }
}
const note = (o: OnBoard, f0: number, seconds = 4) => {
  const setup = onSoundboard({ ...o, strings: [forNote(f0)] })
  return soundOf(setup, perform(setup.instrument, seconds, { plucks: [{ time: 0 }] }).output)
}

// ---- Single notes, open plate against box (each pair one gain) -----------------------------------------
const pairs: [string, string, number, string][] = [
  ['E', 'bottom-note-E2', 82.41, 'the lowest note of the range'],
  ['H', 'low-note-A2', 110, 'the note of Phase 3C.2.1'],
  ['C', 'note-Cs3-on-the-box-resonance', 138.59, 'the note nearest the box\'s strongest resonance: the worst case for evenness'],
  ['I', 'high-note-B3', 246.94, ''],
]
for (const [letter, name, f0, why] of pairs) writeGroup('Pa', { [`${letter}1-${name}-refined-open-plate`]: note(REFINED, f0), [`${letter}2-${name}-enclosed-box`]: note(ENCLOSED, f0) }, `one gain for both${why ? '; ' + why : ''}`)

// ---- The slow attack of A2: the same plate 5 % thicker, so that its mode (1,3) is off the third harmonic ----
writeGroup('Pa', { 'D1-attack-A2-refined-8mm-mode-on-third-harmonic': note(REFINED, 110), 'D2-attack-A2-plate-8.4mm-mode-moved-away': note({ ...REFINED, plate: { ...REFINED.plate!, thickness: 0.0084 } }, 110) }, 'one gain for both; a diagnosis, not a proposed change')

// ---- The approved Faust string -------------------------------------------------------------------------
const faustString = await compileModel('src/audio/models/string.dsp', 'pluck')
writeGroup('Faust output (unitless)', { 'K1-low-note-A2-approved-faust-string': (await faustString({})).play(4), 'K2-high-note-B3-approved-faust-string': (await faustString({ fret: 14 })).play(4) }, 'open and at fret 14; one gain for both')

// ---- The phrase -----------------------------------------------------------------------------------------
const ZITHER: [string, number, number][] = [['A2', 110, 0.0036], ['D3', 146.83, 0.0021], ['E3', 164.81, 0.0021], ['G3', 196, 0.0012], ['A3', 220, 0.0012], ['B3', 246.94, 0.0007]]
const zitherStrings = ZITHER.map(([, f, density]) => tunedTo(f, density))
const melody: [number, number][] = [[0, 0], [0.4, 2], [0.8, 3], [1.2, 4], [1.6, 5], [2.0, 4], [2.4, 3], [2.8, 1], [3.2, 2], [3.6, 0], [4.4, 0], [4.42, 2], [4.44, 4]]
{
  const phrase = (o: OnBoard) => {
    const setup = onSoundboard({ ...o, strings: zitherStrings })
    return soundOf(setup, perform(setup.instrument, 8, { plucks: melody.map(([time, string]) => ({ time, string })) }).output)
  }
  writeGroup('Pa', { 'G1-phrase-refined-open-plate': phrase(REFINED), 'G2-phrase-enclosed-box': phrase(ENCLOSED) }, 'six strings, each plucked open; one gain for both')
  const inst = await faustString({})
  const frets = [0, 7, 10, 12, 14, 12, 10, 5, 7, 0]
  const gaps = [0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 4.4]
  writeGroup('Faust output (unitless)', { 'G4-phrase-approved-faust-string': concat(frets.map((fret, i) => (inst.set({ fret }), inst.play(gaps[i])))) }, 'one fretted string')
}

// ---- Performance (Node) ----------------------------------------------------------------------------------
function measure(make: () => () => void, seconds = 10) {
  const blocks = Math.round((seconds * SR) / 128)
  const speeds: number[] = []
  for (let runIndex = 0; runIndex < 4; runIndex++) {
    const tick = make()
    const t0 = performance.now()
    for (let i = 0; i < blocks; i++) tick()
    if (runIndex > 0) speeds.push(seconds / ((performance.now() - t0) / 1000))
  }
  const x = speeds.sort((a, b) => a - b)[1]
  return { xRealtime: Math.round(x), cpuPercentOfOneCore: fix(100 / x, 2) }
}
const timed = (o: OnBoard) => {
  const built = buildInstrument(onSoundboard({ ...o, strings: [tunedTo(110, 0.0036)] }).instrument, SR)
  return measure(() => {
    const engine = createEngine()
    run(engine, built.calls)
    let i = 0
    return () => {
      if (i++ % 37 === 0) engine.strike(built.strings[0], STRING_PLUCK, 0.002, 0.002)
      engine.process(128)
    }
  })
}
const performanceResult = { 'refined open plate, one string (100 modes), board to 5 kHz': timed(REFINED), 'enclosed box, one string (100 modes), board to 5 kHz': timed(ENCLOSED) }

const box = airCavity(REFINED.plate!, ENCLOSED.cavity!)
writeFileSync(path(`${OUT}/listening.json`), JSON.stringify({ sampleRate: SR, pluckForceNewtons: 2, box: { depthM: ENCLOSED.cavity!.depth, volumeLitres: fix(1000 * box.volume, 1), holeRadiusM: ENCLOSED.cavity!.holeRadius, helmholtzRigidHz: fix(box.helmholtz, 1), plateLowestModeOnClosedBoxHz: fix(box.bodyResonance, 1), airSpringNperM: Math.round(box.stiffness), plugGrams: fix(1000 * box.plug.mass, 2), radiationDamperNsPerM: fix(box.damping, 2) }, files: info }, null, 2))
writeFileSync(path(`${OUT}/performance.json`), JSON.stringify({ sampleRate: SR, node: process.version, results: performanceResult }, null, 2))
console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => [k, Object.fromEntries(Object.entries(v as object).filter(([key]) => key !== 'note' && key !== 'quantity'))])))
console.table(performanceResult)
console.log(JSON.stringify(box, null, 0))
console.log(`\nwritten to ${fsPath(OUT)}`)
