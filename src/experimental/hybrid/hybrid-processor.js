// EXPERIMENTAL (Phase 3D.12). Used only by the hybrid lab page
// (hybrid-lab.html). The engine's own processor (../wasm/processor.js) is
// not changed: this one extends it, and differs in two things.
//
// 1. Several fingers. The engine's processor moves one finger's damper at a
//    time ('touch') and remembers only that one: a second 'touch' on another
//    connection abandons the first where it stands. Here every connection
//    that is touched has its own place (up to FINGERS at once), and each
//    damper follows its own ramp whatever the others are doing. The
//    arithmetic of one finger is the engine's processor's own, line for
//    line, so with one finger the two produce the same samples. Nothing
//    else of 'touch' changes: a finger is still only the engine's damper
//    (setDamping), through which energy leaves; the output is never altered.
//
// 2. Timing. How long each call of process() takes, by the finest clock
//    this scope has (performance.now() where the browser provides it in a
//    worklet, otherwise Date.now(), which counts whole milliseconds), and
//    how far apart the calls arrive. Kept in one Float64Array made when the
//    processor is made: process() allocates nothing and posts nothing. The
//    numbers are sent only when asked for ({ diag: id }), from the message
//    handler, between blocks.
//
// Load order in the worklet: capture.js, ../wasm/processor.js, this file.

/* global registerProcessor */

const Base = globalThis.__sonicmatterProcessors && globalThis.__sonicmatterProcessors['sonicmatter-physics']
if (!Base) throw new Error('hybrid-processor.js: capture.js and processor.js must be added to the worklet first')

const FINGER = 9 // numbers kept per finger: as the engine's processor keeps for its one
const FINGERS = 4

const perf = globalThis.performance
const hasFine = !!perf && typeof perf.now === 'function'
const fineClock = hasFine ? () => perf.now() : () => Date.now()
const coarseClock = () => Date.now()

// Upper edges, in milliseconds, of the bins process() durations are counted in.
// With a fine clock the sixth edge is replaced by the block's own length. With Date.now() a duration is a
// whole number of clock ticks, 0, 1, 2, ..., and a reading r means the block took between r - 1 and r + 1
// ms: the bins are the readings themselves.
const FINE_EDGES = [0.25, 0.5, 1, 1.5, 2, 0, 4, Infinity]
const COARSE_EDGES = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 10.5, Infinity]
const COARSE_LABELS = ['0 ms', '1 ms', '2 ms', '3 ms', '4 ms', '5 ms', '6 to 10 ms', 'over 10 ms']
// Places in the timing array.
const BLOCKS = 0
const SUM = 1
const WORST = 2
const OVER = 3
const LAST = 4
const GAP_SUM = 5
const GAP_WORST = 6
const GAPS = 7
const PEAK = 8
const CEILING = 9
const SMALLEST = 10
const POSSIBLE = 11
const BINS = 12

class HybridProcessor extends Base {
  constructor(options) {
    super(options)
    this.fingers = this.fingers || new Float64Array(FINGERS * FINGER)
    // (`coarseClock`: use Date.now() even where there is a finer clock, so that what a browser without one reports can be tested.)
    this.fine = hasFine && options.processorOptions.coarseClock !== true
    this.clock = this.fine ? fineClock : coarseClock
    this.edges = this.fine ? FINE_EDGES : COARSE_EDGES
    this.timing = new Float64Array(BINS + this.edges.length)
    const base = this.port.onmessage
    this.port.onmessage = (event) => {
      base(event)
      const message = event.data
      if (message.diag && this.engine) this.port.postMessage(this.diagnostics(message))
      if (message.clear) this.timing.fill(0)
    }
  }

  /** 'touch' and 'reset' are handled here; everything else, in order, by the engine's processor. */
  run(calls) {
    // (The engine's processor runs the building calls from its constructor, before this object's own fields exist.)
    this.fingers = this.fingers || new Float64Array(FINGERS * FINGER)
    let from = 0
    for (let i = 0; i < calls.length; i++) {
      const name = calls[i][0]
      if (name !== 'touch' && name !== 'reset') continue
      if (i > from) super.run(calls.slice(from, i))
      if (name === 'touch') this.finger(calls[i])
      else {
        this.fingers.fill(0)
        super.run([calls[i]])
      }
      from = i + 1
    }
    if (from < calls.length) super.run(from === 0 ? calls : calls.slice(from))
    this.pace()
  }

  /** ['touch', connection, damping, attack, hold, release], as the engine's processor takes it, for this connection's own finger. */
  finger([, connection, damping, attack, hold, release]) {
    const f = this.fingers
    let slot = -1
    for (let s = 0; s < f.length; s += FINGER) if (f[s] !== 0 && f[s + 1] === connection) slot = s
    for (let s = 0; slot < 0 && s < f.length; s += FINGER) if (f[s] === 0) slot = s
    if (slot < 0) throw new Error(`more than ${FINGERS} fingers at once`)
    const samples = (seconds) => Math.max(0, Math.round(seconds * this.rate))
    // From wherever this finger is now (nothing, if it was not there).
    const now = f[slot] !== 0 ? f[slot + 2] : 0
    f.set([1, connection, now, now, damping, 0, samples(attack), hold < 0 ? -1 : samples(hold), samples(release)], slot)
  }

