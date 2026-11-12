// Regression against the approved sound. tests/baseline/*.wav hold the exact
// samples each model produced when it was approved; any change to a model, to
// the shared DSP library or to the build must reproduce them.
import { readFileSync } from 'node:fs'
import { WavDecoder } from '@grame/faustwasm'
import { describe, expect, test } from 'vitest'
import { BASELINE_VARIATION, createBar, createGlass, createString, createWood, dB, playBaseline, rms, SR } from './helpers'

const CREATE = { string: createString, bar: createBar, glass: createGlass, wood: createWood }
type Name = keyof typeof CREATE

function baseline(name: Name): Float32Array {
  const file = readFileSync(new URL(`./baseline/${name}.wav`, import.meta.url))
  const wav = WavDecoder.decode(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))
  expect(wav.sampleRate).toBe(SR)
  return wav.channelData[0]
}

const render = async (name: Name) => playBaseline(await CREATE[name](), BASELINE_VARIATION[name])

function difference(a: Float32Array, b: Float32Array) {
  let worst = 0
  let differing = 0
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i])
    if (d > 0) differing++
    worst = Math.max(worst, d)
  }
  return { worst, differing }
}

describe('regression against approved baselines', () => {
  const report: Record<string, Record<string, string | number>> = {}

  for (const name of Object.keys(CREATE) as Name[]) {
    test(`${name} reproduces its approved baseline`, async () => {
      const expected = baseline(name)
      const actual = await render(name)
      expect(actual).toHaveLength(expected.length)
      const { worst, differing } = difference(actual, expected)
      report[name] = {
        samples: actual.length,
        differingSamples: differing,
        worstDifference: worst,
        worstDifference_dBFS: worst === 0 ? '-inf (bit-identical)' : dB(worst).toFixed(1),
        level_dBFS: dB(rms(actual)).toFixed(1),
      }
      // The same build on the same machine is bit-identical. The bound leaves
      // room only for last-bit differences in the JavaScript engine's sin,
      // cos, exp and pow, which the models call for their coefficients: 1e-6
      // is -120 dBFS, 70 dB or more below the signal.
      expect(worst).toBeLessThan(1e-6)
    })
  }

  test('instances are independent: output is the same after other instruments have run', async () => {
    // Switching instruments creates a fresh instance of the model each time.
    // Rendering the others in between must not change what a model produces.
    const first = await render('wood')
    await render('string')
    await render('bar')
    await render('glass')
    const again = await render('wood')
    expect(difference(first, again).worst).toBe(0)
    expect(first.every(Number.isFinite)).toBe(true)
    console.table(report)
  })
})
