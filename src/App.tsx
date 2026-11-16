import { ArrowRight, Link2, Pause, Play, Power, RotateCcw, Square } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { AudioEngine } from './audio/engine/AudioEngine'
import { instrumentParams, preloadInstruments } from './audio/worklet/instruments'
import { Keyboard } from './components/controls/Keyboard'
import { ParamSlider } from './components/controls/ParamSlider'
import { Visualizer } from './components/visualization/Visualizer'
import { readLink, sanitize, writeLink } from './instrumentLink'
import { defaultValues, IDS, INSTRUMENTS, withValue, type AllValues } from './instrumentUI'
import { copy, forgetLink } from './ui/share'
import { Shell } from './ui/Shell'
import type { EngineStatus, InstrumentId } from './types'
const STATUS_TEXT: Record<EngineStatus['state'], string> = {
  stopped: 'Audio is off. Press Start Audio.',
  starting: 'Starting audio…',
  running: 'Running',
  suspended: 'Suspended. Press Resume.',
  error: 'Error',
}

const STORAGE_KEY = 'melofably.instruments'

/** Where the page starts: the instrument a link names, with the settings it carries, over what this browser remembers, over the defaults. */
function initial(): { instrument: InstrumentId; values: AllValues } {
  const values = defaultValues()
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (stored && typeof stored === 'object') for (const id of IDS) values[id] = sanitize((stored as Record<string, unknown>)[id], instrumentParams[id], values[id])
  } catch {
    // Nothing usable is stored, or storage is unavailable: the defaults stand.
  }
  const link = readLink(location.hash, IDS, instrumentParams, defaultValues())
  if (link?.values) {
    values[link.id] = link.values
    forgetLink(`#${link.id}`) // read once: a reload must not put the link's settings back over later changes
  }
  return { instrument: link?.id ?? 'string', values }
}

// Worked out once, when the page loads: reading a link also takes its settings out of the address.
const START = initial()

