// EXPERIMENTAL (Phase 3D.6). A feasibility prototype: not used by the
// application or the builder. One modal string and one metal bar, both
// standing on the damped enclosed body of Phase 3C.2.3 (the builder's string
// instrument, stringBody.ts): three vibrating things in one engine system.
//
//   string --bridge--> soundboard <--two supports-- bar <--mallet
//                          |
//                    air in the box --> hole
//
// The string and the bar never touch. Each pushes the board where it
// stands, the board moves, and that motion pushes the other. What is heard
// is the body's radiated pressure only (the board's mean motion and the
// hole's flow), by the approved string instrument's own output: nothing of
// the bar or the string is added to it. docs/THREE_BODY.md.
//
// What is reused unchanged: the string (modalString.ts), its bridge spring
// with the allowance for its missing modes, the plate (soundboard.ts), the
// air cavity (airCavity.ts), the finger, the bar's bending modes (the
// approved bar formulas, with the decay law of the builder's metal bars),
// the mallet (a mass and a Hertz contact), and the engine's solver.
//
// What is new, because standing on a board requires it:
//
//   The bar moves as a whole. A free bar has, besides its bending modes, two
//   ways of moving without bending: up and down, and rocking about its
//   middle. Elsewhere in this project bars have bending modes only, which is
//   the same as holding the bar's middle still in space; a bar standing on a
//   board would then hold the board still too. Here the bar has both
//   rigid-body modes (frequency zero, the bar's own mass, shapes 1 and
//   sqrt(3) (2 xi - 1)), so the board carries its weight and nothing else.
//
//   Two supports. One point of contact would leave the bar free to spin
//   about it. It stands on two, each a spring and a damper (a post with a
//   pad), as bars are mounted on real instruments.
import { barModeFrequencies, barModeShape } from '../../audio/engine/physics.ts'
import type { Mode } from '../physics/resonator.ts'
import type { Call } from '../wasm/engine.ts'
import { airCavity } from './airCavity.ts'
import { buildInstrument, STRING_END, STRING_PLUCK } from './instrument.ts'
import { DEFAULT_LOSS } from './modalString.ts'
import { plateModes } from './soundboard.ts'
import { BODY, BRIDGE_STIFFNESS, STRING_MODES, stringOf, type Playing } from './stringBody.ts'

/** A metal bar, in the builder's units. */
export interface BarOnBoard {
  /** Length m, width mm, thickness mm. */
  length: number
  width: number
  thickness: number
  /** Density kg/m^3, Young's modulus GPa, and the loss factor of the builder's metal-bar decay law. */
  density: number
  youngsModulus: number
  lossFactor: number
  /** Where the mallet strikes it, and where its two supports are, as fractions of its length. */
  strikeAt: number
  supports: [number, number]
  /**
   * For analysis only (Phase 3D.7): keep this many bending modes. 0 is a bar that cannot bend: a rigid
   * lump of the same mass on the same pads, which shows what the mounting does by itself. Absent: all.
   */
  bendingModes?: number
}

/** Aluminium, as the builder's. */
export const ALUMINIUM = { density: 2700, youngsModulus: 70, lossFactor: 0.001 }
export const barMass = (b: BarOnBoard) => b.density * b.length * (b.width / 1000) * (b.thickness / 1000)

/** Ports of the bar in the engine. */
export const BAR_SUPPORT_A = 0
export const BAR_SUPPORT_B = 1
export const BAR_STRIKE = 2
/** A point for reading or for an optional direct tie to the string: the bar's end. */
export const BAR_END = 3
/** The bar's first two modes are its rigid-body modes; its bending modes follow. */
export const RIGID_MODES = 2

/**
 * The bar's modes: moving as a whole (up and down, then rocking), then
 * bending, with the frequencies, shapes and mass of the builder's bars and
 * the decay of its metal bars. Each mode's mass is the bar's mass (shapes of
 * unit mean square). Bending modes above 0.45 of the sample rate are left out.
 */
export function barOnBoardModes(b: BarOnBoard, sampleRate: number): Mode[] {
  const mass = barMass(b)
  const at = [b.supports[0], b.supports[1], b.strikeAt, 0]
  const rigid: Mode[] = [
    { frequency: 0, t60: Infinity, mass, shape: at.map(() => 1) },
    { frequency: 0, t60: Infinity, mass, shape: at.map((xi) => Math.sqrt(3) * (2 * xi - 1)) },
  ]
  const bending = barModeFrequencies(b)
    .map((frequency, n): Mode => ({ frequency, t60: 1 / (1 / 6 + (b.lossFactor * frequency) / 2.2), mass, shape: at.map((xi) => barModeShape(n, xi)) }))
    .filter((mode) => mode.frequency < 0.45 * sampleRate)
    .slice(0, b.bendingModes ?? Infinity)
  return [...rigid, ...bending]
}

