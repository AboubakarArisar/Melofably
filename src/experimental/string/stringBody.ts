// EXPERIMENTAL (Phase 3C.3). One modal string on the damped enclosed body of
// Phase 3C.2.3 (docs/SOUNDBOARD.md, section 10), as the builder uses it. The
// same pieces as the prototype (analysis/soundboard.ts, DAMPED_BOX): this
// file only fixes the body's geometry and puts the numbers in one place.
// tests/string-body.test.ts checks that both build the same engine system.
import type { Call } from '../wasm/engine.ts'
import { airCavity, enclosedCorner, type Cavity } from './airCavity.ts'
import { buildInstrument, STRING_PLUCK, type BuiltInstrument, type Instrument } from './instrument.ts'
import { bridgeStiffness, DEFAULT_LOSS, pickCutoff, residualCompliance, stringModes, type StringParams } from './modalString.ts'
import { AIR, plateFrequency, plateMass, plateModes, SPRUCE_PLATE, type PlateParams } from './soundboard.ts'

/** The body: fixed in this version. */
export const BODY = {
  /** Spruce, 0.5 x 0.4 m, 8 mm. */
  plate: { ...SPRUCE_PLATE, thickness: 0.008 } as PlateParams,
  /** Where the bridge stands, as fractions of the plate's length and width: on the nodal line of every mode (m, 3). */
  bridgeAt: [0.08, 1 / 3] as [number, number],
  /** 30 litres of air behind the plate; a hole of 80 mm radius with a screen of 100 Pa s/m over it. */
  cavity: { depth: 0.15, holeRadius: 0.08, holeScreen: 100 } as Cavity,
  /** Plate modes are kept up to this frequency, Hz. */
  limit: 5000,
}
/** The bridge: a spring between the string's end and the plate, N/m. */
export const BRIDGE_STIFFNESS = 1e6
/** Most modes kept for the string. */
export const STRING_MODES = 100
/** Mass of the string per metre, kg/m (the A2 string of the prototypes). */
export const STRING_DENSITY = 0.0036
/** How the finger lets go, 0 (a nail or pick) to 1 (soft flesh): the approved string's value. It sets how sharply the plucking force arrives. */
export const PLUCK_SOFTNESS = 0.3
/** A pluck's force is applied for this long, s; it has relaxed to nothing well before. */
export const PLUCK_SECONDS = 0.2
/** The listener: on the axis of the plate, this far away, m. */
export const LISTENER_DISTANCE = 1

export interface StringBody {
  /** Tension of the string, N. */
  tension: number
  /** Length of the string, m. */
  length: number
  /** Where it is plucked, as a fraction of its length from the nut (1 is the bridge). */
  pluckAt: number
  /** Whether the string's end stands on the bridge. Without it the string and the body are two separate things. */
  joined: boolean
}

export const stringOf = (s: Pick<StringBody, 'tension' | 'length'>): StringParams => ({ length: s.length, tension: s.tension, density: STRING_DENSITY })
/** Pitch of the string between two fixed ends, Hz. On the body it differs by a few cents at most. */
export const stringPitch = (s: Pick<StringBody, 'tension' | 'length'>) => Math.sqrt(s.tension / STRING_DENSITY) / (2 * s.length)

/** The string's modes as the engine holds them: ports are its bridge end, the pluck point, and a point 0.3 along. */
export const modesOfString = (s: StringBody, sampleRate: number) => stringModes(stringOf(s), [1, s.pluckAt, 0.3], sampleRate, DEFAULT_LOSS, STRING_MODES)

/** Stiffness the engine's bridge spring is given for this string: the bridge's own, with the compliance of the string's missing modes. */
export const bridgeSpring = (s: StringBody, sampleRate: number) => bridgeStiffness(BRIDGE_STIFFNESS, residualCompliance(stringOf(s), modesOfString(s, sampleRate), sampleRate))

