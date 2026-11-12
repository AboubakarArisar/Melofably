// Phase 3C.1: scenarios for the coupled-string prototype, shared by its tests
// (tests/coupled-string.test.ts) and its renders (analysis/render-string.ts).
// A string, modal or waveguide, joined at its bridge end to one resonator.
import { woodDecayTime } from '../src/audio/engine/physics.ts'
import { ALUMINIUM_BAR, barModes, halfSinePulse, type BarGeometry } from '../src/experimental/physics/bar.ts'
import { SpringDamper } from '../src/experimental/physics/connections.ts'
import { ModalResonator, type Mode } from '../src/experimental/physics/resonator.ts'
import { System } from '../src/experimental/physics/system.ts'
import { bridgeStiffness, DEFAULT_LOSS, fundamental, GUITAR_A, impedance, pickCutoff, pluckForce, residualCompliance, stringModes, waveSpeed, type StringLoss, type StringParams } from '../src/experimental/string/modalString.ts'
import { WaveguideString } from '../src/experimental/string/waveguide.ts'
import { amplitudeAt, SR } from './lib.ts'

export { ALUMINIUM_BAR, bridgeStiffness, DEFAULT_LOSS, fundamental, GUITAR_A, impedance, pickCutoff, pluckForce, residualCompliance, stringModes, WaveguideString, waveSpeed }
export type { Mode, StringLoss, StringParams }

/** Ports of the resonator the string sits on: 0 where the bridge is, 1 where it is struck and heard. */
export const BRIDGE = 0
export const LISTEN = 1

/** A metal bar as the thing the string sits on. */
export const metalBar = (sampleRate = SR, bar: BarGeometry = ALUMINIUM_BAR, bridgeAt = 0.2) => barModes(bar, [bridgeAt, 0.35], sampleRate)

/** A wooden bar (rosewood, the approved wooden bar's defaults and decay law). */
export function woodenBar(sampleRate = SR, bridgeAt = 0.2): Mode[] {
  const wood: BarGeometry = { length: 0.38, thickness: 19, density: 950, youngsModulus: 18, width: 0.05, lossFactor: 0.006 }
  return barModes(wood, [bridgeAt, 0.35], sampleRate).map((mode) => ({ ...mode, t60: woodDecayTime(mode.frequency, wood.lossFactor) }))
}

export interface Coupled {
  string: StringParams
  /** null: no losses in the string. */
  loss: StringLoss | null
  /** The resonator under the bridge, with ports [BRIDGE, LISTEN]; null for a rigid wall. */
  body: Mode[] | null
  /** The bridge: a spring (N/m) and damper (N s/m) between the string's end and the body. */
  bridge: { stiffness: number; damping?: number }
  kind: 'modal' | 'waveguide'
  /** Where the string is plucked, as a fraction of its length from the nut. */
  pluckAt?: number
  /** Modal string only: keep at most this many modes. */
  modes?: number
  /** Modal string only: false joins the bridge spring as given, without making up the residual compliance. */
  compensate?: boolean
  sampleRate?: number
}

export type Excitation = { pluck?: { force: number; cutoff?: number }; strikeBody?: { impulse: number; contact?: number }; impulseOnString?: number }

/** An immovable object with the body's two ports, for a string on a rigid bridge. */
const WALL: Mode[] = [{ frequency: 0, t60: Infinity, mass: 1e12, shape: [1, 1] }]

/**
 * Build the system and run it. Returns the force in the bridge (what the
 * approved string outputs), the body's velocity where it is heard, and the
 * energy held by the string, the body and the whole system at every sample.
 */
export function runCoupled(setup: Coupled, seconds: number, excitation: Excitation) {
  const sampleRate = setup.sampleRate ?? SR
  const pluckAt = setup.pluckAt ?? 0.8 // 0.2 from the bridge, as the approved model's default
  const system = new System()
  const modal = setup.kind === 'modal' ? new ModalResonator(stringModes(setup.string, [1, pluckAt], sampleRate, setup.loss, setup.modes), sampleRate) : null
  const guide = setup.kind === 'waveguide' ? new WaveguideString(setup.string, sampleRate, setup.loss) : null
  const string = (modal ?? guide)!
  const body = new ModalResonator(setup.body ?? WALL, sampleRate)
  const s = system.add(string)
  const b = system.add(body)
  // The modal string's bridge spring also carries the compliance its kept modes lack.
  const stiffness = modal && setup.compensate !== false && setup.bridge.stiffness > 0 ? bridgeStiffness(setup.bridge.stiffness, residualCompliance(setup.string, stringModes(setup.string, [1], sampleRate, null, setup.modes), sampleRate)) : setup.bridge.stiffness
  const spring = new SpringDamper(stiffness, setup.bridge.damping ?? 0)
  system.connect(spring, { resonator: s, port: 0 }, { resonator: b, port: BRIDGE })
  system.build(sampleRate)

  const N = Math.round(seconds * sampleRate)
  const out = { bridgeForce: new Float32Array(N), body: new Float32Array(N), energyString: new Float64Array(N), energyBody: new Float64Array(N), energy: new Float64Array(N), system, spring, modes: modal?.count ?? 0 }
  const pluck = excitation.pluck ? pluckForce(excitation.pluck.force, excitation.pluck.cutoff ?? pickCutoff(), sampleRate, N) : null
  const pulse = excitation.strikeBody ? halfSinePulse(excitation.strikeBody.contact ?? 0.0004, excitation.strikeBody.impulse * sampleRate, sampleRate) : null
  // A force F at a point of a string sends F / 2Z each way. Seen from the bridge: one wave arrives directly,
  // the other after going to the nut and back, inverted.
  const Z = impedance(setup.string)
  const round = sampleRate / fundamental(setup.string)
  const delayed = (x: Float64Array, n: number, delay: number) => {
    const at = n - delay
    const i = Math.floor(at)
    return i < 0 ? 0 : x[i] + (at - i) * ((x[i + 1] ?? x[i]) - x[i])
  }
  for (let n = 0; n < N; n++) {
    if (pluck) {
      if (modal) system.applyForce({ resonator: s, port: 1 }, pluck[n])
      else guide!.excite((delayed(pluck, n, ((1 - pluckAt) * round) / 2) - delayed(pluck, n, ((1 + pluckAt) * round) / 2)) / (2 * Z))
    }
    if (excitation.impulseOnString && n === 0) {
      if (modal) system.applyForce({ resonator: s, port: 1 }, excitation.impulseOnString * sampleRate)
      else guide!.excite((excitation.impulseOnString * sampleRate) / (2 * Z))
    }
    if (pulse && n < pulse.length) system.applyForce({ resonator: b, port: LISTEN }, pulse[n])
    system.step()
    out.bridgeForce[n] = system.connectionForce(0)
    out.body[n] = system.velocity({ resonator: b, port: LISTEN })
    out.energyString[n] = string.energy()
    out.energyBody[n] = body.energy()
    out.energy[n] = system.energy()
  }
  return out
}

