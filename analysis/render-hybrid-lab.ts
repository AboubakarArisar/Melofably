// Phase 3D.13: what the hybrid lab's controls do, measured through the
// lab's own instrument and processor (the files the page loads).
//
//   npm run render:hybrid-lab
//
// Output: renders/hybrid-lab/measurements.json
//   dynamics   every pluck strength and place, every strike speed: peak
//              pressure, level, energy given
//   gestures   each finger, place and pressure: what it does to the bar and
//              to the string, twice (reproducible)
//   endurance  five minutes of dense playing with both fingers: energy,
//              faults, solver iterations, memory, cost
//
// Nothing here changes a sound. Levels are of the model's sound pressure
// 1 m in front of the board; they do not say how anything sounds.
import { mkdirSync, writeFileSync } from 'node:fs'
import { buildLab, Controls, DAMP_PLACES, FULL_SCALE, PLUCK_PLACES, type Choice, type Strength } from '../src/experimental/hybrid/instrument.ts'
import { BAR_TOUCH, LIGHT_STRIKER } from '../src/experimental/string/stringBarBody.ts'
import { createHybridWorklet } from './hybrid-worklet.ts'
import { levels } from './hybrid-study.ts'
import { SR } from './lib.ts'
import { fsPath, path } from './offline.ts'
import { partial } from './radiation.ts'
import { F0 } from './three-body.ts'

const OUT = 'renders/hybrid-lab'
mkdirSync(path(OUT), { recursive: true })
const r = (x: number, digits = 3) => Number(x.toPrecision(digits))
const d1 = (x: number) => Number(x.toFixed(1))

async function session(choice: Choice = 'tie-0.20') {
  const lab = buildLab(choice, SR)
  const w = await createHybridWorklet(lab.calls)
  const controls = new Controls(lab, (calls) => w.send(calls))
  const pressure = (seconds: number, before?: (block: number) => void) => w.render(Math.round(seconds * SR), before).map((v) => v * FULL_SCALE)
  return { lab, w, controls, pressure }
}
const m: Record<string, unknown> = { units: 'pressure Pa, levels dB re 20 uPa (LAFmax: A-weighted, 125 ms), energy J', striker: `${1000 * LIGHT_STRIKER.mass} g, hardness 0.5` }

// ---- Dynamics ---------------------------------------------------------------------------------------------------------------
{
  const plucks: Record<string, unknown> = {}
  for (const choice of ['tie-0.20', 'tie-0.18', 'approved-string'] as const) {
    const rows: Record<string, unknown> = {}
    for (const [place, at] of PLUCK_PLACES.entries()) {
      for (const force of [0.5, 1, 2, 4, 6, 8]) {
        // The level of a pluck is linear in its force (checked below), so the other forces are only measured at the usual place.
        if (force !== 2 && place !== 3) continue
        const s = await session(choice)
        s.controls.setPluckPlace(place)
        s.controls.pluck(force)
        let most = 0
        const x = s.pressure(3, () => (most = Math.max(most, s.w.engine.energy())))
        const l = levels(x)
        rows[`${force} N at ${at}`] = { peak_Pa: r(l.peakPa), LAFmax_dB: d1(l.lafMax_dB), SEL_dB: d1(l.sel_dB), instrumentEnergyAtMost_mJ: r(1000 * most), fundamental_mPa: r(1000 * partial(x, F0)), at660Hz_mPa: r(1000 * partial(x, 6 * F0)) }
      }
    }
    plucks[choice] = rows
  }
  const strikes: Record<string, unknown> = {}
  for (const choice of ['tie-0.20', 'tie-0.18'] as const) {
    const rows: Record<string, unknown> = {}
    for (const speed of [0.25, 0.35, 0.5, 0.7, 1, 1.4, 2]) {
      const s = await session(choice)
      s.controls.strike(speed)
      const x = s.pressure(3)
      const l = levels(x)
      const gave = 0.5 * LIGHT_STRIKER.mass * speed ** 2 - s.w.engine.resonatorEnergy(s.lab.bar! + 1)
      rows[`${speed} m/s`] = { peak_Pa: r(l.peakPa), LAFmax_dB: d1(l.lafMax_dB), SEL_dB: d1(l.sel_dB), strikerHad_mJ: r(500 * LIGHT_STRIKER.mass * speed ** 2), strikerGave_mJ: r(1000 * gave), momentum_g_m_per_s: r(1000 * LIGHT_STRIKER.mass * speed) }
    }
    strikes[choice] = rows
  }
  m.dynamics = { plucks, strikes }
}

