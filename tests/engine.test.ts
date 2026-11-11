// Lifecycle of the main-thread engine, with the Web Audio objects replaced by
// counters: repeated notes must not create nodes, and dispose must release
// everything. (Real playback is verified in the browser.)
import { beforeEach, expect, test, vi } from 'vitest'
import type { EngineStatus } from '../src/types'

const made = { contexts: 0, closed: 0, nodes: 0, destroyed: 0, analysers: 0, disconnects: 0 }
const params: [string, number][] = []

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
vi.mock('../src/audio/worklet/stringNode', () => ({
  createStringNode: async () => {
    made.nodes++
    return Object.assign(new FakeAudioNode(), {
      addEventListener() {},
      setNonFiniteHandler() {},
      setParamValue: (path: string, value: number) => params.push([path, value]),
      destroy: () => made.destroyed++,
    })
  },
}))

const { StringEngine } = await import('../src/audio/engine/StringEngine')

beforeEach(() => {
  for (const k of Object.keys(made) as (keyof typeof made)[]) made[k] = 0
  params.length = 0
})

test('repeated notes reuse one context and one node', async () => {
  const engine = new StringEngine()
  await engine.start()
  await engine.start() // second start is a no-op
  for (let i = 0; i < 1000; i++) engine.pluck(i % 25)
  expect(made).toMatchObject({ contexts: 1, nodes: 1, analysers: 1 })
  // Each note is exactly two parameter writes, and every pluck value differs
  // from the one before it.
  expect(params).toHaveLength(2000)
  const plucks = params.filter(([path]) => path === '/string/pluck').map(([, v]) => v)
  expect(plucks.every((v, i) => i === 0 || v !== plucks[i - 1])).toBe(true)
})

test('dispose releases the node, the graph and the context', async () => {
  const statuses: EngineStatus['state'][] = []
  const engine = new StringEngine((s) => statuses.push(s.state))
  await engine.start()
  await engine.suspend()
  await engine.dispose()
  await engine.dispose() // idempotent
  expect(made).toMatchObject({ destroyed: 1, closed: 1, disconnects: 2 })
  expect(engine.analyser).toBeNull()
  expect(statuses).toEqual(['starting', 'running', 'suspended', 'stopped'])
  engine.pluck(3) // ignored once stopped
  expect(params).toHaveLength(0)
  // The engine can be started again afterwards.
  await engine.start()
  expect(made).toMatchObject({ contexts: 2, nodes: 2 })
})

test('non-finite parameter values never reach the DSP', async () => {
  const engine = new StringEngine()
  await engine.start()
  engine.setParam('tension', NaN)
  engine.setParam('length', Infinity)
  expect(params).toHaveLength(0)
})
