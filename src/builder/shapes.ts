// EXPERIMENTAL (Phase 3B). Where things are drawn on the builder's canvas.
// Pure geometry, shared by drawing and by pointer hit-testing.
import { isBody, isResonator, isString, type Component, type Connection, type Graph } from './graph.ts'

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

/** Where on the body's top edge the bridge stands, as a fraction of its drawn width (the real plate's 0.08). */
const BRIDGE_ON_BODY = 0.08

/**
 * Drawn size of anything drawn as a rectangle: a bar, a string (a thin line
 * whose length follows its length) or a body. null for exciters, which are circles.
 */
export function rectSize(c: Component): { w: number; h: number } | null {
  if (isResonator(c)) return barSize(c)
  if (isString(c)) return { w: clamp(70 + 300 * c.params.length, 80, 520), h: 10 }
  if (isBody(c)) return { w: 300, h: 130 }
  return null
}

/**
 * The dot connections are dragged from: on a bar, where springs attach; on an
 * exciter, its tip; on a string, its bridge end; on a body, where the bridge stands.
 */
export function handle(c: Component): Point {
  if (isString(c)) return { x: c.x + rectSize(c)!.w / 2, y: c.y + 5 }
  if (isBody(c)) return { x: c.x - 150 + BRIDGE_ON_BODY * 300, y: c.y - 65 }
  if (!isResonator(c)) return { x: c.x, y: c.y + EXCITER_RADIUS }
  const { w, h } = barSize(c)
  return { x: c.x - w / 2 + clamp(c.params.connectionPosition, 0, 1) * w, y: c.y + h / 2 }
}

/** Where a bar is struck, or a string plucked. */
export function strikePoint(bar: Component): Point {
  const { w, h } = rectSize(bar)!
  return { x: bar.x - w / 2 + clamp(isString(bar) ? bar.params.pluckPosition : bar.params.strikePosition, 0, 1) * w, y: bar.y - h / 2 }
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
    const size = rectSize(c)
    if (size) {
      const { w, h } = size
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
  const { w, h } = rectSize(c) ?? { w: 2 * EXCITER_RADIUS, h: 2 * EXCITER_RADIUS }
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

// ---- Playing a string on the canvas (Phase 3D.1) --------------------------------------------------------

/** The left end of a drawn string, px: the part it is picked up and moved by. The rest is played. */
export const STRING_GRIP = 26
/**
 * Metres the real string is pulled aside for each canvas unit the pointer is
 * dragged across it: a quarter of a millimetre. Along the string a unit is
 * about 2.5 mm, so the sideways movement is drawn about ten times larger than
 * life; a real pluck moves a string a few millimetres.
 */
export const PULL_SCALE = 0.00025
/** A press that moves across the string by less than this is a click, px. */
export const PULL_STARTS = 4
/** The farthest the string is drawn pulled aside, px (10 mm). */
export const PULL_LIMIT = 40

/**
 * Where along a string a point is, as a fraction of its length from the fixed
 * end, if the point is on the part that is played; null if it is not on the
 * string, or is on its grip. Kept within the range of the Pluck position property.
 */
export function playPoint(c: Component, p: Point): number | null {
  if (!isString(c)) return null
  const { w } = rectSize(c)!
  const left = c.x - w / 2
  if (p.x < left + STRING_GRIP || p.x > left + w || Math.abs(p.y - c.y) > 14) return null
  return Math.min(0.95, Math.max(0.05, Number(((p.x - left) / w).toFixed(2))))
}
