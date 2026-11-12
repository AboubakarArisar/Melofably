// EXPERIMENTAL (Phase 3B). The instrument builder page: palette, canvas,
// inspector, audio controls and status. All physics is in the WebAssembly
// engine; this file only edits the graph and tells the session about it.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { BrowserBackend, type Meter } from './audio.ts'
import { Canvas, type Selection } from './Canvas.tsx'
import { EXAMPLES } from './examples.ts'
import {
  addComponent,
  cannotConnect,
  commit,
  connect,
  deserialize,
  emptyGraph,
  moveComponent,
  redo,
  removeComponent,
  removeConnection,
  serialize,
  setConnection,
  setMaterial,
  setParam,
  startHistory,
  TYPES,
  undo,
  type ComponentType,
  type Graph,
  type History,
} from './graph.ts'
import { Inspector } from './Inspector.tsx'
import { Session, type SessionState } from './session.ts'
import { CANVAS } from './shapes.ts'

const STORAGE_KEY = 'sonicmatter.builder.instrument'
/** How long to wait after the last structural edit before rebuilding, so that dragging a slider restarts the sound once. */
const REBUILD_DELAY = 250 // ms

function initialGraph(): Graph {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return deserialize(saved)
  } catch {
    // Nothing saved, storage unavailable, or a saved instrument this version cannot read: start from the first example.
  }
  return EXAMPLES[0].make()
}

type Action = { type: 'edit'; graph: Graph; key?: string } | { type: 'undo' } | { type: 'redo' }
const reducer = (h: History, action: Action): History => (action.type === 'edit' ? commit(h, action.graph, action.key, performance.now()) : action.type === 'undo' ? undo(h) : redo(h))

const button = 'rounded border border-neutral-600 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-700 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-sky-400'
const primary = 'rounded border border-sky-400 bg-sky-500 px-3 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-sky-400 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300'

