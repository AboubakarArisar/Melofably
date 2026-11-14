// EXPERIMENTAL (Phase 3A.1). Not used by the application.
// AudioWorklet processor that runs the WebAssembly physics engine
// (assembly/engine.ts). Plain JavaScript with no imports: it is loaded as-is
// into the AudioWorkletGlobalScope.
//
// process() allocates nothing: it calls the engine and copies samples out of
// its memory through a view created once. Everything else (building the
// system, edits, strikes) arrives as messages and runs between blocks.
//
// Some things the engine does not do itself are done here, on request, by
// calls that are addressed to this processor rather than to the engine. All
// are off until asked for, and a 'reset' turns them off: with none in use the
// engine fills each block in one call, exactly as before they existed.
//
// Phase 3C.3:
//
//   ['pluck', resonator, port, force, cutoff, seconds, delay = 0]
//     A plucking force on one port: an impulse rounded by two one-pole
//     lowpasses at `cutoff` Hz, then integrated with a 20 Hz leak, so that it
//     steps to `force` newtons and relaxes; applied for `seconds`. The same
//     arithmetic as pluckForce() in src/experimental/string/modalString.ts.
//     It starts `delay` seconds after it is asked for.
//
//   ['radiate', perSample, b0, b1, a1, fullScale]
//     Turns the engine's output into sound pressure: p = perSample (x[n] -
//     x[n-1]), then y = b0 p[n] + b1 p[n-1] - a1 y[n-1]; the node's output is
//     y / fullScale. See radiation() in src/experimental/string/stringBody.ts.
//
// Phase 3D.1 (playing):
//
//   ['touch', connection, damping, attack, hold, release]
//     A finger on the string: the damper `connection` is taken from whatever
//     strength it has to `damping` (N s/m) over `attack` seconds, kept there
//     for `hold` seconds, then taken to nothing over `release` seconds. A
//     negative `hold` keeps it until the next 'touch'. Only the engine's own
//     damper is changed (setDamping): energy leaves through it, and the
//     output is never altered.
//
//   ['hold', resonator, port, force, cutoff]
//     A finger pulling the string aside: a force on one port that follows
//     `force` (N) through two one-pole lowpasses at `cutoff` Hz. Asked again
//     with another force it moves there; asked with 0 and a high cutoff it
//     lets go, which is a pluck.
//
// Phase 3D.4 (experimental radiation):
//
//   ['radiator', fullScale, b0, a1, tap, far, near, late, tap, far, near, late, ...]
//     Sound pressure from the velocities of several points of a bar, each an
//     engine tap (addTap) and each a dipole: per point and per sample
//       a   = rate (v[n] - v[n-1])                 acceleration, m/s^2
//       low = b0 (a[n] + a[n-1]) - a1 low[n-1]     one-pole lowpass at the crossover
//       s   = far (a - low) + near a               Pa
//     and s reaches the listener `late` samples later (a whole number and a
//     fraction, shared between two neighbouring samples). The node's output
//     is the sum / fullScale, in place of the engine's own output, which the
//     engine still computes unchanged. The numbers come from radiatorCall()
//     in src/experimental/radiation/barRadiation.ts. Nothing is normalized.
//
// While any force is being applied the engine is stepped one sample at a
// time; while a touch is changing, sixteen at a time; with a radiator, at
// most 128 at a time (the engine keeps 128 samples of each tap).

/* global AudioWorkletProcessor, registerProcessor */

const PLUCK = 9 // numbers kept per pluck
const PLUCKS = 8 * PLUCK
const POINT = 9 // numbers kept per radiating point
const TAP_BLOCK = 128 // samples of each tap the engine keeps (assembly/engine.ts)

class PhysicsProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const { bytes, calls, measure } = options.processorOptions
    this.alive = true
    this.measure = measure === true
    // [blocks, milliseconds spent in process(), blocks that took 2 ms or more, the longest block in ms]
    this.stats = new Float64Array(4)
    // Plucks, 9 numbers each: samples left, resonator, port, force, lowpass pole, the three numbers the
    // force's filters remember, and samples still to wait before it starts. Room for 8 at once; a ninth
    // takes over the oldest.
    this.plucks = new Float64Array(PLUCKS)
    this.livePlucks = 0
    this.rate = 48000
    // Radiation: [on, perSample, b0, b1, a1, 1 / fullScale, previous x, previous p, previous y].
    this.rad = new Float64Array(9)
    // Touch: [stage (0 off, 1 arriving, 2 resting, 3 leaving), connection, strength now, strength it started
    // this stage from, strength to rest at, samples into this stage, and the lengths in samples of
    // arriving, resting (negative: until told) and leaving].
    this.touch = new Float64Array(9)
    // Hold: [on, resonator, port, force wanted, lowpass pole, and the two numbers its filters remember].
    this.hold = new Float64Array(7)
    // Radiator: off while there are no points. Per point: [tap, far, near, whole samples late, fraction,
    // 1 - fraction, previous velocity, previous acceleration, previous lowpass]. `air` is the sound on its
    // way to the listener: a ring of pascals, read and cleared at `now`, written ahead of it.
    this.points = new Float64Array(0)
    this.radiator = new Float64Array(4) // [rate, b0, a1, 1 / fullScale]
    this.air = new Float64Array(1)
    this.now = 0
    this.engine = null
    try {
      this.engine = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports
      this.run(calls)
      this.samples = new Float32Array(this.engine.memory.buffer, this.engine.outputPointer(), 4096)
      // (An engine built before Phase 3D.4 has no taps; it is still run by the regression tests.)
      this.taps = this.engine.tapPointer ? new Float64Array(this.engine.memory.buffer, this.engine.tapPointer(), 32 * TAP_BLOCK) : null
      this.port.postMessage({ ready: true })
    } catch (error) {
      this.engine = null
      this.port.postMessage({ error: String(error) })
    }
    this.port.onmessage = (event) => {
      const message = event.data
      if (message.stop) this.alive = false
      if (!this.engine) return
      try {
        if (message.calls) this.run(message.calls)
      } catch (error) {
        this.port.postMessage({ error: String(error) })
      }
      if (message.report) {
        this.port.postMessage({
          report: message.report,
          blocks: this.stats[0],
          busyMs: this.stats[1],
          slowBlocks: this.stats[2],
          worstBlockMs: this.stats[3],
          faults: this.engine.faults(),
          worstIterations: this.engine.worstIterations(),
          memoryBytes: this.engine.memory.buffer.byteLength,
          // Everything the system holds as motion and as stretch, J: what a player sees as "still ringing".
          energy: this.engine.energy(),
        })
      }
    }
  }

  run(calls) {
    for (const [name, ...args] of calls) {
      if (name === 'pluck') {
        this.pluck(args)
        continue
      }
      if (name === 'radiate') {
        this.rad.fill(0)
        this.rad.set([1, args[0], args[1], args[2], args[3], 1 / args[4]])
        continue
      }
      if (name === 'touch') {
        const t = this.touch
        const samples = (seconds) => Math.max(0, Math.round(seconds * this.rate))
        // From wherever the finger is now (nothing, if it was not on this connection).
        const now = t[0] !== 0 && t[1] === args[0] ? t[2] : 0
        t.set([1, args[0], now, now, args[1], 0, samples(args[2]), args[3] < 0 ? -1 : samples(args[3]), samples(args[4])])
        continue
      }
      if (name === 'hold') {
        const h = this.hold
        const pole = Math.exp((-2 * Math.PI * Math.min(args[3], 0.45 * this.rate)) / this.rate)
        // The same finger on the same point keeps what its filters remember; a new one starts from nothing.
        if (h[0] === 1 && h[1] === args[0] && h[2] === args[1]) {
          h[3] = args[2]
          h[4] = pole
        } else h.set([1, args[0], args[1], args[2], pole, 0, 0])
        continue
      }
      if (name === 'radiator') {
        // Between blocks: the only place the radiator's memory is made.
        const count = (args.length - 3) / 4
        this.points = new Float64Array(count * POINT)
        let longest = 0
        for (let j = 0; j < count; j++) {
          const [tap, far, near, late] = args.slice(3 + 4 * j, 7 + 4 * j)
          const whole = Math.floor(late)
          this.points.set([tap, far, near, whole, late - whole, 1 - (late - whole)], j * POINT)
          longest = Math.max(longest, whole)
        }
        this.radiator.set([this.rate, args[1], args[2], 1 / args[0]])
        // Room for a whole block written ahead of the block being read, and for the longest travel time.
        this.air = new Float64Array(2 ** Math.ceil(Math.log2(TAP_BLOCK + longest + 2)))
        this.now = 0
        continue
      }
      if (name === 'reset') {
        // A new system: nothing of the old one's plucks, fingers or radiation carries over.
        this.rate = args[0]
        this.plucks.fill(0)
        this.livePlucks = 0
        this.rad.fill(0)
        this.touch.fill(0)
        this.hold.fill(0)
        this.points = new Float64Array(0)
      }
      const fn = this.engine[name]
      if (typeof fn !== 'function') throw new Error(`unknown engine call "${name}"`)
      fn(...args)
    }
  }

  pluck([resonator, port, force, cutoff, seconds, delay = 0]) {
    const p = this.plucks
    let slot = 0
    for (let s = 0; s < PLUCKS; s += PLUCK) if (p[s] < p[slot]) slot = s
    if (p[slot] === 0) this.livePlucks++
    p[slot] = Math.max(1, Math.round(seconds * this.rate))
    p[slot + 1] = resonator
    p[slot + 2] = port
    p[slot + 3] = force
    p[slot + 4] = Math.exp((-2 * Math.PI * Math.min(cutoff, 0.45 * this.rate)) / this.rate)
    p[slot + 5] = 1 - p[slot + 4] // the impulse, through the first lowpass
    p[slot + 6] = 0
    p[slot + 7] = 0
    p[slot + 8] = Math.max(0, Math.round(delay * this.rate))
  }

  /** Sets the finger's damper for the next `n` samples and moves its stages on. */
  touching(n) {
    const t = this.touch
    const length = t[0] === 1 ? t[6] : t[0] === 2 ? t[7] : t[8]
    if (t[0] === 1) t[2] = length === 0 ? t[4] : t[3] + ((t[4] - t[3]) * Math.min(t[5] + n, length)) / length
    else if (t[0] === 3) t[2] = length === 0 ? 0 : t[3] * (1 - Math.min(t[5] + n, length) / length)
    this.engine.setDamping(t[1], t[2])
    t[5] += n
    if (length >= 0 && t[5] >= length) {
      // On to the next stage; after leaving, the finger is off.
      t[0] = t[0] === 3 ? 0 : t[0] + 1
      t[3] = t[2]
      t[5] = 0
    }
  }

  /** The radiator's pressure for the `n` samples the engine has just made, into `first` from `offset`. */
  radiate(first, offset, n) {
    const { points, taps, air } = this
    const rate = this.radiator[0]
    const b0 = this.radiator[1]
    const a1 = this.radiator[2]
    const scale = this.radiator[3]
    const mask = air.length - 1
    for (let p = 0; p < points.length; p += POINT) {
      const at = points[p] * TAP_BLOCK
      const far = points[p + 1]
      const near = points[p + 2]
      const whole = points[p + 3]
      const part = points[p + 4]
      const rest = points[p + 5]
      let v1 = points[p + 6]
      let x1 = points[p + 7]
      let y1 = points[p + 8]
      for (let j = 0; j < n; j++) {
        const v = taps[at + j]
        const a = (v - v1) * rate
        v1 = v
        const low = b0 * (a + x1) - a1 * y1
        x1 = a
        y1 = low
        const s = far * (a - low) + near * a
        const arrives = this.now + j + whole
        air[arrives & mask] += rest * s
        air[(arrives + 1) & mask] += part * s
      }
      points[p + 6] = v1
      points[p + 7] = x1
      points[p + 8] = y1
    }
    for (let j = 0; j < n; j++) {
      const slot = (this.now + j) & mask
      first[offset + j] = air[slot] * scale
      air[slot] = 0
    }
    this.now = (this.now + n) & mask
  }

  process(_inputs, outputs) {
    const engine = this.engine
    if (!engine) return this.alive // silence; the error was already reported
    const output = outputs[0]
    const first = output[0]
    const count = first.length
    // Date.now() is the only clock in this scope. It is coarse (1 ms), but
    // summed over many blocks the differences average to the true time.
    const started = this.measure ? Date.now() : 0
    const samples = this.samples
    const p = this.plucks
    const t = this.touch
    const h = this.hold
    const radiating = this.points.length > 0
    if (this.livePlucks === 0 && t[0] === 0 && h[0] === 0 && !radiating) {
      engine.process(count)
      for (let i = 0; i < count; i++) first[i] = samples[i]
    } else {
      const leak = Math.exp((-2 * Math.PI * 20) / this.rate)
      let i = 0
      while (i < count) {
        // How many samples can be made in one go: one while a force is applied, up to sixteen while the
        // finger's damper is changing, and never past the moment a waiting pluck or the finger's next stage begins.
        let n = count - i
        let forcing = h[0] === 1
        for (let s = 0; s < PLUCKS; s += PLUCK) {
          if (p[s] === 0) continue
          if (p[s + 8] === 0) forcing = true
          else if (p[s + 8] < n) n = p[s + 8]
        }
        if (t[0] === 1 || t[0] === 3) n = Math.min(n, 16)
        else if (t[0] === 2 && t[7] >= 0) n = Math.min(n, Math.max(1, t[7] - t[5]))
        if (radiating && n > TAP_BLOCK) n = TAP_BLOCK
        if (forcing) n = 1
        if (t[0] !== 0) this.touching(n)
        for (let s = 0; s < PLUCKS; s += PLUCK) {
          if (p[s] === 0) continue
          if (p[s + 8] > 0) {
            p[s + 8] -= n
            continue
          }
          const pole = p[s + 4]
          p[s + 6] = (1 - pole) * p[s + 5] + pole * p[s + 6]
          p[s + 7] = p[s + 6] + leak * p[s + 7]
          engine.applyForce(p[s + 1], p[s + 2], p[s + 3] * p[s + 7])
          p[s + 5] *= pole
          if (--p[s] === 0) this.livePlucks--
        }
        if (h[0] === 1) {
          h[5] += (1 - h[4]) * (h[3] - h[5])
          h[6] += (1 - h[4]) * (h[5] - h[6])
          engine.applyForce(h[1], h[2], h[6])
          // Let go, and the force has gone: the finger is off.
          if (h[3] === 0 && Math.abs(h[5]) < 1e-12 && Math.abs(h[6]) < 1e-12) h[0] = 0
        }
        engine.process(n)
        if (radiating) this.radiate(first, i, n)
        else for (let j = 0; j < n; j++) first[i + j] = samples[j]
        i += n
      }
    }
    const rad = this.rad
    if (rad[0] === 1) {
      for (let i = 0; i < count; i++) {
        const x = first[i]
        const pressure = rad[1] * (x - rad[6])
        const y = rad[2] * pressure + rad[3] * rad[7] - rad[4] * rad[8]
        rad[6] = x
        rad[7] = pressure
        rad[8] = y
        first[i] = y * rad[5]
      }
    }
    for (let i = 0; i < count; i++) {
      const x = first[i]
      first[i] = x > 1 ? 1 : x < -1 ? -1 : x
    }
    for (let channel = 1; channel < output.length; channel++) output[channel].set(first)
    if (this.measure) {
      const took = Date.now() - started
      this.stats[0] += 1
      this.stats[1] += took
      if (took >= 2) this.stats[2] += 1
      if (took > this.stats[3]) this.stats[3] = took
    }
    return this.alive
  }
}

registerProcessor('sonicmatter-physics', PhysicsProcessor)