export default function App() {
  const [status, setStatus] = useState<EngineStatus>({ state: 'stopped' })
  const [engine] = useState(() => new AudioEngine(setStatus))
  const [instrument, setInstrument] = useState<InstrumentId>(START.instrument)
  // Each instrument keeps its own control values while another is selected, and this browser remembers them.
  const [allValues, setAllValues] = useState(START.values)
  const [note, setNote] = useState<number | null>(null)

  useEffect(() => {
    // Compile and warm up every model now, before audio is started, so that
    // none of that work coincides with sound that is already playing.
    void preloadInstruments()
    // Development only: lets the live engine be inspected from the console.
    if (import.meta.env.DEV) Object.assign(window, { sonicmatter: engine })
    return () => void engine.dispose()
  }, [engine])

  const ui = INSTRUMENTS[instrument]
  const params = instrumentParams[instrument]
  const values = allValues[instrument]
  const { state } = status
  // Playable once the selected instrument's own node is live.
  const live = status.state === 'running' && status.instrument === instrument

  // Send the control values to the DSP whenever they change, audio (re)starts,
  // or the instrument's node has just been swapped in.
  useEffect(() => {
    if (live) for (const [key, value] of Object.entries(values)) engine.setParam(key, value)
  }, [engine, live, values])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allValues))
    } catch {
      // Remembering is a convenience; the page works without it.
    }
  }, [allValues])

  const changed = Object.keys(values).some((key) => values[key] !== params[key].init)
  const reset = () => {
    setAllValues((prev) => ({ ...prev, [instrument]: defaultValues()[instrument] }))
    toast.success(`${ui.label} is back to its defaults`)
  }
  const share = async () => {
    const url = `${location.origin}${location.pathname}${writeLink(instrument, values, params)}`
    if (await copy(url)) toast.success('Link copied. It opens this instrument with these settings.')
    else toast.error('The browser would not copy the link. It is in the address bar instead.')
    history.replaceState(null, '', url)
  }

  const play = useCallback(
    (n: number) => {
      setNote(n)
      engine.play(n)
    },
    [engine],
  )

  const select = (id: InstrumentId) => {
    setInstrument(id)
    setNote(null)
    void engine.setInstrument(id)
  }

  const frequencyOf = (n: number) => ui.frequency(values, n)

  // The controls in three groups, by what they do to the instrument. Every control is in exactly one.
  const group = (key: string) => (/body|resonator/.test(key) ? 2 : /pluck|strike|hardness|velocity|strength|brightness|softness/.test(key) ? 1 : 0)
  const sections = [
    { title: 'Physical properties', hint: 'What the instrument is made of' },
    { title: 'Tone and excitation', hint: 'How it is set in motion' },
    { title: 'Resonance', hint: 'What rings along with it' },
  ]
    .map((s, n) => ({ ...s, controls: ui.controls.filter((c) => group(c.key) === n) }))
    .filter((s) => s.controls.length)
  return (
    <Shell current="instruments">
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:py-8">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="mr-auto">
            <p className="m-eyebrow">Instruments</p>
            <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-[-0.035em]">{ui.label}</h1>
          </div>
          <p role="status" className="m-chip py-1.5">
            <span className={`h-2 w-2 rounded-full ${live ? 'bg-emerald-500' : state === 'error' ? 'bg-red-400' : 'bg-neutral-600'}`} />
            {state === 'running' && !live ? `Loading ${ui.label}…` : STATUS_TEXT[state]}
            {live && engine.analyser && ` at ${engine.analyser.context.sampleRate} Hz`}
          </p>
          {state === 'stopped' || state === 'error' ? (
            <button type="button" className="m-btn m-btn-primary" onClick={() => void engine.start(instrument)}>
              <Power aria-hidden="true" />
              Start Audio
            </button>
          ) : (
            <div className="flex gap-2">
              <button type="button" className="m-btn" disabled={state === 'starting'} onClick={() => void (state === 'running' ? engine.suspend() : engine.resume())}>
                {state === 'running' ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                {state === 'running' ? 'Suspend' : 'Resume'}
              </button>
              <button type="button" className="m-btn" onClick={() => void engine.dispose()}>
                <Square aria-hidden="true" />
                Stop
              </button>
            </div>
          )}
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <div role="radiogroup" aria-label="Instrument" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-neutral-800 p-1 [scrollbar-width:none]">
            {IDS.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={id === instrument} onClick={() => select(id)} className={`border px-3.5 text-sm ${id === instrument ? 'border-neutral-700 bg-neutral-900 text-neutral-100 shadow-sm' : 'border-transparent text-neutral-400 hover:text-neutral-100'}`} style={{ minHeight: 36 }}>
                {INSTRUMENTS[id].label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" className="m-btn" onClick={reset} disabled={!changed} title="Put every control of this instrument back to its default">
              <RotateCcw aria-hidden="true" />
              Reset
            </button>
            <button type="button" className="m-btn" onClick={() => void share()} title="Copy a link that opens this instrument with these settings">
              <Link2 aria-hidden="true" />
              Share
            </button>
          </div>
          <a className="m-btn m-btn-ghost" href="/builder.html">
            Build your own <ArrowRight aria-hidden="true" size={16} />
          </a>
        </div>

        {status.state === 'error' && (
          <p role="alert" className="rounded-xl border border-red-800 bg-red-950 p-3 text-sm text-red-300">
            {status.message}
          </p>
        )}

        <dl aria-label="Calculated pitch" className="grid gap-3 sm:grid-cols-3">
          {ui.readouts(values, note).map((r) => (
            <div key={r.label} className="m-metric">
              <dt>{r.label}</dt>
              <dd>{r.value}</dd>
            </div>
          ))}
        </dl>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_21rem] xl:grid-cols-[minmax(0,1fr)_23rem]">
          <div className="min-w-0 space-y-5">
            <section aria-label="Playing surface" className="m-panel p-4 sm:p-5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-bold">Play</h2>
                <p className="text-sm text-neutral-400">{live ? 'Click the keys, or press the letters shown on them.' : 'Start audio to play.'}</p>
              </div>
              <Keyboard disabled={!live} active={note} noteName={ui.noteName} frequencyOf={frequencyOf} onPlay={play} />
            </section>
            <section aria-label="Sound" className="m-panel p-4 sm:p-5">
              <h2 className="mb-3 text-lg font-bold">Waveform and spectrum</h2>
              <Visualizer analyser={engine.analyser} fundamental={frequencyOf(note ?? 0)} />
            </section>
          </div>

          <aside aria-label={`${ui.label} controls`} className="m-panel divide-y divide-neutral-700">
            {sections.map((s) => (
              <section key={s.title} className="space-y-4 p-5">
                <div>
                  <h2 className="text-[1.0625rem] font-bold">{s.title}</h2>
                  <p className="text-sm text-neutral-400">{s.hint}</p>
                </div>
                {s.controls.map(({ key, label }) => (
                  <ParamSlider key={`${instrument}/${key}`} param={params[key]} label={label} value={values[key]} onChange={(v) => setAllValues((prev) => withValue(prev, instrument, key, v))} />
                ))}
              </section>
            ))}
          </aside>
        </div>
      </main>
    </Shell>
  )
}