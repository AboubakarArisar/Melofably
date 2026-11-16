// EXPERIMENTAL (Phase 3B). The instrument builder page: palette, canvas,
// inspector, audio controls and status. All physics is in the WebAssembly
// engine; this file only edits the graph and tells the session about it.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { BrowserBackend, type Meter } from './audio.ts'
import { Canvas, type Selection } from './Canvas.tsx'
import { EXAMPLES, RADIATION_EXAMPLES, STRING_EXAMPLES } from './examples.ts'
import {
  addComponent,
  cannotAdd,
  cannotConnect,
  commit,
  connect,
  emptyGraph,
  moveComponent,
  redo,
  removeComponent,
  removeConnection,
  restore,
  serialize,
  setConnection,
  setMaterial,
  setParam,
  startHistory,
  TYPES,
  undo,
  validateGraph,
  type ComponentType,
  type Graph,
  type History,
} from './graph.ts'
import { Inspector } from './Inspector.tsx'
import { Session, type SessionState } from './session.ts'
import { freeSpot } from './shapes.ts'

const STORAGE_KEY = 'sonicmatter.builder.instrument'
/** How long to wait after the last structural edit before rebuilding, so that dragging a slider restarts the sound once. */
const REBUILD_DELAY = 250 // ms

/** The instrument saved in this browser, or the first example; with the reason if a saved one could not be used. */
function initial(): { graph: Graph; problem?: string } {
  let saved: string | null = null
  try {
    saved = localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage is unavailable (private window, blocked): the builder works without it.
  }
  const restored = restore(saved)
  return { graph: restored.graph ?? EXAMPLES[0].make(), problem: restored.problem }
}
const INITIAL = initial()

type Action = { type: 'edit'; graph: Graph; key?: string } | { type: 'undo' } | { type: 'redo' }
const reducer = (h: History, action: Action): History => (action.type === 'edit' ? commit(h, action.graph, action.key, performance.now()) : action.type === 'undo' ? undo(h) : redo(h))

const button = 'rounded border border-neutral-600 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-700 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-sky-400'
const primary = 'rounded border border-sky-400 bg-sky-500 px-3 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-sky-400 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300'

