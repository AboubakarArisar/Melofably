import { useCallback, useEffect, useState } from 'react'
import { AudioEngine } from './audio/engine/AudioEngine'
import { instrumentParams, preloadInstruments } from './audio/worklet/instruments'
import { Keyboard } from './components/controls/Keyboard'
import { ParamSlider } from './components/controls/ParamSlider'
import { Visualizer } from './components/visualization/Visualizer'
import { defaultValues, IDS, INSTRUMENTS, withValue } from './instrumentUI'
import type { EngineStatus, InstrumentId } from './types'
const STATUS_TEXT: Record<EngineStatus['state'], string> = {
  stopped: 'Audio is off. Press Start Audio.',
  starting: 'Starting audio…',
  running: 'Running',
  suspended: 'Suspended. Press Resume.',
  error: 'Error',
}

const button =
  'rounded border border-neutral-700 px-3 py-1.5 hover:bg-neutral-800 disabled:opacity-40 disabled:hover:bg-transparent'

export default function App() {
  const [status, setStatus] = useState<EngineStatus>({ state: 'stopped' })
  const [engine] = useState(() => new AudioEngine(setStatus))
  const [instrument, setInstrument] = useState<InstrumentId>('string')
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

  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-6 p-6 font-mono text-sm text-neutral-200">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-lg font-semibold">SonicMatter</h1>
        <label className="flex items-center gap-2 text-neutral-400">
          Instrument
          <select
            className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-neutral-100"
            value={instrument}
            onChange={(e) => select(e.target.value as InstrumentId)}
          >
            {IDS.map((id) => (
              <option key={id} value={id}>
                {INSTRUMENTS[id].label}
              </option>
            ))}
          </select>
        </label>
        {state === 'stopped' || state === 'error' ? (
          <button
            type="button"
            className={`${button} border-emerald-500 text-emerald-300`}
            onClick={() => void engine.start(instrument)}
          >
            Start Audio
          </button>
        ) : (
          <>
            <button
              type="button"
              className={button}
              disabled={state === 'starting'}
              onClick={() => void (state === 'running' ? engine.suspend() : engine.resume())}
            >
              {state === 'running' ? 'Suspend' : 'Resume'}
            </button>
            <button type="button" className={button} onClick={() => void engine.dispose()}>
              Stop
            </button>
          </>
        )}
      </header>

      <p role="status" className={live ? 'text-emerald-400' : 'text-neutral-400'}>
        {state === 'running' && !live ? `Loading ${ui.label}…` : STATUS_TEXT[state]}
        {live && engine.analyser && `: ${ui.label} at ${engine.analyser.context.sampleRate} Hz`}
      </p>
      {status.state === 'error' && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 p-3 text-red-300">
          {status.message}
        </p>
      )}

      <section aria-label="Calculated pitch" className="grid gap-4 sm:grid-cols-3">
        {ui.readouts(values, note).map((r) => (
          <div key={r.label} className="rounded border border-neutral-800 p-3">
            <div className="text-neutral-400">{r.label}</div>
            <div className="text-xl text-neutral-100 tabular-nums">{r.value}</div>
          </div>
        ))}
      </section>

      <section aria-label={`${ui.label} controls`} className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {ui.controls.map(({ key, label }) => (
          <ParamSlider
            key={`${instrument}/${key}`}
            param={params[key]}
            label={label}
            value={values[key]}
            onChange={(v) => setAllValues((prev) => withValue(prev, instrument, key, v))}
          />
        ))}
      </section>

      <Keyboard disabled={!live} active={note} noteName={ui.noteName} frequencyOf={frequencyOf} onPlay={play} />

      <Visualizer analyser={engine.analyser} fundamental={frequencyOf(note ?? 0)} />
    </main>
  )
}
