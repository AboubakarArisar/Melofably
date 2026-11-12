// EXPERIMENTAL (Phase 3B). The builder's property inspector: the physical
// properties of the selected component or connection, in plain words.
import type { ReactNode } from 'react'
import type { Selection } from './Canvas.tsx'
import { cannotConnect, CONNECTION_LABELS, CONNECTION_PARAMS, isResonator, TYPES, type Component, type Connection, type ConnectionType, type Graph, type ParamSpec } from './graph.ts'
import { describeBar } from './translate.ts'

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

/** One property: a slider for moving it and a box for typing an exact value. */
function Field({ spec, value, onChange, restarts = !spec.live }: { spec: ParamSpec; value: number; onChange(value: number): void; restarts?: boolean }) {
  const id = `field-${spec.key}`
  const log = spec.log && spec.min > 0
  const bad = !Number.isFinite(value) || value < spec.min || value > spec.max
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
            type="number"
            aria-label={`${spec.label}, exact value`}
            aria-invalid={bad}
            value={Number.isFinite(value) ? value : ''}
            min={spec.min}
            max={spec.max}
            step="any"
            onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
            className={`w-24 rounded border bg-neutral-950 px-1 py-0.5 text-right tabular-nums ${bad ? 'border-red-400 text-red-300' : 'border-neutral-700 text-neutral-100'}`}
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
        value={bad ? (log ? 0 : spec.min) : toSlider(value)}
        onChange={(e) => onChange(fromSlider(Number(e.target.value)))}
        className="w-full accent-sky-400"
      />
      <p className="text-xs text-neutral-400">
        {bad ? <span className="text-red-300">{`Must be between ${format(spec.min)} and ${format(spec.max)} ${spec.unit}. Not used until it is.`}</span> : spec.hint}
      </p>
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
        <li>A mallet or impulse strike must be connected to the bar it hits.</li>
        <li>Two bars are joined by a spring, a damper, or both.</li>
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
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={!running} onClick={() => onStrike(item.id)} title={running ? undefined : 'Start audio first'}>
          {isResonator(item) ? 'Strike this bar' : 'Strike now'}
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

function ConnectionPanel({ graph, link, onConnection, onParam, onRemove }: Props & { link: Connection }) {
  const [from, to] = [graph.components.find((c) => c.id === link.from), graph.components.find((c) => c.id === link.to)]
  if (!from || !to) return null
  const strike = link.type === 'strike'
  const point = (bar: Component, key: 'strikePosition' | 'connectionPosition') => {
    const spec = TYPES[bar.type].params.find((p) => p.key === key)!
    return <Field key={`${bar.id}-${key}`} spec={{ ...spec, key: `${bar.id}-${key}`, label: `Point on ${bar.name}`, hint: '0 and 1 are the ends of the bar, 0.5 its middle. Shared by everything attached there.' }} value={bar.params[key]} onChange={(v) => onParam(bar.id, key, v)} />
  }
  return (
    <Panel title={strike ? `${from.name} strikes ${to.name}` : `${from.name} joined to ${to.name}`}>
      {strike ? (
        <p className="mb-3 text-sm text-neutral-400">The exciter hits the bar at the bar's strike position. How hard and how fast are properties of the exciter.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-neutral-400">A physical link: each bar pushes and pulls the other through it. This is not two sounds added together.</p>
          <div className="mb-3">
            <label htmlFor="link-type" className="text-sm text-neutral-200">
              Kind <span className="text-amber-300" title="Changing this rebuilds the instrument: its sound restarts.">↻</span>
            </label>
            <select id="link-type" value={link.type} onChange={(e) => onConnection(link.id, { type: e.target.value as ConnectionType })} className="mt-1 block w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100">
              {(['spring', 'damper', 'springDamper'] as const).map((type) => (
                <option key={type} value={type}>
                  {CONNECTION_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          {link.type !== 'damper' && <Field spec={CONNECTION_PARAMS.stiffness} value={link.stiffness} onChange={(stiffness) => onConnection(link.id, { stiffness })} />}
          {link.type !== 'spring' && <Field spec={CONNECTION_PARAMS.damping} value={link.damping} onChange={(damping) => onConnection(link.id, { damping })} />}
        </>
      )}
      <h3 className="mb-2 mt-1 text-sm font-semibold text-neutral-200">Connection points</h3>
      {strike ? point(to, 'strikePosition') : [point(from, 'connectionPosition'), point(to, 'connectionPosition')]}
      <button className={button} onClick={onRemove}>
        Remove connection
      </button>
    </Panel>
  )
}
