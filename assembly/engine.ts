// EXPERIMENTAL (Phase 3A.1). AssemblyScript, compiled to WebAssembly by
// `npm run engine`. A port of src/experimental/physics/ (the TypeScript
// reference): same equations, same solver. Method and units:
// docs/EXPERIMENTAL_ENGINE.md and docs/WASM_ENGINE.md.
//
// Everything lives in fixed arrays allocated once when the module starts.
// Nothing allocates afterwards, and the module imports nothing.
// All arithmetic is 64-bit; only the output buffer is 32-bit.

const MAX_MODES: i32 = 16384
const MAX_RES: i32 = 128
const MAX_SHAPE: i32 = 32768 // sum over resonators of ports x modes
const MAX_CONN: i32 = 32
const MAX_PULSES: i32 = 32
const MAX_BLOCK: i32 = 4096

const SPRING: i32 = 0
const CONTACT: i32 = 1
const INSTANT: i32 = 0
const RAMP: i32 = 1
// Any other policy value: wait for the spring to pass through its rest length.

let dt: f64 = 1.0 / 48000.0
let prewarp: i32 = 2 // 0 none, 1 poles, 2 full (as the reference's Prewarp)
let R: i32 = 0 // resonators
let M: i32 = 0 // modes in use
let S: i32 = 0 // shape entries in use
let K: i32 = 0 // connections
let dirty: bool = true // the coupling matrix needs assembling
let mix: f64 = 0 // output of the step just taken
let iters: i32 = 0
let worst: i32 = 0
let faultCount: i32 = 0
let livePulses: i32 = 0

// Per resonator.
const rStart = new StaticArray<i32>(MAX_RES) // first mode
const rCount = new StaticArray<i32>(MAX_RES) // modes
const rPorts = new StaticArray<i32>(MAX_RES)
const rShape = new StaticArray<i32>(MAX_RES) // first shape entry; shape[rShape + port * count + n]
const rLinked = new StaticArray<bool>(MAX_RES)

// Per mode.
const q = new StaticArray<f64>(MAX_MODES) // displacement, m
const v = new StaticArray<f64>(MAX_MODES) // velocity, m/s
const vMid = new StaticArray<f64>(MAX_MODES)
const ca = new StaticArray<f64>(MAX_MODES)
const cg = new StaticArray<f64>(MAX_MODES)
const cb = new StaticArray<f64>(MAX_MODES)
const mm = new StaticArray<f64>(MAX_MODES) // discrete mass
const mc = new StaticArray<f64>(MAX_MODES) // discrete damping
const mk = new StaticArray<f64>(MAX_MODES) // discrete stiffness
const fm = new StaticArray<f64>(MAX_MODES) // modal force waiting to be applied
const ow = new StaticArray<f64>(MAX_MODES) // output weight: sum of gain x shape
const freq = new StaticArray<f64>(MAX_MODES) // physical data, kept for live retuning
const t60 = new StaticArray<f64>(MAX_MODES)
const mass0 = new StaticArray<f64>(MAX_MODES)
const corr = new StaticArray<f64>(MAX_MODES) // spring attachment correction (see design())

const shape = new StaticArray<f64>(MAX_SHAPE)
const cshape = new StaticArray<f64>(MAX_SHAPE) // shape x corr: what a corrected spring attaches through

// Per connection. Side a and side b are each a run of shape entries plus the modes they belong to.
const kKind = new StaticArray<i32>(MAX_CONN)
const kCorrected = new StaticArray<bool>(MAX_CONN)
const kResA = new StaticArray<i32>(MAX_CONN)
const kResB = new StaticArray<i32>(MAX_CONN)
const kShapeA = new StaticArray<i32>(MAX_CONN)
const kShapeB = new StaticArray<i32>(MAX_CONN)
const kOffset = new StaticArray<f64>(MAX_CONN)
const kStiff = new StaticArray<f64>(MAX_CONN) // spring k (N/m) or contact K (N/m^alpha), as asked for
const kEff = new StaticArray<f64>(MAX_CONN) // the stiffness actually used (see effective())
const kExcess = new StaticArray<f64>(MAX_CONN) // corrected springs: surplus static compliance at the two ends, m/N
const kDamp = new StaticArray<f64>(MAX_CONN)
const kAlpha = new StaticArray<f64>(MAX_CONN)
const kTarget = new StaticArray<f64>(MAX_CONN)
const kPolicy = new StaticArray<i32>(MAX_CONN)
const kRemaining = new StaticArray<i32>(MAX_CONN)
const kInjected = new StaticArray<f64>(MAX_CONN)
const G = new StaticArray<f64>(MAX_CONN * MAX_CONN)
const J = new StaticArray<f64>(MAX_CONN * MAX_CONN)
const wFree = new StaticArray<f64>(MAX_CONN)
const w = new StaticArray<f64>(MAX_CONN)
const F = new StaticArray<f64>(MAX_CONN)
const slope = new StaticArray<f64>(MAX_CONN)
const residual = new StaticArray<f64>(MAX_CONN)
const eta = new StaticArray<f64>(MAX_CONN)
const prevEta = new StaticArray<f64>(MAX_CONN)
const trial = new StaticArray<f64>(MAX_CONN)
const delta = new StaticArray<f64>(MAX_CONN)

