// Saving and sharing: what goes into a link comes back out unchanged, and
// what comes in from a link or from storage can never put a control outside
// its range.
import { describe, expect, it } from 'vitest'
import { EXAMPLES, STRING_EXAMPLES } from '../src/builder/examples'
import { deserialize, serialize } from '../src/builder/graph'
import { hybridTemplate, openText, saveText } from '../src/builder/hybrid'
import { readLink, sanitize, writeLink, type Ranges } from '../src/instrumentLink'
import { fileName, fromLink, linked, toLink } from '../src/ui/share'

describe('links carry text unchanged', () => {
  it('round-trips plain, accented and symbol text', () => {
    for (const text of ['', 'a', '{"name":"Bar & string"}', 'Über-Saite √(T/μ) 🎻', 'x'.repeat(5000)]) expect(fromLink(toLink(text))).toBe(text)
  })
  it('writes only characters that are safe in an address', () => {
    expect(toLink('?>?>??~~ÿþ')).toMatch(/^[A-Za-z0-9_-]*$/)
  })
  it('refuses what it did not write', () => {
    expect(fromLink('%%%')).toBeNull()
    expect(fromLink(toLink('ok').slice(0, 1))).toBeNull()
    expect(linked('i', '#x=abc')).toBeNull()
    expect(linked('i', `#i=${toLink('hello')}`)).toBe('hello')
  })
  it('names files after the instrument', () => {
    expect(fileName('  My Bar & String! ')).toBe('my-bar-string.melofably.json')
    expect(fileName('***')).toBe('instrument.melofably.json')
  })
})

describe('a builder instrument survives a link', () => {
  it('classic instruments', () => {
    for (const example of [...EXAMPLES, ...STRING_EXAMPLES]) {
      const graph = example.make()
      expect(deserialize(fromLink(toLink(serialize(graph)))!)).toEqual(graph)
    }
  })
  it('the hybrid', () => {
    const graph = hybridTemplate(0.18)
    expect(openText(fromLink(toLink(saveText(graph)))).graph).toEqual(openText(saveText(graph)).graph)
  })
  it('a damaged link is refused, not half-read', () => {
    const code = toLink(serialize(EXAMPLES[0].make()))
    const text = fromLink(code.slice(0, code.length - 40))
    expect(() => deserialize(text ?? 'not json')).toThrow()
    expect(openText('{"not":"an instrument"}').graph).toBeNull()
  })
})

describe('instrument settings in a link', () => {
  const ranges: Ranges = { string: { tension: { min: 30, max: 200, init: 73.5 }, length: { min: 0.3, max: 1.2, init: 0.65 } }, bar: { length: { min: 0.1, max: 0.5, init: 0.3 } } }
  const base = { string: { tension: 73.5, length: 0.65 }, bar: { length: 0.3 } }
  const ids = ['string', 'bar'] as const

  it('writes only what was changed', () => {
    expect(writeLink('string', base.string, ranges.string)).toBe('#string')
    expect(writeLink('string', { tension: 147, length: 0.65 }, ranges.string)).toBe('#string?tension=147')
  })
  it('reads back what it wrote', () => {
    const values = { tension: 91.25, length: 0.8 }
    expect(readLink(writeLink('string', values, ranges.string), ids, ranges, base)).toEqual({ id: 'string', values })
    expect(readLink('#bar', ids, ranges, base)).toEqual({ id: 'bar', values: null })
  })
  it('holds every value to its range and ignores what it does not know', () => {
    expect(readLink('#string?tension=1e9&length=-4&volume=11&evil=<script>', ids, ranges, base)).toEqual({ id: 'string', values: { tension: 200, length: 0.3 } })
    expect(readLink('#string?tension=abc&length=', ids, ranges, base)).toEqual({ id: 'string', values: base.string })
    expect(readLink('#theremin?tension=80', ids, ranges, base)).toBeNull()
    expect(readLink('', ids, ranges, base)).toBeNull()
  })
  it('stored settings are cleaned the same way', () => {
    expect(sanitize({ tension: 'loud', length: 99, extra: 1 }, ranges.string, base.string)).toEqual({ tension: 73.5, length: 1.2 })
    expect(sanitize(null, ranges.string, base.string)).toEqual(base.string)
    expect(sanitize([1, 2], ranges.string, base.string)).toEqual(base.string)
  })
})
