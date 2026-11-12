// Phase 3C.2: listening renders and Node performance of the soundboard prototype.
//
//   npm run render:soundboard
//
// Output: renders/soundboard/*.wav, listening.json (what each file is, its
// physical level and the gain applied) and performance.json.
import { mkdirSync, writeFileSync } from 'node:fs'
import { buildInstrument, STRING_PLUCK } from '../src/experimental/string/instrument.ts'
import { plateFrequency, plateMass } from '../src/experimental/string/soundboard.ts'
import { peak, SR } from './lib.ts'
import { compileModel, concat, fsPath, path, writeWav } from './offline.ts'
import { DEFAULT_LOSS, GUITAR_A, onSoundboard, perform, pressure, SOUNDBOARD, splOfPeak, SPRUCE_PLATE, type Instrument, type OnBoard, type StringParams } from './soundboard.ts'
import { woodenBar } from './string-prototype.ts'
import { createEngine, run } from './wasm.ts'

const OUT = 'renders/soundboard'
mkdirSync(path(OUT), { recursive: true })
const fix = (v: number, d = 3) => Number(v.toFixed(d))
const info: Record<string, unknown> = {}
const rms = (x: Float32Array, from = 0) => Math.sqrt(x.subarray(from).reduce((s, v) => s + v * v, 0) / (x.length - from))
const tunedTo = (f0: number, density: number): StringParams => ({ length: 0.65, density, tension: density * (2 * 0.65 * f0) ** 2 })
const pluck = { plucks: [{ time: 0 }] }

/**
 * Writes files at one common gain, chosen so that the loudest peaks at 0.5:
 * within a group, differences in loudness are the real ones. Records each
 * file's level in its own unit before the gain, and relative to the group's
 * first file.
 */
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
      peakInFile: fix(peak(x) * gain),
      ...(note ? { note } : {}),
    }
  }
}

// ---- A. The approved Faust string, for reference ----------------------------------------------
const faustString = await compileModel('src/audio/models/string.dsp', 'pluck')
writeGroup('Faust output (unitless)', { 'A1-approved-faust-string-with-its-body': (await faustString({})).play(4) }, 'the approved instrument: string, then a fixed body filter')
writeGroup('Faust output (unitless)', { 'A2-approved-faust-string-body-off': (await faustString({ body: 0 })).play(4) }, 'force at the bridge, as the approved model outputs it')

// ---- B, C. The modal string alone, and on the Phase 3C.1 wooden bar ------------------------------
{
  const wall = [{ frequency: 0, t60: Infinity, mass: 1e12, shape: [1, 1] }]
  const alone: Instrument = { strings: [GUITAR_A], loss: DEFAULT_LOSS, stringModes: 100, pluckAt: 0.8, body: wall, bridge: { stiffness: 1e6 } }
  writeGroup('N', { 'B1-modal-string-alone-force-at-a-rigid-bridge': perform(alone, 4, pluck).bridgeForce }, 'no body: this is not sound, it is the force a rigid bridge feels')
  const onBar = perform({ ...alone, body: woodenBar(SR, 0) }, 4, pluck)
  writeGroup('m/s', { 'C1-modal-string-on-a-wooden-bar-velocity-of-the-bar': onBar.bodyVelocity }, 'velocity of the bar at its second port; a bar has no radiation model here')
}