// Half-sine force pulses in flight (the approved models' striker).
const pShape = new StaticArray<i32>(MAX_PULSES)
const pStart = new StaticArray<i32>(MAX_PULSES)
const pCount = new StaticArray<i32>(MAX_PULSES)
const pIndex = new StaticArray<i32>(MAX_PULSES)
const pLength = new StaticArray<i32>(MAX_PULSES) // 0 = slot free
const pWidth = new StaticArray<f64>(MAX_PULSES)
const pAmp = new StaticArray<f64>(MAX_PULSES)

const out = new StaticArray<f32>(MAX_BLOCK)

// ---- Building ---------------------------------------------------------------

export function reset(sampleRate: f64, prewarpMode: i32): void {
  dt = 1.0 / sampleRate
  prewarp = prewarpMode
  R = 0
  M = 0
  S = 0
  K = 0
  dirty = true
  mix = 0
  iters = 0
  worst = 0
  faultCount = 0
  livePulses = 0
  for (let i = 0; i < MAX_PULSES; i++) unchecked((pLength[i] = 0))
}

/** Returns the resonator's index, or -1 if it does not fit. */
export function addResonator(ports: i32, modes: i32): i32 {
  if (R >= MAX_RES || M + modes > MAX_MODES || S + ports * modes > MAX_SHAPE) return -1
  const r = R++
  unchecked((rStart[r] = M))
  unchecked((rCount[r] = modes))
  unchecked((rPorts[r] = ports))
  unchecked((rShape[r] = S))
  unchecked((rLinked[r] = false))
  for (let n = M; n < M + modes; n++) {
    unchecked((q[n] = 0))
    unchecked((v[n] = 0))
    unchecked((vMid[n] = 0))
    unchecked((fm[n] = 0))
    unchecked((ow[n] = 0))
  }
  for (let i = S; i < S + ports * modes; i++) {
    unchecked((shape[i] = 0))
    unchecked((cshape[i] = 0))
  }
  M += modes
  S += ports * modes
  dirty = true
  return r
}

/**
 * Coefficients of mode n (global index) from its physical data. Identical to
 * the reference's ModalResonator constructor.
 */
function design(n: i32): void {
  const T = dt
  // A mode cannot be represented at or above half the sample rate; one tuned
  // there is held just below it. (Callers should drop such modes, as barModes does.)
  const f = Math.min(unchecked(freq[n]), 0.49 / dt)
  const decay = unchecked(t60[n])
  const omega = 2.0 * Math.PI * f
  const sigma = isFinite(decay) ? Math.log(1000.0) / decay : 0.0
  let stiffnessPerMass = omega * omega + sigma * sigma
  let dampingPerMass = 2.0 * sigma
  let mass = unchecked(mass0[n])
  const theta = omega * T
  if (prewarp != 0) {
    const r = Math.exp(-sigma * T)
    const zr = r * Math.cos(theta)
    const zi = r * Math.sin(theta)
    const den = (zr + 1.0) * (zr + 1.0) + zi * zi
    const alpha = ((2.0 / T) * ((zr - 1.0) * (zr + 1.0) + zi * zi)) / den
    const beta = ((2.0 / T) * (2.0 * zi)) / den
    stiffnessPerMass = alpha * alpha + beta * beta
    dampingPerMass = -2.0 * alpha
    if (prewarp == 2) {
      const d0 = 4.0 / (T * T) + (2.0 / T) * dampingPerMass + stiffnessPerMass
      mass = (mass * (4.0 / (T * T))) / d0
    }
  }
  unchecked((mm[n] = mass))
  unchecked((mc[n] = mass * dampingPerMass))
  unchecked((mk[n] = mass * stiffnessPerMass))
  const D = 1.0 + (T * dampingPerMass) / 2.0 + (T * T * stiffnessPerMass) / 4.0
  unchecked((ca[n] = 1.0 / D))
  unchecked((cg[n] = (T * stiffnessPerMass) / 2.0))
  unchecked((cb[n] = T / (2.0 * mass * D)))
  // Spring correction, part 1. A spring added to a fully prewarped mode shifts
  // its frequency by only (theta/2) / tan(theta/2) of the true amount, because
  // the midpoint rule compresses the frequency axis. Attaching the spring
  // through a mode shape scaled by the square root of the inverse makes the
  // mode respond correctly near its own resonance. 1 at low frequency; grows
  // towards Nyquist. Part 2 is in excess().
  const half = theta / 2.0
  unchecked((corr[n] = prewarp == 2 && half > 1e-9 ? Math.sqrt(Math.tan(half) / half) : 1.0))
}

