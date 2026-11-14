// EXPERIMENTAL (Phase 3B). The builder's property inspector: the physical
// properties of the selected component or connection, in plain words.
import { useState, type ReactNode } from 'react'
import type { Selection } from './Canvas.tsx'
import { RADIATOR_POINTS } from '../experimental/radiation/barRadiation.ts'
import { BRIDGE_STIFFNESS, cannotConnect, CONNECTION_LABELS, CONNECTION_PARAMS, isBody, isListener, isResonator, isString, parseEntry, TYPES, type Component, type Connection, type ConnectionType, type Graph, type ParamSpec } from './graph.ts'
import { describeBar, describeBody, describeFinger, describeString, LISTENER, LISTENER_FULL_SCALE } from './translate.ts'

interface Props {
  graph: Graph
  selection: Selection
  sampleRate: number
  running: boolean
  onParam(id: string, key: string, value: number): void
  onMaterial(id: string, material: string): void
  onConnection(id: string, values: Partial<Pick<Connection, 'type' | 'stiffness' | 'damping'>>): void
  onConnect(from: string, to: string): void
  onRemove(): void
  onStrike(id: string): void
}

const format = (value: number) => (Number.isFinite(value) ? Number(value.toPrecision(3)).toLocaleString('en', { maximumFractionDigits: 4 }) : 'not a number')

/**
 * One property: a slider for moving it and a box for typing an exact value.
 * A typed value is used only once it is a number within the property's
 * range; until then the instrument keeps the last valid value and the box
 * says what is wrong. Leaving the box puts the valid value back.
 */
function Field({ spec, value, onChange, restarts = !spec.live }: { spec: ParamSpec; value: number; onChange(value: number): void; restarts?: boolean }) {
  const id = `field-${spec.key}`
  const [draft, setDraft] = useState<string | null>(null)
  const entry = draft === null ? null : parseEntry(draft, spec)
  const error = entry && 'error' in entry ? entry.error : null
  // A switch: on or off, with nothing to slide or type.
  if (spec.toggle)
    return (
      <div className="mb-3">
        <label className="flex items-center gap-2 text-sm text-neutral-200">
          <input type="checkbox" checked={value === 1} onChange={(e) => onChange(e.target.checked ? 1 : 0)} className="h-4 w-4 accent-sky-400" />
          {spec.label}
        </label>
        <p className="text-xs text-neutral-400">{spec.hint}</p>
      </div>
    )
  const log = spec.log && spec.min > 0
  const toSlider = (v: number) => (log ? (1000 * Math.log(v / spec.min)) / Math.log(spec.max / spec.min) : v)
  const fromSlider = (s: number) => (log ? Number((spec.min * (spec.max / spec.min) ** (s / 1000)).toPrecision(3)) : s)
  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm text-neutral-200">
          {spec.label}
          {restarts && (
            <span className="ml-1 text-amber-300" title="Changing this rebuilds the instrument: its sound restarts.">
              ↻<span className="sr-only"> (changing this restarts the sound)</span>
            </span>
          )}
        </label>
        <span className="flex items-baseline gap-1 text-sm">
          <input
            type="text"
            inputMode="decimal"
            aria-label={`${spec.label}, exact value`}
            aria-invalid={error !== null}
            value={draft ?? String(value)}
            onChange={(e) => {
              setDraft(e.target.value)
              const typed = parseEntry(e.target.value, spec)
              if ('value' in typed) onChange(typed.value)
            }}
            onBlur={() => setDraft(null)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className={`w-24 rounded border bg-neutral-950 px-1 py-0.5 text-right tabular-nums ${error ? 'border-red-400 text-red-300' : 'border-neutral-700 text-neutral-100'}`}
          />
          <span className="w-10 text-neutral-400">{spec.unit}</span>
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={log ? 0 : spec.min}
        max={log ? 1000 : spec.max}
        step={log ? 1 : spec.step}
        value={toSlider(value)}
        onChange={(e) => {
          setDraft(null)
          onChange(fromSlider(Number(e.target.value)))
        }}
        className="w-full accent-sky-400"
      />
      <p className="text-xs text-neutral-400">{error ? <span className="text-red-300">{error}</span> : spec.hint}</p>
    </div>
  )
}
const Panel = ({ title, children }: { title: string; children: ReactNode }) => (
  <section aria-label="Properties" className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
    <h2 className="mb-3 text-base font-semibold text-neutral-100">{title}</h2>
    {children}
  </section>
)
const button = 'rounded border border-neutral-600 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 hover:bg-neutral-700 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-sky-400'

