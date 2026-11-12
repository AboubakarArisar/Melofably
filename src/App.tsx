import { useCallback, useEffect, useState } from 'react'
import { AudioEngine } from './audio/engine/AudioEngine'
import {
  BAR_MODE_K,
  barModeFrequencies,
  glassModeFrequencies,
  stringFundamental,
  woodDecayTime,
  type BarParams,
  type GlassParams,
} from './audio/engine/physics'
import { instrumentParams } from './audio/worklet/instruments'
import { Keyboard } from './components/controls/Keyboard'
import { ParamSlider } from './components/controls/ParamSlider'
import { Visualizer } from './components/visualization/Visualizer'
import type { EngineStatus, InstrumentId } from './types'

type Values = Record<string, number>
interface Readout {
  label: string
  value: string
}
interface InstrumentUI {
  label: string
  /** What a key selects, for labels: a fret of the string, a bar of the set. */
  noteName: string
  /** Slider ranges, defaults and units come from the compiled Faust model. */
  controls: { key: string; label: string }[]
  /** Calculated frequency in Hz of note `note` (its lowest mode). */
  frequency: (v: Values, note: number) => number
  readouts: (v: Values, note: number | null) => Readout[]
}

const hz = (f: number) => `${f.toFixed(2)} Hz`
const barFrequency = (v: Values, note: number) => barModeFrequencies(v as unknown as BarParams, note)[0]
// The first entry is the (2,0) mode, always the lowest.
const glassFrequency = (v: Values, note: number) => glassModeFrequencies(v as unknown as GlassParams, note)[0]