/** Physical data of mode `n` of resonator `r`. t60 = Infinity for no damping; frequency 0 for a free mass. */
export function setMode(r: i32, n: i32, frequency: f64, decayTime: f64, mass: f64): void {
  const i = unchecked(rStart[r]) + n
  unchecked((freq[i] = frequency))
  unchecked((t60[i] = decayTime))
  unchecked((mass0[i] = mass))
  design(i)
  refreshShape(r, n)
  dirty = true
}

function refreshShape(r: i32, n: i32): void {
  const N = unchecked(rCount[r])
  const s = unchecked(rShape[r])
  const factor = unchecked(corr[rStart[r] + n])
  for (let p = 0; p < unchecked(rPorts[r]); p++) unchecked((cshape[s + p * N + n] = shape[s + p * N + n] * factor))
}

export function setShape(r: i32, port: i32, n: i32, value: f64): void {
  const i = unchecked(rShape[r]) + port * unchecked(rCount[r]) + n
  unchecked((shape[i] = value))
  unchecked((cshape[i] = value * corr[rStart[r] + n]))
  dirty = true
}

function addConnection(kind: i32, ra: i32, pa: i32, rb: i32, pb: i32, offset: f64, corrected: bool): i32 {
  if (K >= MAX_CONN) return -1
  const k = K++
  unchecked((kKind[k] = kind))
  unchecked((kCorrected[k] = corrected))
  unchecked((kResA[k] = ra))
  unchecked((kResB[k] = rb))
  unchecked((kShapeA[k] = rShape[ra] + pa * rCount[ra]))
  unchecked((kShapeB[k] = rShape[rb] + pb * rCount[rb]))
  unchecked((kOffset[k] = offset))
  unchecked((kDamp[k] = 0))
  unchecked((kAlpha[k] = 1))
  unchecked((kPolicy[k] = INSTANT))
  unchecked((kRemaining[k] = 0))
  unchecked((kInjected[k] = 0))
  unchecked((rLinked[ra] = true))
  unchecked((rLinked[rb] = true))
  dirty = true
  return k
}

/**
 * Linear spring and damper between two ports: F = k eta + c w. `corrected`
 * attaches it through the frequency-corrected mode shapes (right for a
 * spring, wrong for a damper: give those separate connections).
 */
export function addSpring(ra: i32, pa: i32, rb: i32, pb: i32, stiffness: f64, damping: f64, offset: f64, corrected: bool): i32 {
  const k = addConnection(SPRING, ra, pa, rb, pb, offset, corrected)
  if (k < 0) return k
  unchecked((kStiff[k] = stiffness))
  unchecked((kTarget[k] = stiffness))
  unchecked((kDamp[k] = damping))
  return k
}

/** One-sided Hertz contact: F = K max(eta, 0)^alpha, eta = x_a - x_b + offset. */
export function addContact(ra: i32, pa: i32, rb: i32, pb: i32, stiffness: f64, alpha: f64, offset: f64): i32 {
  const k = addConnection(CONTACT, ra, pa, rb, pb, offset, false)
  if (k < 0) return k
  unchecked((kStiff[k] = stiffness))
  unchecked((kTarget[k] = stiffness))
  unchecked((kAlpha[k] = alpha))
  return k
}

/** Adds `gain` x the velocity of a port to the output signal. */
export function addOutput(r: i32, port: i32, gain: f64): void {
  const N = unchecked(rCount[r])
  const s = unchecked(rShape[r]) + port * N
  const first = unchecked(rStart[r])
  for (let n = 0; n < N; n++) unchecked((ow[first + n] += gain * shape[s + n]))
}

