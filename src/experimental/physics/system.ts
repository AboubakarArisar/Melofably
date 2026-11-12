// EXPERIMENTAL (Phase 3A proof of concept). Not used by the application.
import { DT, ETA, FORCE, IO_SIZE, PREVIOUS_ETA, SLOPE, W, type Connection } from './connections.ts'
import type { Resonator } from './resonator.ts'

export interface PortRef {
  resonator: number
  port: number
}

interface Link {
  law: Connection
  a: PortRef
  b: PortRef
  /** Added to x_a - x_b: lets a contact start with a gap (negative) or pre-load. */
  offset: number
}

/**
 * Resonators joined by two-way connections, advanced one sample at a time.
 *
 * Each step: every resonator predicts its mid-step port velocities with no
 * connection forces; the connection forces F and relative velocities w are
 * then solved together from
 *
 *     w = w_free - G F(w)
 *
 * where G (connections x connections) is assembled from the resonators' port
 * mobilities; finally every resonator finishes its step with those forces.
 * There is no delay between the objects: the force used in a step is
 * consistent with the motion it produces in that same step.
 *
 * For linear connections the equation is linear and Newton's method solves
 * it in one iteration; for a nonlinear contact it takes a few.
 *
 * Everything is allocated in build(). step() and process() allocate nothing:
 * every per-sample quantity lives in a typed array (see resonator.ts for why
 * that matters in JavaScript).
 */
export class System {
  private readonly resonators: Resonator[] = []
  private readonly links: Link[] = []
  private dt = 0
  // Per resonator.
  private external: Float64Array[] = []
  private free: Float64Array[] = []
  private forces: Float64Array[] = []
  private disp: Float64Array[] = []
  // Per connection.
  private G = new Float64Array(0)
  private J = new Float64Array(0)
  private wFree = new Float64Array(0)
  private w = new Float64Array(0)
  private F = new Float64Array(0)
  private slope = new Float64Array(0)
  private residual = new Float64Array(0)
  private eta = new Float64Array(0)
  private previousEta = new Float64Array(0)
  private trial = new Float64Array(0)
  private delta = new Float64Array(0)
  private linked: boolean[] = [] // per resonator: is anything connected to it?
  private readonly size = new Float64Array(1) // largest |residual| from evaluate()
  private readonly io = new Float64Array(IO_SIZE) // values passed to and from a connection
  /** Newton iterations used by the last step. */
  iterations = 0
  /** Largest number of Newton iterations any step has needed. */
  worstIterations = 0

  add(resonator: Resonator): number {
    this.resonators.push(resonator)
    return this.resonators.length - 1
  }

  connect(law: Connection, a: PortRef, b: PortRef, offset = 0): number {
    this.links.push({ law, a, b, offset })
    return this.links.length - 1
  }

  /** Allocate working storage and assemble the coupling matrix. Call after adding everything, and again after changing topology. */
  build(sampleRate: number): void {
    this.dt = 1 / sampleRate
    const K = this.links.length
    this.external = this.resonators.map((r) => new Float64Array(r.ports))
    this.free = this.resonators.map((r) => new Float64Array(r.ports))
    this.forces = this.resonators.map((r) => new Float64Array(r.ports))
    this.disp = this.resonators.map((r) => new Float64Array(r.ports))
    this.G = new Float64Array(K * K)
    this.J = new Float64Array(K * K)
    this.wFree = new Float64Array(K)
    this.w = new Float64Array(K)
    this.F = new Float64Array(K)
    this.slope = new Float64Array(K)
    this.residual = new Float64Array(K)
    this.eta = new Float64Array(K)
    this.previousEta = new Float64Array(K)
    this.trial = new Float64Array(K)
    this.delta = new Float64Array(K)
    this.linked = this.resonators.map((_, r) => this.links.some((l) => l.a.resonator === r || l.b.resonator === r))
    // G[k][j]: how much connection j's force changes connection k's relative
    // velocity. Force j is -F on its port a and +F on its port b.
    const mob = (p: PortRef, q: PortRef) => (p.resonator === q.resonator ? this.resonators[p.resonator].mobility(p.port, q.port) : 0)
    for (let k = 0; k < K; k++) {
      for (let j = 0; j < K; j++) {
        const [lk, lj] = [this.links[k], this.links[j]]
        this.G[k * K + j] = mob(lk.a, lj.a) - mob(lk.a, lj.b) - mob(lk.b, lj.a) + mob(lk.b, lj.b)
      }
    }
    this.measureStretch()
    this.previousEta.set(this.eta)
  }

  /** Prescribed force on a port for the next step only (N). */
  applyForce(ref: PortRef, force: number): void {
    this.external[ref.resonator][ref.port] += force
  }

  /** eta[k] = x_a - x_b + offset for every connection, from the resonators' current state. */
  private measureStretch(): void {
    const { resonators, links, disp, eta } = this
    for (let r = 0; r < resonators.length; r++) resonators[r].displacements(disp[r])
    for (let k = 0; k < links.length; k++) {
      const link = links[k]
      eta[k] = disp[link.a.resonator][link.a.port] - disp[link.b.resonator][link.b.port] + link.offset
    }
  }

  /** residual = at - wFree + G F(at); fills F and slope; leaves the largest |residual| in size[0]. */
  private evaluate(at: Float64Array): void {
    const { links, G, wFree, F, slope, residual, eta, io } = this
    const K = links.length
    for (let k = 0; k < K; k++) {
      io[ETA] = eta[k]
      io[W] = at[k]
      links[k].law.evaluate(io)
      F[k] = io[FORCE]
      slope[k] = io[SLOPE]
    }
    let size = 0
    for (let k = 0; k < K; k++) {
      let r = at[k] - wFree[k]
      for (let j = 0; j < K; j++) r += G[k * K + j] * F[j]
      residual[k] = r
      size = Math.max(size, Math.abs(r))
    }
    this.size[0] = size
  }