// ---- D. The string on the soundboard: four different signals ---------------------------------------
const prototype = onSoundboard()
const onBoard = perform(prototype.instrument, 4, pluck)
const sound = pressure(onBoard, prototype.area)
writeGroup('m', { 'D1-string-on-soundboard-string-displacement': onBoard.stringDisplacement }, 'displacement of the string 0.3 of its length from the nut')
writeGroup('m/s', { 'D2-string-on-soundboard-bridge-velocity': onBoard.bridgeVelocity }, 'velocity of the soundboard where the bridge stands')
writeGroup('m/s', { 'D3-string-on-soundboard-mean-velocity-of-the-board': onBoard.bodyVelocity }, 'velocity averaged over the soundboard')
writeGroup('Pa', { 'D4-string-on-soundboard-radiated-pressure-at-1m': sound }, 'pressure on the axis of the board, 1 m away, baffled: the approximate radiated sound')
// The same without the lowest octaves, which small loudspeakers cannot reproduce: a listening aid, not a model.
{
  const cut = new Float32Array(sound.length)
  // Two cascaded first-order high-pass filters at 80 Hz.
  const a = Math.exp((-2 * Math.PI * 80) / SR)
  let [x1, y1, y2, z1] = [0, 0, 0, 0]
  for (let n = 0; n < sound.length; n++) {
    y1 = a * (y1 + sound[n] - x1)
    x1 = sound[n]
    y2 = a * (y2 + y1 - z1)
    z1 = y1
    cut[n] = y2
  }
  writeGroup('Pa', { 'D5-radiated-pressure-with-everything-below-80-Hz-removed': cut }, 'D4 through an 80 Hz high-pass, added for listening on small speakers; not part of the model')
}

// ---- E. Different soundboards (radiated pressure, one common gain) -----------------------------------
const radiated = (o: OnBoard, seconds = 4) => {
  const setup = onSoundboard(o)
  return pressure(perform(setup.instrument, seconds, pluck), setup.area)
}
writeGroup('Pa', {
  'E1-soundboard-prototype-4mm-0.50x0.40m': sound,
  'E2-soundboard-small-0.35x0.28m': radiated({ plate: { ...SOUNDBOARD, length: 0.35, width: 0.28 } }),
  'E3-soundboard-large-0.70x0.50m': radiated({ plate: { ...SOUNDBOARD, length: 0.7, width: 0.5 } }),
  'E4-soundboard-thin-3mm': radiated({ plate: SPRUCE_PLATE }),
  'E5-soundboard-thick-6mm': radiated({ plate: { ...SOUNDBOARD, thickness: 0.006 } }),
  'E6-soundboard-lossy-wood-loss-factor-0.03': radiated({ plate: { ...SOUNDBOARD, lossFactor: 0.03 } }),
})

// ---- F. Different bridge positions (radiated pressure, one common gain) --------------------------------
writeGroup('Pa', {
  'F1-bridge-at-0.30-0.44-prototype': sound,
  'F2-bridge-at-the-centre': radiated({ bridgeAt: [0.5, 0.5] }),
  'F3-bridge-near-an-end': radiated({ bridgeAt: [0.12, 0.44] }),
  'F4-bridge-near-a-side': radiated({ bridgeAt: [0.3, 0.12] }),
})

// ---- G. A phrase ---------------------------------------------------------------------------------------
// Six strings on the soundboard, tuned A2 D3 E3 G3 A3 B3, each plucked open: a small zither.
const ZITHER: [string, number, number][] = [['A2', 110, 0.0036], ['D3', 146.83, 0.0021], ['E3', 164.81, 0.0021], ['G3', 196, 0.0012], ['A3', 220, 0.0012], ['B3', 246.94, 0.0007]]
const zitherStrings = ZITHER.map(([, f, density]) => tunedTo(f, density))
const melody: [number, number][] = [[0, 0], [0.4, 2], [0.8, 3], [1.2, 4], [1.6, 5], [2.0, 4], [2.4, 3], [2.8, 1], [3.2, 2], [3.6, 0], [4.4, 0], [4.42, 2], [4.44, 4]]
{
  const setup = onSoundboard({ strings: zitherStrings })
  const rec = perform(setup.instrument, 8, { plucks: melody.map(([time, string]) => ({ time, string })) })
  const few = onSoundboard({ strings: zitherStrings, limit: 2000, stringModes: 60 })
  const recFew = perform(few.instrument, 8, { plucks: melody.map(([time, string]) => ({ time, string })) })
  writeGroup('Pa', {
    'G1-phrase-six-strings-on-the-soundboard-radiated': pressure(rec, setup.area),
    'G2-phrase-same-with-fewer-modes-60-per-string-board-to-2kHz': pressure(recFew, few.area),
  }, 'all six strings stay on the board and ring on; modes: ' + JSON.stringify(rec.built.modes) + ' and ' + JSON.stringify(recFew.built.modes))
  // The same notes on the approved string (one string, fretted; it cannot play the final chord).
  const inst = await faustString({})
  const frets = [0, 7, 10, 12, 14, 12, 10, 5, 7, 0]
  const gaps = [0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 4.4]
  writeGroup('Faust output (unitless)', { 'G3-phrase-approved-faust-string-with-its-body': concat(frets.map((fret, i) => (inst.set({ fret }), inst.play(gaps[i])))) }, 'one fretted string, so each note ends when the next begins')
}

