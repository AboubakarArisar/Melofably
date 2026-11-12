// EXPERIMENTAL (Phase 3B). The builder's canvas: components are dragged by
// their body, and connected by dragging from a component's dot to another
// component. Everything drawn here is read from the graph.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cannotConnect, CONNECTION_LABELS, isExciter, isResonator, TYPES, type Component, type ConnectionType, type Graph } from './graph.ts'
import { barSize, CANVAS, componentAt, ends, EXCITER_RADIUS, handle, HANDLE_REACH, onHandle, strikePoint, zigzag, type Point } from './shapes.ts'

export type Selection = { kind: 'component' | 'connection'; id: string } | null

interface Props {
  graph: Graph
  selection: Selection
  /** Identifiers with a problem, outlined in red. */
  flagged: Set<string>
  /** Bars just struck: `n` changes with every strike so that the flash restarts. */
  struck: { ids: string[]; n: number }
  onSelect(selection: Selection): void
  onMove(id: string, x: number, y: number): void
  onConnect(from: string, to: string): void
  onRemoveComponent(id: string): void
  onStrike(id: string): void
}

type Drag = { kind: 'move'; id: string; dx: number; dy: number } | { kind: 'link'; from: string; at: Point } | null

const FILL: Record<Component['type'], string> = { metalBar: '#8b9bb0', woodBar: '#a87545', mallet: '#d8c59a', impulse: '#7fb2d9' }
/** Excitation is drawn in amber, physical links between bars in teal: two different things, two different colours. */
const STRIKE_COLOR = '#f0b44c'
const LINK_COLOR = '#6fd6c9'
const SELECTED = '#6cb2ff'
const PROBLEM = '#ff6b6b'
const SHORT: Record<ConnectionType, string> = { strike: 'strikes', spring: 'spring', damper: 'damper', springDamper: 'spring + damper' }

/** What dragging a connection from `from` onto `to` would do, in words. */
function preview(graph: Graph, from: string, to: string | null): { text: string; ok: boolean } {
  if (!to || to === from) return { text: 'Drop on another component', ok: false }
  const reason = cannotConnect(graph, from, to)
  if (reason) return { text: reason, ok: false }
  const [a, b] = [graph.components.find((c) => c.id === from)!, graph.components.find((c) => c.id === to)!]
  const exciter = isExciter(a) ? a : isExciter(b) ? b : null
  const bar = exciter === a ? b : a
  return { text: exciter ? `${exciter.name} will strike ${bar.name}` : `Join ${a.name} and ${b.name} with a spring and damper`, ok: true }
}

