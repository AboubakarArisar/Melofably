// EXPERIMENTAL (Phase 3D.12). Used only by the hybrid lab page
// (hybrid-lab.html). What the page's controls mean to the engine: which
// instrument is built, and which engine calls each playing action sends.
// Nothing here makes or alters sound; it only names things the validated
// model (stringBarBody.ts, Phases 3D.9 to 3D.11) already does.
import type { Call } from '../wasm/engine.ts'
import { DEFAULT_LOSS, pickCutoff, stringModes } from '../string/modalString.ts'
import { BAR_TOUCH, barOnBoardModes, barReleaseCalls, barTouchCalls, buildStringBarBody, dampable, STROKES, type BarTouch } from '../string/stringBarBody.ts'
import { buildPlayableStringBody, PLUCK_SECONDS, PLUCK_SOFTNESS, radiation, STRING_MODES, stringOf, touchCall } from '../string/stringBody.ts'

/** What the page can build. The first is the default. */
export const CHOICES = {
  'tie-0.20': 'Hybrid: string tied at 0.20 of the bar (reference)',
  'tie-0.18': 'Hybrid: string tied at 0.18 of the bar',
  'approved-string': 'Approved string on its body (no bar): for comparison',
} as const
export type Choice = keyof typeof CHOICES

/** The string of every instrument here: the approved A2 string. */
export const STRING = { tension: 73.5, length: 0.65, pluckAt: 0.8 }
/** Where the string can be plucked, as fractions of its length from the nut. The fourth is the approved instrument's. */
export const PLUCK_PLACES = [0.5, 0.65, 0.75, 0.8, 0.85, 0.9]
export const DEFAULT_PLUCK_PLACE = 3
/** Where a finger can be laid on the bar, as fractions of its length (Phase 3D.11, section 6). */
export const DAMP_PLACES = [
  { at: 0.5, name: 'middle (stops the note, little else)' },
  { at: 0.05, name: 'end by the string (stops most, duller)' },
  { at: 0.2, name: 'by the string\'s tie (shortens the knock)' },
]
/** Pascals at the audio node's ceiling: a strong stroke peaks at 4.1 Pa, a 2 N pluck at 0.19 Pa. One value for every instrument. */
export const FULL_SCALE = 8
/** Ranges of the two strength controls: pluck force, N, and the 5 g striker's speed, m/s. */
export const PLUCK_FORCE = { min: 0.5, max: 8, default: 2 }
export const STRIKE_SPEED = { min: 0.25, max: 2, ...STROKES }

export interface Lab {
  choice: Choice
  sampleRate: number
  /** Engine calls that build it, ending with the conversion to sound pressure. */
  calls: Call[]
  /** Engine resonators and connections. `bar`, `striker` and `barFingers` are absent on the approved string instrument. */
  string: number
  pluckPorts: number[]
  stringFinger: number
  bar?: number
  striker?: number
  /** One per DAMP_PLACES. */
  barFingers: number[]
}

/** `calls` with further ports on resonator `resonator`: one column of mode-shape values per new port. Returns the first new port's number. */
function addPorts(calls: Call[], resonator: number, columns: number[][]): { calls: Call[]; first: number } {
  let seen = -1
  const at = calls.findIndex((call) => call[0] === 'addResonator' && ++seen === resonator)
  if (at < 0) throw new Error(`no resonator ${resonator}`)
  const [first, modes] = [calls[at][1], calls[at][2]]
  for (const column of columns) if (column.length !== modes) throw new Error(`a port needs ${modes} shape values, not ${column.length}`)
  const shapes = columns.flatMap((column, p) => column.map((value, n): Call => ['setShape', resonator, first + p, n, value]))
  return { calls: [...calls.slice(0, at), ['addResonator', first + columns.length, modes], ...shapes, ...calls.slice(at + 1)], first }
}

/** The instrument a choice names, at a sample rate. Built once per choice; playing never rebuilds it. */
export function buildLab(choice: Choice, sampleRate: number): Lab {
  if (!(choice in CHOICES)) throw new Error(`unknown instrument "${choice}"`)
  if (!(sampleRate >= 22050 && sampleRate <= 192000)) throw new Error(`cannot build the instrument at ${sampleRate} Hz`)
  const r = radiation(sampleRate)
  const radiate: Call = ['radiate', r.perSample, r.b0, r.b1, r.a1, FULL_SCALE]
  // The string's mode shapes at each place it can be plucked: further ports on the string, which cost nothing to the solver.
  const places = stringModes(stringOf(STRING), PLUCK_PLACES, sampleRate, DEFAULT_LOSS, STRING_MODES)
  const columns = PLUCK_PLACES.map((_, p) => places.map((mode) => mode.shape[p]))
  const ports = (first: number) => PLUCK_PLACES.map((_, p) => first + p)
  if (choice === 'approved-string') {
    const built = buildPlayableStringBody({ ...STRING, joined: true }, sampleRate)
    const plucked = addPorts(built.calls, built.string, columns)
    return { choice, sampleRate, calls: [...plucked.calls, radiate], string: built.string, pluckPorts: ports(plucked.first), stringFinger: built.finger, barFingers: [] }
  }
  const s = dampable(DAMP_PLACES[0].at, choice === 'tie-0.18' ? 0.18 : 0.2)
  const built = buildStringBarBody(s, sampleRate)
  const plucked = addPorts(built.calls, built.string, columns)
  // The other places for a finger on the bar: a port each, and a connection of no strength to what does not move, as the first has.
  const others = DAMP_PLACES.slice(1).map(({ at }) => barOnBoardModes(s.bar, sampleRate, [at]).map((mode) => mode.shape.at(-1)!))
  const fingered = addPorts(plucked.calls, built.bar, others)
  let connections = fingered.calls.filter((call) => call[0] === 'addSpring' || call[0] === 'addContact').length
  const barFingers = [built.barFinger!]
  const calls = fingered.calls.slice(0, -1)
  others.forEach((_, p) => {
    calls.push(['addSpring', built.bar, fingered.first + p, built.ground, 0, 0, 0, 0, 0])
    barFingers.push(connections++)
  })
  return { choice, sampleRate, calls: [...calls, ['build'], radiate], string: built.string, pluckPorts: ports(plucked.first), stringFinger: built.finger, bar: built.bar, striker: built.mallet, barFingers }
}

