// EXPERIMENTAL (Phase 3B). Where things are drawn on the builder's canvas.
// Pure geometry, shared by drawing and by pointer hit-testing.
import { isResonator, type Component, type Connection, type Graph } from './graph.ts'

export interface Point {
  x: number
  y: number
}

export const EXCITER_RADIUS = 26
/** Size of the canvas, px. */
export const CANVAS = { width: 920, height: 560 }
// A value being typed may not be a number yet; draw it at its lowest rather than not at all.
const clamp = (v: number, low: number, high: number) => (Number.isFinite(v) ? Math.min(high, Math.max(low, v)) : low)

/** Drawn size of a bar: longer and thicker bars are drawn longer and thicker (not to scale). */
export const barSize = (bar: Component) => ({ w: clamp(70 + 300 * bar.params.length, 80, 520), h: clamp(12 + 0.9 * bar.params.thickness, 16, 48) })

/** The dot connections are dragged from: on a bar, where springs attach; on an exciter, its tip. */
export function handle(c: Component): Point {
  if (!isResonator(c)) return { x: c.x, y: c.y + EXCITER_RADIUS }
  const { w, h } = barSize(c)
  return { x: c.x - w / 2 + clamp(c.params.connectionPosition, 0, 1) * w, y: c.y + h / 2 }
}

/** Where a bar is struck. */
export function strikePoint(bar: Component): Point {
  const { w, h } = barSize(bar)
  return { x: bar.x - w / 2 + clamp(bar.params.strikePosition, 0, 1) * w, y: bar.y - h / 2 }
}

/** The two ends of a connection as drawn. */
export function ends(graph: Graph, link: Connection): [Point, Point] | null {
  const [from, to] = [graph.components.find((c) => c.id === link.from), graph.components.find((c) => c.id === link.to)]
  if (!from || !to) return null
  return link.type === 'strike' ? [handle(from), strikePoint(to)] : [handle(from), handle(to)]
}

/** The component under a point (topmost first), with a little margin so that a drop near it counts. */
export function componentAt(graph: Graph, p: Point, margin = 14): string | null {
  for (const c of [...graph.components].reverse()) {
    if (isResonator(c)) {
      const { w, h } = barSize(c)
      if (Math.abs(p.x - c.x) <= w / 2 + margin && Math.abs(p.y - c.y) <= h / 2 + margin) return c.id
    } else if (Math.hypot(p.x - c.x, p.y - c.y) <= EXCITER_RADIUS + margin) return c.id
  }
  return null
}

/** A zigzag from a to b, for drawing a spring. */
export function zigzag(a: Point, b: Point, teeth = 9, amplitude = 7): string {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const length = Math.hypot(dx, dy) || 1
  const [nx, ny] = [-dy / length, dx / length]
  const points = [`${a.x},${a.y}`]
  for (let i = 1; i <= teeth; i++) {
    const t = 0.15 + (0.7 * (i - 0.5)) / teeth
    const side = i % 2 ? amplitude : -amplitude
    points.push(`${a.x + dx * t + nx * side},${a.y + dy * t + ny * side}`)
  }
  points.push(`${b.x},${b.y}`)
  return points.join(' ')
}

/**
 * How close to a component's dot a press must be to start a connection
 * rather than a move. Deliberately generous: the dot is small, and missing it
 * would move the component instead, which is not what was meant.
 */
export const HANDLE_REACH = 18

/** Whether a press at `p` is on the component's dot. */
export const onHandle = (c: Component, p: Point): boolean => Math.hypot(p.x - handle(c).x, p.y - handle(c).y) <= HANDLE_REACH

/** The rectangle a component occupies as drawn, with its name above it. */
function box(c: Component) {
  const [w, h] = isResonator(c) ? [barSize(c).w, barSize(c).h] : [2 * EXCITER_RADIUS, 2 * EXCITER_RADIUS]
  return { left: c.x - w / 2 - 12, right: c.x + w / 2 + 12, top: c.y - h / 2 - 30, bottom: c.y + h / 2 + 18 }
}

/**
 * Where to put a new component so that it does not cover one already there:
 * exciters along the top, bars below, scanning left to right and then down.
 * If the canvas is full it goes to the first position.
 */
export function freeSpot(graph: Graph, exciter: boolean, size = { w: 190, h: 70 }): Point {
  // Bars start on a different row each time, so that connections between neighbours run diagonally and stay readable.
  const bars = graph.components.filter(isResonator).length
  const barRows = [250, 340, 430]
  const rows = exciter ? [90, 170] : [...barRows.slice(bars % 3), ...barRows.slice(0, bars % 3), 500, 170]
  for (const y of rows) {
    for (let x = 150; x <= CANVAS.width - 120; x += 40) {
      const mine = { left: x - size.w / 2, right: x + size.w / 2, top: y - size.h / 2, bottom: y + size.h / 2 }
      const clear = graph.components.every((c) => {
        const other = box(c)
        return mine.right < other.left || mine.left > other.right || mine.bottom < other.top || mine.top > other.bottom
      })
      if (clear) return { x, y }
    }
  }
  return { x: 150, y: rows[0] }
}