  /** Every finger's damper for the next `n` samples, and its stages moved on: the engine's processor's `touching`, once per finger. */
  touching(n) {
    const f = this.fingers
    for (let s = 0; s < f.length; s += FINGER) {
      if (f[s] === 0) continue
      const length = f[s] === 1 ? f[s + 6] : f[s] === 2 ? f[s + 7] : f[s + 8]
      if (f[s] === 1) f[s + 2] = length === 0 ? f[s + 4] : f[s + 3] + ((f[s + 4] - f[s + 3]) * Math.min(f[s + 5] + n, length)) / length
      else if (f[s] === 3) f[s + 2] = length === 0 ? 0 : f[s + 3] * (1 - Math.min(f[s + 5] + n, length) / length)
      this.engine.setDamping(f[s + 1], f[s + 2])
      f[s + 5] += n
      if (length >= 0 && f[s + 5] >= length) {
        f[s] = f[s] === 3 ? 0 : f[s] + 1
        f[s + 3] = f[s + 2]
        f[s + 5] = 0
      }
    }
    this.pace()
  }

  /**
   * The engine's processor decides how many samples to make in one go from its one finger (this.touch):
   * sixteen at most while it is moving, up to the end of a rest of fixed length, a whole block otherwise.
   * Its finger is used here only for that: it is set to stand for all of ours together.
   */
  pace() {
    const f = this.fingers
    const t = this.touch
    let moving = false
    let resting = false
    let soonest = -1
    for (let s = 0; s < f.length; s += FINGER) {
      if (f[s] === 1 || f[s] === 3) moving = true
      else if (f[s] === 2) {
        resting = true
        if (f[s + 7] >= 0 && (soonest < 0 || f[s + 7] - f[s + 5] < soonest)) soonest = f[s + 7] - f[s + 5]
      }
    }
    t.fill(0)
    if (moving) t[0] = 1
    else if (resting) {
      t[0] = 2
      t[7] = soonest
    }
  }

  process(inputs, outputs) {
    const d = this.timing
    const clock = this.clock
    const edges = this.edges
    const started = clock()
    const alive = super.process(inputs, outputs)
    const took = clock() - started
    const first = outputs[0][0]
    const quantum = (1000 * first.length) / this.rate
    if (d[BLOCKS] > 0) {
      const gap = started - d[LAST]
      d[GAP_SUM] += gap
      d[GAPS] += 1
      if (gap > d[GAP_WORST]) d[GAP_WORST] = gap
    }
    d[LAST] = started
    d[BLOCKS] += 1
    d[SUM] += took
    if (took > d[WORST]) d[WORST] = took
    // Longer than a block. By the fine clock that is a fact. By Date.now() a reading r is somewhere between r - 1
    // and r + 1 ms: it is certainly over when r - 1 is, and possibly over when only r + 1 is.
    if (this.fine ? took > quantum : took - 1 >= quantum) d[OVER] += 1
    else if (!this.fine && took + 1 > quantum) d[POSSIBLE] += 1
    if (took > 0 && (d[SMALLEST] === 0 || took < d[SMALLEST])) d[SMALLEST] = took
    for (let b = 0; b < edges.length; b++) {
      if (took < (this.fine && b === 5 ? quantum : edges[b])) {
        d[BINS + b] += 1
        break
      }
    }
    let peak = 0
    for (let i = 0; i < first.length; i++) {
      const x = first[i] < 0 ? -first[i] : first[i]
      if (x > peak) peak = x
    }
    if (peak > d[PEAK]) d[PEAK] = peak
    if (peak >= 1) d[CEILING] += 1
    return alive
  }

  /** What has been measured since the processor was made or last cleared, and the engine's state now. Runs between blocks. */
  diagnostics(message) {
    const d = this.timing
    const f = this.fingers
    const engine = this.engine
    const fingers = []
    for (let s = 0; s < f.length; s += FINGER) if (f[s] !== 0) fingers.push({ connection: f[s + 1], stage: f[s], damping: f[s + 2] })
    return {
      diag: message.diag,
      clock: this.fine ? 'performance.now' : 'Date.now',
      smallestDurationSeen_ms: d[SMALLEST],
      quantum_ms: (1000 * 128) / this.rate,
      blocks: d[BLOCKS],
      mean_ms: d[BLOCKS] ? d[SUM] / d[BLOCKS] : 0,
      worst_ms: d[WORST],
      // Certainly longer than a block; and, with Date.now() only, possibly longer (the clock cannot tell).
      overruns: d[OVER],
      possibleOverruns: d[POSSIBLE],
      binLabels: this.fine ? FINE_EDGES.map((edge, b) => `${b === 0 ? 'under' : `${b === 6 ? ((1000 * 128) / this.rate).toFixed(2) : FINE_EDGES[b - 1]} to`} ${b === 5 ? ((1000 * 128) / this.rate).toFixed(2) : edge === Infinity ? 'more' : edge} ms`) : COARSE_LABELS,
      bins: Array.from(d.subarray(BINS, BINS + this.edges.length)),
      gapMean_ms: d[GAPS] ? d[GAP_SUM] / d[GAPS] : 0,
      gapWorst_ms: d[GAP_WORST],
      peak: d[PEAK],
      blocksAtTheCeiling: d[CEILING],
      faults: engine.faults(),
      worstIterations: engine.worstIterations(),
      memoryBytes: engine.memory.buffer.byteLength,
      energy: engine.energy(),
      resonatorEnergy: (message.resonators || []).map((r) => engine.resonatorEnergy(r)),
      stiffness: (message.connections || []).map((k) => engine.stiffness(k)),
      injected: (message.connections || []).map((k) => engine.injected(k)),
      fingers,
    }
  }
}

registerProcessor('sonicmatter-hybrid', HybridProcessor)
