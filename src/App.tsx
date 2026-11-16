import { ArrowRight, Pause, Play, Power, Square } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { AudioEngine } from './audio/engine/AudioEngine'
import { instrumentParams, preloadInstruments } from './audio/worklet/instruments'
import { Keyboard } from './components/controls/Keyboard'
import { ParamSlider } from './components/controls/ParamSlider'
import { Visualizer } from './components/visualization/Visualizer'
import { defaultValues, IDS, INSTRUMENTS, withValue } from './instrumentUI'
import { Shell } from './ui/Shell'
import type { EngineStatus, InstrumentId } from './types'
const STATUS_TEXT: Record<EngineStatus['state'], string> = {
  stopped: 'Audio is off. Press Start Audio.',
  starting: 'Starting audio…',
  running: 'Running',
  suspended: 'Suspended. Press Resume.',
  error: 'Error',
}

export default function App() {
  const [status, setStatus] = useState<EngineStatus>({ state: 'stopped' })
  const [engine] = useState(() => new AudioEngine(setStatus))
  const [instrument, setInstrument] = useState<InstrumentId>(() => IDS.find((id) => `#${id}` === location.hash) ?? 'string')
  // Each instrument keeps its own control values while another is selected.
  const [allValues, setAllValues] = useState(defaultValues)
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
            <p className="m-eyebrow">Instrument studio</p>
            <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-tight">{ui.label}</h1>
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
          <a className="m-btn m-btn-ghost ml-auto" href="/builder.html">
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