export interface StringBarBody {
  /** The string: tension N, length m, where it is plucked (fraction from the nut). */
  tension: number
  length: number
  pluckAt: number
  /** Whether the string stands on the board by its bridge. */
  stringOn: boolean
  /** Where the bridge stands on the board (fractions of its length and width). Absent: where the approved body has it. */
  bridgeAt?: [number, number]
  bar: BarOnBoard
  /**
   * Where the bar lies on the board: its middle, as fractions of the board's
   * length and width. It lies along the board's length.
   */
  barAt: [number, number]
  /** Each of the bar's two supports: a spring (N/m) and a damper (N s/m). null: the bar does not stand on the board. */
  mount: { stiffness: number; damping: number } | null
  /** Optional: a spring and damper straight from the string's end to the bar's end. Absent: none. */
  direct?: { stiffness: number; damping: number }
  /** A mallet for the bar: mass (kg) and Hertz contact stiffness (N/m^1.5). */
  mallet?: { mass: number; stiffness: number }
}

/** Where on the board the bar's two supports stand, as fractions of the board's length and width. */
export function supportPoints(s: Pick<StringBarBody, 'bar' | 'barAt'>): [[number, number], [number, number]] {
  const along = (xi: number) => s.barAt[0] + ((xi - 0.5) * s.bar.length) / BODY.plate.length
  return [[along(s.bar.supports[0]), s.barAt[1]], [along(s.bar.supports[1]), s.barAt[1]]]
}

/** Ports of the board in the engine. */
export const BOARD_BRIDGE = 0
export const BOARD_SUPPORT_A = 1
export const BOARD_SUPPORT_B = 2
export const BOARD_RADIATION = 3

export interface BuiltStringBarBody extends Playing {
  calls: Call[]
  /** Engine resonators: the string, the board, the plug of air in the hole, the bar, and the mallet's head if there is one. */
  board: number
  plug: number
  bar: number
  malletHead?: number
  /** Engine connections: the bridge, the bar's two supports (if mounted), the mallet's contact and the direct tie (if any). */
  bridge: number
  supports?: [number, number]
  mallet?: number
  direct?: number
  modes: { string: number; board: number; bar: number }
}

/**
 * Engine calls that build the three-component instrument. The engine's
 * output is the body's: the board's mean velocity and the hole's flow, as
 * for the string on the box. To be followed by the processor's 'radiate'
 * (radiation() in stringBody.ts) to hear it as sound pressure.
 */
export function buildStringBarBody(s: StringBarBody, sampleRate: number): BuiltStringBarBody {
  const points = supportPoints(s)
  for (const [x] of points) if (!(x > 0 && x < 1)) throw new Error('the bar does not fit on the board there')
  const air = airCavity(BODY.plate, BODY.cavity)
  const built = buildInstrument(
    {
      strings: [stringOf(s)],
      loss: DEFAULT_LOSS,
      stringModes: STRING_MODES,
      pluckAt: s.pluckAt,
      body: plateModes(BODY.plate, [s.bridgeAt ?? BODY.bridgeAt, ...points], sampleRate, BODY.limit),
      bridge: { stiffness: s.stringOn ? BRIDGE_STIFFNESS : 0 },
      output: { port: BOARD_RADIATION, gain: 1 },
      air: { stiffness: air.stiffness, damping: air.damping, resistance: air.resistance, plug: air.plug },
    },
    sampleRate,
  )
  if (built.ground === undefined) throw new Error('the body has nothing fixed for the finger to rest against')
  const calls = built.calls.slice(0, -1)
  let resonators = calls.filter((call) => call[0] === 'addResonator').length
  let connections = calls.filter((call) => call[0] === 'addSpring' || call[0] === 'addContact').length
  const string = built.strings[0]
  // The finger, as on the string instrument: a damper of no strength until asked for.
  const finger = connections++
  calls.push(['addSpring', string, STRING_PLUCK, built.ground, 0, 0, 0, 0, 0])
  // The bar.
  const modes = barOnBoardModes(s.bar, sampleRate)
  const bar = resonators++
  calls.push(['addResonator', 4, modes.length])
  modes.forEach((mode, n) => {
    mode.shape.forEach((value, port) => calls.push(['setShape', bar, port, n, value]))
    calls.push(['setMode', bar, n, mode.frequency, mode.t60, mode.mass])
  })
  let supports: [number, number] | undefined
  if (s.mount) {
    supports = [connections++, connections++]
    calls.push(['addSpring', bar, BAR_SUPPORT_A, built.body, BOARD_SUPPORT_A, s.mount.stiffness, s.mount.damping, 0, 0])
    calls.push(['addSpring', bar, BAR_SUPPORT_B, built.body, BOARD_SUPPORT_B, s.mount.stiffness, s.mount.damping, 0, 0])
  }
  let direct: number | undefined
  if (s.direct) {
    direct = connections++
    calls.push(['addSpring', string, STRING_END, bar, BAR_END, s.direct.stiffness, s.direct.damping, 0, 0])
  }
  let mallet: number | undefined
  let malletHead: number | undefined
  if (s.mallet) {
    malletHead = resonators++
    calls.push(['addResonator', 1, 1], ['setShape', malletHead, 0, 0, 1], ['setMode', malletHead, 0, 0, Infinity, s.mallet.mass])
    calls.push(['addContact', malletHead, 0, bar, BAR_STRIKE, s.mallet.stiffness, 1.5, -1])
    mallet = connections++
  }
  calls.push(['build'])
  // The plug of air is the resonator buildInstrument adds after the board; the ground follows it.
  return { calls, string, pluckPort: STRING_PLUCK, finger, board: built.body, plug: built.body + 1, bar, malletHead, bridge: built.bridges[0], supports, mallet, direct, modes: { string: built.modes.strings[0], board: built.modes.body, bar: modes.length } }
}