const INSTRUMENTS: Record<InstrumentId, InstrumentUI> = {
  string: {
    label: 'String',
    noteName: 'fret',
    controls: [
      { key: 'length', label: 'String length' },
      { key: 'tension', label: 'Tension' },
      { key: 'density', label: 'Linear density' },
      { key: 'damping', label: 'Damping' },
      { key: 'pluckPosition', label: 'Pluck position' },
      { key: 'strength', label: 'Excitation strength' },
      { key: 'brightness', label: 'Tone brightness' },
      { key: 'softness', label: 'Attack softness' },
      { key: 'body', label: 'Body resonance' },
    ],
    frequency: (v, note) => stringFundamental(v.tension, v.density, v.length, note),
    readouts: (v, note) => [
      { label: 'Open string, f = √(T/μ) / 2L', value: hz(stringFundamental(v.tension, v.density, v.length)) },
      {
        label: note === null ? 'Last note' : `Last note (fret ${note})`,
        value: note === null ? '—' : hz(stringFundamental(v.tension, v.density, v.length, note)),
      },
      { label: 'Wave speed, √(T/μ)', value: `${Math.sqrt(v.tension / v.density).toFixed(1)} m/s` },
    ],
  },
  bar: {
    label: 'Metal Bar',
    noteName: 'bar',
    controls: [
      { key: 'length', label: 'Bar length (longest bar)' },
      { key: 'thickness', label: 'Thickness' },
      { key: 'density', label: 'Density' },
      { key: 'youngsModulus', label: "Young's modulus" },
      { key: 'lossFactor', label: 'Internal damping (loss factor)' },
      { key: 'strikePosition', label: 'Strike position (0 end, 0.5 middle)' },
      { key: 'hardness', label: 'Mallet hardness' },
      { key: 'velocity', label: 'Strike velocity' },
    ],
    frequency: barFrequency,
    readouts: (v, note) => [
      { label: 'Longest bar, mode 1 = k₁²h/(2πL²)·√(E/12ρ)', value: hz(barFrequency(v, 0)) },
      {
        label: note === null ? 'Last bar struck' : `Last bar struck (bar ${note})`,
        value: note === null ? '—' : hz(barFrequency(v, note)),
      },
      {
        label: 'Mode ratios (free-free beam)',
        value: BAR_MODE_K.slice(0, 4)
          .map((k) => ((k / BAR_MODE_K[0]) ** 2).toFixed(2))
          .join(' : '),
      },
    ],
  },
  wood: {
    label: 'Wooden Bar',
    noteName: 'bar',
    controls: [
      { key: 'length', label: 'Bar length (longest bar)' },
      { key: 'thickness', label: 'Thickness' },
      { key: 'density', label: 'Wood density' },
      { key: 'youngsModulus', label: "Stiffness along the grain (Young's modulus)" },
      { key: 'lossFactor', label: 'Internal damping (loss factor at 1 kHz)' },
      { key: 'strikePosition', label: 'Strike position (0 end, 0.5 middle)' },
      { key: 'hardness', label: 'Mallet hardness' },
      { key: 'velocity', label: 'Strike velocity' },
      { key: 'resonator', label: 'Resonator tubes' },
    ],
    // The same beam equation as the metal bar; only the material differs.
    frequency: barFrequency,
    readouts: (v, note) => [
      { label: 'Longest bar, mode 1 = k₁²h/(2πL²)·√(E/12ρ)', value: hz(barFrequency(v, 0)) },
      {
        label: note === null ? 'Last bar struck' : `Last bar struck (bar ${note})`,
        value: note === null ? '—' : hz(barFrequency(v, note)),
      },
      {
        label: 'Decay time (60 dB) of modes 1, 2, 3',
        value: barModeFrequencies(v as unknown as BarParams, note ?? 0)
          .slice(0, 3)
          .map((f) => `${Math.round(1000 * woodDecayTime(f, v.lossFactor))}`)
          .join(' / ')
          .concat(' ms'),
      },
    ],
  },
  glass: {
    label: 'Glass Vessel',
    noteName: 'vessel',
    controls: [
      { key: 'diameter', label: 'Diameter (largest vessel)' },
      { key: 'height', label: 'Height (largest vessel)' },
      { key: 'thickness', label: 'Wall thickness' },
      { key: 'youngsModulus', label: "Glass stiffness (Young's modulus)" },
      { key: 'density', label: 'Glass density' },
      { key: 'lossFactor', label: 'Material damping (loss factor)' },
      { key: 'strikeHeight', label: 'Strike height (0 base, 1 rim)' },
      { key: 'hardness', label: 'Striker hardness' },
      { key: 'velocity', label: 'Strike velocity' },
    ],
    frequency: glassFrequency,
    readouts: (v, note) => {
      const modes = glassModeFrequencies(v as unknown as GlassParams).sort((a, b) => a - b)
      return [
        { label: 'Largest vessel, mode (2,0)', value: hz(glassFrequency(v, 0)) },
        {
          label: note === null ? 'Last vessel struck' : `Last vessel struck (vessel ${note})`,
          value: note === null ? '—' : hz(glassFrequency(v, note)),
        },
        {
          label: 'Lowest mode ratios (depend on diameter/height)',
          value: modes
            .slice(0, 4)
            .map((f) => (f / modes[0]).toFixed(2))
            .join(' : '),
        },
      ]
    },
  },
}
const IDS: InstrumentId[] = ['string', 'bar', 'glass', 'wood'] // selector order

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
  // Each instrument keeps its own control values while the other is selected.
  const [allValues, setAllValues] = useState(() =>
    Object.fromEntries(
      IDS.map((id) => [id, Object.fromEntries(INSTRUMENTS[id].controls.map((c) => [c.key, instrumentParams[id][c.key].init]))]),
    ) as Record<InstrumentId, Values>,
  )
  const [note, setNote] = useState<number | null>(null)

  useEffect(() => {
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
            onChange={(v) => setAllValues((prev) => ({ ...prev, [instrument]: { ...prev[instrument], [key]: v } }))}
          />
        ))}
      </section>

      <Keyboard disabled={!live} active={note} noteName={ui.noteName} frequencyOf={frequencyOf} onPlay={play} />

      <Visualizer analyser={engine.analyser} fundamental={frequencyOf(note ?? 0)} />
    </main>
  )
}