export function Inspector(props: Props) {
  const { graph, selection, sampleRate, running } = props
  const item = selection?.kind === 'component' ? graph.components.find((c) => c.id === selection.id) : undefined
  const link = selection?.kind === 'connection' ? graph.connections.find((c) => c.id === selection.id) : undefined

  if (item) return <ComponentPanel {...props} item={item} />
  if (link) return <ConnectionPanel {...props} link={link} />
  return (
    <Panel title="Properties">
      <p className="text-sm text-neutral-300">Select a component or a connection on the canvas to see and change what it is made of.</p>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-neutral-400">
        <li>Drag a component by its body to move it.</li>
        <li>Drag from a component's dot to another component to connect them.</li>
        <li>Double-click a bar or an exciter to strike it.</li>
        <li>A mallet or impulse strike must be connected to the bar it hits.</li>
        <li>Two bars are joined by a spring, a damper, or both.</li>
        <li>A string is stood on a body by its bridge. Double-click either to pluck the string.</li>
        <li>
          <span className="text-amber-300">↻</span> marks properties that rebuild the instrument: its sound stops and starts again. The others change while it rings.
        </li>
      </ul>
      {!running && <p className="mt-3 text-sm text-neutral-400">Press Start audio to hear it.</p>}
      <p className="mt-3 text-xs text-neutral-500">Checked for a sample rate of {sampleRate} Hz.</p>
    </Panel>
  )
}

