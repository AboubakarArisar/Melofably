// Phase 3C.2.1: before-and-after listening renders of the refined soundboard,
// and its Node performance.
//
//   npm run render:soundboard-refined
//
// Output: renders/soundboard-refined/*.wav, listening.json (what each file
// is, its physical level and the gain applied) and performance.json.
// Files in one group share one gain, so differences in loudness within a
// group are the real ones; the "full-scale" files repeat the refined board
// at its own gain, for comparing tone rather than loudness.
import { mkdirSync, writeFileSync } from 'node:fs'
import { buildInstrument, STRING_PLUCK } from '../src/experimental/string/instrument.ts'
import { plateFrequency, plateMass } from '../src/experimental/string/soundboard.ts'
import { unbaffledCorner } from '../src/experimental/string/soundboardRefined.ts'
import { peak, SR } from './lib.ts'
import { compileModel, concat, fsPath, path, writeWav } from './offline.ts'
import { onSoundboard, perform, REFINED, SOUNDBOARD, soundOf, splOfPeak, type OnBoard, type StringParams } from './soundboard.ts'
import { createEngine, run } from './wasm.ts'

const OUT = 'renders/soundboard-refined'
mkdirSync(path(OUT), { recursive: true })
const fix = (v: number, d = 3) => Number(v.toFixed(d))
const info: Record<string, unknown> = {}
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)
const tunedTo = (f0: number, density: number): StringParams => ({ length: 0.65, density, tension: density * (2 * 0.65 * f0) ** 2 })

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

const A2 = tunedTo(110, 0.0036)
const B3 = tunedTo(246.94, 0.0007)
/** Radiated pressure at 1 m of one plucked string on a board. */
const note = (o: OnBoard, seconds = 4) => {
  const setup = onSoundboard(o)
  return soundOf(setup, perform(setup.instrument, seconds, { plucks: [{ time: 0 }] }).bodyVelocity)
}

// ---- H, I. One low and one high note, before and after --------------------------------------------
const lowBefore = note({ strings: [A2] })
const lowAfter = note({ ...REFINED, strings: [A2] })
const highBefore = note({ strings: [B3] })
const highAfter = note({ ...REFINED, strings: [B3] })
writeGroup('Pa', { 'H1-low-note-A2-original-soundboard': lowBefore, 'H2-low-note-A2-refined-soundboard': lowAfter }, 'one gain for both')
writeGroup('Pa', { 'H3-low-note-A2-refined-soundboard-full-scale': lowAfter }, 'H2 at its own gain')
writeGroup('Pa', { 'I1-high-note-B3-original-soundboard': highBefore, 'I2-high-note-B3-refined-soundboard': highAfter }, 'one gain for both')
writeGroup('Pa', { 'I3-high-note-B3-refined-soundboard-full-scale': highAfter }, 'I2 at its own gain')

// ---- K. The approved Faust string, same two notes ----------------------------------------------------
const faustString = await compileModel('src/audio/models/string.dsp', 'pluck')
writeGroup('Faust output (unitless)', { 'K1-low-note-A2-approved-faust-string': (await faustString({})).play(4), 'K2-high-note-B3-approved-faust-string': (await faustString({ fret: 14 })).play(4) }, 'the approved instrument, open and at fret 14; one gain for both')

// ---- L. Bridge positions on the refined plate (one gain) ----------------------------------------------
writeGroup('Pa', {
  'L1-bridge-at-0.08-0.44-refined': lowAfter,
  'L2-bridge-at-0.30-0.44-where-phase-3C2-had-it': note({ ...REFINED, bridgeAt: [0.3, 0.44], strings: [A2] }),
  'L3-bridge-at-the-centre': note({ ...REFINED, bridgeAt: [0.5, 0.5], strings: [A2] }),
  'L4-bridge-near-a-side-0.30-0.12': note({ ...REFINED, bridgeAt: [0.3, 0.12], strings: [A2] }),
}, 'the refined 8 mm plate, unbaffled, A2; only the bridge moves')

