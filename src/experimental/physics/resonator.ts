// EXPERIMENTAL (Phase 3A proof of concept). Not used by the application.
// Numerical method, units and assumptions: docs/EXPERIMENTAL_ENGINE.md.

/**
 * Anything that stores vibrational energy and exposes points ("ports") where
 * force can be applied and motion read. The time step is split in two so that
 * forces between objects can be solved together with their motion:
 *
 *   1. predict(): where would each port be moving at the middle of this step
 *      if no connection force acted? (External, prescribed forces included.)
 *   2. The system solves the connection forces, using mobility().
 *   3. commit(): finish the step with those forces applied.
 *
 * Units are SI: force N, displacement m, velocity m/s, mass kg, energy J.
 *
 * Nothing called once per sample returns a number: results are written into
 * typed arrays. In JavaScript a function that returns a non-integer number to
 * a caller that has not inlined it allocates a small object each time, and
 * allocation on the audio thread eventually means a garbage-collection pause.
 *
 * The interface is deliberately not modal. A digital waveguide could
 * implement it too: its mobility is its wave admittance at the port, and
 * predict() is what arrives at the port from the delay lines this sample.
 */
export interface Resonator {
  readonly ports: number
  /**
   * Mid-step velocity produced at port `i` by a unit force at port `j` held
   * over this step (m/s per N). The "instantaneous" part of the response.
   */
  mobility(i: number, j: number): number
  /** Step 1. `external[p]` is a prescribed force at port p (N); writes mid-step port velocities into `free`. */
  predict(external: Float64Array, free: Float64Array): void
  /** Step 3. `forces[p]` is the net connection force at port p (N). */
  commit(forces: Float64Array): void
  /** Steps 1 and 3 in one pass, for a resonator nothing is connected to. */
  advance(external: Float64Array): void
  /** Writes the displacement of every port at the start of the current step into `out` (m). */
  displacements(out: Float64Array): void
  /** Mid-step velocity of every port for the step just committed (m/s). */
  readonly portVelocity: Float64Array
  /** Stored energy now: kinetic plus elastic (J). */
  energy(): number
  /** Energy dissipated internally during the step just committed (J, >= 0). */
  dissipated(): number
}

/** One vibration mode of an object, as physical data. */
export interface Mode {
  /** Frequency of free oscillation, Hz. 0 is a rigid-body mode (a free mass). */
  frequency: number
  /** 60 dB decay time, s. Infinity for no damping. */
  t60: number
  /** Effective modal mass, kg, for the mode shape normalisation used in `shape`. */
  mass: number
  /** Mode shape at each port (dimensionless). */
  shape: number[]
}

/**
 * How the continuous mode is mapped to discrete time.
 *  - 'none': the midpoint rule applied to the physical m, c, k. Stable and
 *    passive, but frequencies come out low and amplitudes weak towards Nyquist.
 *  - 'poles': stiffness and damping adjusted so the discrete mode has exactly
 *    the intended frequency and decay.
 *  - 'full': mass adjusted as well, so that the mode's response to an impulse
 *    also has the intended amplitude. The default.
 * All three are a positive mass, spring and damper, hence passive.
 */
export type Prewarp = 'none' | 'poles' | 'full'

/**
 * A set of modes integrated with the implicit midpoint rule:
 *
 *   m dv/dt + c v + k q = phi . F        dq/dt = v
 *
 *   v_mid = (v[n] + v[n+1]) / 2,   q[n+1] = q[n] + T v_mid,
 *   m (v[n+1] - v[n]) / T = phi . F_mid - c v_mid - k (q[n] + T v_mid / 2)
 *
 * which gives v_mid = a (v[n] - g q[n]) + b (phi . F_mid) with
 *   D = 1 + T c / (2 m) + T^2 k / (4 m),  a = 1 / D,  g = T k / (2 m),  b = T / (2 m D).
 *
 * No allocation after construction.
 */
