// EXPERIMENTAL (Phase 3A proof of concept). Not used by the application.

/**
 * A two-way connection between port a and port b. With
 *   eta = x_a - x_b   (relative displacement, m)
 *   w   = u_a - u_b   (relative mid-step velocity, m/s)
 * the connection exerts -F on a and +F on b: equal and opposite by
 * construction. A positive F resists a positive eta.
 */
/**
 * Layout of the array a connection is evaluated through. Inputs and outputs
 * travel in one typed array because, in JavaScript, passing or returning a
 * non-integer number across a call the engine has not inlined allocates a
 * small object each time.
 */
export const ETA = 0 // in: relative displacement at the start of the step
export const W = 1 // in: mid-step relative velocity
export const DT = 2 // in: time step
export const FORCE = 3 // out: F for this step
export const SLOPE = 4 // out: dF/dw, for the Newton solve
export const PREVIOUS_ETA = 5 // in (update only): eta one step ago
export const IO_SIZE = 6

export interface Connection {
  /** Reads io[ETA], io[W], io[DT]; writes io[FORCE] and io[SLOPE]. */
  evaluate(io: Float64Array): void
  /** Energy stored at relative displacement eta (J). */
  potential(eta: number): number
  /** Energy dissipated this step for the solved w (J, >= 0). */
  dissipated(w: number, dt: number): number
  /** Called once per step before solving, with io[ETA] and io[PREVIOUS_ETA] set: where live parameter changes are applied. */
  update(io: Float64Array): void
}

export type ChangePolicy =
  /** Apply at once. Changing stiffness while stretched changes the stored energy abruptly. */
  | 'instant'
  /** Interpolate linearly over `samples` steps. */
  | 'ramp'
  /** Wait until the spring passes through its rest length (stored energy zero), then apply at once. */
  | 'zero-crossing'

/**
 * A linear spring and damper in parallel: F = k eta + c w, with eta taken at
 * mid-step (eta + dt w / 2). Stored energy k eta^2 / 2.
 */
export class SpringDamper implements Connection {
  k: number // N/m
  c: number // N s/m
  private kTarget: number
  private policy: ChangePolicy = 'instant'
  private remaining = 0
  /** Energy added to the system by stiffness changes so far (J; negative = removed). */
  injected = 0

  constructor(stiffness: number, damping = 0) {
    this.k = this.kTarget = stiffness
    this.c = damping
  }

  /** Change the stiffness while running. */
  setStiffness(k: number, policy: ChangePolicy = 'instant', samples = 0): void {
    this.kTarget = k
    this.policy = policy
    this.remaining = policy === 'ramp' ? Math.max(1, samples) : 0
  }

  /** Change the damping while running. A damper stores no energy, so this is always passive. */
  setDamping(c: number): void {
    this.c = c
  }

  update(io: Float64Array): void {
    if (this.k === this.kTarget) return
    const eta = io[ETA]
    const previousEta = io[PREVIOUS_ETA]
    let next = this.k
    if (this.policy === 'instant') next = this.kTarget
    else if (this.policy === 'ramp') {
      next = this.k + (this.kTarget - this.k) / this.remaining
      if (--this.remaining <= 0) next = this.kTarget
    } else if (eta * previousEta <= 0) next = this.kTarget
    // The spring is stretched by eta right now, so its stored energy jumps.
    this.injected += 0.5 * (next - this.k) * eta * eta
    this.k = next
  }

  evaluate(io: Float64Array): void {
    io[FORCE] = this.k * (io[ETA] + 0.5 * io[DT] * io[W]) + this.c * io[W]
    io[SLOPE] = 0.5 * this.k * io[DT] + this.c
  }
  potential(eta: number): number {
    return 0.5 * this.k * eta * eta
  }
  dissipated(w: number, dt: number): number {
    return this.c * w * w * dt
  }
}

/**
 * One-sided nonlinear contact (Hertz): F = K max(eta, 0)^alpha, with
 * eta the compression. Stored energy V = K max(eta, 0)^(alpha + 1) / (alpha + 1).
 *
 * The force used for a step is the discrete gradient of V,
 *   F = (V(eta + dt w) - V(eta)) / (dt w),
 * so that the work done over the step equals the change in stored energy
 * exactly, whatever the step size. This is what keeps the contact from
 * gaining energy numerically (Chatziioannou & van Walstijn, 2015).
 */
export class HertzContact implements Connection {
  readonly K: number // N / m^alpha
  readonly alpha: number

  constructor(stiffness: number, alpha = 1.5) {
    this.K = stiffness
    this.alpha = alpha
  }

  potential(eta: number): number {
    return eta > 0 ? (this.K * Math.pow(eta, this.alpha + 1)) / (this.alpha + 1) : 0
  }

  // Written out in full rather than through small helper functions: a helper
  // that returns a number allocates on every call unless the JavaScript
  // engine happens to inline it.
  evaluate(io: Float64Array): void {
    const { K, alpha } = this
    const eta = io[ETA]
    const dt = io[DT]
    const s = dt * io[W]
    // Where the step is tiny the quotient loses precision; use its limit.
    if (Math.abs(s) < 1e-12 * (Math.abs(eta) + 1e-9)) {
      const mid = eta + 0.5 * s
      io[FORCE] = mid > 0 ? K * Math.pow(mid, alpha) : 0
      io[SLOPE] = mid > 0 ? 0.5 * dt * K * alpha * Math.pow(mid, alpha - 1) : 0
      return
    }
    const end = eta + s
    const vEnd = end > 0 ? (K * Math.pow(end, alpha + 1)) / (alpha + 1) : 0
    const vStart = eta > 0 ? (K * Math.pow(eta, alpha + 1)) / (alpha + 1) : 0
    const gEnd = end > 0 ? K * Math.pow(end, alpha) : 0
    io[FORCE] = (vEnd - vStart) / s
    io[SLOPE] = (dt * (gEnd * s - (vEnd - vStart))) / (s * s)
  }  dissipated(): number {
    return 0
  }
  update(): void {}
}