export function Canvas({ graph, selection, flagged, struck, onSelect, onMove, onConnect, onRemoveComponent, onStrike }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<Drag>(null)
  const lastPress = useRef({ id: '', time: 0 })

  const local = (e: PointerEvent): Point => {
    const box = svg.current!.getBoundingClientRect()
    // The drawing scales with the page; positions are kept in its own 920 x 560 units.
    return { x: ((e.clientX - box.left) * CANVAS.width) / box.width, y: ((e.clientY - box.top) * CANVAS.height) / box.height }
  }
  const within = (x: number, y: number): [number, number] => [Math.min(CANVAS.width - 40, Math.max(40, x)), Math.min(CANVAS.height - 40, Math.max(40, y))]

  const press = (e: PointerEvent, c: Component) => {
    e.stopPropagation()
    svg.current!.setPointerCapture(e.pointerId)
    onSelect({ kind: 'component', id: c.id })
    // A second press on the same component within a third of a second strikes it. (Counted here
    // because the pointer is captured for dragging, so the browser's own double-click never arrives.)
    const now = performance.now()
    if (lastPress.current.id === c.id && now - lastPress.current.time < 350) onStrike(c.id)
    lastPress.current = { id: c.id, time: now }
    const p = local(e)
    // On or near the dot: start a connection. Anywhere else on it: move it.
    setDrag(onHandle(c, p) ? { kind: 'link', from: c.id, at: p } : { kind: 'move', id: c.id, dx: p.x - c.x, dy: p.y - c.y })
  }
  const move = (e: PointerEvent) => {
    if (!drag) return
    const p = local(e)
    if (drag.kind === 'move') onMove(drag.id, ...within(p.x - drag.dx, p.y - drag.dy))
    else setDrag({ ...drag, at: p })
  }
  const release = (e: PointerEvent) => {
    if (drag?.kind === 'link') {
      const target = componentAt(graph, local(e))
      if (target && target !== drag.from) onConnect(drag.from, target)
    }
    if (drag) svg.current!.releasePointerCapture(e.pointerId)
    setDrag(null)
  }
  const keys = (e: KeyboardEvent, c: Component) => {
    const step = e.shiftKey ? 40 : 10
    const by: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (e.key === 'Enter') onSelect({ kind: 'component', id: c.id })
    else if (e.key === ' ') onStrike(c.id)
    else if (e.key in by) onMove(c.id, ...within(c.x + by[e.key][0], c.y + by[e.key][1]))
    else if (e.key === 'Delete' || e.key === 'Backspace') onRemoveComponent(c.id) // the one with the focus, whatever is selected
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const linkingFrom = drag?.kind === 'link' ? drag.from : null
  const hover = drag?.kind === 'link' ? preview(graph, drag.from, componentAt(graph, drag.at)) : null
  const selected = (kind: 'component' | 'connection', id: string) => selection?.kind === kind && selection.id === id
  // The selected component is drawn last, so that it is never hidden under another.
  const ordered = [...graph.components].sort((a, b) => Number(selected('component', a.id)) - Number(selected('component', b.id)))

  return (
    <div>
      <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
        <svg
          ref={svg}
          viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}
          width="100%"
          role="application"
          aria-label="Instrument canvas. Drag components to move them; drag from a component's dot to another component to connect them."
          className="block h-auto touch-none select-none"
          onPointerDown={() => onSelect(null)}
          onPointerMove={move}
          onPointerUp={release}
          onPointerCancel={release}
        >
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0V40" fill="none" stroke="#1f242b" strokeWidth="1" />
            </pattern>
            {[STRIKE_COLOR, SELECTED, PROBLEM].map((color) => (
              <marker key={color} id={`arrow-${color.slice(1)}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L10 5L0 10z" fill={color} />
              </marker>
            ))}
            <style>{`
              .struck { animation: struck 0.45s ease-out forwards; transform-box: fill-box; transform-origin: center; }
              @keyframes struck { from { transform: scale(0.4); opacity: 0.9; } to { transform: scale(2.4); opacity: 0; } }
              @media (prefers-reduced-motion: reduce) { .struck { animation: none; opacity: 0; } }
            `}</style>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {graph.components.length === 0 && (
            <text x={CANVAS.width / 2} y={CANVAS.height / 2 - 26} textAnchor="middle" fill="#8a94a0" fontSize="17">
              <tspan x={CANVAS.width / 2}>Nothing here yet.</tspan>
              <tspan x={CANVAS.width / 2} dy="28">Add a bar from the Add list, then a mallet, and drag from the mallet's dot to the bar.</tspan>
              <tspan x={CANVAS.width / 2} dy="28">Or load an example from the top of the page.</tspan>
            </text>
          )}

          {graph.connections.map((link) => {
            const line = ends(graph, link)
            if (!line) return null
            const [a, b] = line
            const on = selected('connection', link.id)
            const strike = link.type === 'strike'
            const color = flagged.has(link.id) ? PROBLEM : on ? SELECTED : strike ? STRIKE_COLOR : LINK_COLOR
            // The label sits just below the middle of the line, clear of the line itself.
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + (strike ? 0 : 18) }
            const label = SHORT[link.type]
            const width = 7 * label.length + 14
            return (
              <g
                key={link.id}
                data-connection={link.id}
                className="cursor-pointer"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onSelect({ kind: 'connection', id: link.id })
                }}
              >
                <title>{`${CONNECTION_LABELS[link.type]}: click to select and edit`}</title>
                {/* A wide invisible line, so that a thin connection is easy to pick. */}
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="24" />
                {strike && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={on ? 3.5 : 2.5} strokeDasharray="7 6" markerEnd={`url(#arrow-${color.slice(1)})`} />}
                {(link.type === 'spring' || link.type === 'springDamper') && <polyline points={zigzag(a, b)} fill="none" stroke={color} strokeWidth={on ? 3.5 : 2.5} strokeLinejoin="round" />}
                {link.type === 'damper' && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={on ? 7 : 6} strokeDasharray="2 6" />}
                {link.type === 'springDamper' && <line x1={a.x + 10} y1={a.y} x2={b.x + 10} y2={b.y} stroke={color} strokeWidth="5" strokeDasharray="2 6" />}
                {/* What kind of connection it is, in a word. */}
                <rect x={mid.x - width / 2} y={mid.y - 10} width={width} height="20" rx="10" fill="#111418" stroke={color} strokeWidth="1.5" />
                <text x={mid.x} y={mid.y + 4} textAnchor="middle" fontSize="12" fill={color}>
                  {label}
                </text>
              </g>
            )
          })}

          {ordered.map((c) => {
            const on = selected('component', c.id)
            const dot = handle(c)
            const offered = linkingFrom !== null && linkingFrom !== c.id && cannotConnect(graph, linkingFrom, c.id) === null
            const dim = linkingFrom !== null && linkingFrom !== c.id && !offered
            const stroke = flagged.has(c.id) ? PROBLEM : on ? SELECTED : offered ? '#5fd38d' : '#0b0d10'
            const strokeWidth = on || offered || flagged.has(c.id) ? 3 : 1.5
            const size = isResonator(c) ? barSize(c) : null
            const hit = size ? strikePoint(c) : null
            return (
              <g
                key={c.id}
                data-component={c.id}
                tabIndex={0}
                role="button"
                aria-pressed={on}
                aria-label={`${c.name}. Enter selects, Space strikes, arrow keys move, Delete removes.`}
                opacity={dim ? 0.35 : 1}
                className="cursor-grab outline-none focus-visible:[&>.body]:stroke-[#6cb2ff]"
                onKeyDown={(e) => keys(e, c)}
                onPointerDown={(e) => press(e, c)}
              >
                <title>{`${TYPES[c.type].description} Double-click to strike.`}</title>
                {size ? (
                  <>
                    <rect className="body" x={c.x - size.w / 2} y={c.y - size.h / 2} width={size.w} height={size.h} rx="5" fill={FILL[c.type]} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={offered ? '6 4' : undefined} />
                    {/* Where it is struck. */}
                    <path d={`M${hit!.x - 7} ${hit!.y - 10}h14l-7 10z`} fill={STRIKE_COLOR} />
                  </>
                ) : (
                  <>
                    <circle className="body" cx={c.x} cy={c.y} r={EXCITER_RADIUS} fill={FILL[c.type]} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={offered ? '6 4' : undefined} />
                    <text x={c.x} y={c.y + 5} textAnchor="middle" fontSize="13" fontWeight="600" fill="#111418" pointerEvents="none">
                      {c.type === 'mallet' ? 'mallet' : 'pulse'}
                    </text>
                  </>
                )}
                <text x={c.x} y={size ? c.y - size.h / 2 - 16 : c.y - EXCITER_RADIUS - 8} textAnchor="middle" fontSize="13" fill="#c9d1d9" pointerEvents="none">
                  {c.name}
                </text>
                {/* The dot connections are dragged from, with a generous invisible area around it. */}
                <circle data-handle={c.id} cx={dot.x} cy={dot.y} r={HANDLE_REACH} fill="transparent" className="cursor-crosshair">
                  <title>Drag from here to another component to connect them</title>
                </circle>
                <circle cx={dot.x} cy={dot.y} r="9" fill="#111418" stroke={size ? LINK_COLOR : STRIKE_COLOR} strokeWidth="2.5" pointerEvents="none" />
                <circle cx={dot.x} cy={dot.y} r="3" fill={size ? LINK_COLOR : STRIKE_COLOR} pointerEvents="none" />
                {struck.ids.includes(c.id) && hit && <circle key={struck.n} className="struck" cx={hit.x} cy={hit.y} r="16" fill="none" stroke="#fff" strokeWidth="3" pointerEvents="none" />}
              </g>
            )
          })}

          {drag?.kind === 'link' &&
            (() => {
              const from = graph.components.find((c) => c.id === drag.from)
              if (!from || !hover) return null
              const a = handle(from)
              const color = hover.ok ? '#5fd38d' : '#c9d1d9'
              const width = Math.min(560, 7.2 * hover.text.length + 20)
              const x = Math.min(CANVAS.width - width / 2 - 6, Math.max(width / 2 + 6, drag.at.x))
              const y = Math.max(24, drag.at.y - 26)
              return (
                <g pointerEvents="none">
                  <line x1={a.x} y1={a.y} x2={drag.at.x} y2={drag.at.y} stroke={color} strokeWidth="2.5" strokeDasharray="5 4" />
                  <rect x={x - width / 2} y={y - 14} width={width} height="22" rx="6" fill="#0b0d10" stroke={color} />
                  <text x={x} y={y + 2} textAnchor="middle" fontSize="12.5" fill={color}>
                    {hover.text}
                  </text>
                </g>
              )
            })()}
        </svg>
      </div>
      <ul aria-label="What the lines mean" className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-neutral-400">
        <li>
          <span style={{ color: STRIKE_COLOR }}>- - ▸ strikes</span>: an exciter hitting a bar
        </li>
        <li>
          <span style={{ color: LINK_COLOR }}>⌇ spring</span>, <span style={{ color: LINK_COLOR }}>┅ damper</span>: a physical link between two bars
        </li>
        <li>
          <span style={{ color: STRIKE_COLOR }}>▼</span> where a bar is struck
        </li>
        <li>
          <span style={{ color: LINK_COLOR }}>◉</span> drag from a dot to another component to connect them
        </li>
        <li>Double-click a bar or exciter to strike it</li>
      </ul>
    </div>
  )
}