// ---- Performance (Node) ----------------------------------------------------------------------------------
type Tick = () => void
function measure(make: () => Tick, seconds = 10) {
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
const timed = (strings: StringParams[], stringModes: number, limit: number) => {
  const setup = onSoundboard({ strings, stringModes, limit })
  const built = buildInstrument(setup.instrument, SR)
  const total = built.modes.body + built.modes.strings.reduce((a, b) => a + b, 0)
  const result = measure(() => {
    const engine = createEngine()
    run(engine, built.calls)
    let i = 0
    return () => {
      // Every string plucked in turn, ten times a second.
      if (i % 37 === 0) engine.strike(built.strings[Math.floor(i / 37) % strings.length], STRING_PLUCK, 0.002, 0.002)
      i++
      engine.process(128)
    }
  })
  return { modes: total, connections: strings.length, ...result }
}
const performanceResult: Record<string, unknown> = {
  'one string (100 modes), soundboard to 1 kHz': timed([GUITAR_SET[1]], 100, 1000),
  'one string (100 modes), soundboard to 2 kHz': timed([GUITAR_SET[1]], 100, 2000),
  'one string (100 modes), soundboard to 5 kHz': timed([GUITAR_SET[1]], 100, 5000),
  'one string (100 modes), soundboard to 10 kHz': timed([GUITAR_SET[1]], 100, 10000),
  'one string (all 197 modes), soundboard to 5 kHz': timed([GUITAR_SET[1]], 1000, 5000),
  'three strings (100 modes each), soundboard to 2 kHz': timed(GUITAR_SET.slice(1, 4), 100, 2000),
  'three strings (100 modes each), soundboard to 5 kHz': timed(GUITAR_SET.slice(1, 4), 100, 5000),
  'six strings (60 modes each), soundboard to 2 kHz': timed(GUITAR_SET, 60, 2000),
  'six strings (100 modes each), soundboard to 2 kHz': timed(GUITAR_SET, 100, 2000),
  'six strings (100 modes each), soundboard to 5 kHz': timed(GUITAR_SET, 100, 5000),
}

const board = { massGrams: Math.round(1000 * plateMass(SOUNDBOARD)), lowestModeHz: fix(plateFrequency(SOUNDBOARD, 1, 1), 1) }
writeFileSync(path(`${OUT}/listening.json`), JSON.stringify({ sampleRate: SR, pluckForceNewtons: 2, prototypeSoundboard: board, files: info }, null, 2))
writeFileSync(path(`${OUT}/performance.json`), JSON.stringify({ sampleRate: SR, node: process.version, blockBudgetMs: 2.667, results: performanceResult }, null, 2))
console.table(Object.fromEntries(Object.entries(info).map(([k, v]) => [k, Object.fromEntries(Object.entries(v as object).filter(([key]) => key !== 'note'))])))
console.table(performanceResult)
console.log(`\nwritten to ${fsPath(OUT)}`)