function ComponentPanel({ graph, item, sampleRate, running, onParam, onMaterial, onConnect, onRemove, onStrike }: Props & { item: Component }) {
  const spec = TYPES[item.type]
  const facts = isResonator(item) && spec.materials?.[item.material!] && Object.values(item.params).every(Number.isFinite) ? describeBar(item, sampleRate) : null
  const candidates = graph.components.filter((c) => c.id !== item.id && cannotConnect(graph, item.id, c.id) === null)
  return (
    <Panel title={item.name}>
      <p className="mb-3 text-sm text-neutral-400">{spec.description}</p>
      {spec.materials && (
        <div className="mb-3">
          <label htmlFor="material" className="text-sm text-neutral-200">
            Material <span className="text-amber-300" title="Changing this rebuilds the instrument: its sound restarts.">↻</span>
          </label>
          <select id="material" value={item.material} onChange={(e) => onMaterial(item.id, e.target.value)} className="mt-1 block w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100">
            {Object.entries(spec.materials).map(([key, m]) => (
              <option key={key} value={key}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {spec.params.map((p) => (
        <Field key={`${item.id}-${p.key}`} spec={p} value={item.params[p.key]} onChange={(v) => onParam(item.id, p.key, v)} />
      ))}
      {facts && (
        <dl className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded bg-neutral-950 p-2 text-sm">
          <dt className="text-neutral-400">Lowest note</dt>
          <dd className="text-neutral-100">{`${format(facts.lowest)} Hz (${facts.note})`}</dd>
          <dt className="text-neutral-400">Weight</dt>
          <dd className="text-neutral-100">{`${format(facts.massKg * 1000)} g`}</dd>
          <dt className="text-neutral-400">Rings for about</dt>
          <dd className="text-neutral-100">{facts.ringSeconds ? `${format(facts.ringSeconds)} s` : 'not playable'}</dd>
          <dt className="text-neutral-400">Overtones used</dt>
          <dd className="text-neutral-100">{`${facts.overtones} of 8`}</dd>
        </dl>
      )}
      {isString(item) && Object.values(item.params).every(Number.isFinite) && <StringFacts item={item} sampleRate={sampleRate} />}
      {isBody(item) && <BodyFacts />}
      {isListener(item) && <ListenerFacts />}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={!running} onClick={() => onStrike(item.id)} title={running ? undefined : 'Start audio first'}>
          {isString(item) || isBody(item) ? 'Pluck the string' : isListener(item) ? 'Play instrument' : isResonator(item) ? 'Strike this bar' : 'Strike now'}
        </button>
        <button className={button} onClick={onRemove}>
          Remove
        </button>
      </div>
      <div className="mt-3">
        <label htmlFor="connect-to" className="text-sm text-neutral-200">
          Connect to
        </label>
        <select id="connect-to" value="" disabled={candidates.length === 0} onChange={(e) => e.target.value && onConnect(item.id, e.target.value)} className="mt-1 block w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100 disabled:opacity-40">
          <option value="">{candidates.length ? 'Choose a component…' : 'Nothing it can connect to'}</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <p className="text-xs text-neutral-400">The same as dragging from its dot on the canvas.</p>
      </div>
    </Panel>
  )
}

const facts = 'mb-3 grid grid-cols-2 gap-x-3 gap-y-1 rounded bg-neutral-950 p-2 text-sm'
const Fact = ({ name, children }: { name: string; children: ReactNode }) => (
  <>
    <dt className="text-neutral-400">{name}</dt>
    <dd className="text-neutral-100">{children}</dd>
  </>
)

function StringFacts({ item, sampleRate }: { item: Component; sampleRate: number }) {
  const s = describeString(item, sampleRate)
  return (
    <>
      <dl className={facts}>
        <Fact name="Pitch">{`${format(s.pitch)} Hz (${s.note} ${s.centsFromNote >= 0 ? '+' : '−'}${Math.abs(s.centsFromNote).toFixed(0)} cents)`}</Fact>
        <Fact name="Weight">{`${format(s.massGrams)} g (3.6 g/m)`}</Fact>
        <Fact name="Wave impedance">{`${format(s.impedance)} kg/s`}</Fact>
        <Fact name="Overtones used">{`${s.modes}, up to ${format(s.highestMode / 1000)} kHz`}</Fact>
        <Fact name="Lowest overtone rings for">{s.ringSeconds ? `${format(s.ringSeconds)} s` : 'not playable'}</Fact>
        <Fact name="A finger's touch">{`a damper of ${format(describeFinger(item).damping)} N s/m`}</Fact>
        <Fact name="Pulled aside 1 mm takes">{`${format(0.001 / describeFinger(item).displacementPerNewton)} N`}</Fact>
      </dl>
      <p className="mb-3 text-xs text-neutral-400">
        The pitch is that of the string between two fixed ends. On the body it is within a few cents of this. On the canvas: click the string to pluck it there; drag across it and let go to pull it aside and release it. Hold M (or the Hold to mute button) to rest a finger on it: the finger is a damper where the string is plucked, as strong as takes the most from the string (twice its wave impedance), so it cannot quiet an overtone that does not move there.
      </p>
    </>
  )
}

function ListenerFacts() {
  return (
    <>
      <dl className={facts}>
        <Fact name="Where">{`${LISTENER.distance} m from the bar's middle, ${LISTENER.angle}° off its face`}</Fact>
        <Fact name="Heard through">{`${RADIATOR_POINTS} points along the bar`}</Fact>
        <Fact name="Loudest it can carry">{`${LISTENER_FULL_SCALE} Pa (${(20 * Math.log10(LISTENER_FULL_SCALE / Math.SQRT2 / 2e-5)).toFixed(0)} dB SPL)`}</Fact>
      </dl>
      <p className="mb-3 text-xs text-neutral-400">
        Experimental. Each of the points is a short piece of the bar pushing on the air; their sounds are added where the listener is, each with its own distance, direction and travel time. Open, still air: no room, no floor. The pressure is a model's and has not been checked against a microphone. Nothing about the bar or the string changes: remove the listener and the bar is heard as before, by its velocity. A string moves the bar slowly and a slow bar moves little air, so plucking is much quieter here than striking.
      </p>
    </>
  )
}

function BodyFacts() {
  const b = describeBody()
  return (
    <>
      <dl className={facts}>
        <Fact name="Soundboard">{`spruce, ${b.plate.length} × ${b.plate.width} m, ${1000 * b.plate.thickness} mm`}</Fact>
        <Fact name="Soundboard weight">{`${format(b.plateGrams)} g`}</Fact>
        <Fact name="Air inside">{`${format(b.volumeLitres)} litres`}</Fact>
        <Fact name="Sound hole">{`radius ${1000 * b.holeRadius} mm, screen ${b.holeScreen} Pa s/m`}</Fact>
        <Fact name="Bridge stands at">{`${b.bridgeAt[0]} along, ${b.bridgeAt[1].toFixed(3)} across`}</Fact>
        <Fact name="Heard from">1 m in front, on its axis</Fact>
      </dl>
      <p className="mb-3 text-xs text-neutral-400">
        Nothing here can be changed in this version: the body is the one that was measured. What you hear is the sound pressure it radiates, from the soundboard and from the hole together, not the string itself.
      </p>
    </>
  )
}

function ConnectionPanel({ graph, link, onConnection, onParam, onRemove }: Props & { link: Connection }) {
  const [from, to] = [graph.components.find((c) => c.id === link.from), graph.components.find((c) => c.id === link.to)]
  if (!from || !to) return null
  if (link.type === 'bridge')
    return (
      <Panel title={`${from.name} stands on ${to.name}`}>
        <p className="mb-3 text-sm text-neutral-400">
          The bridge: the string's end pushes and pulls the soundboard through it, and the soundboard pushes back. This is the only way the string's motion reaches the body. Remove it and the string still moves when plucked, but nothing is heard.
        </p>
        <dl className={facts}>
          <Fact name="Stiffness">{`${BRIDGE_STIFFNESS.toLocaleString('en')} N/m (fixed)`}</Fact>
          <Fact name="Kind">a spring; no damper</Fact>
        </dl>
        <button className={button} onClick={onRemove}>
          Remove connection
        </button>
      </Panel>
    )
  const strike = link.type === 'strike'
  // A string tied to a bar (Phase 3D.2): its end is held by the spring, so the joint is never a damper alone.
  const tied = isString(from)
  const point = (bar: Component, key: 'strikePosition' | 'connectionPosition') => {
    const spec = TYPES[bar.type].params.find((p) => p.key === key)!
    return <Field key={`${bar.id}-${key}`} spec={{ ...spec, key: `${bar.id}-${key}`, label: `Point on ${bar.name}`, hint: '0 and 1 are the ends of the bar, 0.5 its middle. Shared by everything attached there.' }} value={bar.params[key]} onChange={(v) => onParam(bar.id, key, v)} />
  }
  return (
    <Panel title={strike ? `${from.name} strikes ${to.name}` : tied ? `${from.name} tied to ${to.name}` : `${from.name} joined to ${to.name}`}>
      {strike ? (
        <p className="mb-3 text-sm text-neutral-400">The exciter hits the bar at the bar's strike position. How hard and how fast are properties of the exciter.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-neutral-400">
            {tied
              ? 'The end of the string is held by this spring, whose other end is on the bar. The string pulls the bar through it and the bar pulls the string: energy goes both ways. Only the bar is heard, so the string is heard through the bar. A soft spring lets the end of the string give, which lowers its pitch.'
              : 'A physical link: each bar pushes and pulls the other through it. This is not two sounds added together.'}
          </p>
          <div className="mb-3">
            <label htmlFor="link-type" className="text-sm text-neutral-200">
              Kind <span className="text-amber-300" title="Changing this rebuilds the instrument: its sound restarts.">↻</span>
            </label>
            <select id="link-type" value={link.type} onChange={(e) => onConnection(link.id, { type: e.target.value as ConnectionType })} className="mt-1 block w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100">
              {(tied ? (['spring', 'springDamper'] as const) : (['spring', 'damper', 'springDamper'] as const)).map((type) => (
                <option key={type} value={type}>
                  {CONNECTION_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          {link.type !== 'damper' && (
            <Field
              key={`${link.id}-stiffness`}
              spec={tied ? { ...CONNECTION_PARAMS.stiffness, hint: 'How firmly the end of the string is held. At a million N/m and above the string keeps its pitch; at ten thousand it is a fifth of a semitone flat; softer still and the string is hardly tied at all.' } : CONNECTION_PARAMS.stiffness}
              value={link.stiffness}
              onChange={(stiffness) => onConnection(link.id, { stiffness })}
            />
          )}
          {link.type !== 'spring' && (
            <Field
              key={`${link.id}-damping`}
              spec={tied ? { ...CONNECTION_PARAMS.damping, hint: 'Friction in the joint. It takes energy from both. Beside a stiff spring it has little to work on; it does more beside a soft one.' } : CONNECTION_PARAMS.damping}
              value={link.damping}
              onChange={(damping) => onConnection(link.id, { damping })}
            />
          )}
        </>
      )}
      <h3 className="mb-2 mt-1 text-sm font-semibold text-neutral-200">Connection points</h3>
      {strike ? point(to, 'strikePosition') : tied ? point(to, 'connectionPosition') : [point(from, 'connectionPosition'), point(to, 'connectionPosition')]}
      <button className={button} onClick={onRemove}>
        Remove connection
      </button>
    </Panel>
  )
}
