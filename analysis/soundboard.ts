// Phase 3C.2: scenarios for the soundboard prototype, shared by its tests
// (tests/soundboard.test.ts) and its renders (analysis/render-soundboard.ts).
// Modal strings on a modal plate, run in the WebAssembly engine.
import { buildInstrument, STRING_PLUCK, STRING_WATCH, type BuiltInstrument, type Instrument } from '../src/experimental/string/instrument.ts'
import { DEFAULT_LOSS, GUITAR_A, pickCutoff, pluckForce, type StringLoss, type StringParams } from '../src/experimental/string/modalString.ts'
import { plateModes, radiatedPressure, SPRUCE_PLATE, type PlateParams } from '../src/experimental/string/soundboard.ts'
import { halfSinePulse } from '../src/experimental/physics/bar.ts'
import type { Mode } from '../src/experimental/physics/resonator.ts'
import { SR } from './lib.ts'
import { createEngine, run, type Engine } from './wasm.ts'

export { buildInstrument, DEFAULT_LOSS, GUITAR_A, plateModes, SPRUCE_PLATE }
export type { Instrument, Mode, PlateParams, StringLoss, StringParams }

/**
 * The prototype's soundboard: the spruce plate at 4 mm. Guitar tops are nearer 2.5 to 3 mm but are
 * braced; a bare 3 mm plate is so yielding that it pulls this string 37 cents flat. The extra
 * thickness stands in for the bracing. It is a calibration, not a derivation.
 */
export const SOUNDBOARD: PlateParams = { ...SPRUCE_PLATE, thickness: 0.004 }

/** Where the bridge stands on the plate by default (fractions of length and width): off the nodal lines of the low modes. */
export const BRIDGE_AT: [number, number] = [0.3, 0.44]
/** Soundboard modes are kept up to this frequency unless stated. */
export const BOARD_LIMIT = 5000
/** String modes kept unless stated (to 10.9 kHz for the A2 string). */
export const STRING_MODES = 100

export interface OnBoard {
  plate?: PlateParams
  bridgeAt?: [number, number]
  strings?: StringParams[]
  loss?: StringLoss | null
  /** Keep soundboard modes below this frequency, Hz. */
  limit?: number
  stringModes?: number
  bridge?: { stiffness: number; damping?: number }
  /** Mass of the bridge, kg. With one, all strings share the first bridge point. */
  bridgeMass?: number
  /** No material damping in the plate (for checks that need sharp resonances or exact energy). */
  lossless?: boolean
  sampleRate?: number
}

/**
 * Strings on a soundboard. Each string has its own bridge point, 10 mm from
 * its neighbour across the grain. The body's ports are those bridge points,
 * then the radiation port.
 */
export function onSoundboard(o: OnBoard = {}) {
  const sampleRate = o.sampleRate ?? SR
  const plate = o.plate ?? SOUNDBOARD
  const strings = o.strings ?? [GUITAR_A]
  const [x, y] = o.bridgeAt ?? BRIDGE_AT
  const points = strings.map((_, i): [number, number] => [x, y + ((i - (strings.length - 1) / 2) * 0.01) / plate.width])
  const body = plateModes(plate, points, sampleRate, o.limit ?? BOARD_LIMIT).map((mode) => (o.lossless ? { ...mode, t60: Infinity } : mode))
  const radiation = strings.length
  const instrument: Instrument = {
    strings,
    loss: o.loss === undefined ? DEFAULT_LOSS : o.loss,
    stringModes: o.stringModes ?? STRING_MODES,
    pluckAt: 0.8,
    body,
    bridge: o.bridge ?? { stiffness: 1e6 },
    bridgeMass: o.bridgeMass,
    output: { port: radiation, gain: 1 },
  }
  return { instrument, radiation, area: plate.length * plate.width, plate, sampleRate }
}

export interface Events {
  /** Pluck string `string` at `time` s with a force that steps to `force` N. */
  plucks?: { time: number; string?: number; force?: number; cutoff?: number }[]
  /** Strike a body port at `time` s with an impulse (N s). */
  strikes?: { time: number; port: number; impulse: number; contact?: number }[]
}

export interface Recording {
  /** Force in the first string's bridge, N. */
  bridgeForce: Float32Array
  /** Velocity of the body where the first string's bridge stands, m/s. */
  bridgeVelocity: Float32Array
  /** Displacement of the first string 0.3 of its length from the nut, m. */
  stringDisplacement: Float32Array
  /** The body's velocity at its last port (the radiation port of a soundboard: its mean surface velocity), m/s. */
  bodyVelocity: Float32Array
  /** Energy held by all strings, by the body, and by everything including the bridges, J. */
  energyStrings: Float64Array
  energyBody: Float64Array
  energy: Float64Array
  engine: Engine
  built: BuiltInstrument
}

/** Run an instrument, recording the signals above at every sample. */
export function perform(inst: Instrument, seconds: number, events: Events, sampleRate = SR): Recording {
  const built = buildInstrument(inst, sampleRate)
  const engine = createEngine()
  run(engine, built.calls)
  const N = Math.round(seconds * sampleRate)
  const out: Recording = { bridgeForce: new Float32Array(N), bridgeVelocity: new Float32Array(N), stringDisplacement: new Float32Array(N), bodyVelocity: new Float32Array(N), energyStrings: new Float64Array(N), energyBody: new Float64Array(N), energy: new Float64Array(N), engine, built }
  // Forces to apply, per sample: [engine resonator, port, samples from `start`].
  const forces: { r: number; port: number; start: number; samples: Float64Array }[] = []
  for (const p of events.plucks ?? []) {
    const start = Math.round(p.time * sampleRate)
    // The plucking force has relaxed to a thousandth after 55 ms: keep 0.2 s of it.
    forces.push({ r: built.strings[p.string ?? 0], port: STRING_PLUCK, start, samples: pluckForce(p.force ?? 2, p.cutoff ?? pickCutoff(), sampleRate, Math.min(N - start, Math.round(0.2 * sampleRate))) })
  }
  for (const s of events.strikes ?? []) forces.push({ r: built.body, port: s.port, start: Math.round(s.time * sampleRate), samples: halfSinePulse(s.contact ?? 0.0004, s.impulse * sampleRate, sampleRate) })
  const last = inst.body[0].shape.length - 1
  let displacement = 0
  for (let n = 0; n < N; n++) {
    for (const f of forces) if (n >= f.start && n - f.start < f.samples.length) engine.applyForce(f.r, f.port, f.samples[n - f.start])
    engine.step()
    out.bridgeForce[n] = engine.connectionForce(built.bridges[0])
    out.bridgeVelocity[n] = engine.velocity(built.body, 0)
    out.bodyVelocity[n] = engine.velocity(built.body, last)
    displacement += engine.velocity(built.strings[0], STRING_WATCH) / sampleRate
    out.stringDisplacement[n] = displacement
    let strings = 0
    for (const s of built.strings) strings += engine.resonatorEnergy(s)
    out.energyStrings[n] = strings
    out.energyBody[n] = engine.resonatorEnergy(built.body)
    out.energy[n] = engine.energy()
  }
  return out
}

/** Sound pressure on the soundboard's axis at `distance` m, Pa, from a recording of the board. */
export const pressure = (recording: Recording, area: number, sampleRate = SR, distance = 1) => radiatedPressure(recording.bodyVelocity, area, sampleRate, distance)

/** Sound pressure level of a peak pressure, dB re 20 micropascal (of the equivalent sine: peak / sqrt 2). */
export const splOfPeak = (peakPa: number) => 20 * Math.log10(peakPa / Math.SQRT2 / 20e-6)
