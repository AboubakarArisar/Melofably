// EXPERIMENTAL (Phase 3B). Keeps one running engine in step with the graph:
// starts and stops it, decides whether an edit can be applied live or needs
// a rebuild, and plays it. No browser APIs here: the audio side is passed in,
// so this logic is tested in Node against the real engine.
import type { Call } from '../experimental/wasm/engine.ts'
import type { Graph, Issue } from './graph.ts'
import { barCalls, exciterCalls, instrumentCalls, liveCalls, structureKey, translate, type Built } from './translate.ts'

/** One running engine. */
export interface Voice {
  sampleRate: number
  /** Run engine functions between audio blocks. */
  send(calls: Call[]): void
  /** Replace the whole system. The sound restarts from silence. */
  rebuild(calls: Call[]): void
  close(): Promise<void>
}

export interface Backend {
  /** Create the audio output and one engine with nothing in it. */
  open(): Promise<Voice>
}

export interface SessionState {
  running: boolean
  /** Why the instrument cannot be built. Empty when it can. */
  issues: Issue[]
  /** Things worth knowing that do not stop it. */
  notes: Issue[]
  /** How many times the engine's system has been rebuilt since audio started (the first build included). */
  rebuilds: number
}

/** What an update did. */
export type Outcome = 'stopped' | 'unchanged' | 'live' | 'rebuilt' | 'invalid'

/** Sample rate assumed for checking a graph while audio is off. */
const NOMINAL_RATE = 48000

export class Session {
  private voice: Voice | null = null
  private opening: Promise<void> | null = null
  private built: Built | null = null
  /** The graph the engine currently holds. */
  private graph: Graph | null = null
  private key = ''
  state: SessionState = { running: false, issues: [], notes: [], rebuilds: 0 }
  private readonly backend: Backend
  private readonly onChange: (state: SessionState) => void

  constructor(backend: Backend, onChange: (state: SessionState) => void = () => {}) {
    this.backend = backend
    this.onChange = onChange
  }

  private set(next: Partial<SessionState>) {
    this.state = { ...this.state, ...next }
    this.onChange(this.state)
  }

  get sampleRate() {
    return this.voice?.sampleRate ?? NOMINAL_RATE
  }

  /** Start audio with this graph. Calling it again while starting or running starts nothing new. */
  start(graph: Graph): Promise<void> {
    if (this.voice) return Promise.resolve()
    this.opening ??= (async () => {
      try {
        this.voice = await this.backend.open()
        this.set({ running: true, rebuilds: 0 })
        this.update(graph)
      } finally {
        this.opening = null
      }
    })()
    return this.opening
  }

  async stop(): Promise<void> {
    if (this.opening) await this.opening.catch(() => {})
    const voice = this.voice
    if (!voice) return
    this.voice = null
    this.built = null
    this.graph = null
    this.key = ''
    this.set({ running: false })
    await voice.close()
  }

  /** Whether `graph` differs from what is running in a way that needs a rebuild. */
  needsRebuild(graph: Graph): boolean {
    return this.voice !== null && (this.built === null || structureKey(graph) !== this.key)
  }

  /**
   * Bring the engine in line with `graph`: nothing if audio is off (the graph
   * is only checked), a live edit if only live properties changed, otherwise
   * a rebuild. An invalid graph silences the engine and reports why.
   */
  update(graph: Graph): Outcome {
    const translation = translate(graph, this.sampleRate)
    if (!translation.ok) {
      if (this.voice && this.built) this.voice.rebuild([['reset', this.sampleRate, 2], ['build']])
      this.built = null
      this.graph = null
      this.key = ''
      this.set({ issues: translation.issues, notes: [] })
      return this.voice ? 'invalid' : 'stopped'
    }
    if (!this.voice) {
      this.set({ issues: [], notes: translation.built.notes })
      return 'stopped'
    }
    const key = structureKey(graph)
    if (this.built && this.graph && key === this.key) {
      const calls = liveCalls(this.graph, graph, this.built)
      this.graph = graph
      if (calls.length) this.voice.send(calls)
      this.set({ issues: [], notes: translation.built.notes })
      return calls.length ? 'live' : 'unchanged'
    }
    this.voice.rebuild(translation.built.calls)
    this.built = translation.built
    this.graph = graph
    this.key = key
    this.set({ issues: [], notes: translation.built.notes, rebuilds: this.state.rebuilds + 1 })
    return 'rebuilt'
  }

  private send(calls: Call[]): boolean {
    if (!this.voice || calls.length === 0) return false
    this.voice.send(calls)
    return true
  }

  /** Strike one bar with whatever is attached to it. False if nothing was played. */
  strikeBar(id: string): boolean {
    return this.built !== null && this.graph !== null && this.send(barCalls(this.graph, this.built, id))
  }

  /** Make one exciter strike. */
  strikeExciter(id: string): boolean {
    return this.built !== null && this.graph !== null && this.send(exciterCalls(this.graph, this.built, id))
  }

  /** Play the whole instrument. */
  play(): boolean {
    return this.built !== null && this.graph !== null && this.send(instrumentCalls(this.graph, this.built))
  }
}