export default function Builder() {
  const [history, dispatch] = useReducer(reducer, undefined, () => startHistory(initialGraph()))
  const graph = history.present
  const [selection, setSelection] = useState<Selection>(null)
  const [state, setState] = useState<SessionState>({ running: false, issues: [], notes: [], rebuilds: 0 })
  const [notice, setNotice] = useState('')
  const [failure, setFailure] = useState('')
  const [lastMeter, setMeter] = useState<Meter | null>(null)
  const [volume, setVolume] = useState(0.7)
  const [busy, setBusy] = useState(false)

  const backend = useMemo(() => new BrowserBackend(), [])
  const session = useMemo(() => new Session(backend, setState), [backend])
  const latest = useRef(graph)
  const meter = state.running ? lastMeter : null

  const edit = useCallback((next: Graph, key?: string) => dispatch({ type: 'edit', graph: next, key }), [])

  // Keep the engine in step with the graph. Live properties go at once; a
  // structural change waits for a pause, then rebuilds (the sound restarts).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, serialize(graph))
    } catch {
      // Saving is a convenience; the builder works without it.
    }
    const apply = () => {
      const outcome = session.update(graph)
      if (outcome === 'rebuilt' && session.state.rebuilds > 1) setNotice('The instrument was rebuilt, so its sound restarted.')
      else if (outcome === 'invalid') setNotice('The instrument cannot be built as it is, so it is silent. See the problems listed below.')
      else if (outcome === 'live') setNotice('Changed while sounding.')
    }
    if (!session.needsRebuild(graph)) return apply()
    const timer = setTimeout(apply, REBUILD_DELAY)
    return () => clearTimeout(timer)
  }, [graph, session])

  useEffect(() => backend.setVolume(volume), [backend, volume])
  useEffect(() => {
    if (!state.running) return
    const timer = setInterval(() => void backend.meter().then(setMeter), 250)
    return () => clearInterval(timer)
  }, [backend, state.running])
  useEffect(() => () => void session.stop(), [session])

  const start = async () => {
    setBusy(true)
    setFailure('')
    try {
      await session.start(graph)
      setNotice('Audio is on. Press Play instrument, or select a bar and strike it.')
    } catch (error) {
      setFailure(`Audio could not start: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }
  const stop = async () => {
    setBusy(true)
    await session.stop()
    setNotice('Audio is off.')
    setBusy(false)
  }
  const play = () => {
    if (!session.play()) setNotice(state.running ? 'There is nothing to play yet: add a bar.' : 'Start audio first.')
  }
  const strike = (id: string) => {
    const item = graph.components.find((c) => c.id === id)
    const played = item && TYPES[item.type].kind === 'resonator' ? session.strikeBar(id) : session.strikeExciter(id)
    if (!played) setNotice(state.running ? `${item?.name ?? 'It'} is not attached to a bar, so there is nothing to strike.` : 'Start audio first.')
  }

  const add = (type: ComponentType) => {
    // New components step across the canvas so that they do not land on top of each other.
    const n = graph.components.length
    const exciter = TYPES[type].kind === 'exciter'
    const added = addComponent(graph, type, 180 + ((n * 170) % (CANVAS.width - 360)), (exciter ? 90 : 240) + ((n * 70) % 240))
    edit(added.graph)
    setSelection({ kind: 'component', id: added.id })
  }
  const join = (from: string, to: string) => {
    const reason = cannotConnect(graph, from, to)
    if (reason) return setNotice(reason)
    const joined = connect(graph, from, to)
    edit(joined.graph)
    setSelection({ kind: 'connection', id: joined.id })
  }
  const remove = () => {
    if (!selection) return
    edit(selection.kind === 'component' ? removeComponent(graph, selection.id) : removeConnection(graph, selection.id))
    setSelection(null)
  }
  const load = (next: Graph) => {
    edit(next)
    setSelection(null)
  }

  // Keyboard: undo, redo, delete, and Space to play. Not while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        dispatch({ type: 'redo' })
      } else if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && selection && !(e.target instanceof SVGElement)) remove()
      else if (!typing && e.key === ' ' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof SVGElement)) {
        e.preventDefault()
        play()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // A selection that no longer exists (undo, load) is dropped.
  const exists = selection && (selection.kind === 'component' ? graph.components.some((c) => c.id === selection.id) : graph.connections.some((c) => c.id === selection.id))
  const current = exists ? selection : null
  const flagged = useMemo(() => new Set(state.issues.map((i) => i.id).filter((id): id is string => !!id)), [state.issues])

  // For driving the page from the developer console and from browser checks.
  useEffect(() => {
    latest.current = graph
    Object.assign(window, { sonicmatterBuilder: { session, backend, graph: () => latest.current, load } })
  })

  const load01 = meter ? Math.min(1, Math.max(0, (20 * Math.log10(Math.max(meter.peak, 1e-4) / 4) + 72) / 72)) : 0
  const cpu = meter && meter.engine.blocks ? (100 * meter.engine.busyMs) / ((meter.engine.blocks * 128 * 1000) / meter.sampleRate) : 0

  return (
    <div className="mx-auto max-w-[1500px] p-4 text-neutral-100">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Instrument builder</h1>
        <span className="rounded bg-amber-300 px-2 py-0.5 text-xs font-semibold text-neutral-950">Experimental</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label htmlFor="example" className="sr-only">
            Load an example
          </label>
          <select id="example" value="" onChange={(e) => e.target.value && load(EXAMPLES.find((x) => x.id === e.target.value)!.make())} className="rounded border border-neutral-600 bg-neutral-800 px-2 py-1.5 text-sm">
            <option value="">Load an example…</option>
            {EXAMPLES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
          <button className={button} onClick={() => load(emptyGraph())} disabled={graph.components.length === 0}>
            Clear
          </button>
          <button className={button} onClick={() => dispatch({ type: 'undo' })} disabled={history.past.length === 0} title="Ctrl+Z">
            Undo
          </button>
          <button className={button} onClick={() => dispatch({ type: 'redo' })} disabled={history.future.length === 0} title="Ctrl+Y">
            Redo
          </button>
        </div>
      </header>

      <section aria-label="Audio" className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-3">
        {state.running ? (
          <button className={button} onClick={stop} disabled={busy}>
            Stop audio
          </button>
        ) : (
          <button className={primary} onClick={start} disabled={busy}>
            Start audio
          </button>
        )}
        <button className={primary} onClick={play} disabled={!state.running || state.issues.length > 0} title="Space">
          Play instrument
        </button>
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          Volume
          <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-28 accent-sky-400" />
        </label>
        <div className="flex items-center gap-2 text-sm text-neutral-300" title="How fast the bars are moving where they are struck">
          Level
          <div className="h-2 w-32 overflow-hidden rounded bg-neutral-800" role="meter" aria-label="Output level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(load01.toFixed(2))}>
            <div className={`h-full ${meter?.overloaded ? 'bg-red-400' : meter && meter.limiting > 0.5 ? 'bg-amber-300' : 'bg-emerald-400'}`} style={{ width: `${100 * load01}%` }} />
          </div>
        </div>
        <output className="text-sm text-neutral-400">
          {state.running && meter
            ? `Audio ${meter.state} at ${meter.sampleRate} Hz · engine load ${cpu.toFixed(1)} % of one core · dropouts ${meter.underruns ?? 'not reported'} · rebuilt ${Math.max(0, state.rebuilds - 1)} times`
            : state.running
              ? 'Audio starting…'
              : 'Audio is off'}
        </output>
      </section>

      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_21rem]">
        <nav aria-label="Components to add" className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 lg:self-start">
          <h2 className="mb-2 text-base font-semibold">Add</h2>
          {(['exciter', 'resonator'] as const).map((kind) => (
            <div key={kind} className="mb-3">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{kind === 'exciter' ? 'Things that strike' : 'Things that ring'}</h3>
              <div className="flex flex-wrap gap-2 lg:flex-col">
                {(Object.keys(TYPES) as ComponentType[])
                  .filter((type) => TYPES[type].kind === kind)
                  .map((type) => (
                    <button key={type} className={`${button} text-left`} onClick={() => add(type)} title={TYPES[type].description}>
                      {TYPES[type].label}
                    </button>
                  ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-neutral-400">Springs and dampers are made by connecting two bars: drag from one bar's dot to the other.</p>
        </nav>

        <main className="min-w-0">
          <Canvas graph={graph} selection={current} flagged={flagged} onSelect={setSelection} onMove={(id, x, y) => edit(moveComponent(graph, id, x, y), `move:${id}`)} onConnect={join} onRemove={remove} />
          <div className="mt-3 space-y-2 text-sm">
            <p aria-live="polite" className="min-h-5 text-neutral-300">
              {notice}
            </p>
            {failure && (
              <p role="alert" className="rounded border border-red-400 bg-red-950 p-2 text-red-200">
                {failure}
              </p>
            )}
            {meter && meter.engine.faults > 0 && (
              <p role="alert" className="rounded border border-red-400 bg-red-950 p-2 text-red-200">
                {`The physics engine produced numbers that are not valid ${meter.engine.faults} time${meter.engine.faults === 1 ? '' : 's'} since audio started. Each time it was silenced and reset rather than played. This should not happen within the allowed property ranges: please note what you were doing.`}
              </p>
            )}
            {meter?.overloaded && (
              <p role="alert" className="rounded border border-red-400 bg-red-950 p-2 text-red-200">
                The instrument is far too loud: its output is being cut off, which distorts it. Use a lighter, softer or slower mallet.
              </p>
            )}
            {meter && !meter.overloaded && meter.limiting > 0.5 && <p className="text-amber-200">{`Loud: the limiter is turning it down by ${meter.limiting.toFixed(0)} dB. Lower the volume or strike more gently.`}</p>}
            {state.issues.length > 0 && (
              <div role="alert" className="rounded border border-red-400 bg-red-950 p-2 text-red-200">
                <p className="font-semibold">This instrument cannot be built yet:</p>
                <ul className="list-disc pl-5">
                  {state.issues.map((issue, i) => (
                    <li key={i}>{issue.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {state.notes.length > 0 && (
              <ul className="list-disc pl-5 text-neutral-400">
                {state.notes.map((note, i) => (
                  <li key={i}>{note.message}</li>
                ))}
              </ul>
            )}
          </div>
        </main>

        <Inspector
          graph={graph}
          selection={current}
          sampleRate={session.sampleRate}
          running={state.running}
          onParam={(id, key, value) => edit(setParam(graph, id, key, value), `param:${id}:${key}`)}
          onMaterial={(id, material) => edit(setMaterial(graph, id, material))}
          onConnection={(id, values) => edit(setConnection(graph, id, values), `connection:${id}:${Object.keys(values).join()}`)}
          onConnect={join}
          onRemove={remove}
          onStrike={strike}
        />
      </div>
      <footer className="mt-4 text-xs text-neutral-500">
        Every bar, mallet, spring and damper is simulated as a physical object by the experimental WebAssembly engine; connected bars move each other. Your instrument is saved in this browser as you work.
      </footer>
    </div>
  )
}