// Spring correction, part 2. Seen through the corrected shapes, a mode at
// angle theta is too compliant to slow forces: by (theta / sin theta - 1) of
// its true static compliance shape^2 / (m w^2). The sum over the modes at one
// end of a spring is a surplus compliance in series with it.
function excess(r: i32, i: i32): f64 {
  const first = unchecked(rStart[r])
  let sum: f64 = 0
  for (let n = 0, N = unchecked(rCount[r]); n < N; n++) {
    const omega = 2.0 * Math.PI * Math.min(unchecked(freq[first + n]), 0.49 / dt)
    const theta = omega * dt
    if (theta < 1e-9) continue // a free mass: no stiffness, nothing to correct
    const s = unchecked(shape[i + n])
    sum += ((s * s) / (unchecked(mass0[first + n]) * omega * omega)) * (theta / Math.sin(theta) - 1.0)
  }
  return sum
}

// The stiffness a spring is given so that, in series with the surplus
// compliance at its ends, it acts as the stiffness asked for. Still a
// positive spring, so still passive; for springs so stiff that the surplus
// could not be removed (k x surplus near 1: effectively a weld) the
// compensation is capped.
function effective(k: i32, stiff: f64): f64 {
  return unchecked(kCorrected[k]) ? stiff / (1.0 - Math.min(stiff * unchecked(kExcess[k]), 0.9)) : stiff
}

function refreshSpring(k: i32): void {
  if (unchecked(kKind[k]) != SPRING) return
  if (unchecked(kCorrected[k])) {
    unchecked((kExcess[k] = excess(kResA[k], kShapeA[k]) + excess(kResB[k], kShapeB[k])))
  }
  unchecked((kEff[k] = effective(k, kStiff[k])))
}

// Velocity-per-force between two shape runs of the same resonator.
function mobility(r: i32, sa: StaticArray<f64>, ia: i32, sb: StaticArray<f64>, ib: i32): f64 {
  const first = unchecked(rStart[r])
  let s: f64 = 0
  for (let n = 0, N = unchecked(rCount[r]); n < N; n++) s += unchecked(sa[ia + n] * sb[ib + n] * cb[first + n])
  return s
}

// G[k][j]: how much connection j's force changes connection k's relative
// velocity. Force j is -F on its side a and +F on its side b.
function assemble(): void {
  for (let k = 0; k < K; k++) {
    refreshSpring(k)
    const sk = unchecked(kCorrected[k]) ? cshape : shape
    const ka = unchecked(kResA[k])
    const kb = unchecked(kResB[k])
    for (let j = 0; j < K; j++) {
      const sj = unchecked(kCorrected[j]) ? cshape : shape
      const ja = unchecked(kResA[j])
      const jb = unchecked(kResB[j])
      let g: f64 = 0
      if (ka == ja) g += mobility(ka, sk, unchecked(kShapeA[k]), sj, unchecked(kShapeA[j]))
      if (ka == jb) g -= mobility(ka, sk, unchecked(kShapeA[k]), sj, unchecked(kShapeB[j]))
      if (kb == ja) g -= mobility(kb, sk, unchecked(kShapeB[k]), sj, unchecked(kShapeA[j]))
      if (kb == jb) g += mobility(kb, sk, unchecked(kShapeB[k]), sj, unchecked(kShapeB[j]))
      unchecked((G[k * MAX_CONN + j] = g))
    }
  }
  dirty = false
}

// Displacement (state = q) or mid-step velocity (state = vMid) of one side of a connection.
function side(r: i32, s: StaticArray<f64>, i: i32, state: StaticArray<f64>): f64 {
  const first = unchecked(rStart[r])
  let x: f64 = 0
  for (let n = 0, N = unchecked(rCount[r]); n < N; n++) x += unchecked(s[i + n] * state[first + n])
  return x
}

function stretch(k: i32): f64 {
  const s = unchecked(kCorrected[k]) ? cshape : shape
  return side(unchecked(kResA[k]), s, unchecked(kShapeA[k]), q) - side(unchecked(kResB[k]), s, unchecked(kShapeB[k]), q) + unchecked(kOffset[k])
}

/** Call after adding everything and before the first step. */
export function build(): void {
  assemble()
  for (let k = 0; k < K; k++) {
    unchecked((eta[k] = stretch(k)))
    unchecked((prevEta[k] = eta[k]))
  }
}

// ---- Stepping ---------------------------------------------------------------

/** Prescribed force on a port for the next step only (N). */
export function applyForce(r: i32, port: i32, force: f64): void {
  const N = unchecked(rCount[r])
  const s = unchecked(rShape[r]) + port * N
  const first = unchecked(rStart[r])
  for (let n = 0; n < N; n++) unchecked((fm[first + n] += shape[s + n] * force))
}