const clamp = (x: number, low: number, high: number) => Math.min(high, Math.max(low, Number.isFinite(x) ? x : low))

/** A pluck of `force` newtons at one of PLUCK_PLACES: the approved string's own pluck, at that place. */
export const pluckCalls = (lab: Lab, force: number, place = DEFAULT_PLUCK_PLACE): Call[] => [['pluck', lab.string, lab.pluckPorts[clamp(Math.round(place), 0, PLUCK_PLACES.length - 1)], clamp(force, PLUCK_FORCE.min, PLUCK_FORCE.max), pickCutoff(PLUCK_SOFTNESS), PLUCK_SECONDS, 0]]
/** The 5 g striker thrown at the bar's middle at `speed` m/s. Nothing on an instrument with no bar. */
export const strikeCalls = (lab: Lab, speed: number): Call[] => (lab.striker === undefined ? [] : [['launch', lab.striker, clamp(speed, STRIKE_SPEED.min, STRIKE_SPEED.max)]])
/** A finger laid on the string (the approved instrument's mute) or lifted from it. */
export const muteCalls = (lab: Lab, on: boolean): Call[] => [touchCall({ finger: lab.stringFinger }, STRING, on)]
/** A finger laid on the bar at one of DAMP_PLACES (`landing`: it was not there before), or its pressure changed. */
export const dampCalls = (lab: Lab, place: number, touch: BarTouch, landing = true): Call[] => (lab.barFingers[place] === undefined ? [] : barTouchCalls({ barFinger: lab.barFingers[place] }, touch, lab.sampleRate, undefined, landing))
export const undampCalls = (lab: Lab, place: number): Call[] => (lab.barFingers[place] === undefined ? [] : barReleaseCalls({ barFinger: lab.barFingers[place] }, lab.sampleRate))

export type Strength = keyof typeof BAR_TOUCH

/**
 * The page's controls, as a player has them: what is held, where and how hard, and the engine calls each
 * change sends, in order, through `send`. The two fingers are independent: neither waits for the other.
 */
export class Controls {
  muted = false
  damped = false
  dampPlace = 0
  dampStrength: Strength = 'medium'
  pluckPlace = DEFAULT_PLUCK_PLACE
  readonly lab: Lab
  private readonly send: (calls: Call[]) => void
  constructor(lab: Lab, send: (calls: Call[]) => void) {
    this.lab = lab
    this.send = send
  }
  get hasBar() {
    return this.lab.bar !== undefined
  }
  private go(calls: Call[]) {
    if (calls.length) this.send(calls)
  }
  pluck(force: number) {
    this.go(pluckCalls(this.lab, force, this.pluckPlace))
  }
  strike(speed: number) {
    this.go(strikeCalls(this.lab, speed))
  }
  setPluckPlace(place: number) {
    this.pluckPlace = clamp(Math.round(place), 0, PLUCK_PLACES.length - 1)
  }
  setMute(on: boolean) {
    if (on === this.muted) return
    this.muted = on
    this.go(muteCalls(this.lab, on))
  }
  setDamp(on: boolean) {
    if (!this.hasBar || on === this.damped) return
    this.damped = on
    this.go(on ? dampCalls(this.lab, this.dampPlace, BAR_TOUCH[this.dampStrength]) : undampCalls(this.lab, this.dampPlace))
  }
  /** Moving a finger that is down lifts it where it was and lays it where it now is. */
  setDampPlace(place: number) {
    const next = clamp(Math.round(place), 0, DAMP_PLACES.length - 1)
    if (next === this.dampPlace) return
    if (this.damped) this.go([...undampCalls(this.lab, this.dampPlace), ...dampCalls(this.lab, next, BAR_TOUCH[this.dampStrength])])
    this.dampPlace = next
  }
  /** Pressing harder or softer with a finger that is down changes its pressure where it is; it does not land again. */
  setDampStrength(strength: Strength) {
    if (!(strength in BAR_TOUCH)) throw new Error(`unknown strength "${strength}"`)
    if (strength === this.dampStrength) return
    this.dampStrength = strength
    if (this.damped) this.go(dampCalls(this.lab, this.dampPlace, BAR_TOUCH[strength], false))
  }
}