/** The instrument as the prototype's builder takes it. */
export function stringBodyInstrument(s: StringBody, sampleRate: number): Instrument {
  const air = airCavity(BODY.plate, BODY.cavity)
  return {
    strings: [stringOf(s)],
    loss: DEFAULT_LOSS,
    stringModes: STRING_MODES,
    pluckAt: s.pluckAt,
    body: plateModes(BODY.plate, [BODY.bridgeAt], sampleRate, BODY.limit),
    bridge: { stiffness: s.joined ? BRIDGE_STIFFNESS : 0 },
    // The body's second port is its radiation port: the plate's mean velocity.
    output: { port: 1, gain: 1 },
    air: { stiffness: air.stiffness, damping: air.damping, resistance: air.resistance, plug: air.plug },
  }
}

/**
 * What turns the engine's output (flow of air out of the body per plate
 * area, m/s) into sound pressure at the listener, Pa, one sample at a time:
 *
 *   p[n] = perSample (x[n] - x[n-1])          rho S / (2 pi r) d/dt
 *   y[n] = b0 p[n] + b1 p[n-1] - a1 y[n-1]    a box, not a wall: enclosed()
 *
 * The same arithmetic as radiatedPressure() followed by enclosed().
 */
export function radiation(sampleRate: number) {
  const area = BODY.plate.length * BODY.plate.width
  const w = 2 * Math.tan((Math.PI * enclosedCorner(area)) / sampleRate)
  const [zero, pole] = [w / Math.SQRT2, w * Math.SQRT2]
  return { perSample: (AIR * area * sampleRate) / (2 * Math.PI * LISTENER_DISTANCE), b0: (2 + zero) / (2 + pole), b1: (zero - 2) / (2 + pole), a1: (pole - 2) / (2 + pole) }
}

export interface BuiltStringBody extends BuiltInstrument {
  /** Engine resonator of the string, and its port for plucking. */
  string: number
  pluckPort: number
  /** Engine connection of the bridge spring. */
  bridge: number
}

/** Engine calls that build the string on the body. */
export function buildStringBody(s: StringBody, sampleRate: number): BuiltStringBody {
  const built = buildInstrument(stringBodyInstrument(s, sampleRate), sampleRate)
  return { ...built, string: built.strings[0], pluckPort: STRING_PLUCK, bridge: built.bridges[0] }
}

/**
 * The host call that plucks: a force at the pluck point that steps to
 * `force` newtons and relaxes (pluckForce() in modalString.ts, the approved
 * string's excitation). It adds to whatever the string is already doing.
 */
export const pluckCall = (built: Pick<BuiltStringBody, 'string' | 'pluckPort'>, force: number, softness = PLUCK_SOFTNESS, delay = 0): Call => ['pluck', built.string, built.pluckPort, force, pickCutoff(softness), PLUCK_SECONDS, delay]

/** Plain facts about the body, for display. */
export function describeBody() {
  const air = airCavity(BODY.plate, BODY.cavity)
  return {
    plate: BODY.plate,
    plateGrams: 1000 * plateMass(BODY.plate),
    lowestPlateMode: plateFrequency(BODY.plate, 1, 1),
    volumeLitres: 1000 * air.volume,
    holeRadius: BODY.cavity.holeRadius,
    holeScreen: BODY.cavity.holeScreen ?? 0,
    helmholtz: air.helmholtz,
    bridgeAt: BODY.bridgeAt,
    bridgeStiffness: BRIDGE_STIFFNESS,
  }
}

// ---- Playing (Phase 3D.1) ---------------------------------------------------------------------------------

export interface PlayableStringBody extends BuiltStringBody {
  /** Engine connection of the finger: a damper between the string's pluck point and something that does not move. */
  finger: number
}

/**
 * The string on the body with a finger that can touch it. The finger is a
 * damper at the pluck point (the finger that plucks is the finger that
 * touches), of no strength until it is asked for: with the finger off, this
 * is the system of buildStringBody() and sounds the same.
 */