export class ModalResonator implements Resonator {
  readonly ports: number
  readonly count: number
  private readonly dt: number
  // Per mode.
  private readonly q: Float64Array // displacement, m
  private readonly v: Float64Array // velocity, m/s
  private readonly vMid: Float64Array
  private readonly a: Float64Array
  private readonly g: Float64Array
  private readonly b: Float64Array
  private readonly m: Float64Array // discrete mass
  private readonly c: Float64Array // discrete damping
  private readonly k: Float64Array // discrete stiffness
  // shape[p * count + n]
  private readonly shape: Float64Array
  private readonly mob: Float64Array // ports x ports
  readonly portVelocity: Float64Array
  // Energy dissipated in the last step. Kept in a typed array, not a plain
  // field: V8 allocates a new boxed number each time a non-integer is stored
  // in an object field, which showed up as garbage collection on every few
  // thousand steps.
  private readonly lost = new Float64Array(1)

  constructor(modes: Mode[], sampleRate: number, prewarp: Prewarp = 'full') {
    const T = (this.dt = 1 / sampleRate)
    const N = (this.count = modes.length)
    const P = (this.ports = modes[0]?.shape.length ?? 0)
    this.q = new Float64Array(N)
    this.v = new Float64Array(N)
    this.vMid = new Float64Array(N)
    this.a = new Float64Array(N)
    this.g = new Float64Array(N)
    this.b = new Float64Array(N)
    this.m = new Float64Array(N)
    this.c = new Float64Array(N)
    this.k = new Float64Array(N)
    this.shape = new Float64Array(P * N)
    this.mob = new Float64Array(P * P)
    this.portVelocity = new Float64Array(P)

    modes.forEach((mode, n) => {
      const omega = 2 * Math.PI * mode.frequency
      const sigma = Number.isFinite(mode.t60) ? Math.log(1000) / mode.t60 : 0 // decay rate, 1/s
      let stiffnessPerMass = omega * omega + sigma * sigma // k / m
      let dampingPerMass = 2 * sigma // c / m
      let mass = mode.mass
      if (prewarp !== 'none') {
        // The midpoint rule is the bilinear transform s = (2/T)(z - 1)/(z + 1).
        // Choose the s-plane pole whose image is the z-plane pole we want,
        // z = r e^(j theta): exact frequency and exact decay.
        const r = Math.exp(-sigma * T)
        const theta = omega * T
        const [zr, zi] = [r * Math.cos(theta), r * Math.sin(theta)]
        const den = (zr + 1) * (zr + 1) + zi * zi
        const alpha = ((2 / T) * ((zr - 1) * (zr + 1) + zi * zi)) / den // Re(s)
        const beta = ((2 / T) * (2 * zi)) / den // Im(s)
        stiffnessPerMass = alpha * alpha + beta * beta
        dampingPerMass = -2 * alpha
        if (prewarp === 'full') {
          // The bilinear map also weakens a mode's impulse response towards
          // Nyquist, by (4/T^2) / (4/T^2 + (2/T) c/m + k/m). Scale the mass by
          // the same factor to restore the intended amplitude.
          const d0 = 4 / (T * T) + (2 / T) * dampingPerMass + stiffnessPerMass
          mass = (mode.mass * (4 / (T * T))) / d0
        }
      }
      this.m[n] = mass
      this.c[n] = mass * dampingPerMass
      this.k[n] = mass * stiffnessPerMass
      const D = 1 + (T * dampingPerMass) / 2 + (T * T * stiffnessPerMass) / 4
      this.a[n] = 1 / D
      this.g[n] = (T * stiffnessPerMass) / 2
      this.b[n] = T / (2 * mass * D)
      for (let p = 0; p < P; p++) this.shape[p * N + n] = mode.shape[p]
    })
    for (let i = 0; i < P; i++) {
      for (let j = 0; j < P; j++) {
        let s = 0
        for (let n = 0; n < N; n++) s += this.shape[i * N + n] * this.shape[j * N + n] * this.b[n]
        this.mob[i * P + j] = s
      }
    }
  }

