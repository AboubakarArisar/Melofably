// Phase 3C.2: scenarios for the soundboard prototype, shared by its tests
// (tests/soundboard.test.ts) and its renders (analysis/render-soundboard.ts).
// Modal strings on a modal plate, run in the WebAssembly engine.
import { buildInstrument, STRING_PLUCK, STRING_WATCH, type BuiltInstrument, type Instrument } from '../src/experimental/string/instrument.ts'
import { DEFAULT_LOSS, GUITAR_A, pickCutoff, pluckForce, type StringLoss, type StringParams } from '../src/experimental/string/modalString.ts'
import { plateModes, radiatedPressure, SPRUCE_PLATE, type PlateParams } from '../src/experimental/string/soundboard.ts'
import { refinedPlateModes, unbaffled, type Refinements } from '../src/experimental/string/soundboardRefined.ts'
import { STRING_PLUCK as PLUCK_PORT } from '../src/experimental/string/instrument.ts'
import { airCavity, enclosed, type Cavity } from '../src/experimental/string/airCavity.ts'
import { outputBuffer } from './wasm.ts'
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

/**
 * The Phase 3C.2.1 soundboard: 8 mm, the bridge 4 cm from one end, no baffle.
 * Chosen by measurement (docs/SOUNDBOARD.md, section 8): of the plates tried
 * it is the one on which no note from E2 to E4 is pulled more than 5 cents.
 * Pass with other options: onSoundboard({ ...REFINED, strings }).
 */
export const REFINED: OnBoard = { plate: { ...SPRUCE_PLATE, thickness: 0.008 }, bridgeAt: [0.08, 0.44], unbaffled: true }

/**
 * Phase 3C.2.2: the refined board as the front of a closed box 15 cm deep (30 litres) with a round
 * hole of 60 mm radius. Chosen from nine boxes as the one with the strongest and most even
 * fundamentals from E2 to E4 (docs/SOUNDBOARD.md, section 9).
 */
export const ENCLOSED: OnBoard = { ...REFINED, cavity: { depth: 0.15, holeRadius: 0.06 } }

/**
 * Phase 3C.2.3: the box with its resonances under control. Against ENCLOSED: the bridge stands a third
 * of the way across the plate, on the line where mode (1,3) does not move, so that mode is not driven;
 * the hole is wider (80 mm radius) and covered by a screen of 100 Pa s/m, which takes the energy of the
 * air rushing through it. docs/SOUNDBOARD.md, section 10.
 */
export const DAMPED_BOX: OnBoard = { ...REFINED, bridgeAt: [0.08, 1 / 3], cavity: { depth: 0.15, holeRadius: 0.08, holeScreen: 100 } }

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
  /** Phase 3C.2.1 refinements of the plate (bridge footprint, losses, listener direction). Absent: the Phase 3C.2 plate. */
  refine?: Refinements
  /** The plate has no baffle: its bass is reduced as a dipole's is (see unbaffled()). */
  unbaffled?: boolean
  /** Phase 3C.2.2: a closed box of air with a hole behind the plate (airCavity.ts). The sound is then that of a box, not of an open plate. */
  cavity?: Cavity
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
  const all = o.refine ? refinedPlateModes(plate, points, sampleRate, o.limit ?? BOARD_LIMIT, o.refine) : plateModes(plate, points, sampleRate, o.limit ?? BOARD_LIMIT)
  const body = all.map((mode) => (o.lossless ? { ...mode, t60: Infinity } : mode))
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
  const air = o.cavity ? airCavity(plate, o.cavity) : undefined
  if (air) instrument.air = { stiffness: air.stiffness, damping: o.lossless ? 0 : air.damping, resistance: o.lossless ? 0 : air.resistance, plug: o.lossless ? { ...air.plug, t60: Infinity } : air.plug }
  return { instrument, radiation, area: plate.length * plate.width, plate, sampleRate, unbaffled: (o.unbaffled ?? false) && !air, air }
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
  /**
   * The engine's output: bodyVelocity for a bare board; with an air cavity, that plus the hole's flow
   * per plate area. This, not bodyVelocity, is what soundOf() takes when there is a cavity.
   */
  output: Float32Array
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
  const out: Recording = { bridgeForce: new Float32Array(N), bridgeVelocity: new Float32Array(N), stringDisplacement: new Float32Array(N), bodyVelocity: new Float32Array(N), output: new Float32Array(N), energyStrings: new Float64Array(N), energyBody: new Float64Array(N), energy: new Float64Array(N), engine, built }
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
    out.output[n] = engine.output()
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

/**
 * The sound of a soundboard's motion at 1 m, Pa: the baffled far field of
 * its radiation port, then the unbaffled correction if the setup asks for it.
 */
export function soundOf(setup: ReturnType<typeof onSoundboard>, velocity: ArrayLike<number>, distance = 1): Float32Array {
  const baffled = radiatedPressure(velocity, setup.area, setup.sampleRate, distance)
  if (setup.air) return enclosed(baffled, setup.area, setup.sampleRate)
  return setup.unbaffled ? unbaffled(baffled, setup.area, setup.sampleRate) : baffled
}

/**
 * Pluck one string of an instrument and return the velocity of the body's
 * output port, without the per-sample bookkeeping of perform(): for sweeps
 * over many configurations.
 */
export function pluckOne(inst: Instrument, string: number, seconds: number, sampleRate = SR, force = 2): Float32Array {
  const built = buildInstrument(inst, sampleRate)
  const engine = createEngine()
  run(engine, built.calls)
  const N = Math.round(seconds * sampleRate)
  const out = new Float32Array(N)
  const push = pluckForce(force, pickCutoff(), sampleRate, Math.round(0.2 * sampleRate))
  for (let n = 0; n < push.length; n++) {
    engine.applyForce(built.strings[string], PLUCK_PORT, push[n])
    engine.step()
    out[n] = engine.output()
  }
  const buffer = outputBuffer(engine)
  for (let at = push.length; at < N; at += 128) {
    const count = Math.min(128, N - at)
    engine.process(count)
    out.set(buffer.subarray(0, count), at)
  }
  if (engine.faults()) throw new Error('engine fault')
  return out
}
