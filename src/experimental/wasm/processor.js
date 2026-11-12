// EXPERIMENTAL (Phase 3A.1). Not used by the application.
// AudioWorklet processor that runs the WebAssembly physics engine
// (assembly/engine.ts). Plain JavaScript with no imports: it is loaded as-is
// into the AudioWorkletGlobalScope.
//
// process() allocates nothing: it calls the engine and copies samples out of
// its memory through a view created once. Everything else (building the
// system, edits, strikes) arrives as messages and runs between blocks.

/* global AudioWorkletProcessor, registerProcessor */

class PhysicsProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const { bytes, calls, measure } = options.processorOptions
    this.alive = true
    this.measure = measure === true
    // [blocks, milliseconds spent in process(), blocks that took 2 ms or more]
    this.stats = new Float64Array(3)
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
      const fn = this.engine[name]
      if (typeof fn !== 'function') throw new Error(`unknown engine call "${name}"`)
      fn(...args)
    }
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
    engine.process(count)
    const samples = this.samples
    for (let i = 0; i < count; i++) {
      const x = samples[i]
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