  step(): void {
    const { resonators, links, G, J, wFree, w, trial, delta, F, slope, residual, eta, previousEta, io, linked, size } = this
    const K = links.length
    io[DT] = this.dt
    for (let r = 0; r < resonators.length; r++) {
      if (linked[r]) {
        resonators[r].predict(this.external[r], this.free[r])
        this.forces[r].fill(0)
      } else {
        // Nothing is attached: one fused pass, no force to solve for.
        resonators[r].advance(this.external[r])
        this.external[r].fill(0)
      }
    }
    if (K === 0) return
    this.measureStretch()
    let scale = 0
    for (let k = 0; k < K; k++) {
      const link = links[k]
      io[ETA] = eta[k]
      io[PREVIOUS_ETA] = previousEta[k]
      link.law.update(io)
      previousEta[k] = eta[k]
      wFree[k] = this.free[link.a.resonator][link.a.port] - this.free[link.b.resonator][link.b.port]
      w[k] = wFree[k]
      scale = Math.max(scale, Math.abs(wFree[k]))
    }

    // Newton on R(w) = w - wFree + G F(w) = 0, with step halving: where a
    // contact opens or closes a full Newton step can overshoot, so a step is
    // taken only as far as it actually reduces the residual.
    this.evaluate(w)
    let iterations = 0
    while (size[0] > 1e-13 * scale + 1e-300 && iterations < 60) {
      iterations++
      for (let k = 0; k < K; k++) {
        delta[k] = residual[k]
        for (let j = 0; j < K; j++) J[k * K + j] = (k === j ? 1 : 0) + G[k * K + j] * slope[j]
      }
      solveInPlace(J, delta, K)
      const before = size[0]
      let fraction = 1
      for (let halving = 0; halving < 30; halving++) {
        for (let k = 0; k < K; k++) trial[k] = w[k] - fraction * delta[k]
        this.evaluate(trial)
        if (size[0] < before) break
        fraction *= 0.5
      }
      if (size[0] >= before) {
        // No step improves on w at this precision: keep w, restore its forces.
        this.evaluate(w)
        break
      }
      for (let k = 0; k < K; k++) w[k] = trial[k]
    }
    this.iterations = iterations
    if (iterations > this.worstIterations) this.worstIterations = iterations

    // F holds the forces for the accepted w.
    for (let k = 0; k < K; k++) {
      const link = links[k]
      this.forces[link.a.resonator][link.a.port] -= F[k]
      this.forces[link.b.resonator][link.b.port] += F[k]
    }
    for (let r = 0; r < resonators.length; r++) {
      if (!linked[r]) continue
      resonators[r].commit(this.forces[r])
      this.external[r].fill(0)
    }
  }

  /**
   * Advance `out.length` samples, writing the mid-step velocity of `ref` into
   * `out`, scaled by `gain`. The shape of an AudioWorklet process() call.
   */
  process(out: Float32Array, ref: PortRef, gain = 1): void {
    const velocity = this.resonators[ref.resonator].portVelocity
    for (let n = 0; n < out.length; n++) {
      this.step()
      out[n] = velocity[ref.port] * gain
    }
  }

  /** Mid-step velocity of a port for the step just taken (m/s): the output signal. */
  velocity(ref: PortRef): number {
    return this.resonators[ref.resonator].portVelocity[ref.port]
  }

  /** Force in connection k for the step just taken (N). */
  connectionForce(k: number): number {
    return this.F[k]
  }

  /** Relative displacement of connection k at the start of the step just taken (m). */
  connectionStretch(k: number): number {
    return this.eta[k]
  }

  /** Total stored energy now: every resonator plus every connection (J). A diagnostic, not for the audio path. */
  energy(): number {
    let e = 0
    for (const r of this.resonators) e += r.energy()
    const { links, disp } = this
    for (let r = 0; r < this.resonators.length; r++) this.resonators[r].displacements(disp[r])
    for (const link of links) e += link.law.potential(disp[link.a.resonator][link.a.port] - disp[link.b.resonator][link.b.port] + link.offset)
    return e
  }

  /** Energy dissipated during the step just taken, in resonators and connections (J). A diagnostic. */
  dissipated(): number {
    let e = 0
    for (const r of this.resonators) e += r.dissipated()
    for (let k = 0; k < this.links.length; k++) e += this.links[k].law.dissipated(this.w[k], this.dt)
    return e
  }
}

/** Solve A x = b for a small dense system by Gaussian elimination with partial pivoting; x overwrites b, A is destroyed. */
function solveInPlace(A: Float64Array, b: Float64Array, n: number): void {
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) if (Math.abs(A[row * n + col]) > Math.abs(A[pivot * n + col])) pivot = row
    if (pivot !== col) {
      for (let j = 0; j < n; j++) {
        const t = A[col * n + j]
        A[col * n + j] = A[pivot * n + j]
        A[pivot * n + j] = t
      }
      const t = b[col]
      b[col] = b[pivot]
      b[pivot] = t
    }
    const d = A[col * n + col]
    for (let row = col + 1; row < n; row++) {
      const f = A[row * n + col] / d
      if (f === 0) continue
      for (let j = col; j < n; j++) A[row * n + j] -= f * A[col * n + j]
      b[row] -= f * b[col]
    }
  }
  for (let row = n - 1; row >= 0; row--) {
    let s = b[row]
    for (let j = row + 1; j < n; j++) s -= A[row * n + j] * b[j]
    b[row] = s / A[row * n + row]
  }
}
