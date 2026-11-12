// Write the regression baselines: tests/baseline/<instrument>.wav, 32-bit
// float, the exact samples the current models produce for the baseline
// performance (playBaseline in lib.ts). tests/baseline.test.ts compares every
// later build against them.
//
//   npm run baseline            refuses to overwrite existing baselines
//   npm run baseline -- --update    replaces them (only after the new sound
//                                   has been approved by listening)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { WavEncoder } from '@grame/faustwasm/dist/esm/index.js'
import { BASELINE_VARIATION, peak, playBaseline, SR } from './lib.ts'
import { compileModel, fsPath, path } from './offline.ts'

const update = process.argv.includes('--update')
const TRIGGER: Record<string, string> = { string: 'pluck', bar: 'strike', glass: 'strike', wood: 'strike' }

mkdirSync(path('tests/baseline'), { recursive: true })
for (const [name, trigger] of Object.entries(TRIGGER)) {
  const file = `tests/baseline/${name}.wav`
  if (existsSync(path(file)) && !update) {
    console.log(`${file} exists; left untouched (pass --update to replace it)`)
    continue
  }
  const model = await compileModel(`src/audio/models/${name}.dsp`, trigger)
  const audio = playBaseline(await model(), BASELINE_VARIATION[name])
  writeFileSync(path(file), new Uint8Array(WavEncoder.encode([audio], { sampleRate: SR, float: true }) as ArrayBuffer))
  console.log(`${file}: ${audio.length} samples, peak ${peak(audio).toFixed(4)}`)
}
console.log(`Baselines are in ${fsPath('tests/baseline')}`)