// Live stiffness changes, exactly as the reference's SpringDamper.update().
function update(k: i32): void {
  const now = unchecked(kStiff[k])
  const target = unchecked(kTarget[k])
  if (now == target || unchecked(kKind[k]) != SPRING) return
  const x = unchecked(eta[k])
  let next = now
  const policy = unchecked(kPolicy[k])
  if (policy == INSTANT) next = target
  else if (policy == RAMP) {
    const left = unchecked(kRemaining[k])
    next = now + (target - now) / <f64>left
    unchecked((kRemaining[k] = left - 1))
    if (left - 1 <= 0) next = target
  } else if (x * unchecked(prevEta[k]) <= 0) next = target
  const before = unchecked(kEff[k])
  unchecked((kStiff[k] = next))
  unchecked((kEff[k] = effective(k, next)))
  unchecked((kInjected[k] += 0.5 * (kEff[k] - before) * x * x))
}

// residual = at - wFree + G F(at); fills F and slope; returns the largest |residual|.
function evaluate(at: StaticArray<f64>): f64 {
  for (let k = 0; k < K; k++) {
    const x = unchecked(eta[k])
    const rate = unchecked(at[k])
    if (unchecked(kKind[k]) == SPRING) {
      const stiff = unchecked(kEff[k])
      const damp = unchecked(kDamp[k])
      unchecked((F[k] = stiff * (x + 0.5 * dt * rate) + damp * rate))
      unchecked((slope[k] = 0.5 * stiff * dt + damp))
    } else {
      // Discrete-gradient Hertz force: work done over the step equals the
      // change in stored energy exactly (see the reference's HertzContact).
      const stiff = unchecked(kStiff[k])
      const alpha = unchecked(kAlpha[k])
      const s = dt * rate
      if (Math.abs(s) < 1e-12 * (Math.abs(x) + 1e-9)) {
        const mid = x + 0.5 * s
        unchecked((F[k] = mid > 0 ? stiff * Math.pow(mid, alpha) : 0))
        unchecked((slope[k] = mid > 0 ? 0.5 * dt * stiff * alpha * Math.pow(mid, alpha - 1) : 0))
      } else {
        const end = x + s
        const vEnd = end > 0 ? (stiff * Math.pow(end, alpha + 1)) / (alpha + 1) : 0
        const vStart = x > 0 ? (stiff * Math.pow(x, alpha + 1)) / (alpha + 1) : 0
        const gEnd = end > 0 ? stiff * Math.pow(end, alpha) : 0
        unchecked((F[k] = (vEnd - vStart) / s))
        unchecked((slope[k] = (dt * (gEnd * s - (vEnd - vStart))) / (s * s)))
      }
    }
  }
  let size: f64 = 0
  for (let k = 0; k < K; k++) {
    let r = unchecked(at[k] - wFree[k])
    for (let j = 0; j < K; j++) r += unchecked(G[k * MAX_CONN + j] * F[j])
    unchecked((residual[k] = r))
    size = Math.max(size, Math.abs(r))
  }
  return size
}

// Gaussian elimination with partial pivoting on the K x K system J x = delta; x overwrites delta.
function solve(): void {
  const n = K
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(unchecked(J[row * MAX_CONN + col])) > Math.abs(unchecked(J[pivot * MAX_CONN + col]))) pivot = row
    }
    if (pivot != col) {
      for (let j = 0; j < n; j++) {
        const t = unchecked(J[col * MAX_CONN + j])
        unchecked((J[col * MAX_CONN + j] = J[pivot * MAX_CONN + j]))
        unchecked((J[pivot * MAX_CONN + j] = t))
      }
      const t = unchecked(delta[col])
      unchecked((delta[col] = delta[pivot]))
      unchecked((delta[pivot] = t))
    }
    const d = unchecked(J[col * MAX_CONN + col])
    for (let row = col + 1; row < n; row++) {
      const f = unchecked(J[row * MAX_CONN + col]) / d
      if (f == 0) continue
      for (let j = col; j < n; j++) unchecked((J[row * MAX_CONN + j] -= f * J[col * MAX_CONN + j]))
      unchecked((delta[row] -= f * delta[col]))
    }
  }
  for (let row = n - 1; row >= 0; row--) {
    let s = unchecked(delta[row])
    for (let j = row + 1; j < n; j++) s -= unchecked(J[row * MAX_CONN + j] * delta[j])
    unchecked((delta[row] = s / J[row * MAX_CONN + row]))
  }
}