// ---- Gestures ---------------------------------------------------------------------------------------------------------------
{
  const at = (seconds: number) => Math.round((seconds * SR) / 128)
  /** A pluck and a medium stroke together; at 0.15 s a gesture; the string's and the bar's energy 50 and 350 ms later. */
  const run = async (gesture: (c: Controls) => void) => {
    const s = await session()
    const out = { string: [0, 0], bar: [0, 0], iterations: 0, faults: 0, pressure: new Float32Array(0) }
    out.pressure = s.pressure(0.6, (block) => {
      if (block === 0) {
        s.controls.pluck(2)
        s.controls.strike(1)
      }
      if (block === at(0.15)) gesture(s.controls)
      for (const [i, t] of [0.2, 0.5].entries()) {
        if (block !== at(t)) continue
        out.string[i] = s.w.engine.resonatorEnergy(s.lab.string)
        out.bar[i] = s.w.engine.resonatorEnergy(s.lab.bar!)
      }
    })
    out.iterations = s.w.engine.worstIterations()
    out.faults = s.w.engine.faults()
    return out
  }
  const open = await run(() => undefined)
  const dB = (x: number, reference: number) => d1(10 * Math.log10(x / reference))
  const row = async (gesture: (c: Controls) => void) => {
    const [a, b] = [await run(gesture), await run(gesture)]
    let differ = 0
    for (let i = 0; i < a.pressure.length; i++) if (a.pressure[i] !== b.pressure[i]) differ++
    return { bar_re_open_dB: { '50 ms after': dB(a.bar[0], open.bar[0]), '350 ms after': dB(a.bar[1], open.bar[1]) }, string_re_open_dB: { '50 ms after': dB(a.string[0], open.string[0]), '350 ms after': dB(a.string[1], open.string[1]) }, at660Hz_inTheSoundAfter_re_open_dB: d1(20 * Math.log10(partial(a.pressure, 6 * F0, Math.round(0.2 * SR)) / partial(open.pressure, 6 * F0, Math.round(0.2 * SR)))), samplesThatDifferOnASecondRun: differ, solverIterationsWorst: a.iterations, faults: a.faults }
  }
  const rows: Record<string, unknown> = {}
  rows['string muted'] = await row((c) => c.setMute(true))
  for (const [place, { name }] of DAMP_PLACES.entries()) {
    for (const strength of Object.keys(BAR_TOUCH) as Strength[]) {
      rows[`bar damped, ${name.split(' (')[0]}, ${strength}`] = await row((c) => {
        c.setDampPlace(place)
        c.setDampStrength(strength)
        c.setDamp(true)
      })
    }
  }
  rows['both: string muted and bar damped (middle, medium) in the same message'] = await row((c) => {
    c.setMute(true)
    c.setDamp(true)
  })
  m.gestures = { open_uJ: { bar: open.bar.map((e) => r(1e6 * e)), string: open.string.map((e) => r(1e6 * e)) }, rows }
}

// ---- Endurance ---------------------------------------------------------------------------------------------------------------
{
  const minutes = 5
  const s = await session()
  const c = s.controls
  let [peak, nonFinite, most, mostAfterFirstMinute] = [0, 0, 0, 0]
  const energyEachMinute: number[] = []
  const t0 = performance.now()
  const blocks = Math.round((minutes * 60 * SR) / 128)
  const blockMs: number[] = []
  let last = performance.now()
  for (let block = 0; block < blocks; block++) {
    // Something every 8 ms, as in the lab's hardest test: plucks and strokes, both fingers out of step, the finger moved and pressed.
    if (block % 3 === 0) {
      const i = block / 3
      if (i % 4 === 0) c.pluck(i % 8 ? 2 : 8)
      if (i % 4 === 2) c.strike(i % 8 === 2 ? 1 : 2)
      if (i % 5 === 1) c.setMute(!c.muted)
      if (i % 3 === 1) c.setDamp(!c.damped)
      if (i % 7 === 3) c.setDampPlace((c.dampPlace + 1) % DAMP_PLACES.length)
      if (i % 11 === 5) c.setDampStrength(c.dampStrength === 'firm' ? 'light' : 'firm')
    }
    last = performance.now()
    const x = s.w.render(128)
    blockMs.push(performance.now() - last)
    for (const v of x) {
      if (!Number.isFinite(v)) nonFinite++
      peak = Math.max(peak, Math.abs(v))
    }
    const e = s.w.engine.energy()
    most = Math.max(most, e)
    if (block > blocks / minutes) mostAfterFirstMinute = Math.max(mostAfterFirstMinute, e)
    if ((block + 1) % Math.round(blocks / minutes) === 0) energyEachMinute.push(r(1000 * e))
  }
  const seconds = (performance.now() - t0) / 1000
  blockMs.sort((a, b) => a - b)
  c.setMute(false)
  c.setDamp(false)
  s.w.render(3 * SR)
  m.endurance = {
    simulatedMinutes: minutes, eventsEvery_ms: 8, percentOfOneCore: d1((100 * seconds) / (minutes * 60)), blockMs: { median: r(blockMs[Math.floor(blockMs.length / 2)]), p999: r(blockMs[Math.floor(0.999 * blockMs.length)]), longest: r(blockMs.at(-1)!) },
    peak_Pa: r(peak * FULL_SCALE), nonFiniteSamples: nonFinite, faults: s.w.engine.faults(), solverIterationsWorst: s.w.engine.worstIterations(), engineMemoryBytes: s.w.engine.memory.buffer.byteLength,
    instrumentEnergy_mJ: { atMost: r(1000 * most), atMostAfterTheFirstMinute: r(1000 * mostAfterFirstMinute), atTheEndOfEachMinute: energyEachMinute, threeSecondsAfterTheLastEvent: r(1000 * (s.w.engine.energy() - s.w.engine.resonatorEnergy(s.lab.bar! + 1))) },
    fingersLeftDown: (s.w.diag().fingers as unknown[]).length,
  }
}

writeFileSync(path(`${OUT}/measurements.json`), JSON.stringify(m, null, 2))
const dyn = m.dynamics as { plucks: Record<string, Record<string, { LAFmax_dB: number; peak_Pa: number }>>; strikes: Record<string, Record<string, { LAFmax_dB: number; peak_Pa: number }>> }
console.table(Object.fromEntries(Object.entries(dyn.plucks['tie-0.20']).map(([k, v]) => [k, { peak_Pa: v.peak_Pa, LAFmax_dB: v.LAFmax_dB }])))
console.table(Object.fromEntries(Object.entries(dyn.strikes['tie-0.20']).map(([k, v]) => [k, { peak_Pa: v.peak_Pa, LAFmax_dB: v.LAFmax_dB }])))
console.log(JSON.stringify(m.endurance))
console.log(`\nwritten to ${fsPath(OUT)}`)