/**
 * Frequencies (Hz, ascending, up to `limit`) of the string joined to the body
 * through a bridge spring, from continuous-time theory with no modal
 * truncation of the string and no time stepping. With the bridge spring's
 * compliance 1/k, the string end's receptance tan(w L / c) / (T w / c) and
 * the body's receptance at the bridge, the joined system vibrates where
 *
 *   1/k + tan(w L / c) c / (T w) + sum_n shape_n^2 / (m_n (w_n^2 - w^2)) = 0.
 */
export function exactFrequencies(string: StringParams, stiffness: number, body: Mode[] | null, limit: number): number[] {
  const c = waveSpeed(string)
  const D = (f: number) => {
    const w = 2 * Math.PI * f
    let sum = 1 / stiffness + (Math.tan((w * string.length) / c) * c) / (string.tension * w)
    for (const mode of body ?? []) sum += mode.shape[BRIDGE] ** 2 / (mode.mass * ((2 * Math.PI * mode.frequency) ** 2 - w * w))
    return sum
  }
  const roots: number[] = []
  const step = 0.02
  let [f0, d0] = [step, D(step)]
  for (let f = 2 * step; f <= limit; f += step) {
    const d = D(f)
    if (d0 * d < 0) {
      // A sign change is a root or a pole: bisect, and keep it only if the function goes to zero there.
      let [lo, hi, dlo] = [f0, f, d0]
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2
        const dm = D(mid)
        if (dlo * dm <= 0) hi = mid
        else [lo, dlo] = [mid, dm]
      }
      const root = (lo + hi) / 2
      if (Math.abs(D(root)) < 1e-3 * Math.max(Math.abs(d0), Math.abs(d))) roots.push(root)
    }
    ;[f0, d0] = [f, d]
  }
  // Where the body is only weakly driven, a root sits within a fraction of a hertz of the body mode's own
  // frequency (a pole of D), closer than the scan above can separate: look there on a much finer grid.
  for (const mode of body ?? []) {
    if (mode.frequency > limit) continue
    const fine = 1e-4
    let [g0, e0] = [mode.frequency - 0.5, D(mode.frequency - 0.5)]
    for (let f = g0 + fine; f <= mode.frequency + 0.5; f += fine) {
      const e = D(f)
      if (e0 * e < 0 && Math.abs(e) + Math.abs(e0) < 1e-2 * Math.abs(D(mode.frequency - 0.5)) && !roots.some((r) => Math.abs(r - f) < 2e-3)) roots.push((g0 * Math.abs(e) + f * Math.abs(e0)) / (Math.abs(e) + Math.abs(e0)))
      ;[g0, e0] = [f, e]
    }
  }
  return roots.sort((x, y) => x - y)
}

export const cents = (measured: number, expected: number) => 1200 * Math.log2(measured / expected)

/**
 * The frequency of the spectral peak nearest `f`, looked for within 2.5 Hz
 * on a 0.02 Hz grid over the whole recording: for telling apart two modes
 * only a few hertz from each other, which a general peak finder merges.
 */
export function peakNear(x: Float32Array, f: number, sampleRate = SR): number {
  const step = 0.02
  const levels: number[] = []
  for (let g = f - 2.5; g <= f + 2.5; g += step) levels.push(amplitudeAt(x, g, sampleRate))
  let best = NaN
  for (let i = 1; i < levels.length - 1; i++) {
    if (levels[i] > levels[i - 1] && levels[i] >= levels[i + 1]) {
      const g = f - 2.5 + i * step
      if (Number.isNaN(best) || Math.abs(g - f) < Math.abs(best - f)) best = g
    }
  }
  return best
}