/** Advance one sample. */
export function step(): void {
  if (dirty) assemble()
  let sum: f64 = 0
  for (let r = 0; r < R; r++) {
    const first = unchecked(rStart[r])
    const last = first + unchecked(rCount[r])
    if (unchecked(rLinked[r])) {
      // Predict: mid-step velocity with no connection forces.
      for (let n = first; n < last; n++) {
        unchecked((vMid[n] = ca[n] * (v[n] - cg[n] * q[n]) + cb[n] * fm[n]))
        unchecked((fm[n] = 0))
      }
    } else {
      // Nothing attached: the whole step in one pass.
      for (let n = first; n < last; n++) {
        const mid = unchecked(ca[n] * (v[n] - cg[n] * q[n]) + cb[n] * fm[n])
        unchecked((fm[n] = 0))
        unchecked((vMid[n] = mid))
        unchecked((v[n] = 2.0 * mid - v[n]))
        unchecked((q[n] += dt * mid))
        sum += unchecked(ow[n]) * mid
      }
    }
  }
  if (K == 0) {
    mix = sum
    return
  }

  let scale: f64 = 0
  for (let k = 0; k < K; k++) {
    const s = unchecked(kCorrected[k]) ? cshape : shape
    const ra = unchecked(kResA[k])
    const rb = unchecked(kResB[k])
    const ia = unchecked(kShapeA[k])
    const ib = unchecked(kShapeB[k])
    // Displacement and mid-step velocity of each end in one pass (two
    // independent running sums, so the processor can overlap them).
    let xa: f64 = 0
    let ua: f64 = 0
    for (let n = 0, N = unchecked(rCount[ra]), first = unchecked(rStart[ra]); n < N; n++) {
      const weight = unchecked(s[ia + n])
      xa += weight * unchecked(q[first + n])
      ua += weight * unchecked(vMid[first + n])
    }
    let xb: f64 = 0
    let ub: f64 = 0
    for (let n = 0, N = unchecked(rCount[rb]), first = unchecked(rStart[rb]); n < N; n++) {
      const weight = unchecked(s[ib + n])
      xb += weight * unchecked(q[first + n])
      ub += weight * unchecked(vMid[first + n])
    }
    unchecked((eta[k] = xa - xb + kOffset[k]))
    update(k)
    unchecked((prevEta[k] = eta[k]))
    const free = ua - ub
    unchecked((wFree[k] = free))
    unchecked((w[k] = free))
    scale = Math.max(scale, Math.abs(free))
  }

  // Newton on R(w) = w - wFree + G F(w) = 0 with step halving, as the reference.
  let size = evaluate(w)
  let iterations = 0
  while (size > 1e-13 * scale + 1e-300 && iterations < 60) {
    iterations++
    for (let k = 0; k < K; k++) {
      unchecked((delta[k] = residual[k]))
      for (let j = 0; j < K; j++) unchecked((J[k * MAX_CONN + j] = (k == j ? 1.0 : 0.0) + G[k * MAX_CONN + j] * slope[j]))
    }
    solve()
    const before = size
    let fraction: f64 = 1
    for (let halving = 0; halving < 30; halving++) {
      for (let k = 0; k < K; k++) unchecked((trial[k] = w[k] - fraction * delta[k]))
      size = evaluate(trial)
      if (size < before) break
      fraction *= 0.5
    }
    if (size >= before) {
      size = evaluate(w)
      break
    }
    for (let k = 0; k < K; k++) unchecked((w[k] = trial[k]))
  }
  iters = iterations
  if (iterations > worst) worst = iterations

  // -F on side a, +F on side b: equal and opposite by construction.
  for (let k = 0; k < K; k++) {
    const s = unchecked(kCorrected[k]) ? cshape : shape
    const force = unchecked(F[k])
    const ra = unchecked(kResA[k])
    const rb = unchecked(kResB[k])
    const ia = unchecked(kShapeA[k])
    const ib = unchecked(kShapeB[k])
    for (let n = 0, N = unchecked(rCount[ra]), first = unchecked(rStart[ra]); n < N; n++) unchecked((fm[first + n] -= force * s[ia + n]))
    for (let n = 0, N = unchecked(rCount[rb]), first = unchecked(rStart[rb]); n < N; n++) unchecked((fm[first + n] += force * s[ib + n]))
  }
  for (let r = 0; r < R; r++) {
    if (!unchecked(rLinked[r])) continue
    const first = unchecked(rStart[r])
    const last = first + unchecked(rCount[r])
    for (let n = first; n < last; n++) {
      const mid = unchecked(vMid[n] + cb[n] * fm[n])
      unchecked((fm[n] = 0))
      unchecked((vMid[n] = mid))
      unchecked((v[n] = 2.0 * mid - v[n]))
      unchecked((q[n] += dt * mid))
      sum += unchecked(ow[n]) * mid
    }
  }
  mix = sum
}

