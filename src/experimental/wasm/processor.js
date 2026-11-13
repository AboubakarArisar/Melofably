// EXPERIMENTAL (Phase 3A.1). Not used by the application.
// AudioWorklet processor that runs the WebAssembly physics engine
// (assembly/engine.ts). Plain JavaScript with no imports: it is loaded as-is
// into the AudioWorkletGlobalScope.
//
// process() allocates nothing: it calls the engine and copies samples out of
// its memory through a view created once. Everything else (building the
// system, edits, strikes) arrives as messages and runs between blocks.
//
// Two things the engine does not do itself are done here, on request, by
// calls that are addressed to this processor rather than to the engine
// (Phase 3C.3; both are off until asked for, and a 'reset' turns them off):
//
//   ['pluck', resonator, port, force, cutoff, seconds]
//     A plucking force on one port: an impulse rounded by two one-pole
//     lowpasses at `cutoff` Hz, then integrated with a 20 Hz leak, so that it
//     steps to `force` newtons and relaxes; applied for `seconds`. The same
//     arithmetic as pluckForce() in src/experimental/string/modalString.ts.
//     While a pluck lasts the engine is stepped one sample at a time.
//
//   ['radiate', perSample, b0, b1, a1, fullScale]
//     Turns the engine's output into sound pressure: p = perSample (x[n] -
//     x[n-1]), then y = b0 p[n] + b1 p[n-1] - a1 y[n-1]; the node's output is
//     y / fullScale. See radiation() in src/experimental/string/stringBody.ts.

/* global AudioWorkletProcessor, registerProcessor */

class PhysicsProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const { bytes, calls, measure } = options.processorOptions
    this.alive = true
    this.measure = measure === true
    // [blocks, milliseconds spent in process(), blocks that took 2 ms or more]
    this.stats = new Float64Array(3)
    // Plucks in progress, 8 numbers each: samples left, resonator, port, force, lowpass pole, and the
    // three numbers the force's filters remember. Room for 8 at once; a ninth takes over the oldest.
    this.plucks = new Float64Array(64)
    this.livePlucks = 0
    this.rate = 48000
    // Radiation: [on, perSample, b0, b1, a1, 1 / fullScale, previous x, previous p, previous y].
    this.rad = new Float64Array(9)
    this.engine = null
    try {
      this.engine = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports
      this.run(calls)
      this.samples = new Float32Array(this.engine.memory.buffer, this.engine.outputPointer(), 4096)
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
          faults: this.engine.faults(),
          worstIterations: this.engine.worstIterations(),
          memoryBytes: this.engine.memory.buffer.byteLength,
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
      if (name === 'reset') {
        // A new system: nothing of the old one's plucks or radiation carries over.
        this.rate = args[0]
        this.plucks.fill(0)
        this.livePlucks = 0
        this.rad.fill(0)
      }
      const fn = this.engine[name]
      if (typeof fn !== 'function') throw new Error(`unknown engine call "${name}"`)
      fn(...args)
    }
  }

  pluck([resonator, port, force, cutoff, seconds]) {
    const p = this.plucks
    let slot = 0
    for (let s = 0; s < 64; s += 8) if (p[s] < p[slot]) slot = s
    if (p[slot] === 0) this.livePlucks++
    p[slot] = Math.max(1, Math.round(seconds * this.rate))
    p[slot + 1] = resonator
    p[slot + 2] = port
    p[slot + 3] = force
    p[slot + 4] = Math.exp((-2 * Math.PI * Math.min(cutoff, 0.45 * this.rate)) / this.rate)
    p[slot + 5] = 1 - p[slot + 4] // the impulse, through the first lowpass
    p[slot + 6] = 0
    p[slot + 7] = 0
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
    if (this.livePlucks > 0) {
      const p = this.plucks
      const leak = Math.exp((-2 * Math.PI * 20) / this.rate)
      for (let i = 0; i < count; i++) {
        for (let s = 0; s < 64; s += 8) {
          if (p[s] === 0) continue
          const pole = p[s + 4]
          p[s + 6] = (1 - pole) * p[s + 5] + pole * p[s + 6]
          p[s + 7] = p[s + 6] + leak * p[s + 7]
          engine.applyForce(p[s + 1], p[s + 2], p[s + 3] * p[s + 7])
          p[s + 5] *= pole
          if (--p[s] === 0) this.livePlucks--
        }
        engine.process(1)
        first[i] = samples[0]
      }
    } else {
      engine.process(count)
      for (let i = 0; i < count; i++) first[i] = samples[i]
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
    }
    return this.alive
  }
}

registerProcessor('sonicmatter-physics', PhysicsProcessor)
