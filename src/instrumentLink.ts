// The Instruments page's settings as text: in a link (#string?tension=80)
// and in the browser's storage. Whatever comes back in is untrusted: only
// known controls are taken, and every value is held to its control's range,
// so a stale or edited link can never set a model outside what it allows.
import type { InstrumentId } from './types'

export type Values = Record<string, number>
export type Ranges = Record<string, Record<string, { min: number; max: number; init: number }>>

const hold = (value: unknown, r: { min: number; max: number }): number | null => (typeof value === 'number' && Number.isFinite(value) ? Math.min(r.max, Math.max(r.min, value)) : null)

/** `values` with anything unknown dropped and everything else inside its range; missing controls take `base`. */
export function sanitize(values: unknown, ranges: Ranges[string], base: Values): Values {
  const out = { ...base }
  if (values && typeof values === 'object' && !Array.isArray(values)) for (const key of Object.keys(base)) out[key] = hold((values as Record<string, unknown>)[key], ranges[key]) ?? base[key]
  return out
}

/** The link for an instrument: its name, then only the controls that differ from their defaults. */
export function writeLink(id: string, values: Values, ranges: Ranges[string]): string {
  const changed = Object.keys(values).filter((key) => values[key] !== ranges[key].init)
  return `#${id}${changed.length ? '?' : ''}${changed.map((key) => `${key}=${Number(values[key].toPrecision(6))}`).join('&')}`
}

/** What a link names: an instrument and, if it carries any, its settings. Null if it names no instrument. */
export function readLink<Id extends string = InstrumentId>(hash: string, ids: readonly Id[], ranges: Ranges, base: Record<Id, Values>): { id: Id; values: Values | null } | null {
  const [name, query] = hash.replace(/^#/, '').split('?')
  const id = ids.find((x) => x === name)
  if (!id) return null
  if (!query) return { id, values: null }
  const given: Record<string, number> = {}
  for (const [key, value] of new URLSearchParams(query)) if (value.trim() !== '') given[key] = Number(value)
  return { id, values: sanitize(given, ranges[id], base[id]) }
}