/**
 * Advance `count` samples (at most 4096) into the output buffer: the shape of
 * an AudioWorklet process() call. An output that is not finite, or absurdly
 * large (1e30 m/s or more), is replaced by silence, the state is cleared and
 * the fault is counted.
 */
export function process(count: i32): void {
  if (count > MAX_BLOCK) count = MAX_BLOCK
  for (let i = 0; i < count; i++) {
    if (livePulses > 0) {
      for (let p = 0; p < MAX_PULSES; p++) {
        const length = unchecked(pLength[p])
        if (length == 0) continue
        const at = unchecked(pIndex[p])
        const force = unchecked(Math.sin((Math.PI * <f64>at) / pWidth[p]) * pAmp[p])
        const s = unchecked(pShape[p])
        for (let n = 0, N = unchecked(pCount[p]), first = unchecked(pStart[p]); n < N; n++) unchecked((fm[first + n] += shape[s + n] * force))
        if (at + 1 >= length) {
          unchecked((pLength[p] = 0))
          livePulses--
        } else unchecked((pIndex[p] = at + 1))
      }
    }
    step()
    // Not a number, infinite, or so large that it is one in 32 bits: a fault.
    if (!(Math.abs(mix) < 1e30)) {
      faultCount++
      silence()
      mix = 0
    }
    unchecked((out[i] = <f32>mix))
  }
  // Numbers too small to matter become exactly zero, so a long decay never
  // reaches the subnormal range, where arithmetic is many times slower.
  for (let n = 0; n < M; n++) {
    if (Math.abs(unchecked(v[n])) < 1e-100 && Math.abs(unchecked(q[n])) < 1e-100) {
      unchecked((v[n] = 0))
      unchecked((q[n] = 0))
    }
  }
}

/** Stop all motion and cancel pending forces. */
export function silence(): void {
  for (let n = 0; n < M; n++) {
    unchecked((q[n] = 0))
    unchecked((v[n] = 0))
    unchecked((vMid[n] = 0))
    unchecked((fm[n] = 0))
  }
  for (let p = 0; p < MAX_PULSES; p++) unchecked((pLength[p] = 0))
  livePulses = 0
  for (let k = 0; k < K; k++) {
    unchecked((eta[k] = kOffset[k]))
    unchecked((prevEta[k] = kOffset[k]))
  }
}

export function outputPointer(): usize {
  return changetype<usize>(out)
}

// ---- Playing ----------------------------------------------------------------

/**
 * The approved models' striker: a half-sine force pulse of area `impulse`
 * (N s) lasting `contact` seconds, starting with the next sample processed.
 */
export function strike(r: i32, port: i32, impulse: f64, contact: f64): void {
  let slot = 0
  for (let p = 0; p < MAX_PULSES; p++) {
    if (unchecked(pLength[p]) == 0) {
      slot = p
      break
    }
  }
  if (unchecked(pLength[slot]) == 0) livePulses++
  const width = Math.max(2.0, contact / dt)
  const N = unchecked(rCount[r])
  unchecked((pShape[slot] = rShape[r] + port * N))
  unchecked((pStart[slot] = rStart[r]))
  unchecked((pCount[slot] = N))
  unchecked((pIndex[slot] = 0))
  unchecked((pLength[slot] = <i32>Math.ceil(width)))
  unchecked((pWidth[slot] = width))
  unchecked((pAmp[slot] = (impulse * Math.PI) / (2.0 * width * dt))) // N: the area of the pulse is the impulse
}

/**
 * Throw the mallet of contact `k` (its side a, a free mass) at the other
 * side: placed just touching, moving at `velocity` m/s.
 */
export function launch(k: i32, velocity: f64): void {
  const r = unchecked(kResA[k])
  const n = unchecked(rStart[r])
  const s = unchecked(shape[kShapeA[k]])
  unchecked((q[n] = 0))
  unchecked((q[n] = -stretch(k) / s))
  unchecked((v[n] = velocity / s))
  unchecked((eta[k] = 0))
  unchecked((prevEta[k] = 0))
}

// ---- Editing while sounding ---------------------------------------------------

/** policy: 0 at once, 1 linear ramp over `samples` steps, 2 when the spring next passes through its rest length. */
export function setStiffness(k: i32, stiffness: f64, policy: i32, samples: i32): void {
  unchecked((kTarget[k] = stiffness))
  unchecked((kPolicy[k] = policy))
  unchecked((kRemaining[k] = policy == RAMP ? (samples > 1 ? samples : 1) : 0))
}

/** A damper stores no energy, so this is always passive. */
export function setDamping(k: i32, damping: f64): void {
  unchecked((kDamp[k] = damping))
}

