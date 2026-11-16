// The hybrid instrument in the builder (MVP): an editable template of the
// one string-on-a-bar-bridge assembly a validated model exists for. Its
// parts and connections are fixed; their sizes, places and strengths are
// the user's. What it is: hybrid.ts. How it sounds: hybridAudio.ts.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { COMPONENTS, CONNECTIONS, TARGETS, type Graph } from '../experimental/graph2/model.ts'
import { validate, type Issue } from '../experimental/graph2/validate.ts'
import { FULL_SCALE, keyAction, PLUCK_FORCE, pluckLevel, STRIKE_SPEED, strikeLevel, type Strength } from '../experimental/hybrid/instrument.ts'
import { BAR_TOUCH } from '../experimental/string/stringBarBody.ts'
import { BODY } from '../experimental/string/stringBody.ts'
import { compileHybrid, HYBRID_STORAGE_KEY, hybridTemplate, IDS, openText, rename, saveText, setMaterial, setPads, setParam, setPort, setStriker, setTie } from './hybrid.ts'
import { HybridVoice, type HybridStatus } from './hybridAudio.ts'

const button = 'rounded border border-neutral-600 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-700 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-sky-400'
const primary = 'rounded border border-sky-400 bg-sky-500 px-3 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-sky-400 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300'
const held = 'border-amber-300 bg-amber-900'
const panel = 'rounded-lg border border-neutral-800 bg-neutral-900 p-3'

const stored = () => {
  try {
    return localStorage.getItem(HYBRID_STORAGE_KEY)
  } catch {
    return null // storage is unavailable: the builder works without it
  }
}

/** A number with a slider. `log`: the slider moves in equal ratios. The number shown is the number set. */
function Field({ label, unit, value, min, max, step, log, hint, onChange }: { label: string; unit?: string; value: number; min: number; max: number; step: number; log?: boolean; hint?: string; onChange: (value: number) => void }) {
  const id = `f-${label.replace(/\W+/g, '-')}`
  const shown = Math.abs(value) >= 10000 ? value.toExponential(2) : String(Number(value.toPrecision(5)))
  return (
    <label htmlFor={id} className="mb-2 block text-sm" title={hint}>
      <span className="flex justify-between gap-2">
        <span className="text-neutral-300">{label}</span>
        <output className="tabular-nums text-neutral-400">
          {shown}
          {unit ? ` ${unit}` : ''}
        </output>
      </span>
      <input
        id={id}
        type="range"
        className="w-full accent-sky-400"
        min={log ? Math.log10(min) : min}
        max={log ? Math.log10(max) : max}
        step={log ? 0.01 : step}
        value={log ? Math.log10(value) : value}
        onChange={(e) => onChange(log ? Number((10 ** Number(e.target.value)).toPrecision(3)) : Number(e.target.value))}
      />
    </label>
  )
}

// The picture: seen from above, to scale, 700 px to the metre, the board's corner at (520, 30).
const PX = 700
const BOARD = { x: 520, y: 30 }

