// Lifecycle of the main-thread engine, with the Web Audio objects replaced by
// recorders: notes must not create nodes, switching must swap exactly one
// node behind a fade, failures must leave nothing behind, and dispose must
// release everything. (Real playback is verified in the browser.)
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { EngineStatus, InstrumentId } from '../src/types'

const made = { contexts: 0, closed: 0, nodes: 0, destroyed: 0, analysers: 0, gains: 0, disconnects: 0 }
const params: [string, number][] = []
const events: string[] = [] // order of graph operations
const pending: (() => void)[] = [] // node creations held back by a test
let hold = false
let failNext: string | null = null
const failIds = new Set<string>() // models that always fail to load

class FakeAudioNode {
  connect<T>(next: T) {
    return next
  }
  disconnect() {
    made.disconnects++
  }
}

vi.stubGlobal(
  'AudioContext',
  class {
    state = 'suspended'
    currentTime = 0
    destination = new FakeAudioNode()
    onstatechange: (() => void) | null = null
    constructor() {
      made.contexts++
    }
    async resume() {
      this.state = 'running'
      this.onstatechange?.()
    }
    async suspend() {
      this.state = 'suspended'
      this.onstatechange?.()
    }
    async close() {
      made.closed++
    }
  },
)
vi.stubGlobal(
  'AnalyserNode',
  class extends FakeAudioNode {
    constructor() {
      super()
      made.analysers++
    }
  },
)
vi.stubGlobal(
  'GainNode',
  class extends FakeAudioNode {
    gain = {
      value: 1,
      cancelScheduledValues() {},
      setValueAtTime: (v: number) => events.push(`gain=${v}`),
      linearRampToValueAtTime: (v: number) => events.push(`ramp to ${v}`),
    }
    constructor() {
      super()
      made.gains++
    }
  },
)
vi.mock('../src/audio/worklet/instruments', () => ({
  MODELS: {
    string: { note: 'fret', trigger: 'pluck' },
    bar: { note: 'key', trigger: 'strike' },
    glass: { note: 'key', trigger: 'strike' },
    wood: { note: 'key', trigger: 'strike' },
  },
  createInstrumentNode: async (_ctx: unknown, id: string) => {
    if (hold) await new Promise<void>((resolve) => pending.push(resolve))
    if (failIds.has(id)) throw new Error(`Could not load the ${id} model (HTTP 404)`)
    if (failNext) {
      const message = failNext
      failNext = null
      throw new Error(message)
    }
    made.nodes++
    return Object.assign(new FakeAudioNode(), {
      connect<T>(next: T) {
        events.push(`connect ${id}`)
        return next
      },
      addEventListener() {},
      setNonFiniteHandler() {},
      setParamValue: (path: string, value: number) => params.push([path, value]),
      destroy: () => {
        made.destroyed++
        events.push(`destroy ${id}`)
      },
    })
  },
}))

const { AudioEngine } = await import('../src/audio/engine/AudioEngine')

/** An engine that records its statuses as "state" or "state:instrument". */
function recordingEngine() {
  const statuses: string[] = []
  const last: { status?: EngineStatus } = {}
  const engine = new AudioEngine((s) => {
    last.status = s
    statuses.push('instrument' in s ? `${s.state}:${s.instrument}` : s.state)
  })
  return { engine, statuses, last }
}
const liveNodes = () => made.nodes - made.destroyed
const settle = () => new Promise((resolve) => setTimeout(resolve, 60)) // longer than the switch fade

beforeEach(() => {
  for (const k of Object.keys(made) as (keyof typeof made)[]) made[k] = 0
  params.length = events.length = pending.length = 0
  hold = false
  failNext = null
  failIds.clear()
})

describe('notes', () => {
  test('repeated notes reuse one context and one node', async () => {
    const engine = new AudioEngine()
    await engine.start('string')
    await engine.start('string') // second start is a no-op
    for (let i = 0; i < 1000; i++) engine.play(i % 25)
    expect(made).toMatchObject({ contexts: 1, analysers: 1, gains: 1 })
    expect(liveNodes()).toBe(1)
    // Each note is exactly two parameter writes, and every trigger value differs
    // from the one before it.
    expect(params).toHaveLength(2000)
    const plucks = params.filter(([path]) => path === '/string/pluck').map(([, v]) => v)
    expect(plucks).toHaveLength(1000)
    expect(plucks.every((v, i) => i === 0 || v !== plucks[i - 1])).toBe(true)
  })

  test('non-finite parameter values never reach the DSP', async () => {
    const engine = new AudioEngine()
    await engine.start('string')
    engine.setParam('tension', NaN)
    engine.setParam('length', Infinity)
    expect(params).toHaveLength(0)
  })
})