/** Make the spring's rest length its present length, so that giving it stiffness now adds no energy. */
export function attach(k: i32): void {
  unchecked((kOffset[k] -= stretch(k)))
  unchecked((eta[k] = 0))
  unchecked((prevEta[k] = 0))
}

/**
 * Change the frequency and decay time of mode `n` of resonator `r` while it
 * sounds. The mode's displacement and velocity are rescaled so that its
 * stored energy is unchanged, and every spring's rest length is moved so that
 * its stored energy is unchanged too: the edit neither adds nor removes
 * energy, and no force jumps (a spring's force changes only by the square
 * root of the small change in its compensated stiffness).
 */
export function tune(r: i32, n: i32, frequency: f64, decayTime: f64): void {
  const i = unchecked(rStart[r]) + n
  for (let k = 0; k < K; k++) {
    unchecked((trial[k] = stretch(k)))
    unchecked((delta[k] = kEff[k]))
  }
  const massBefore = unchecked(mm[i])
  const stiffBefore = unchecked(mk[i])
  unchecked((freq[i] = frequency))
  unchecked((t60[i] = decayTime))
  design(i)
  refreshShape(r, n)
  unchecked((v[i] *= Math.sqrt(massBefore / mm[i])))
  if (stiffBefore > 0 && unchecked(mk[i]) > 0) unchecked((q[i] *= Math.sqrt(stiffBefore / mk[i])))
  for (let k = 0; k < K; k++) {
    if (unchecked(kKind[k]) != SPRING) continue
    refreshSpring(k)
    const keep = unchecked(kEff[k]) > 0 ? Math.sqrt(unchecked(delta[k] / kEff[k])) : 1.0
    unchecked((kOffset[k] += trial[k] * keep - stretch(k)))
  }
  dirty = true
}

// ---- Reading (diagnostics; none of this is needed to make sound) -------------

export function output(): f64 {
  return mix
}

/** Mid-step velocity of a port for the step just taken (m/s). */
export function velocity(r: i32, port: i32): f64 {
  return side(r, shape, unchecked(rShape[r]) + port * unchecked(rCount[r]), vMid)
}

export function connectionForce(k: i32): f64 {
  return unchecked(F[k])
}

export function connectionStretch(k: i32): f64 {
  return unchecked(eta[k])
}

export function stiffness(k: i32): f64 {
  return unchecked(kStiff[k])
}

/** Energy added by stiffness changes of connection k so far (J; negative = removed). */
export function injected(k: i32): f64 {
  return unchecked(kInjected[k])
}

export function resonatorEnergy(r: i32): f64 {
  let e: f64 = 0
  for (let n = unchecked(rStart[r]), last = n + unchecked(rCount[r]); n < last; n++) {
    e += unchecked(0.5 * mm[n] * v[n] * v[n] + 0.5 * mk[n] * q[n] * q[n])
  }
  return e
}

/** Total stored energy now: every resonator plus every connection (J). */
export function energy(): f64 {
  let e: f64 = 0
  for (let r = 0; r < R; r++) e += resonatorEnergy(r)
  for (let k = 0; k < K; k++) {
    const x = stretch(k)
    if (unchecked(kKind[k]) == SPRING) e += 0.5 * unchecked(kEff[k]) * x * x
    else if (x > 0) e += (unchecked(kStiff[k]) * Math.pow(x, unchecked(kAlpha[k]) + 1)) / (unchecked(kAlpha[k]) + 1)
  }
  return e
}

/** Energy dissipated during the step just taken, in resonators and dampers (J). */
export function dissipated(): f64 {
  let e: f64 = 0
  for (let n = 0; n < M; n++) e += unchecked(mc[n] * vMid[n] * vMid[n])
  for (let k = 0; k < K; k++) e += unchecked(kDamp[k] * w[k] * w[k])
  return e * dt
}

/** Momentum of a resonator's modes taken as rigid-body modes of unit shape (kg m/s). */
export function momentum(r: i32): f64 {
  let p: f64 = 0
  for (let n = unchecked(rStart[r]), last = n + unchecked(rCount[r]); n < last; n++) p += unchecked(mm[n] * v[n])
  return p
}

export function setVelocity(r: i32, value: f64): void {
  for (let n = unchecked(rStart[r]), last = n + unchecked(rCount[r]); n < last; n++) unchecked((v[n] = value))
}

export function iterations(): i32 {
  return iters
}

export function worstIterations(): i32 {
  return worst
}

/** Samples so far whose output was not a finite number. */
export function faults(): i32 {
  return faultCount
}