  mobility(i: number, j: number): number {
    return this.mob[i * this.ports + j]
  }

  predict(external: Float64Array, free: Float64Array): void {
    const { count: N, ports: P, shape, vMid, v, q, a, g, b } = this
    for (let n = 0; n < N; n++) {
      let f = 0
      for (let p = 0; p < P; p++) f += shape[p * N + n] * external[p]
      vMid[n] = a[n] * (v[n] - g[n] * q[n]) + b[n] * f
    }
    for (let p = 0; p < P; p++) {
      let u = 0
      for (let n = 0; n < N; n++) u += shape[p * N + n] * vMid[n]
      free[p] = u
    }
  }

  commit(forces: Float64Array): void {
    const { count: N, ports: P, shape, vMid, v, q, b, c, dt, portVelocity } = this
    let lost = 0
    for (let n = 0; n < N; n++) {
      let f = 0
      for (let p = 0; p < P; p++) f += shape[p * N + n] * forces[p]
      const mid = vMid[n] + b[n] * f
      vMid[n] = mid
      v[n] = 2 * mid - v[n]
      q[n] += dt * mid
      lost += c[n] * mid * mid
    }
    this.lost[0] = lost * dt
    for (let p = 0; p < P; p++) {
      let u = 0
      for (let n = 0; n < N; n++) u += shape[p * N + n] * vMid[n]
      portVelocity[p] = u
    }
  }

  advance(external: Float64Array): void {
    const { count: N, ports: P, shape, vMid, v, q, a, g, b, c, dt, portVelocity } = this
    let lost = 0
    if (P === 1) {
      // The common case, written without the inner loops over ports.
      const f = external[0]
      let u = 0
      for (let n = 0; n < N; n++) {
        const mid = a[n] * (v[n] - g[n] * q[n]) + b[n] * shape[n] * f
        vMid[n] = mid
        v[n] = 2 * mid - v[n]
        q[n] += dt * mid
        lost += c[n] * mid * mid
        u += shape[n] * mid
      }
      portVelocity[0] = u
    } else {
      portVelocity.fill(0)
      for (let n = 0; n < N; n++) {
        let f = 0
        for (let p = 0; p < P; p++) f += shape[p * N + n] * external[p]
        const mid = a[n] * (v[n] - g[n] * q[n]) + b[n] * f
        vMid[n] = mid
        v[n] = 2 * mid - v[n]
        q[n] += dt * mid
        lost += c[n] * mid * mid
        for (let p = 0; p < P; p++) portVelocity[p] += shape[p * N + n] * mid
      }
    }
    this.lost[0] = lost * dt
  }

  displacements(out: Float64Array): void {
    const { count: N, ports: P, shape, q } = this
    for (let p = 0; p < P; p++) {
      let x = 0
      for (let n = 0; n < N; n++) x += shape[p * N + n] * q[n]
      out[p] = x
    }
  }

  energy(): number {
    const { count: N, m, k, v, q } = this
    let e = 0
    for (let n = 0; n < N; n++) e += 0.5 * m[n] * v[n] * v[n] + 0.5 * k[n] * q[n] * q[n]
    return e
  }

  dissipated(): number {
    return this.lost[0]
  }

  /** Set every mode moving so that port `port` has velocity `velocity` (rigid-body modes only make sense here). */
  setVelocity(velocity: number): void {
    this.v.fill(velocity)
  }

  /** Momentum carried by rigid-body modes of unit shape (kg m/s). */
  momentum(): number {
    let p = 0
    for (let n = 0; n < this.count; n++) p += this.m[n] * this.v[n]
    return p
  }
}

/** A free point mass: one rigid-body mode. */
export const pointMass = (mass: number, sampleRate: number) =>
  new ModalResonator([{ frequency: 0, t60: Infinity, mass, shape: [1] }], sampleRate)
