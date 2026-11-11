import { expect, test } from 'vitest'
import { midiToFrequency } from '../src/audio/engine/pitch'

test('midiToFrequency follows equal temperament', () => {
  expect(midiToFrequency(69)).toBe(440)
  expect(midiToFrequency(81)).toBe(880)
  expect(midiToFrequency(60)).toBeCloseTo(261.6256, 4)
  expect(midiToFrequency(69, 432)).toBe(432)
})
