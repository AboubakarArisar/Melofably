// EXPERIMENTAL (Phase 3B). The builder's canvas: components are dragged by
// their body, and connected by dragging from a component's dot to another
// component. Everything drawn here is read from the graph.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cannotConnect, CONNECTION_LABELS, isResonator, TYPES, type Component, type Graph } from './graph.ts'
import { barSize, CANVAS, componentAt, ends, EXCITER_RADIUS, handle, strikePoint, zigzag, type Point } from './shapes.ts'

export type Selection = { kind: 'component' | 'connection'; id: string } | null

interface Props {
  graph: Graph
  selection: Selection
  /** Identifiers with a problem, outlined in red. */
  flagged: Set<string>
  onSelect(selection: Selection): void
  onMove(id: string, x: number, y: number): void
  onConnect(from: string, to: string): void
  onRemove(): void
}

type Drag = { kind: 'move'; id: string; dx: number; dy: number } | { kind: 'link'; from: string; at: Point } | null

const FILL: Record<Component['type'], string> = { metalBar: '#8b9bb0', woodBar: '#a87545', mallet: '#d8c59a', impulse: '#7fb2d9' }

export function Canvas({ graph, selection, flagged, onSelect, onMove, onConnect, onRemove }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<Drag>(null)

  const local = (e: PointerEvent): Point => {
    const box = svg.current!.getBoundingClientRect()
    // The drawing scales with the page; positions are kept in its own 920 x 560 units.
    return { x: ((e.clientX - box.left) * CANVAS.width) / box.width, y: ((e.clientY - box.top) * CANVAS.height) / box.height }
  }
  const within = (x: number, y: number): [number, number] => [Math.min(CANVAS.width - 40, Math.max(40, x)), Math.min(CANVAS.height - 40, Math.max(40, y))]

  const grab = (e: PointerEvent, next: Drag) => {
    e.stopPropagation()
    svg.current!.setPointerCapture(e.pointerId)
    setDrag(next)
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
    if (e.key === 'Enter' || e.key === ' ') onSelect({ kind: 'component', id: c.id })
    else if (e.key in by) onMove(c.id, ...within(c.x + by[e.key][0], c.y + by[e.key][1]))
    else if (e.key === 'Delete' || e.key === 'Backspace') onRemove()
    else return
    e.preventDefault()
  }

  const linkingFrom = drag?.kind === 'link' ? drag.from : null
  const selected = (kind: 'component' | 'connection', id: string) => selection?.kind === kind && selection.id === id

  return (
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
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0L10 5L0 10z" fill="#d8c59a" />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />

        {graph.components.length === 0 && (
          <text x={CANVAS.width / 2} y={CANVAS.height / 2} textAnchor="middle" fill="#8a94a0" fontSize="16">
            <tspan x={CANVAS.width / 2}>Nothing here yet.</tspan>
            <tspan x={CANVAS.width / 2} dy="26">Add a bar from the Add list, then a mallet, and drag from the mallet's dot to the bar.</tspan>
            <tspan x={CANVAS.width / 2} dy="26">Or load an example from the top of the page.</tspan>
          </text>
        )}

        {graph.connections.map((link) => {
          const line = ends(graph, link)
          if (!line) return null
          const [a, b] = line
          const on = selected('connection', link.id)
          const color = flagged.has(link.id) ? '#ff6b6b' : on ? '#6cb2ff' : link.type === 'strike' ? '#d8c59a' : '#c9d1d9'
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
              <title>{`${CONNECTION_LABELS[link.type]}: select to edit`}</title>
              {/* A wide invisible line, so that a thin connection is easy to pick. */}
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="22" />
              {link.type === 'strike' && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={on ? 3 : 2} strokeDasharray="6 5" markerEnd="url(#arrow)" />}
              {(link.type === 'spring' || link.type === 'springDamper') && <polyline points={zigzag(a, b)} fill="none" stroke={color} strokeWidth={on ? 3 : 2} strokeLinejoin="round" />}
              {link.type === 'damper' && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={on ? 7 : 6} strokeDasharray="2 6" />}
              {link.type === 'springDamper' && <line x1={a.x + 9} y1={a.y} x2={b.x + 9} y2={b.y} stroke={color} strokeWidth="5" strokeDasharray="2 6" />}
            </g>
          )
        })}

        {graph.components.map((c) => {
          const on = selected('component', c.id)
          const dot = handle(c)
          const offered = linkingFrom !== null && linkingFrom !== c.id && cannotConnect(graph, linkingFrom, c.id) === null
          const dim = linkingFrom !== null && linkingFrom !== c.id && !offered
          const stroke = flagged.has(c.id) ? '#ff6b6b' : on ? '#6cb2ff' : offered ? '#5fd38d' : '#0b0d10'
          const strokeWidth = on || offered || flagged.has(c.id) ? 3 : 1.5
          const size = isResonator(c) ? barSize(c) : null
          return (
            <g
              key={c.id}
              data-component={c.id}
              tabIndex={0}
              role="button"
              aria-pressed={on}
              aria-label={`${c.name}. Enter selects, arrow keys move, Delete removes.`}
              opacity={dim ? 0.35 : 1}
              className="cursor-grab outline-none focus-visible:[&>.body]:stroke-[#6cb2ff]"
              onKeyDown={(e) => keys(e, c)}
              onPointerDown={(e) => {
                onSelect({ kind: 'component', id: c.id })
                const p = local(e)
                grab(e, { kind: 'move', id: c.id, dx: p.x - c.x, dy: p.y - c.y })
              }}
            >
              <title>{TYPES[c.type].description}</title>
              {size ? (
                <>
                  <rect className="body" x={c.x - size.w / 2} y={c.y - size.h / 2} width={size.w} height={size.h} rx="5" fill={FILL[c.type]} stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={offered ? '6 4' : undefined} />
                  {/* Where it is struck. */}
                  <path d={`M${strikePoint(c).x - 6} ${strikePoint(c).y - 9}h12l-6 9z`} fill="#e6e8eb" />
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
              <circle
                data-handle={c.id}
                cx={dot.x}
                cy={dot.y}
                r="8"
                fill="#111418"
                stroke="#e6e8eb"
                strokeWidth="2"
                className="cursor-crosshair"
                onPointerDown={(e) => {
                  onSelect({ kind: 'component', id: c.id })
                  grab(e, { kind: 'link', from: c.id, at: local(e) })
                }}
              >
                <title>Drag from here to another component to connect them</title>
              </circle>
            </g>
          )
        })}

        {drag?.kind === 'link' &&
          (() => {
            const from = graph.components.find((c) => c.id === drag.from)
            if (!from) return null
            const a = handle(from)
            return <line x1={a.x} y1={a.y} x2={drag.at.x} y2={drag.at.y} stroke="#5fd38d" strokeWidth="2" strokeDasharray="5 4" pointerEvents="none" />
          })()}
      </svg>
    </div>
  )
}