describe('instrument switching', () => {
  test('swaps the one node behind a fade and readdresses parameters', async () => {
    const { engine, statuses } = recordingEngine()
    await engine.start('string')
    events.length = 0
    await engine.setInstrument('bar')
    // Fade out, then drop the old node, then connect the new one, then restore
    // the gain: the old sound is never cut mid-wave and the two never overlap.
    expect(events).toEqual(['gain=1', 'ramp to 0', 'destroy string', 'connect bar', 'gain=1'])
    await engine.setInstrument('bar') // already loaded: no-op
    expect(made).toMatchObject({ contexts: 1, analysers: 1, gains: 1 })
    expect(liveNodes()).toBe(1)
    expect(statuses).toEqual(['starting', 'running:string', 'running:bar'])
    engine.setParam('length', 0.3)
    engine.play(5)
    expect(params).toEqual([
      ['/bar/length', 0.3],
      ['/bar/key', 5],
      ['/bar/strike', 1],
    ])
  })

  test('cycling through all four instruments keeps one live node and one context', async () => {
    const { engine, statuses } = recordingEngine()
    await engine.start('glass')
    for (const id of ['string', 'bar', 'wood', 'glass', 'wood', 'string'] as const) {
      await engine.setInstrument(id)
      expect(liveNodes(), `live nodes after switching to ${id}`).toBe(1)
      params.length = 0
      engine.play(3)
      // Notes go to the instrument just selected, under its own parameter names.
      expect(params.map(([path]) => path.split('/')[1])).toEqual([id, id])
    }
    expect(made).toMatchObject({ contexts: 1, analysers: 1, gains: 1 })
    expect(statuses.at(-1)).toBe('running:string')
  })

  test('rapid switching ends on the last request with a single node', async () => {
    const { engine, statuses } = recordingEngine()
    await engine.start('string')
    const requests: InstrumentId[] = ['bar', 'glass', 'wood', 'string', 'bar', 'wood', 'glass', 'bar', 'string', 'wood', 'bar', 'glass']
    // Fired without waiting, as a user flicking through the selector would.
    await Promise.all(requests.map((id) => engine.setInstrument(id)))
    await settle()
    expect(liveNodes()).toBe(1)
    expect(made).toMatchObject({ contexts: 1, analysers: 1, gains: 1 })
    expect(statuses.at(-1)).toBe('running:glass')
    params.length = 0
    engine.play(1)
    expect(params.map(([path]) => path)).toEqual(['/glass/key', '/glass/strike'])
    // Only the winning load ever reached the output.
    expect(events.filter((e) => e.startsWith('connect'))).toEqual(['connect string', 'connect glass'])
  })

  test('a superseded instrument load is discarded', async () => {
    const engine = new AudioEngine()
    await engine.start('string')
    hold = true
    const first = engine.setInstrument('bar')
    const second = engine.setInstrument('string') // changes mind before bar has loaded
    await settle()
    pending.forEach((resolve) => resolve())
    await Promise.all([first, second])
    expect(liveNodes()).toBe(1) // exactly one live node
    // The latest request wins, whichever load finished last.
    engine.play(2)
    expect(params.map(([path]) => path)).toEqual(['/string/fret', '/string/pluck'])
  })

  test('switching while suspended works and stays suspended', async () => {
    const { engine, statuses } = recordingEngine()
    await engine.start('string')
    await engine.suspend()
    await engine.setInstrument('wood')
    expect(statuses.at(-1)).toBe('suspended:wood')
    await engine.resume()
    expect(statuses.at(-1)).toBe('running:wood')
    expect(liveNodes()).toBe(1)
  })
})

