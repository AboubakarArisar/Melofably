// MVP: the hybrid instrument in the builder (src/builder/hybrid.ts): its
// template, the edits allowed, how it becomes engine calls, and saving. The
// page itself was checked in a browser; this holds the logic under it.
import { describe, expect, test } from 'vitest'
import { createHybridWorklet } from '../analysis/hybrid-worklet'
import { compileHybrid, hybridTemplate, IDS, openText, rename, saveText, setMaterial, setPads, setParam, setPort, setStriker, setTie } from '../src/builder/hybrid'
import { describeAssembly } from '../src/experimental/graph2/assembly'
import { stringOnBodyFixture } from '../src/experimental/graph2/fixtures'
import { serialize } from '../src/experimental/graph2/io'
import { errorsOf, validate } from '../src/experimental/graph2/validate'
import { Controls, FULL_SCALE, PLUCK_FORCE, STRIKE_SPEED } from '../src/experimental/hybrid/instrument'
import { BAR_TOUCH, buildStringBarBody, dampable } from '../src/experimental/string/stringBarBody'
import { radiation } from '../src/experimental/string/stringBody'
import { EXAMPLES } from '../src/builder/examples'
import { serialize as writeV1 } from '../src/builder/graph'
import { SR } from './helpers'

describe('The hybrid in the builder', () => {
  test('each template is the validated hybrid: the same description, and the same engine calls as the standalone reference', () => {
    for (const tie of [0.2, 0.18] as const) {
      const g = hybridTemplate(tie)
      expect(validate(g)).toEqual([])
      expect(describeAssembly(g).spec).toEqual(dampable(0.5, tie))
      const r = radiation(SR)
      expect(compileHybrid(g, SR).calls, `tie ${tie}`).toEqual([...buildStringBarBody(dampable(0.5, tie), SR).calls, ['radiate', r.perSample, r.b0, r.b1, r.a1, FULL_SCALE]])
    }
    // The page starts where the Hybrid Lab measured the pluck and the stroke to be 2.6 dB apart.
    expect([PLUCK_FORCE.default, STRIKE_SPEED.default]).toEqual([4, 0.5])
  })

  test('edits change what they say and nothing else; identities never change; the second pad follows the bar', () => {
    const g = hybridTemplate()
    const ids = (x: typeof g) => [...x.components, ...x.connections, ...x.targets].map((i) => i.id)
    const edited = setStriker(setPads(setTie(setMaterial(setPort(setPort(setParam(setParam(g, IDS.bar, 'length', 0.25), IDS.string, 'tension', 80), IDS.bar, 'tie', 0.19), IDS.bar, 'touch', 0.05), 'brass'), { stiffness: 5e5 }), { stiffness: 2e6, damping: 8 }), { mass: 0.01 })
    expect(ids(edited)).toEqual(ids(g))
    expect(errorsOf(validate(edited))).toEqual([])
    const spec = describeAssembly(edited).spec as ReturnType<typeof dampable>
    expect(spec).toMatchObject({ tension: 80, stringOnBar: { at: 0.19, stiffness: 5e5 }, mount: { stiffness: 2e6, damping: 8 }, mallet: { mass: 0.01 }, touchBar: { at: 0.05 } })
    expect(spec.bar).toMatchObject({ length: 0.25, density: 8500 })
    // Moving a pad, or changing the bar's length, moves the second pad's place on the board with it: the bar never has to stretch.
    for (const moved of [setParam(g, IDS.bar, 'length', 0.3), setPort(g, IDS.bar, 'pad-a', 0.1), setPort(g, IDS.bar, 'pad-b', 0.9)]) expect(errorsOf(validate(moved))).toEqual([])
    expect(g).toEqual(hybridTemplate()) // the original is not touched
    // A change that has no meaning is refused in words, not built.
    const off = setPort(g, IDS.bar, 'tie', 1.4)
    expect(errorsOf(validate(off))[0].message).toMatch(/not on it/)
    expect(() => compileHybrid(off, SR)).toThrow(/cannot be described/)
  })

  test('it plays through the Hybrid Lab\'s controls: pluck, strike, and the two fingers down together', async () => {
    const lab = compileHybrid(hybridTemplate(), SR)
    const w = await createHybridWorklet(lab.calls)
    const c = new Controls(lab, (calls) => w.send(calls))
    c.pluck(PLUCK_FORCE.default)
    c.strike(STRIKE_SPEED.default)
    w.render(4800)
    const [string, bar] = [w.engine.resonatorEnergy(lab.string), w.engine.resonatorEnergy(lab.bar!)]
    expect(string).toBeGreaterThan(1e-3)
    expect(bar).toBeGreaterThan(1e-6)
    c.hold('mute', 'latch', true)
    c.hold('damp', 'key', true)
    w.render(SR / 2)
    expect((w.diag().fingers as { damping: number }[]).map((f) => f.damping)).toEqual([expect.any(Number), BAR_TOUCH.medium.damping])
    expect(w.engine.resonatorEnergy(lab.string)).toBeLessThan(1e-3 * string)
    expect(w.engine.resonatorEnergy(lab.bar!)).toBeLessThan(1e-2 * bar)
    expect(w.engine.faults()).toBe(0)
  }, 400000)

  test('saved as version 2 and opened again it is the same instrument; what cannot be used is refused safely and left alone', () => {
    const g = rename(setPort(setParam(hybridTemplate(0.18), IDS.bar, 'length', 0.21), IDS.bar, 'tie', 0.19), 'My hybrid')
    const text = saveText(g)
    expect(JSON.parse(text).version).toBe(2)
    const opened = openText(text)
    expect(opened.problem).toBeUndefined()
    expect(saveText(opened.graph!)).toBe(text)
    expect(opened.graph!.meta.name).toBe('My hybrid')
    expect(compileHybrid(opened.graph!, SR).calls).toEqual(compileHybrid(g, SR).calls)
    expect(openText(null)).toEqual({ graph: null })
    for (const bad of ['', '{', '[]', '{"version": 9}', JSON.stringify({ ...JSON.parse(text), nextId: 2 }), text.replace('"tie"', '"weld"')]) {
      const r = openText(bad)
      expect(r.graph, bad.slice(0, 20)).toBeNull()
      expect(r.problem!.length).toBeGreaterThan(10)
    }
    // A version 1 instrument and a version 2 instrument that is not this assembly are each said to be what they are.
    expect(openText(writeV1(EXAMPLES[0].make())).problem).toMatch(/older format/)
    expect(openText(serialize(stringOnBodyFixture())).problem).toMatch(/one kind of hybrid/)
  })
})