export default function HybridBuilder({ initial, initialNotice = '', onClassic }: { initial: Graph; initialNotice?: string; onClassic: () => void }) {
  const [graph, setGraph] = useState(initial)
  const [notice, setNotice] = useState(initialNotice)
  const [failure, setFailure] = useState('')
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<HybridStatus | null>(null)
  const [volume, setVolume] = useState(0)
  const [force, setForce] = useState(PLUCK_FORCE.default)
  const [speed, setSpeed] = useState(STRIKE_SPEED.default)
  const [strength, setStrength] = useState<Strength>('medium')
  const [fingers, setFingers] = useState({ mute: false, damp: false, muteLatch: false, dampLatch: false })
  const [flash, setFlash] = useState({ string: 0, bar: 0 })
  const [savedText, setSavedText] = useState(stored)
  const voice = useRef<HybridVoice | null>(null)
  const latest = useRef(graph)

  const issues = useMemo(() => validate(graph), [graph])
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const text = useMemo(() => {
    try {
      return errors.length ? null : saveText(graph)
    } catch {
      return null
    }
  }, [graph, errors.length])
  const unsaved = text !== savedText

  const string = graph.components.find((c) => c.id === IDS.string)!
  const bar = graph.components.find((c) => c.id === IDS.bar)!
  const port = (component: typeof bar, id: string) => component.ports.find((p) => p.id === id)!.at as number
  const tie = graph.connections.find((c) => c.id === IDS.tie)!
  const pad = graph.connections.find((c) => c.id === IDS.padA)!
  const striker = graph.targets.find((t) => t.id === IDS.strike)!.striker!
  const range = (type: 'steelString' | 'metalBar', key: string) => {
    const p = COMPONENTS[type].params.find((spec) => spec.key === key)!
    return { min: p.min, max: p.max }
  }
  // What the engine is built from. A new name is not a new instrument.
  const physical = useMemo(() => JSON.stringify([graph.components, graph.connections, graph.targets]), [graph])

  const sync = useCallback(() => {
    const c = voice.current?.controls
    setFingers({ mute: !!c?.muted, damp: !!c?.damped, muteLatch: !!c?.latched('mute'), dampLatch: !!c?.latched('damp') })
  }, [])

  // Keep the engine in step with the graph: any change builds a new engine after a pause (the sound restarts).
  const built = useRef('')
  useEffect(() => {
    latest.current = graph
    const v = voice.current
    if (!v || built.current === physical) return
    built.current = physical
    const timer = setTimeout(() => {
      if (validate(graph).some((i) => i.severity === 'error')) {
        v.silence()
        sync()
        return setNotice('The instrument cannot be built as it is, so it is silent. See the problems listed below.')
      }
      v.rebuild(compileHybrid(graph, v.sampleRate))
        .then(() => {
          v.controls?.setDampStrength(strength)
          sync()
          setNotice('The instrument was rebuilt with your change, so its sound restarted.')
        })
        .catch((error) => setFailure(error instanceof Error ? error.message : String(error)))
    }, 250)
    return () => clearTimeout(timer)
    // (`strength` is applied when it changes, below; it does not rebuild anything.)
  }, [graph, physical, sync]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => void voice.current?.status().then((s) => s && setStatus(s)), 300)
    return () => clearInterval(timer)
  }, [running])
  useEffect(() => voice.current?.setGain(10 ** (volume / 20)), [volume])
  useEffect(() => () => void voice.current?.stop(), [])

  const start = async () => {
    if (voice.current) {
      await voice.current.resume()
      return
    }
    if (errors.length) return setNotice('Fix the problems listed below first.')
    setBusy(true)
    setFailure('')
    try {
      const v = await HybridVoice.start((sampleRate) => compileHybrid(latest.current, sampleRate), 10 ** (volume / 20))
      v.onError = setFailure
      v.controls?.setDampStrength(strength)
      voice.current = v
      built.current = JSON.stringify([latest.current.components, latest.current.connections, latest.current.targets])
      setRunning(true)
      setNotice('Audio is on. Pluck the string (A) or strike the bar (S).')
    } catch (error) {
      setFailure(`Audio could not start: ${error instanceof Error ? error.message : String(error)}`)
    }
    setBusy(false)
  }
  const stop = async () => {
    setBusy(true)
    const v = voice.current
    voice.current = null
    setRunning(false)
    setStatus(null)
    await v?.stop()
    sync()
    setNotice('Audio is off.')
    setBusy(false)
  }

  const playable = () => {
    const ok = !!voice.current?.controls && voice.current.running
    if (!ok) setNotice(voice.current ? 'The instrument is silent: fix the problems below, or resume audio.' : 'Start audio first.')
    return ok
  }
  const pluck = () => {
    if (!playable()) return
    voice.current!.controls!.pluck(force)
    setFlash((f) => ({ ...f, string: f.string + 1 }))
  }
  const strike = () => {
    if (!playable()) return
    voice.current!.controls!.strike(speed)
    setFlash((f) => ({ ...f, bar: f.bar + 1 }))
  }
  const finger = (which: 'mute' | 'damp', by: 'latch' | 'key', on: boolean) => {
    const c = voice.current?.controls
    if (!c || !voice.current!.running) return by === 'latch' && on ? void playable() : undefined
    c.hold(which, by, on)
    sync()
  }
  const pressStrength = (next: Strength) => {
    setStrength(next)
    voice.current?.controls?.setDampStrength(next)
  }

  // Keys, as in the Hybrid Lab: A pluck, S strike, hold M to mute the string, hold D to damp the bar.
  const act = useRef({ pluck, strike, finger })
  useEffect(() => {
    act.current = { pluck, strike, finger }
  })
  useEffect(() => {
    const down = new Set<'mute' | 'damp'>()
    const focus = (t: EventTarget | null) => (t instanceof HTMLSelectElement ? 'list' : t instanceof HTMLInputElement && t.type !== 'range' ? 'text' : 'other')
    const onDown = (e: KeyboardEvent) => {
      const action = keyAction(e.key, { repeat: e.repeat, modified: e.ctrlKey || e.metaKey || e.altKey, focus: focus(e.target) })
      if (action === 'pluck') act.current.pluck()
      else if (action === 'strike') act.current.strike()
      else if (action === 'mute' || action === 'damp') {
        down.add(action)
        act.current.finger(action, 'key', true)
      }
    }
    const onUp = (e: KeyboardEvent) => {
      const action = keyAction(e.key)
      if ((action === 'mute' || action === 'damp') && down.delete(action)) act.current.finger(action, 'key', false)
    }
    const onBlur = () => {
      for (const action of down) act.current.finger(action, 'key', false)
      down.clear()
    }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  const save = () => {
    if (text === null) return setNotice('This instrument has problems, so it was not saved: a broken instrument must never replace a good one.')
    try {
      localStorage.setItem(HYBRID_STORAGE_KEY, text)
      setSavedText(text)
      setNotice(`Saved in this browser as "${graph.meta.name}".`)
    } catch {
      setNotice('This browser would not store the instrument (private window, or storage is blocked).')
    }
  }
  const open = (next: Graph, message: string) => {
    setGraph(next)
    setNotice(message)
  }
  const openSaved = () => {
    const saved = openText(stored())
    if (saved.graph) open(saved.graph, `Opened your saved instrument "${saved.graph.meta.name}".`)
    else setNotice(saved.problem ? `The saved instrument could not be used and was left as it is. ${saved.problem}` : 'Nothing has been saved in this browser yet.')
  }

  // For driving the page from the developer console and from browser checks.
  useEffect(() => {
    Object.assign(window, { sonicmatterHybridBuilder: { graph: () => latest.current, voice: () => voice.current, status: () => voice.current?.status(), setGraph } })
  }, [])

  // ---- The picture ----
  const length = bar.params.length * PX
  const padAx = BOARD.x + BODY.bridgeAt[0] * BODY.plate.length * PX
  const left = padAx - port(bar, 'pad-a') * length
  const y = BOARD.y + BODY.bridgeAt[1] * BODY.plate.width * PX
  const barX = (xi: number) => left + xi * length
  const end = barX(port(bar, 'tie'))
  const nut = end - string.params.length * PX
  const pluckX = nut + port(string, 'pluck') * string.params.length * PX
  const glow = (joules: number | undefined) => Math.max(0, Math.min(1, (Math.log10(Math.max(joules ?? 0, 1e-12)) + 9) / 6))
  const cpu = status && status.quantumMs ? (100 * status.meanMs) / status.quantumMs : 0
  const gain = 10 ** (volume / 20)
  const suspended = running && status !== null && status.state !== 'running'

  return (
    <div className="mx-auto max-w-[1500px] p-4 text-neutral-100">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Instrument builder</h1>
        <span className="rounded bg-amber-300 px-2 py-0.5 text-xs font-semibold text-neutral-950">Experimental hybrid</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label htmlFor="hybrid-instrument" className="sr-only">
            Choose an instrument
          </label>
          <select
            id="hybrid-instrument"
            value=""
            className="rounded border border-neutral-600 bg-neutral-800 px-2 py-1.5 text-sm"
            onChange={(e) => {
              const choice = e.target.value
              e.target.blur() // the keys go back to the instrument
              if (choice === 'classic') onClassic()
              else if (choice === 'saved') openSaved()
              else if (choice) open(hybridTemplate(choice === '0.18' ? 0.18 : 0.2), `Loaded the hybrid with the string tied at ${choice} of the bar.`)
            }}
          >
            <option value="">Choose an instrument…</option>
            <optgroup label="String on a bar bridge (experimental)">
              <option value="0.20">Hybrid, string tied at 0.20 of the bar</option>
              <option value="0.18">Hybrid, string tied at 0.18 of the bar</option>
              {savedText !== null && <option value="saved">Your saved hybrid</option>}
            </optgroup>
            <optgroup label="Bars, and the string on its box">
              <option value="classic">Open the classic builder and its examples</option>
            </optgroup>
          </select>
          <button className={button} onClick={save} disabled={!unsaved || text === null}>
            {unsaved ? 'Save in this browser' : 'Saved'}
          </button>
          <button className={button} onClick={openSaved} disabled={savedText === null}>
            Open saved
          </button>
        </div>
      </header>

      <section aria-label="Audio and playing" className={`mb-4 flex flex-wrap items-center gap-3 ${panel}`}>
        {running && !suspended ? (
          <button className={button} onClick={stop} disabled={busy}>
            Stop audio
          </button>
        ) : (
          <button className={primary} onClick={start} disabled={busy}>
            {suspended ? 'Resume audio' : 'Start audio'}
          </button>
        )}
        <button className={primary} onPointerDown={(e) => e.button === 0 && pluck()} onClick={(e) => e.detail === 0 && pluck()} disabled={!running} title="A">
          Pluck string (A)
        </button>
        <button className={primary} onPointerDown={(e) => e.button === 0 && strike()} onClick={(e) => e.detail === 0 && strike()} disabled={!running} title="S">
          Strike bar (S)
        </button>
        <button className={`${button} ${fingers.mute ? held : ''}`} aria-pressed={fingers.mute} disabled={!running} onClick={() => finger('mute', 'latch', !fingers.muteLatch)} title="Stays down until pressed again. Or hold M.">
          {fingers.mute ? 'Finger on the string' : 'Mute string (M)'}
        </button>
        <button className={`${button} ${fingers.damp ? held : ''}`} aria-pressed={fingers.damp} disabled={!running} onClick={() => finger('damp', 'latch', !fingers.dampLatch)} title="Stays down until pressed again. Or hold D.">
          {fingers.damp ? 'Finger on the bar' : 'Damp bar (D)'}
        </button>
        <label className="flex items-center gap-2 text-sm text-neutral-300">
          Volume
          <input type="range" min="-12" max="36" step="1" value={volume} onChange={(e) => setVolume(Number(e.target.value))} className="w-28 accent-sky-400" />
          <output className="w-12 tabular-nums text-neutral-400">{`${volume >= 0 ? '+' : ''}${volume} dB`}</output>
        </label>
        <output className="min-h-10 basis-full text-sm text-neutral-400">
          {running && status
            ? `Audio ${status.state} at ${status.sampleRate} Hz · engine ${cpu.toFixed(0)} % of each block · ${status.faults === 0 ? 'no engine faults' : `${status.faults} ENGINE FAULTS`} · loudest ${(status.peak * FULL_SCALE).toFixed(2)} Pa at 1 m · fingers down in the engine: ${status.fingers} · string ${status.stringEnergy.toExponential(1)} J, bar ${status.barEnergy.toExponential(1)} J`
            : running
              ? 'Audio starting…'
              : 'Audio is off'}
        </output>
        {status && status.peak * gain >= 1 && <p className="basis-full text-sm text-amber-200">At this volume the loudest sound passed full scale and was clipped by the browser. Turn the volume down: nothing here evens out loud and quiet.</p>}
      </section>

      <p className={`mb-4 text-sm text-neutral-300 ${panel}`}>
        <strong>What this is.</strong> One instrument: a string whose end is tied to a metal bar, the bar standing on two pads on the soundboard of the body. That is the one string-and-bar assembly with a validated model. You can change its sizes, where things attach and
        how stiff they are; you cannot add or remove parts here, and other combinations are not offered because they have not been validated. Bars, mallets and the string on its box are in the classic builder (instrument list, above). Nobody has yet judged this
        instrument by ear.
      </p>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <main className="min-w-0">
          <svg viewBox="0 0 900 330" role="img" aria-label="The instrument from above: a string tied to a metal bar that stands on two pads on a soundboard" className={`w-full ${panel}`}>
            <rect x={BOARD.x} y={BOARD.y} width={BODY.plate.length * PX} height={BODY.plate.width * PX} rx="4" fill="#2a2118" stroke="#6b563c" />
            <text x={BOARD.x + BODY.plate.length * PX - 6} y={BOARD.y + 16} textAnchor="end" fill="#9aa3ad" fontSize="12">
              body: soundboard 0.5 × 0.4 m on enclosed air (what is heard)
            </text>
            <rect x={left} y={y - 7} width={length} height="14" rx="2" fill="#8f9aa6" stroke="#c9d2dc" style={{ cursor: 'pointer' }} onPointerDown={strike}>
              <title>Metal bar: click to strike</title>
            </rect>
            <rect key={`b${flash.bar}`} x={left - 3} y={y - 10} width={length + 6} height="20" rx="4" fill="none" stroke="#bfe3ff" strokeWidth="6" pointerEvents="none" opacity={glow(status?.barEnergy)} />
            <line x1={nut} x2={end} y1={y} y2={y} stroke="#d9c79a" strokeWidth="3" style={{ cursor: 'pointer' }} onPointerDown={pluck}>
              <title>String: click to pluck</title>
            </line>
            <line key={`s${flash.string}`} x1={nut} x2={end} y1={y} y2={y} stroke="#ffe9a8" strokeWidth="7" pointerEvents="none" opacity={glow(status?.stringEnergy)} />
            {/* Mechanical connections: two pads (bar to board) and the tie (string end to bar). */}
            <circle cx={barX(port(bar, 'pad-a'))} cy={y} r="5" fill="#2f8f58" />
            <circle cx={barX(port(bar, 'pad-b'))} cy={y} r="5" fill="#2f8f58" />
            <circle cx={end} cy={y} r="4" fill="#d9c79a" stroke="#111418" />
            <text x={end} y={y - 16} textAnchor="middle" fill="#d9c79a" fontSize="12">{`tie at ${port(bar, 'tie').toFixed(3)}`}</text>
            <text x={barX(0.5)} y={y + 30} textAnchor="middle" fill="#6fcf97" fontSize="12">
              pads (green) at {port(bar, 'pad-a').toFixed(3)} and {port(bar, 'pad-b').toFixed(3)}
            </text>
            {/* Places to play. */}
            <circle cx={pluckX} cy={y} r="8" fill="none" stroke="#6cb2ff" strokeWidth="1.5" />
            <text x={pluckX} y={y + 26} textAnchor="middle" fill="#9aa3ad" fontSize="12">
              pluck
            </text>
            <path d={`M ${barX(port(bar, 'middle')) - 5} ${y - 20} l 5 9 l 5 -9 z`} fill="#6cb2ff" />
            <circle cx={barX(port(bar, 'touch'))} cy={y} r="9" fill={fingers.damp ? '#d99a3d' : 'none'} stroke="#d99a3d" strokeDasharray={fingers.damp ? undefined : '3 3'} />
            <circle cx={pluckX} cy={y} r="5" fill={fingers.mute ? '#d99a3d' : 'none'} />
            <text x={nut} y={y + 26} fill="#9aa3ad" fontSize="12">
              nut
            </text>
            <text x="20" y="318" fill="#9aa3ad" fontSize="12">
              Seen from above, to scale. Blue ring: pluck. Blue arrow: strike. Orange: finger places (filled when down). The glow follows the energy the string and the bar hold.
            </text>
          </svg>

          <div className="mt-3 space-y-2 text-sm">
            <p aria-live="polite" className="min-h-5 text-neutral-300">
              {notice}
            </p>
            {failure && (
              <p role="alert" className="rounded border border-red-400 bg-red-950 p-2 text-red-200">
                {failure}
              </p>
            )}
            {errors.length > 0 && (
              <div role="alert" className="rounded border border-red-400 bg-red-950 p-2 text-red-200">
                <p className="font-semibold">This instrument cannot be built yet:</p>
                <ul className="list-disc pl-5">
                  {errors.map((issue: Issue, i) => (
                    <li key={i}>{issue.message}</li>
                  ))}
                </ul>
              </div>
            )}
            {warnings.length > 0 && (
              <ul className="list-disc pl-5 text-amber-200">
                {warnings.map((issue: Issue, i) => (
                  <li key={i}>{issue.message}</li>
                ))}
              </ul>
            )}
          </div>

          <section aria-label="Parts and connections" className={`mt-3 text-sm ${panel}`}>
            <h2 className="mb-2 text-base font-semibold">Parts and how they are connected</h2>
            <ul className="space-y-1 text-neutral-300">
              <li>
                <strong>{CONNECTIONS.tie.label}:</strong> the string's end → the bar's "{bar.ports.find((p) => p.id === 'tie')!.name}" point. A spring ({tie.stiffness!.toExponential(1)} N/m) and a damper ({tie.damping} N s/m).
              </li>
              <li>
                <strong>{CONNECTIONS.pad.label} 1:</strong> the bar's first pad point → the body's bridge point. A spring ({pad.stiffness!.toExponential(1)} N/m) and a damper ({pad.damping} N s/m).
              </li>
              <li>
                <strong>{CONNECTIONS.pad.label} 2:</strong> the bar's second pad point → the soundboard, along the board from the first, as far as the pads are apart on the bar (placed for you: a bar does not stretch).
              </li>
              <li>
                <strong>Heard:</strong> only the body's radiated sound pressure, 1 m in front of the soundboard. The string and the bar are heard through what they do to the body.
              </li>
              <li className="text-neutral-400">
                Places to play (not parts of the instrument): {TARGETS.pluck.label.toLowerCase()} and {TARGETS.mute.label.toLowerCase()} at the string's pluck point; {TARGETS.strike.label.toLowerCase()} and {TARGETS.contact.label.toLowerCase()} at their own points on the bar.
              </li>
            </ul>
          </section>
        </main>

        <aside aria-label="Properties" className="space-y-3">
          <section className={panel}>
            <h2 className="mb-2 text-base font-semibold">Playing</h2>
            <Field label="Pluck strength" unit={`N · about ${pluckLevel(force).toFixed(0)} dB`} value={force} min={PLUCK_FORCE.min} max={PLUCK_FORCE.max} step={0.1} onChange={setForce} />
            <Field label="Strike strength" unit={`m/s · about ${strikeLevel(speed).toFixed(0)} dB`} value={speed} min={STRIKE_SPEED.min} max={STRIKE_SPEED.max} step={0.05} onChange={setSpeed} />
            <label htmlFor="damp-strength" className="mb-1 block text-sm text-neutral-300">
              How hard the finger presses on the bar
            </label>
            <select id="damp-strength" value={strength} onChange={(e) => (pressStrength(e.target.value as Strength), e.target.blur())} className="w-full rounded border border-neutral-600 bg-neutral-800 px-2 py-1.5 text-sm">
              {(Object.keys(BAR_TOUCH) as Strength[]).map((name) => (
                <option key={name} value={name}>{`${name}: ${BAR_TOUCH[name].stiffness} N/m, ${BAR_TOUCH[name].damping} N s/m`}</option>
              ))}
            </select>
            <p className="mt-2 text-xs text-neutral-400">The dB is the model's own loudness for that pluck or stroke, so the two can be set against each other. Keys: A pluck, S strike, hold M to mute the string, hold D to damp the bar. The two fingers are independent.</p>
          </section>

          <section className={panel}>
            <h2 className="mb-2 text-base font-semibold">String</h2>
            <Field label="Tension" unit="N" value={string.params.tension} {...range('steelString', 'tension')} step={0.5} onChange={(v) => setGraph(setParam(graph, IDS.string, 'tension', v))} />
            <Field label="String length" unit="m" value={string.params.length} {...range('steelString', 'length')} step={0.005} onChange={(v) => setGraph(setParam(graph, IDS.string, 'length', v))} />
            <Field label="Pluck position" value={port(string, 'pluck')} min={0.05} max={0.95} step={0.01} hint="0 is the nut, 1 the end tied to the bar. The mute rests at the same place." onChange={(v) => setGraph(setPort(graph, IDS.string, 'pluck', v))} />
          </section>

          <section className={panel}>
            <h2 className="mb-2 text-base font-semibold">Metal bar</h2>
            <label htmlFor="bar-material" className="mb-1 block text-sm text-neutral-300">
              Material
            </label>
            <select id="bar-material" value={bar.material} onChange={(e) => (setGraph(setMaterial(graph, e.target.value)), e.target.blur())} className="mb-2 w-full rounded border border-neutral-600 bg-neutral-800 px-2 py-1.5 text-sm">
              {Object.keys(COMPONENTS.metalBar.materials!).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <Field label="Bar length" unit="m" value={bar.params.length} min={0.1} max={0.4} step={0.0005} hint="Longer sounds lower. The reference, 0.1994 m, puts the bar's note just under the string's 6th harmonic." onChange={(v) => setGraph(setParam(graph, IDS.bar, 'length', v))} />
            <Field label="Width" unit="mm" value={bar.params.width} min={10} max={60} step={0.5} onChange={(v) => setGraph(setParam(graph, IDS.bar, 'width', v))} />
            <Field label="Thickness" unit="mm" value={bar.params.thickness} min={2} max={15} step={0.5} onChange={(v) => setGraph(setParam(graph, IDS.bar, 'thickness', v))} />
            <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">Connection points along the bar (0 and 1 are its ends)</h3>
            <Field label="String tie" value={port(bar, 'tie')} min={0} max={1} step={0.005} hint="Validated at 0.20 and 0.18." onChange={(v) => setGraph(setPort(graph, IDS.bar, 'tie', v))} />
            <Field label="First pad" value={port(bar, 'pad-a')} min={0} max={0.45} step={0.005} onChange={(v) => setGraph(setPort(graph, IDS.bar, 'pad-a', v))} />
            <Field label="Second pad" value={port(bar, 'pad-b')} min={0.55} max={1} step={0.005} onChange={(v) => setGraph(setPort(graph, IDS.bar, 'pad-b', v))} />
            <Field label="Where it is struck" value={port(bar, 'middle')} min={0} max={1} step={0.01} onChange={(v) => setGraph(setPort(graph, IDS.bar, 'middle', v))} />
            <Field label="Where the finger rests" value={port(bar, 'touch')} min={0} max={1} step={0.01} onChange={(v) => setGraph(setPort(graph, IDS.bar, 'touch', v))} />
          </section>

          <section className={panel}>
            <h2 className="mb-2 text-base font-semibold">Connections and striker</h2>
            <Field label="Tie stiffness" unit="N/m" value={tie.stiffness!} min={1e4} max={1e8} step={1} log onChange={(v) => setGraph(setTie(graph, { stiffness: v }))} />
            <Field label="Tie damping" unit="N s/m" value={tie.damping!} min={0} max={100} step={0.5} onChange={(v) => setGraph(setTie(graph, { damping: v }))} />
            <Field label="Pad stiffness (both)" unit="N/m" value={pad.stiffness!} min={1e4} max={1e8} step={1} log onChange={(v) => setGraph(setPads(graph, { stiffness: v }))} />
            <Field label="Pad damping (both)" unit="N s/m" value={pad.damping!} min={0} max={100} step={0.5} onChange={(v) => setGraph(setPads(graph, { damping: v }))} />
            <Field label="Striker mass" unit="kg" value={striker.mass} min={0.002} max={0.5} step={0.001} log onChange={(v) => setGraph(setStriker(graph, { mass: v }))} />
            <Field label="Striker hardness" value={striker.hardness} min={0} max={1} step={0.01} onChange={(v) => setGraph(setStriker(graph, { hardness: v }))} />
          </section>

          <section className={panel}>
            <label htmlFor="hybrid-name" className="mb-1 block text-sm text-neutral-300">
              Name
            </label>
            <input id="hybrid-name" type="text" value={graph.meta.name} onChange={(e) => setGraph(rename(graph, e.target.value))} className="w-full rounded border border-neutral-600 bg-neutral-800 px-2 py-1.5 text-sm" />
            <p className="mt-2 text-xs text-neutral-400">{unsaved ? 'There are changes that are not saved.' : 'Saved in this browser.'} A changed property rebuilds the instrument, so its sound restarts.</p>
          </section>
        </aside>
      </div>
    </div>
  )
}