// ---- The two configurations of the feasibility study (docs/THREE_BODY.md) -----------------------------------

/** A small aluminium bar: 0.20 m x 20 mm x 5 mm, 54 g, lowest note 654 Hz. On two pads a tenth of the way in from each end. */
export const SMALL_BAR: BarOnBoard = { ...ALUMINIUM, length: 0.2, width: 20, thickness: 5, strikeAt: 0.35, supports: [0.1, 0.9] }

/**
 * The prototype as first built: the approved string instrument (A2 string,
 * bridge where the approved body has it) with the small bar lying across
 * the board on two firm pads (1e6 N/m and 5 N s/m each), and the builder's
 * default mallet (20 g, hardness 0.5: 1e8 N/m^1.5).
 */
export const PROTOTYPE: StringBarBody = { tension: 73.5, length: 0.65, pluckAt: 0.8, stringOn: true, bar: SMALL_BAR, barAt: [0.5, 0.65], mount: { stiffness: 1e6, damping: 5 }, mallet: { mass: 0.02, stiffness: 1e8 } }

/**
 * The most promising configuration found. Two changes to the bar, nothing
 * else:
 *   - its pads stand close to the nodes of its lowest mode (0.215 and 0.785;
 *     the nodes are at 0.224 and 0.776), so that mode leaks into the board
 *     slowly enough to ring and fast enough to be heard;
 *   - it is 1.3 mm shorter, which puts that mode, as it is on the board, on
 *     the string's 6th harmonic (659.5 Hz).
 */
export const TUNED: StringBarBody = { ...PROTOTYPE, bar: { ...SMALL_BAR, length: 0.1987, supports: [0.215, 0.785] } }

// ---- Phase 3D.7: mounting and playability candidates (docs/THREE_BODY_MOUNTING.md) -----------------------------

/**
 * Candidate A, "soft mount". The tuned bar on softer, lightly damped pads
 * (1e5 N/m and 1 N s/m each, a tenth of the stiffness) still close to its
 * nodes, struck at its middle, and 0.6 mm longer so that its note as it
 * stands is again the string's 6th harmonic. The string, its bridge and the
 * body are the approved ones. The knock of a stroke is 4 dB lower and the
 * bar's note lasts as long as the bar's own material lets it.
 */
export const SOFT_MOUNT: StringBarBody = { ...PROTOTYPE, bar: { ...SMALL_BAR, length: 0.1993, supports: [0.215, 0.785], strikeAt: 0.5 }, mount: { stiffness: 1e5, damping: 1 } }

/**
 * Candidate B, "soft mount, bridge moved". Candidate A with the string's
 * bridge at (0.08, 0.44) of the board instead of the approved (0.08, 1/3):
 * off the nodal line, so the string gives the board more. This is a
 * different body from the approved one, in this prototype only.
 */
export const SOFT_MOUNT_BRIDGE: StringBarBody = { ...SOFT_MOUNT, bridgeAt: [0.08, 0.44] }

/** A way of playing, not a part of the instrument: a small mallet (5 g, the same hardness) at 1 m/s. */
export const LIGHT_MALLET = { mallet: { mass: 0.005, stiffness: 1e8 }, stroke: 1 }