// ---- G. The phrase ---------------------------------------------------------------------------------------
const ZITHER: [string, number, number][] = [['A2', 110, 0.0036], ['D3', 146.83, 0.0021], ['E3', 164.81, 0.0021], ['G3', 196, 0.0012], ['A3', 220, 0.0012], ['B3', 246.94, 0.0007]]
const zitherStrings = ZITHER.map(([, f, density]) => tunedTo(f, density))
const melody: [number, number][] = [[0, 0], [0.4, 2], [0.8, 3], [1.2, 4], [1.6, 5], [2.0, 4], [2.4, 3], [2.8, 1], [3.2, 2], [3.6, 0], [4.4, 0], [4.42, 2], [4.44, 4]]
{
  const phrase = (o: OnBoard) => {
    const setup = onSoundboard({ ...o, strings: zitherStrings })
    return soundOf(setup, perform(setup.instrument, 8, { plucks: melody.map(([time, string]) => ({ time, string })) }).bodyVelocity)
  }
  const [before, after] = [phrase({}), phrase(REFINED)]
  writeGroup('Pa', { 'G1-phrase-original-soundboard': before, 'G2-phrase-refined-soundboard': after }, 'six strings on the board, each plucked open; one gain for both')
  writeGroup('Pa', { 'G3-phrase-refined-soundboard-full-scale': after }, 'G2 at its own gain')
  const inst = await faustString({})
  const frets = [0, 7, 10, 12, 14, 12, 10, 5, 7, 0]
  const gaps = [0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 4.4]
  writeGroup('Faust output (unitless)', { 'G4-phrase-approved-faust-string': concat(frets.map((fret, i) => (inst.set({ fret }), inst.play(gaps[i])))) }, 'one fretted string, so each note ends when the next begins')
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
  return { xRealtime: Math.round(x), cpuPercentOfOneCore: fix(100 / x, 2), worstBlockMs: fix(worst, 3) }
}
const GUITAR_SET = ([[82.41, 0.0064], [110, 0.0036], [146.83, 0.0021], [196, 0.0012], [246.94, 0.0007], [329.63, 0.0004]] as const).map(([f, density]) => tunedTo(f, density))
const timed = (o: OnBoard) => {
  const built = buildInstrument(onSoundboard(o).instrument, SR)
  const strings = built.strings.length
  const result = measure(() => {
    const engine = createEngine()
    run(engine, built.calls)
    let i = 0
    return () => {
      if (i % 37 === 0) engine.strike(built.strings[Math.floor(i / 37) % strings], STRING_PLUCK, 0.002, 0.002)
      i++
      engine.process(128)
    }
  })
  return { modes: built.modes.body + built.modes.strings.reduce((a, b) => a + b, 0), boardModes: built.modes.body, ...result }
}
const performanceResult = {
  'original 4 mm board, one string (100 modes), board to 5 kHz': timed({ strings: [GUITAR_SET[1]] }),
  'refined 8 mm board, one string (100 modes), board to 5 kHz': timed({ ...REFINED, strings: [GUITAR_SET[1]] }),
  'original 4 mm board, six strings (100 modes each), board to 5 kHz': timed({ strings: GUITAR_SET }),
  'refined 8 mm board, six strings (100 modes each), board to 5 kHz': timed({ ...REFINED, strings: GUITAR_SET }),
}

const describe = (o: OnBoard) => {
  const plate = o.plate ?? SOUNDBOARD
  return { thicknessMm: 1000 * plate.thickness, massGrams: Math.round(1000 * plateMass(plate)), lowestModeHz: fix(plateFrequency(plate, 1, 1), 1), bridgeAt: o.bridgeAt ?? [0.3, 0.44], baffled: !o.unbaffled }
}
writeFileSync(path(`${OUT}/listening.json`), JSON.stringify({ sampleRate: SR, pluckForceNewtons: 2, original: describe({}), refined: { ...describe(REFINED), unbaffledCornerHz: fix(unbaffledCorner(0.2), 0) }, files: info }, null, 2))
writeFileSync(path(`${OUT}/performance.json`), JSON.stringify({ sampleRate: SR, node: process.version, blockBudgetMs: 2.667, results: performanceResult }, null, 2))
console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => [k, Object.fromEntries(Object.entries(v as object).filter(([key]) => key !== 'note'))])))
console.table(performanceResult)
console.log(`\nwritten to ${fsPath(OUT)}`)
