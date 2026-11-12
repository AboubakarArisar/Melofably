// Lifecycle of the main-thread engine, with the Web Audio objects replaced by
// counters: repeated notes must not create nodes, switching instrument must
// swap exactly one node, and dispose must release everything. (Real playback
// is verified in the browser.)
import { beforeEach, expect, test, vi } from 'vitest'
import type { EngineStatus } from '../src/types'

const made = { contexts: 0, closed: 0, nodes: 0, destroyed: 0, analysers: 0, disconnects: 0 }
const params: [string, number][] = []
const pending: (() => void)[] = [] // node creations held back by a test

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
    destination = new FakeAudioNode()
    onstatechange: (() => void) | null = null
    constructor() {
      made.contexts++
    }
    async resume() {
      this.state = 'running'
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
let hold = false
vi.mock('../src/audio/worklet/instruments', () => ({
  MODELS: {
    string: { note: 'fret', trigger: 'pluck' },
    bar: { note: 'key', trigger: 'strike' },
    glass: { note: 'key', trigger: 'strike' },
    wood: { note: 'key', trigger: 'strike' },
  },
  createInstrumentNode: async () => {
    if (hold) await new Promise<void>((resolve) => pending.push(resolve))
    made.nodes++
    return Object.assign(new FakeAudioNode(), {
      addEventListener() {},
      setNonFiniteHandler() {},
      setParamValue: (path: string, value: number) => params.push([path, value]),
      destroy: () => made.destroyed++,
    })
  },
}))

const { AudioEngine } = await import('../src/audio/engine/AudioEngine')

beforeEach(() => {
  for (const k of Object.keys(made) as (keyof typeof made)[]) made[k] = 0
  params.length = 0
  pending.length = 0
  hold = false
})

test('repeated notes reuse one context and one node', async () => {
  const engine = new AudioEngine()
  await engine.start('string')
  await engine.start('string') // second start is a no-op
  for (let i = 0; i < 1000; i++) engine.play(i % 25)
  expect(made).toMatchObject({ contexts: 1, nodes: 1, analysers: 1 })
  // Each note is exactly two parameter writes, and every trigger value differs
  // from the one before it.
  expect(params).toHaveLength(2000)
  const plucks = params.filter(([path]) => path === '/string/pluck').map(([, v]) => v)
  expect(plucks).toHaveLength(1000)
  expect(plucks.every((v, i) => i === 0 || v !== plucks[i - 1])).toBe(true)
})

test('switching instrument swaps the one node and readdresses parameters', async () => {
  const statuses: string[] = []
  const engine = new AudioEngine((s) => statuses.push('instrument' in s ? `${s.state}:${s.instrument}` : s.state))
  await engine.start('string')
  await engine.setInstrument('bar')
  await engine.setInstrument('bar') // already loaded: no-op
  expect(made).toMatchObject({ contexts: 1, nodes: 2, destroyed: 1, analysers: 1 })
  expect(statuses).toEqual(['starting', 'running:string', 'running:bar'])
  engine.setParam('length', 0.3)
  engine.play(5)
  expect(params).toEqual([
    ['/bar/length', 0.3],
    ['/bar/key', 5],
    ['/bar/strike', 1],
  ])
  await engine.setInstrument('string')
  expect(made).toMatchObject({ contexts: 1, nodes: 3, destroyed: 2 })
})

test('cycling through all four instruments keeps one live node and one context', async () => {
  const statuses: string[] = []
  const engine = new AudioEngine((s) => statuses.push('instrument' in s ? `${s.state}:${s.instrument}` : s.state))
  await engine.start('glass')
  for (const id of ['string', 'bar', 'wood', 'glass', 'wood', 'string'] as const) {
    await engine.setInstrument(id)
    expect(made.nodes - made.destroyed, `live nodes after switching to ${id}`).toBe(1)
    params.length = 0
    engine.play(3)
    // Notes go to the instrument just selected, under its own parameter names.
    expect(params.map(([path]) => path.split('/')[1])).toEqual([id, id])
  }
  expect(made).toMatchObject({ contexts: 1, analysers: 1, nodes: 7, destroyed: 6 })
  expect(statuses.at(-1)).toBe('running:string')
})

test('a superseded instrument load is discarded', async () => {
  const engine = new AudioEngine()
  await engine.start('string')
  hold = true
  const first = engine.setInstrument('bar')
  const second = engine.setInstrument('string') // changes mind before bar has loaded
  pending.forEach((resolve) => resolve())
  await Promise.all([first, second])
  expect(made.nodes - made.destroyed).toBe(1) // exactly one live node
  // The latest request wins, whichever load finished last.
  engine.play(2)
  expect(params.map(([path]) => path)).toEqual(['/string/fret', '/string/pluck'])
})

test('dispose releases the node, the graph and the context', async () => {
  const statuses: EngineStatus['state'][] = []
  const engine = new AudioEngine((s) => statuses.push(s.state))
  await engine.start('string')
  await engine.suspend()
  await engine.dispose()
  await engine.dispose() // idempotent
  expect(made).toMatchObject({ destroyed: 1, closed: 1, disconnects: 2 })
  expect(engine.analyser).toBeNull()
  expect(statuses).toEqual(['starting', 'running', 'suspended', 'stopped'])
  engine.play(3) // ignored once stopped
  expect(params).toHaveLength(0)
  // The engine can be started again afterwards.
  await engine.start('bar')
  expect(made).toMatchObject({ contexts: 2, nodes: 2 })
})

test('dispose during loading leaves nothing behind', async () => {
  const engine = new AudioEngine()
  hold = true
  const starting = engine.start('bar')
  await engine.dispose()
  pending.forEach((resolve) => resolve())
  await starting
  expect(made.nodes - made.destroyed).toBe(0)
  expect(made).toMatchObject({ contexts: 1, closed: 1 })
})

test('non-finite parameter values never reach the DSP', async () => {
  const engine = new AudioEngine()
  await engine.start('string')
  engine.setParam('tension', NaN)
  engine.setParam('length', Infinity)
  expect(params).toHaveLength(0)
})