export function buildPlayableStringBody(s: StringBody, sampleRate: number): PlayableStringBody {
  const built = buildStringBody(s, sampleRate)
  if (built.ground === undefined) throw new Error('the body has nothing fixed for the finger to rest against')
  const calls = built.calls.slice(0, -1)
  const finger = calls.filter((call) => call[0] === 'addSpring' || call[0] === 'addContact').length
  calls.push(['addSpring', built.string, built.pluckPort, built.ground, 0, 0, 0, 0, 0], ['build'])
  return { ...built, calls, finger }
}

/**
 * Strength of the finger's damper, N s/m: twice the string's wave impedance.
 * A damper at one point of a string takes the most from the waves passing it
 * when it matches the two halves of string it sits between; weaker and the
 * waves pass, stronger and they bounce off it as from a fret. Measured in
 * Phase 3D.1: at this value the string loses 20 dB in 17 ms and 40 dB in 38 ms.
 */
export const fingerDamping = (s: Pick<StringBody, 'tension'>) => 2 * Math.sqrt(s.tension * STRING_DENSITY)

/** What the playing calls need to know of a built system: where the string is plucked and which damper is the finger. */
export type Playing = Pick<PlayableStringBody, 'string' | 'pluckPort' | 'finger'>

/** How long the finger takes to come to rest on the string and to leave it, s: no faster than a finger moves. */
export const TOUCH = { arrive: 0.002, leave: 0.004 }
/**
 * Retrigger: the finger lands, rests, and leaves as it plucks. 30 ms in all,
 * after which what the string was doing is about 30 dB down.
 */
export const RETRIGGER = { arrive: 0.002, rest: 0.026, leave: 0.002 }
/** A pulling finger's force follows the hand through a lowpass at this frequency, Hz: slow enough not to be a pluck itself. */
export const PULL_FOLLOWS = 30

/** The finger comes to rest on the string and stays (`on`), or leaves it. */
export const touchCall = (built: Pick<PlayableStringBody, 'finger'>, s: Pick<StringBody, 'tension'>, on: boolean): Call =>
  on ? ['touch', built.finger, fingerDamping(s), TOUCH.arrive, -1, 0] : ['touch', built.finger, 0, TOUCH.leave, 0, 0]

/** Touch, then pluck: the finger damps what the string was doing for 30 ms, and plucks as it leaves. */
export function retriggerCalls(built: Playing, s: Pick<StringBody, 'tension'>, force: number, softness = PLUCK_SOFTNESS): Call[] {
  return [
    ['touch', built.finger, fingerDamping(s), RETRIGGER.arrive, RETRIGGER.rest, RETRIGGER.leave],
    pluckCall(built, force, softness, RETRIGGER.arrive + RETRIGGER.rest + RETRIGGER.leave),
  ]
}

/**
 * Force needed to hold the string `displacement` metres aside at `position`
 * (a fraction of its length): the two halves of the string pull back with
 * the tension times the slope each makes, T d (1 / a + 1 / b). Exact for
 * small displacements of a string between fixed ends.
 */
export const pullForce = (s: Pick<StringBody, 'tension' | 'length'>, position: number, displacement: number) =>
  s.tension * displacement * (1 / (position * s.length) + 1 / ((1 - position) * s.length))

/**
 * The finger takes hold of the string and pulls it aside with `force`
 * newtons: it is touching (so what the string was doing is damped) and its
 * force follows the hand. Asked again, the force moves to the new value.
 */
export const pullCalls = (built: Playing, s: Pick<StringBody, 'tension'>, force: number): Call[] => [
  ['touch', built.finger, fingerDamping(s), TOUCH.arrive, -1, 0],
  ['hold', built.string, built.pluckPort, force, PULL_FOLLOWS],
]

/** The finger lets go: its force goes as fast as `softness` allows and its damping with it. The string is plucked. */
export const releaseCalls = (built: Playing, softness = PLUCK_SOFTNESS): Call[] => [
  ['touch', built.finger, 0, 0, 0, 0],
  ['hold', built.string, built.pluckPort, 0, pickCutoff(softness)],
]
