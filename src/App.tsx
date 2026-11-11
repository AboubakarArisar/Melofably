import { useCallback, useEffect, useState } from 'react'
import { stringFundamental } from './audio/engine/physics'
import { StringEngine } from './audio/engine/StringEngine'
import { stringParams } from './audio/worklet/stringNode'
import { Keyboard } from './components/controls/Keyboard'
import { ParamSlider } from './components/controls/ParamSlider'
import { Visualizer } from './components/visualization/Visualizer'
import type { EngineStatus } from './types'

// Ranges, defaults and units come from the compiled Faust model (stringParams).
const CONTROLS = [
  { key: 'length', label: 'String length' },
  { key: 'tension', label: 'Tension' },
  { key: 'density', label: 'Linear density' },
  { key: 'damping', label: 'Damping' },
  { key: 'pluckPosition', label: 'Pluck position' },
  { key: 'strength', label: 'Excitation strength' },
]

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
  const [engine] = useState(() => new StringEngine(setStatus))
  const [values, setValues] = useState(() =>
    Object.fromEntries(CONTROLS.map((c) => [c.key, stringParams[c.key].init])),
  )
  const [fret, setFret] = useState<number | null>(null)

  useEffect(() => () => void engine.dispose(), [engine])
  const { state } = status
  const running = state === 'running'

  // Send the control values to the DSP whenever they change or audio (re)starts.
  useEffect(() => {
    if (running) for (const [key, value] of Object.entries(values)) engine.setParam(key, value)
  }, [engine, running, values])

  const pluck = useCallback(
    (f: number) => {
      setFret(f)
      engine.pluck(f)
    },
    [engine],
  )

  const frequencyOf = (f: number) => stringFundamental(values.tension, values.density, values.length, f)

  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-6 p-6 font-mono text-sm text-neutral-200">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-lg font-semibold">SonicMatter · plucked string</h1>
        {state === 'stopped' || state === 'error' ? (
          <button type="button" className={`${button} border-emerald-500 text-emerald-300`} onClick={() => void engine.start()}>
            Start Audio
          </button>
        ) : (
          <>
            <button
              type="button"
              className={button}
              disabled={state === 'starting'}
              onClick={() => void (running ? engine.suspend() : engine.resume())}
            >
              {running ? 'Suspend' : 'Resume'}
            </button>
            <button type="button" className={button} onClick={() => void engine.dispose()}>
              Stop
            </button>
          </>
        )}
      </header>

      <p role="status" className={running ? 'text-emerald-400' : 'text-neutral-400'}>
        {STATUS_TEXT[state]}
        {running && engine.analyser && ` at ${engine.analyser.context.sampleRate} Hz`}
      </p>
      {status.state === 'error' && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 p-3 text-red-300">
          {status.message}
        </p>
      )}

      <section aria-label="Calculated pitch" className="grid gap-4 sm:grid-cols-3">
        <Readout label="Open string, f = √(T/μ) / 2L" value={`${frequencyOf(0).toFixed(2)} Hz`} />
        <Readout
          label={fret === null ? 'Last note' : `Last note (fret ${fret})`}
          value={fret === null ? '—' : `${frequencyOf(fret).toFixed(2)} Hz`}
        />
        <Readout label="Wave speed, √(T/μ)" value={`${Math.sqrt(values.tension / values.density).toFixed(1)} m/s`} />
      </section>

      <section aria-label="String controls" className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        {CONTROLS.map(({ key, label }) => (
          <ParamSlider
            key={key}
            param={stringParams[key]}
            label={label}
            value={values[key]}
            onChange={(v) => setValues((prev) => ({ ...prev, [key]: v }))}
          />
        ))}
      </section>

      <Keyboard disabled={!running} active={fret} frequencyOf={frequencyOf} onPluck={pluck} />

      <Visualizer analyser={engine.analyser} fundamental={frequencyOf(fret ?? 0)} />
    </main>
  )
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-neutral-800 p-3">
      <div className="text-neutral-400">{label}</div>
      <div className="text-xl text-neutral-100 tabular-nums">{value}</div>
    </div>
  )
}