export default function Builder({ onOpenHybrid }: { onOpenHybrid?: (choice: string) => void } = {}) {
  const [history, dispatch] = useReducer(reducer, INITIAL.graph, startHistory)
  const graph = history.present
  const [selection, setSelection] = useState<Selection>(null)
  const [state, setState] = useState<SessionState>({ running: false, issues: [], notes: [], rebuilds: 0 })
  const [notice, setNotice] = useState(INITIAL.problem ? `The instrument saved in this browser could not be used, so the first example was loaded instead. ${INITIAL.problem}` : '')
  const [struck, setStruck] = useState<{ ids: string[]; n: number }>({ ids: [], n: 0 })
  const [failure, setFailure] = useState('')
  const [lastMeter, setMeter] = useState<Meter | null>(null)
  const [volume, setVolume] = useState(0.7)
  const [busy, setBusy] = useState(false)

  const backend = useMemo(() => new BrowserBackend(), [])
  const session = useMemo(() => new Session(backend, setState), [backend])
  const latest = useRef(graph)
  const [dropoutRate, setDropoutRate] = useState(0)
  const dropoutWindow = useRef<{ count: number; time: number } | null>(null)
  const meter = state.running ? lastMeter : null

  const edit = useCallback((next: Graph, key?: string) => dispatch({ type: 'edit', graph: next, key }), [])

  // Keep the engine in step with the graph. Live properties go at once; a
  // structural change waits for a pause, then rebuilds (the sound restarts).
  useEffect(() => {
    // Only an instrument that can be loaded again is saved: a broken one must never replace a good one.
    if (validateGraph(graph).length === 0) {
      try {
        localStorage.setItem(STORAGE_KEY, serialize(graph))
      } catch {
        // Saving is a convenience; the builder works without it.
      }
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
    const timer = setInterval(
      () =>
        void backend.meter().then((next) => {
          setMeter(next)
          // The browser refreshes its dropout count about once a second: compare readings two seconds apart.
          const now = performance.now()
          const seen = dropoutWindow.current
          if (next && next.underruns !== null && (seen === null || now - seen.time >= 2000)) {
            if (seen) setDropoutRate((1000 * (next.underruns - seen.count)) / (now - seen.time))
            dropoutWindow.current = { count: next.underruns, time: now }
          }
        }),
      250,
    )
    return () => {
      clearInterval(timer)
      dropoutWindow.current = null // the next context counts from zero
      setDropoutRate(0)
    }
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
  /** Flash the bars that were just struck. */
  const flash = (ids: string[]) => setStruck((s) => ({ ids, n: s.n + 1 }))
  const targets = (exciters: Graph['components']) => graph.connections.filter((c) => c.type === 'strike' && exciters.some((e) => e.id === c.from)).map((c) => c.to)
  const play = () => {
    if (!session.play()) return setNotice(state.running ? 'There is nothing to play yet: add a bar.' : 'Start audio first.')
    const struckBars = targets(graph.components)
    flash(struckBars.length ? struckBars : graph.components.filter((c) => TYPES[c.type].kind === 'resonator' || TYPES[c.type].kind === 'string').map((c) => c.id))
  }
  const strike = (id: string) => {
    const item = graph.components.find((c) => c.id === id)
    if (!item) return
    if (TYPES[item.type].kind === 'listener') return play()
    const bar = TYPES[item.type].kind !== 'exciter'
    const played = bar ? session.strikeBar(id) : session.strikeExciter(id)
    // Plucking shows on the string, whether the string or its body was asked.
    const strings = graph.components.filter((c) => TYPES[c.type].kind === 'string').map((c) => c.id)
    if (played) flash(TYPES[item.type].kind === 'body' ? strings : bar ? [id] : targets([item]))
    else setNotice(!state.running ? 'Start audio first.' : state.issues.length ? 'Fix the problems listed below first.' : `${item.name} is not attached to a bar, so there is nothing to strike. Drag from its dot to a bar.`)
  }

  // ---- Playing a string by hand (Phase 3D.1) ----
  const hasString = graph.components.some((c) => TYPES[c.type].kind === 'string')
  /** An edit that must reach the engine before what follows it (a pluck at a new point), not after the next render. */
  const now = (next: Graph, key: string) => {
    edit(next, key)
    session.update(next)
  }
  const playAt = (id: string, position: number) => {
    const string = graph.components.find((c) => c.id === id)
    if (string && string.params.pluckPosition !== position) now(setParam(graph, id, 'pluckPosition', position), `pluck-at:${id}`)
  }
  const pull = (_id: string, displacement: number) => session.pull(displacement)
  const letGo = (id: string, pulled: boolean) => {
    // A click plucks the string and nothing else (Play instrument also throws a mallet, if the bar has one).
    if (pulled ? session.release() : session.strikeBar(id)) flash([id])
    else setNotice(!state.running ? 'Start audio first.' : 'There is nothing to pluck yet.')
  }
  const [muting, setMuting] = useState(false)
  const mute = (on: boolean) => {
    if (on === muting) return
    setMuting(on)
    if (!session.touch(on) && on) setNotice(state.running ? 'There is no string to touch.' : 'Start audio first.')
  }

  const add = (type: ComponentType) => {
    const reason = cannotAdd(graph, type)
    if (reason) return setNotice(reason)
    const spot = freeSpot(graph, TYPES[type].kind === 'exciter')
    const added = addComponent(graph, type, spot.x, spot.y)
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
  const removeItem = (target: NonNullable<Selection>) => {
    edit(target.kind === 'component' ? removeComponent(graph, target.id) : removeConnection(graph, target.id))
    if (selection?.id === target.id) setSelection(null)
  }
  const remove = () => selection && removeItem(selection)
  const load = (next: Graph) => {
    edit(next)
    setSelection(null)
  }

  // Keyboard: undo, redo, delete, and Space to play. Not while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement
      const mod = e.ctrlKey || e.metaKey
      // In a text box, Ctrl+Z belongs to the text being typed.
      if (mod && e.target instanceof HTMLInputElement && e.target.type === 'text') return
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        dispatch({ type: 'redo' })
      } else if (e.key === 'Delete' && selection && (e.target === document.body || e.target instanceof SVGElement)) remove() // never from a button or a field
      else if (!typing && e.key === ' ' && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof SVGElement)) {
        e.preventDefault()
        play()
      } else if (!typing && !mod && e.key.toLowerCase() === 'm' && hasString && !e.repeat) mute(true) // held: the finger stays on the string
    }
    const onKeyUp = (e: KeyboardEvent) => e.key.toLowerCase() === 'm' && mute(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKeyUp)
    }
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

  const load01 = meter ? Math.min(1, Math.max(0, (20 * Math.log10(Math.max(meter.peakOfFullScale, 2.5e-5)) + 72) / 72)) : 0
  const pressure = meter?.unit === 'Pa'
  // How strongly the instrument is ringing, 0 to 1 over six decades of energy below a millijoule (a pluck is about half of one).
  const ringing = meter && hasString ? Math.min(1, Math.max(0, 1 + Math.log10(Math.max(meter.engine.energy, 1e-12) / 1e-3) / 6)) : 0
  const late = meter?.engine.slowBlocks ?? 0
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
          <select
            id="example"
            value=""
            onChange={(e) => {
              // The hybrid (a string on a bar bridge) is a different kind of instrument with its own page of the builder.
              if (e.target.value.startsWith('hybrid:')) return onOpenHybrid?.(e.target.value.slice(7))
              if (e.target.value) load([...EXAMPLES, ...STRING_EXAMPLES, ...RADIATION_EXAMPLES].find((x) => x.id === e.target.value)!.make())
            }}
            className="rounded border border-neutral-600 bg-neutral-800 px-2 py-1.5 text-sm"
          >
            <option value="">Load an example…</option>
            {EXAMPLES.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
            <optgroup label="Experimental: string and body">
              {STRING_EXAMPLES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Experimental: radiated sound">
              {RADIATION_EXAMPLES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </optgroup>
            {onOpenHybrid && (
              <optgroup label="Experimental: string on a bar bridge (opens the hybrid builder)">
                <option value="hybrid:0.20">Hybrid, string tied at 0.20 of the bar</option>
                <option value="hybrid:0.18">Hybrid, string tied at 0.18 of the bar</option>
                <option value="hybrid:saved">Your saved hybrid, if there is one</option>
              </optgroup>
            )}
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
        {hasString && (
          <button
            className={`${button} ${muting ? 'border-amber-300 bg-amber-900' : ''}`}
            disabled={!state.running}
            aria-pressed={muting}
            title="Hold down (or hold M): a finger rests on the string and damps it. Let go and the finger leaves. Pluck while holding for a short, muted note."
            onPointerDown={() => mute(true)}
            onPointerUp={() => mute(false)}
            onPointerLeave={() => mute(false)}
            onPointerCancel={() => mute(false)}
            onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && !e.repeat && mute(true)}
            onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && mute(false)}
            onBlur={() => mute(false)}
          >
            {muting ? 'Finger on the string' : 'Hold to mute'}
          </button>
        )}
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          Volume
          <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-28 accent-sky-400" />
        </label>
        <div className="flex items-center gap-2 text-sm text-neutral-300" title={pressure ? 'Sound pressure a metre away, before the volume control' : 'How fast the bars are moving where they are struck'}>
          Level
          <div className="h-2 w-32 overflow-hidden rounded bg-neutral-800" role="meter" aria-label="Output level" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(load01.toFixed(2))}>
            <div className={`h-full ${meter?.overloaded ? 'bg-red-400' : meter && meter.limiting > 0.5 ? 'bg-amber-300' : 'bg-emerald-400'}`} style={{ width: `${100 * load01}%` }} />
          </div>
        </div>
        {/* Always its own line of fixed height, so that the page does not jump when the text changes. */}
        <output className="min-h-10 basis-full text-sm text-neutral-400">
          {state.running && meter
            ? `Audio ${meter.state} at ${meter.sampleRate} Hz · engine load ${cpu.toFixed(1)} % of one core · ${late === 0 ? 'engine on time' : `engine late ${late} time${late === 1 ? '' : 's'}`} · output device dropouts: ${meter.underruns === null ? 'not reported by this browser' : dropoutRate < 0.5 ? 'none now' : `about ${Math.round(dropoutRate)} a second`} · rebuilt ${Math.max(0, state.rebuilds - 1)} times${pressure ? ` · sound pressure at 1 m: ${meter.peak < 2e-5 ? 'silent' : `${meter.peak.toPrecision(2)} Pa peak (${(20 * Math.log10(meter.peak / Math.SQRT2 / 2e-5)).toFixed(0)} dB SPL)`}` : ''}`
            : state.running
              ? 'Audio starting…'
              : 'Audio is off'}
        </output>
      </section>

      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)_21rem]">
        <nav aria-label="Components to add" className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 lg:self-start">
          <h2 className="mb-2 text-base font-semibold">Add</h2>
          {(
            [
              ['Things that strike', ['exciter']],
              ['Things that ring', ['resonator']],
              ['String instrument (experimental)', ['string', 'body']],
              ['Listening (experimental)', ['listener']],
            ] as const
          ).map(([title, kinds]) => (
            <div key={title} className="mb-3">
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">{title}</h3>
              <div className="flex flex-wrap gap-2 lg:flex-col">
                {(Object.keys(TYPES) as ComponentType[])
                  .filter((type) => (kinds as readonly string[]).includes(TYPES[type].kind))
                  .map((type) => {
                    // What cannot be added still explains why when pressed, rather than doing nothing.
                    const reason = cannotAdd(graph, type)
                    return (
                      <button key={type} className={`${button} text-left ${reason ? 'opacity-45' : ''}`} onClick={() => add(type)} aria-disabled={reason !== null} title={reason ?? TYPES[type].description}>
                        {TYPES[type].label}
                      </button>
                    )
                  })}
              </div>
            </div>
          ))}
          <p className="text-xs text-neutral-400">Springs and dampers are made by connecting two bars: drag from one bar's dot to the other. A string is stood on its body the same way. One string and one body make an instrument; they cannot be mixed with bars yet.</p>
        </nav>

        <main className="min-w-0">
          <Canvas
            graph={graph}
            selection={current}
            flagged={flagged}
            struck={struck}
            onSelect={setSelection}
            onMove={(id, x, y) => edit(moveComponent(graph, id, x, y), `move:${id}`)}
            onConnect={join}
            onRemoveComponent={(id) => removeItem({ kind: 'component', id })}
            onStrike={strike}
            ringing={ringing}
            onPlayAt={playAt}
            onPull={pull}
            onLetGo={letGo}
          />
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
                {pressure ? 'The instrument is far too loud: its output is being cut off, which distorts it. Pluck more gently.' : 'The instrument is far too loud: its output is being cut off, which distorts it. Use a lighter, softer or slower mallet.'}
              </p>
            )}
            {meter && dropoutRate >= 1 && late === 0 && (
              <p className="text-neutral-400">
                The browser is reporting dropouts on the audio output device. They do not come from this instrument: the engine is finishing every block of sound on time, and the same count appears with nothing playing. If you hear crackling, try another output
                device.
              </p>
            )}
            {late > 0 && <p className="text-amber-200">{`The engine took too long ${late} time${late === 1 ? '' : 's'} since audio started, which can be heard as a click. Fewer connections or mallets make it lighter.`}</p>}
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