describe('start, stop and cleanup', () => {
  test('start sets up every instrument once and connects only the selected one', async () => {
    const { engine, statuses } = recordingEngine()
    await engine.start('glass')
    // One node per model was created; the three not selected were discarded
    // without ever reaching the output.
    expect(made).toMatchObject({ contexts: 1, nodes: 4, destroyed: 3 })
    expect(events.filter((e) => e.startsWith('connect'))).toEqual(['connect glass'])
    expect(events.filter((e) => e.startsWith('destroy')).sort()).toEqual(['destroy bar', 'destroy string', 'destroy wood'])
    // "running" is reported only once all of that is done.
    expect(statuses).toEqual(['starting', 'running:glass'])
  })

  test('dispose releases the node, the graph and the context', async () => {
    const { engine, statuses } = recordingEngine()
    await engine.start('string')
    await engine.suspend()
    await engine.dispose()
    await engine.dispose() // idempotent
    // The instrument node, the output gain and the analyser are each disconnected.
    expect(made).toMatchObject({ closed: 1, disconnects: 3 })
    expect(liveNodes()).toBe(0)
    expect(engine.analyser).toBeNull()
    expect(statuses).toEqual(['starting', 'running:string', 'suspended:string', 'stopped'])
    engine.play(3) // ignored once stopped
    expect(params).toHaveLength(0)
    const nodesBefore = made.nodes
    await engine.setInstrument('bar') // ignored once stopped
    expect(made.nodes).toBe(nodesBefore)
  })

  test('repeated initialisation creates and closes one context each time', async () => {
    const engine = new AudioEngine()
    for (let i = 0; i < 6; i++) {
      await engine.start((['string', 'bar', 'glass', 'wood'] as const)[i % 4])
      expect(liveNodes()).toBe(1)
      engine.play(i)
      await engine.dispose()
      expect(liveNodes()).toBe(0)
    }
    expect(made).toMatchObject({ contexts: 6, closed: 6, analysers: 6, gains: 6 })
    expect(made.nodes).toBe(made.destroyed)
  })

  test('starting twice at once creates a single context', async () => {
    const engine = new AudioEngine()
    await Promise.all([engine.start('string'), engine.start('bar'), engine.start('wood')])
    expect(made.contexts).toBe(1)
    expect(liveNodes()).toBe(1)
  })

  test('dispose during loading leaves nothing behind', async () => {
    const engine = new AudioEngine()
    hold = true
    const starting = engine.start('bar')
    await engine.dispose()
    pending.forEach((resolve) => resolve())
    await starting
    expect(liveNodes()).toBe(0)
    expect(made).toMatchObject({ contexts: 1, closed: 1 })
  })
})

describe('loading failures', () => {
  test('a model that fails to load at start reports the error and releases the context', async () => {
    const { engine, statuses, last } = recordingEngine()
    failNext = 'Could not load the bar model (HTTP 404)'
    await engine.start('bar')
    await settle()
    expect(statuses).toEqual(['starting', 'stopped', 'error'])
    expect(last.status).toEqual({ state: 'error', message: 'Could not load the bar model (HTTP 404)' })
    expect(made).toMatchObject({ contexts: 1, closed: 1, nodes: 0 })
    expect(engine.analyser).toBeNull()
    // Nothing is left half-open: starting again works.
    await engine.start('bar')
    expect(statuses.at(-1)).toBe('running:bar')
    expect(made).toMatchObject({ contexts: 2, closed: 1 })
    expect(liveNodes()).toBe(1)
  })

  test('a model that cannot be loaded does not stop another from starting', async () => {
    const { engine, statuses, last } = recordingEngine()
    failIds.add('glass')
    await engine.start('string')
    expect(statuses.at(-1)).toBe('running:string')
    expect(liveNodes()).toBe(1)
    // The failure surfaces when that instrument is actually selected.
    await engine.setInstrument('glass')
    await settle()
    expect(last.status).toEqual({ state: 'error', message: 'Could not load the glass model (HTTP 404)' })
    expect(liveNodes()).toBe(0)
    expect(made).toMatchObject({ contexts: 1, closed: 1 })
  })

  test('a model that fails to load while switching stops audio cleanly', async () => {
    const { engine, last } = recordingEngine()
    await engine.start('string')
    failNext = 'WebAssembly.compileStreaming(): invalid module'
    await engine.setInstrument('glass')
    await settle()
    expect(last.status).toEqual({ state: 'error', message: 'WebAssembly.compileStreaming(): invalid module' })
    expect(liveNodes()).toBe(0)
    expect(made).toMatchObject({ contexts: 1, closed: 1 })
    engine.play(0) // no node to receive it
    expect(params).toHaveLength(0)
  })
})
