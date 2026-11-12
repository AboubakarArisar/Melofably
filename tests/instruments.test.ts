// The model registry and the interface's parameter state: every control must
// exist in its compiled Faust model, values must persist per instrument, and
// WebAssembly must be compiled once and failures reported usefully.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { compileInstrument, INSTRUMENT_IDS, instrumentParams, MODELS, preloadInstruments } from '../src/audio/worklet/instruments'
import { defaultValues, IDS, INSTRUMENTS, withValue } from '../src/instrumentUI'

describe('parameter schema', () => {
  test('the selector lists every model exactly once', () => {
    expect([...IDS].sort()).toEqual([...INSTRUMENT_IDS].sort())
    expect(new Set(IDS).size).toBe(IDS.length)
  })

  test('every control on screen is a real parameter of its compiled model', () => {
    for (const id of IDS) {
      for (const { key } of INSTRUMENTS[id].controls) {
        const param = instrumentParams[id][key]
        expect(param, `${id}.${key}`).toBeDefined()
        expect(param.address).toBe(`/${id}/${key}`)
        expect(param.min).toBeLessThan(param.max)
        expect(param.init).toBeGreaterThanOrEqual(param.min)
        expect(param.init).toBeLessThanOrEqual(param.max)
        expect(param.step).toBeGreaterThan(0)
      }
      // The note selector and the trigger exist too, and are not shown as sliders.
      const { note, trigger } = MODELS[id]
      expect(instrumentParams[id][note], `${id}.${note}`).toBeDefined()
      expect(instrumentParams[id][trigger], `${id}.${trigger}`).toBeDefined()
      const shown = INSTRUMENTS[id].controls.map((c) => c.key)
      expect(shown).not.toContain(note)
      expect(shown).not.toContain(trigger)
    }
  })

  test('readouts and frequencies are computable at the default values', () => {
    const values = defaultValues()
    for (const id of IDS) {
      expect(INSTRUMENTS[id].frequency(values[id], 0)).toBeGreaterThan(20)
      expect(INSTRUMENTS[id].frequency(values[id], 12) / INSTRUMENTS[id].frequency(values[id], 0)).toBeCloseTo(2, 6)
      for (const note of [null, 0, 24]) {
        const readouts = INSTRUMENTS[id].readouts(values[id], note)
        expect(readouts).toHaveLength(3)
        for (const r of readouts) expect(r.value, `${id}: ${r.label}`).not.toMatch(/NaN|undefined|Infinity/)
      }
    }
  })
})

describe('parameter persistence', () => {
  test('defaults are the values declared in each Faust model', () => {
    const values = defaultValues()
    for (const id of IDS) {
      expect(Object.keys(values[id])).toEqual(INSTRUMENTS[id].controls.map((c) => c.key))
      for (const [key, value] of Object.entries(values[id])) expect(value).toBe(instrumentParams[id][key].init)
    }
  })

  test('changing one instrument leaves every other instrument as it was', () => {
    const initial = defaultValues()
    let values = initial
    values = withValue(values, 'wood', 'thickness', 24)
    values = withValue(values, 'glass', 'thickness', 2)
    values = withValue(values, 'string', 'tension', 120)
    // Instruments share parameter names (thickness, density...); each keeps its own.
    expect(values.wood.thickness).toBe(24)
    expect(values.glass.thickness).toBe(2)
    expect(values.bar.thickness).toBe(instrumentParams.bar.thickness.init)
    expect(values.string.tension).toBe(120)
    expect(values.bar).toBe(initial.bar) // untouched instruments are not even copied
    expect(values.wood.length).toBe(initial.wood.length)
    // Selecting other instruments is not an edit: nothing here depends on which is selected.
    values = withValue(values, 'bar', 'hardness', 1)
    expect(values.wood.thickness).toBe(24)
    expect(initial.wood.thickness).toBe(instrumentParams.wood.thickness.init) // the original was not mutated
  })
})

describe('loading the compiled models', () => {
  const fetched: string[] = []
  let respond: (url: string) => { ok: boolean; status: number }

  beforeEach(() => {
    fetched.length = 0
    respond = () => ({ ok: true, status: 200 })
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url)
      return respond(url)
    })
    vi.spyOn(WebAssembly, 'compileStreaming').mockImplementation(async () => ({ compiledFrom: fetched.at(-1) }) as unknown as WebAssembly.Module)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test('a failed load names the model, is not cached, and can be retried', async () => {
    respond = () => ({ ok: false, status: 404 })
    await expect(compileInstrument('bar')).rejects.toThrow('Could not load the bar model (HTTP 404)')
    await expect(compileInstrument('bar')).rejects.toThrow('HTTP 404')
    expect(fetched).toHaveLength(2) // tried again rather than replaying the failure
    respond = () => ({ ok: true, status: 200 })
    await expect(compileInstrument('bar')).resolves.toBeDefined()
    expect(fetched).toHaveLength(3)
  })

  test('each model is fetched and compiled once, however often it is used', async () => {
    const first = await compileInstrument('glass')
    const again = await Promise.all([compileInstrument('glass'), compileInstrument('glass'), compileInstrument('glass')])
    expect(again.every((m) => m === first)).toBe(true)
    expect(fetched.filter((url) => url === MODELS.glass.wasmUrl)).toHaveLength(1)
  })

  test('preloading compiles every model and swallows failures until first use', async () => {
    respond = (url) => (url === MODELS.wood.wasmUrl ? { ok: false, status: 500 } : { ok: true, status: 200 })
    await preloadInstruments() // must not throw or reject
    // Models not compiled by an earlier test were fetched by the preload.
    expect(fetched).toContain(MODELS.string.wasmUrl)
    expect(fetched).toContain(MODELS.wood.wasmUrl)
    const before = fetched.length
    for (const id of INSTRUMENT_IDS.filter((id) => id !== 'wood')) await expect(compileInstrument(id)).resolves.toBeDefined()
    expect(fetched).toHaveLength(before) // already compiled: no further requests
    await expect(compileInstrument('wood')).rejects.toThrow('Could not load the wood model (HTTP 500)')
  })
})
