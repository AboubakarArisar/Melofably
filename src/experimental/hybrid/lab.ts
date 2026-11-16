// EXPERIMENTAL (Phase 3D.12). The hybrid lab page (hybrid-lab.html): a
// small instrument panel for playing the bar-as-bridge instrument of Phases
// 3D.9 to 3D.11 in real time. Not used by the application or the builder.
//
// What the controls mean to the engine is in instrument.ts; this file is
// the page: the audio context and node, the buttons and keys, the picture,
// and the diagnostics. It makes no sound of its own and changes none.
import { BAR_TOUCH, dampable, supportPoints } from '../string/stringBarBody.ts'
import { BODY } from '../string/stringBody.ts'
import type { Call } from '../wasm/engine.ts'
import { engineBytes } from '../wasm/host.ts'
import processorUrl from '../wasm/processor.js?url'
import captureUrl from './capture.js?url'
import hybridUrl from './hybrid-processor.js?url'
import { buildLab, CHOICES, Controls, DAMP_PLACES, DEFAULT_PLUCK_PLACE, FULL_SCALE, PLUCK_PLACES, STRIKE_SPEED, STRING, type Choice, type Lab, type Strength } from './instrument.ts'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const svg = (id: string) => document.getElementById(id) as unknown as SVGElement

interface Diag {
  clock: string
  smallestDurationSeen_ms: number
  quantum_ms: number
  blocks: number
  mean_ms: number
  worst_ms: number
  overruns: number
  possibleOverruns: number
  binLabels: string[]
  bins: number[]
  gapMean_ms: number
  gapWorst_ms: number
  peak: number
  blocksAtTheCeiling: number
  faults: number
  worstIterations: number
  memoryBytes: number
  energy: number
  resonatorEnergy: number[]
  stiffness: number[]
  injected: number[]
  fingers: { connection: number; stage: number; damping: number }[]
}
interface PlaybackStats {
  underrunEvents: number
  underrunDuration: number
  totalDuration?: number
}

interface Running {
  ctx: AudioContext
  volume: GainNode
  node: AudioWorkletNode
  lab: Lab
  controls: Controls
  /** Audio clock and wall clock when counting began, for the inferred lag. */
  began: { audio: number; wall: number; underruns: number; underrunSeconds: number }
}
let running: Running | null = null
let busy = false
const pending = new Map<number, (d: Diag) => void>()
let asked = 0

const fail = (error: unknown) => {
  $('error').textContent = error instanceof Error ? error.message : String(error)
}
const stats = (ctx: AudioContext) => (ctx as AudioContext & { playbackStats?: PlaybackStats }).playbackStats

// ---- Audio --------------------------------------------------------------------------------------------------------

/** A node playing `lab`, connected to the volume. Resolves when the processor has built it. */
async function makeNode(ctx: AudioContext, volume: GainNode, lab: Lab): Promise<AudioWorkletNode> {
  const node = new AudioWorkletNode(ctx, 'sonicmatter-hybrid', { numberOfInputs: 0, outputChannelCount: [1], processorOptions: { bytes: await engineBytes(), calls: lab.calls, measure: false } })
  await new Promise<void>((resolve, reject) => {
    const late = setTimeout(() => reject(new Error('The audio processor did not answer within 10 seconds.')), 10000)
    node.onprocessorerror = () => reject(new Error('The audio processor stopped with an error.'))
    node.port.onmessage = ({ data }) => {
      if (data.ready) {
        clearTimeout(late)
        resolve()
      } else if (data.error) {
        clearTimeout(late)
        reject(new Error(`Physics engine: ${data.error}`))
        fail(`Physics engine: ${data.error}`)
      } else if (data.diag) {
        pending.get(data.diag)?.(data)
        pending.delete(data.diag)
      }
    }
  }).catch((error) => {
    node.port.postMessage({ stop: true })
    node.disconnect()
    throw error
  })
  node.connect(volume)
  return node
}

function mark(ctx: AudioContext) {
  const s = stats(ctx)
  return { audio: ctx.currentTime, wall: performance.now(), underruns: s?.underrunEvents ?? 0, underrunSeconds: s?.underrunDuration ?? 0 }
}

/** Builds the chosen instrument on the running context, replacing the one that was there. Fingers start lifted. */
async function build(ctx: AudioContext, volume: GainNode, choice: Choice): Promise<Running> {
  const lab = buildLab(choice, ctx.sampleRate)
  const node = await makeNode(ctx, volume, lab)
  const controls = new Controls(lab, (calls: Call[]) => node.port.postMessage({ calls }))
  controls.setPluckPlace(Number($<HTMLSelectElement>('pluckAt').value))
  controls.setDampPlace(Number($<HTMLSelectElement>('dampAt').value))
  controls.setDampStrength($<HTMLSelectElement>('dampStrength').value as Strength)
  return { ctx, volume, node, lab, controls, began: mark(ctx) }
}

function dispose(r: Running) {
  r.node.port.postMessage({ stop: true })
  r.node.port.onmessage = null
  r.node.disconnect()
  pending.clear()
}

async function start() {
  if (running || busy) return
  busy = true
  $('error').textContent = ''
  $('state').textContent = 'starting…'
  let ctx: AudioContext | undefined
  try {
    if (typeof AudioWorkletNode === 'undefined') throw new Error('This browser has no AudioWorklet; the instrument cannot run here.')
    ctx = new AudioContext({ latencyHint: 'interactive' })
    // The engine's processor, unchanged, between the two files that let the lab's processor extend it.
    await ctx.audioWorklet.addModule(captureUrl)
    await ctx.audioWorklet.addModule(processorUrl)
    await ctx.audioWorklet.addModule(hybridUrl)
    const volume = new GainNode(ctx, { gain: gainOf() })
    volume.connect(ctx.destination)
    running = await build(ctx, volume, $<HTMLSelectElement>('choice').value as Choice)
    await ctx.resume()
    ctx.onstatechange = show
  } catch (error) {
    fail(error)
    void ctx?.close()
    running = null
  }
  busy = false
  show()
}

async function stop() {
  if (!running || busy) return
  busy = true
  const r = running
  running = null
  dispose(r)
  await r.ctx.close().catch(() => undefined)
  busy = false
  show()
}

/** Another instrument: a new engine. Nothing of the old one's motion or fingers carries over, by construction. */
async function choose() {
  if (!running || busy) return show()
  busy = true
  const { ctx, volume } = running
  dispose(running)
  running = null
  show()
  try {
    running = await build(ctx, volume, $<HTMLSelectElement>('choice').value as Choice)
    $('error').textContent = ''
  } catch (error) {
    fail(error)
    await ctx.close().catch(() => undefined)
  }
  busy = false
  show()
}

const gainOf = () => 10 ** (Number($<HTMLInputElement>('volume').value) / 20)

// ---- Playing --------------------------------------------------------------------------------------------------------

const flash = (id: string) => {
  const el = svg(id)
  el.classList.remove('hit')
  void el.getBoundingClientRect() // so that the animation starts again
  el.classList.add('hit')
}
function pluck() {
  if (!running) return
  running.controls.pluck(Number($<HTMLInputElement>('force').value))
  flash('stringGlow')
}
function strike(speed = Number($<HTMLInputElement>('speed').value)) {
  if (!running?.controls.hasBar) return
  running.controls.strike(speed)
  flash('barGlow')
}
function mute(on: boolean) {
  running?.controls.setMute(on)
  show()
}
function damp(on: boolean) {
  running?.controls.setDamp(on)
  show()
}

// ---- The picture ----------------------------------------------------------------------------------------------------

// In plan, to scale: 700 px to the metre, the board's corner at (480, 30).
const PX = 700
const BOARD = { x: 480, y: 30 }
function draw() {
  const choice = $<HTMLSelectElement>('choice').value as Choice
  const hybrid = choice !== 'approved-string'
  const tieAt = choice === 'tie-0.18' ? 0.18 : 0.2
  const s = dampable(DAMP_PLACES[0].at, tieAt)
  const [padA, padB] = supportPoints(s).map(([x]) => BOARD.x + x * BODY.plate.length * PX)
  const length = s.bar.length * PX
  const left = padA - s.bar.supports[0] * length
  const y = BOARD.y + BODY.bridgeAt[1] * BODY.plate.width * PX
  const end = hybrid ? left + tieAt * length : padA // the approved string stands on the board where the first pad stands
  const nut = end - STRING.length * PX
  const set = (id: string, attributes: Record<string, number | string>) => Object.entries(attributes).forEach(([name, value]) => svg(id).setAttribute(name, String(value)))
  for (const id of ['bar', 'barGlow', 'padA', 'padB', 'dampFinger', 'barLabel']) svg(id).style.display = hybrid ? '' : 'none'
  set('bar', { x: left, width: length })
  set('barGlow', { x: left - 3, width: length + 6 })
  set('padA', { cx: padA, cy: y })
  set('padB', { cx: padB, cy: y })
  set('string', { x1: nut, x2: end })
  set('stringGlow', { x1: nut, x2: end })
  set('tie', { cx: end })
  set('nutLabel', { x: nut })
  set('tieLabel', { x: end })
  svg('tieLabel').textContent = hybrid ? `tied at ${tieAt.toFixed(2)} of the bar` : 'bridge, on the board'
  set('barLabel', { x: left + length + 12 })
  const pluckAt = PLUCK_PLACES[Number($<HTMLSelectElement>('pluckAt').value)]
  set('pluckPlace', { cx: nut + pluckAt * STRING.length * PX })
  set('pluckLabel', { x: nut + pluckAt * STRING.length * PX })
  set('muteFinger', { cx: nut + STRING.pluckAt * STRING.length * PX })
  set('dampFinger', { cx: left + DAMP_PLACES[Number($<HTMLSelectElement>('dampAt').value)].at * length })
}

// ---- State on the page -------------------------------------------------------------------------------------------------

function show() {
  const r = running
  const on = !!r && !busy
  const bar = on && r.controls.hasBar
  $('state').textContent = busy ? 'working…' : r ? `${r.ctx.state}, ${r.ctx.sampleRate} Hz` : 'stopped'
  $<HTMLButtonElement>('start').disabled = !!r || busy
  $<HTMLButtonElement>('stop').disabled = !on
  $<HTMLSelectElement>('choice').disabled = busy
  for (const id of ['pluck', 'mute', 'clear']) $<HTMLButtonElement>(id).disabled = !on
  for (const id of ['strike', 'damp', 'gentle', 'medium', 'strong']) $<HTMLButtonElement>(id).disabled = !bar
  const approved = $<HTMLSelectElement>('choice').value === 'approved-string'
  for (const id of ['speed', 'dampAt', 'dampStrength']) $<HTMLInputElement>(id).disabled = approved
  $('mute').setAttribute('aria-pressed', String(!!r?.controls.muted))
  $('damp').setAttribute('aria-pressed', String(!!r?.controls.damped))
  svg('muteFinger').classList.toggle('on', !!r?.controls.muted)
  svg('dampFinger').classList.toggle('on', !!r?.controls.damped)
  $('volumeValue').textContent = `${Number($<HTMLInputElement>('volume').value) >= 0 ? '+' : ''}${$<HTMLInputElement>('volume').value} dB`
  $('forceValue').textContent = `${Number($<HTMLInputElement>('force').value).toFixed(1)} N`
  $('speedValue').textContent = `${Number($<HTMLInputElement>('speed').value).toFixed(2)} m/s`
  if (!r) {
    $('status').textContent = 'not running'
    svg('stringGlow').style.opacity = ''
    svg('barGlow').style.opacity = ''
  }
  draw()
}

// ---- Diagnostics --------------------------------------------------------------------------------------------------------

function diag(clear = false): Promise<Diag | null> {
  const r = running
  if (!r) return Promise.resolve(null)
  return new Promise((resolve) => {
    const id = ++asked
    pending.set(id, resolve)
    setTimeout(() => pending.delete(id) && resolve(null), 2000)
    r.node.port.postMessage({ diag: id, clear, resonators: [r.lab.string, ...(r.lab.bar === undefined ? [] : [r.lab.bar])], connections: [r.lab.stringFinger, ...r.lab.barFingers] })
  })
}

/** What the browser itself reports of the output device, and how far the audio clock has fallen behind the wall clock since counting began. */
function device(r: Running) {
  const s = stats(r.ctx)
  return {
    underrunEvents: s ? s.underrunEvents - r.began.underruns : null,
    underrunSeconds: s ? s.underrunDuration - r.began.underrunSeconds : null,
    audioClockBehindWallClock_ms: performance.now() - r.began.wall - 1000 * (r.ctx.currentTime - r.began.audio),
    baseLatency_ms: 1000 * r.ctx.baseLatency,
    outputLatency_ms: 1000 * (r.ctx.outputLatency || 0),
  }
}

const ms = (x: number) => x.toFixed(x < 10 ? 2 : 1)
// Opacity of a glow from the energy a part holds: nothing below a nanojoule, full at a millijoule.
const glow = (joules: number) => String(Math.max(0, Math.min(1, (Math.log10(Math.max(joules, 1e-12)) + 9) / 6)))

async function refresh() {
  const r = running
  if (!r || busy || r.ctx.state !== 'running') return
  const d = await diag()
  if (!d || running !== r) return
  const dev = device(r)
  const gain = gainOf()
  const [stringEnergy, barEnergy] = d.resonatorEnergy
  if (!svg('stringGlow').classList.contains('hit')) svg('stringGlow').style.opacity = glow(stringEnergy)
  if (barEnergy !== undefined && !svg('barGlow').classList.contains('hit')) svg('barGlow').style.opacity = glow(barEnergy)
  const names = ['string mute', ...DAMP_PLACES.map((p) => `bar finger, ${p.name.split(' (')[0]}`)]
  const connections = [r.lab.stringFinger, ...r.lab.barFingers]
  const fingers = d.fingers.map((f) => `${names[connections.indexOf(f.connection)]}: ${f.damping.toFixed(2)} N s/m${['', ', landing', '', ', leaving'][f.stage]}`)
  const coarse = d.clock === 'Date.now'
  const bins = d.bins.map((count, b) => (count ? `${d.binLabels[b]}: ${count}` : '')).filter(Boolean)
  $('status').textContent = [
    `audio: ${r.ctx.state}, ${r.ctx.sampleRate} Hz; one block is 128 samples, ${ms(d.quantum_ms)} ms`,
    `instrument: ${CHOICES[r.lab.choice]}`,
    `energy: ${d.energy.toExponential(2)} J in all; string ${stringEnergy.toExponential(2)} J${barEnergy === undefined ? '' : `; bar ${barEnergy.toExponential(2)} J`}`,
    `fingers: ${fingers.length ? fingers.join('; ') : 'none down'}`,
    `engine: ${d.faults} faults; worst solver iterations ${d.worstIterations}; memory ${d.memoryBytes} bytes`,
    '',
    `processing time per block, measured in the audio thread by ${d.clock}${coarse ? ', the only clock this browser gives an audio worklet. It counts whole milliseconds: a reading of r ms means between r - 1 and r + 1 ms' : ` (finest step seen ${d.smallestDurationSeen_ms.toFixed(3)} ms)`}:`,
    `  blocks ${d.blocks}; mean ${ms(d.mean_ms)} ms${coarse ? ' (an average of many readings is accurate even though each is not)' : ''}; worst ${coarse ? 'reading ' : ''}${ms(d.worst_ms)} ms`,
    `  longer than a block (${ms(d.quantum_ms)} ms): certainly ${d.overruns}${coarse ? `; possibly ${d.possibleOverruns} more (readings the clock cannot place on either side of ${ms(d.quantum_ms)} ms)` : ''}`,
    `  ${coarse ? 'readings: ' : ''}${bins.join('; ') || 'none yet'}`,
    `time between calls: mean ${ms(d.gapMean_ms)} ms; longest ${ms(d.gapWorst_ms)} ms (the browser asks for several blocks at a time, so gaps longer than a block are normal)`,
    '',
    `output: peak ${(d.peak * FULL_SCALE).toFixed(3)} Pa (${(20 * Math.log10(Math.max(d.peak, 1e-9))).toFixed(1)} dB re the node's ${FULL_SCALE} Pa ceiling); blocks at the ceiling: ${d.blocksAtTheCeiling}`,
    d.peak * gain >= 1 ? `  at this volume (+${(20 * Math.log10(gain)).toFixed(0)} dB) the loudest peak passed full scale and was clipped by the browser: turn the volume down` : `  at this volume the loudest peak reached ${(20 * Math.log10(Math.max(d.peak * gain, 1e-9))).toFixed(1)} dBFS`,
    '',
    'output device, as the browser reports it (not measured in the engine):',
    `  ${dev.underrunEvents === null ? 'this browser does not report underruns' : `underruns ${dev.underrunEvents}, ${(1000 * dev.underrunSeconds!).toFixed(1)} ms in all`}; latency ${ms(dev.baseLatency_ms)} + ${ms(dev.outputLatency_ms)} ms`,
    `  audio clock behind the wall clock since counting began: ${ms(dev.audioClockBehindWallClock_ms)} ms (inferred: it grows when blocks are not delivered)`,
  ].join('\n')
}

// ---- Wiring ---------------------------------------------------------------------------------------------------------------

function options(id: string, entries: [string, string][], chosen: string) {
  const select = $<HTMLSelectElement>(id)
  for (const [value, text] of entries) select.add(new Option(text, value, false, value === chosen))
}
options('choice', Object.entries(CHOICES), 'tie-0.20')
options('pluckAt', PLUCK_PLACES.map((at, i) => [String(i), `${at} of the string from the nut${i === DEFAULT_PLUCK_PLACE ? ' (as approved)' : ''}`]), String(DEFAULT_PLUCK_PLACE))
options('dampAt', DAMP_PLACES.map((p, i) => [String(i), `${p.at} of the bar: ${p.name}`]), '0')
options('dampStrength', Object.entries(BAR_TOUCH).map(([name, t]) => [name, `${name}: ${t.stiffness} N/m, ${t.damping} N s/m`]), 'medium')

/** Acts at once on a press (mouse, pen or touch), and on a click that came from the keyboard. */
function press(id: string, action: () => void) {
  const el = $(id)
  el.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    action()
  })
  el.addEventListener('click', (event) => event.detail === 0 && action())
}
$('start').addEventListener('click', () => void start())
$('stop').addEventListener('click', () => void stop())
$('choice').addEventListener('change', () => void choose())
$('volume').addEventListener('input', () => {
  if (running) running.volume.gain.setTargetAtTime(gainOf(), running.ctx.currentTime, 0.02)
  show()
})
for (const id of ['force', 'speed']) $(id).addEventListener('input', show)
press('pluck', pluck)
press('strike', () => strike())
press('gentle', () => strike(STRIKE_SPEED.gentle))
press('medium', () => strike(STRIKE_SPEED.medium))
press('strong', () => strike(STRIKE_SPEED.strong))
press('mute', () => mute(!running?.controls.muted))
press('damp', () => damp(!running?.controls.damped))
$('pluckAt').addEventListener('change', () => {
  running?.controls.setPluckPlace(Number($<HTMLSelectElement>('pluckAt').value))
  show()
})
$('dampAt').addEventListener('change', () => {
  running?.controls.setDampPlace(Number($<HTMLSelectElement>('dampAt').value))
  show()
})
$('dampStrength').addEventListener('change', () => running?.controls.setDampStrength($<HTMLSelectElement>('dampStrength').value as Strength))
$('clear').addEventListener('click', () => {
  if (!running) return
  void diag(true)
  running.began = mark(running.ctx)
})

const KEYS: Record<string, () => void> = { a: pluck, s: () => strike(), 1: () => strike(STRIKE_SPEED.gentle), 2: () => strike(STRIKE_SPEED.medium), 3: () => strike(STRIKE_SPEED.strong) }
const typing = (target: EventTarget | null) => target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && target.type !== 'range')
const held = { m: false, d: false }
const hold = (key: 'm' | 'd', on: boolean) => {
  held[key] = on
  if (key === 'm') mute(on)
  else damp(on)
}
window.addEventListener('keydown', (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return
  const key = event.key.toLowerCase()
  if (key === 'm' || key === 'd') hold(key, true)
  else KEYS[key]?.()
})
window.addEventListener('keyup', (event) => {
  const key = event.key.toLowerCase()
  if ((key === 'm' || key === 'd') && held[key]) hold(key, false)
})
// A key held when the window loses focus never reports being let go: lift what the keys were holding.
window.addEventListener('blur', () => {
  for (const key of ['m', 'd'] as const) if (held[key]) hold(key, false)
})

setInterval(() => void refresh(), 300)
show()

/** For driving and measuring the page from the developer console. Plays by itself for `seconds`; nothing here is used by the page. */
async function bench(seconds = 20, gestures = true) {
  const r = running
  if (!r) throw new Error('start the audio first')
  const c = r.controls
  await diag(true)
  r.began = mark(r.ctx)
  const t0 = performance.now()
  for (let i = 0; performance.now() - t0 < seconds * 1000; i++) {
    // Every 100 ms: a pluck and a medium stroke in turn; with gestures, the two fingers go down and up out of step with each other.
    if (i % 2 === 0) c.pluck(2)
    else c.strike(STRIKE_SPEED.medium)
    if (gestures) {
      if (i % 5 === 1) c.setMute(!c.muted)
      if (i % 3 === 1) c.setDamp(!c.damped)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  c.setMute(false)
  c.setDamp(false)
  const d = await diag()
  show()
  return { choice: r.lab.choice, seconds, gestures, sampleRate: r.ctx.sampleRate, ...d, device: device(r), userAgent: navigator.userAgent, hidden: document.hidden }
}
Object.assign(window, { sonicmatterHybridLab: { start, stop, diag, bench, pluck, strike, mute, damp, state: () => (running ? { choice: running.lab.choice, muted: running.controls.muted, damped: running.controls.damped, dampPlace: running.controls.dampPlace, dampStrength: running.controls.dampStrength, pluckPlace: running.controls.pluckPlace, audio: running.ctx.state } : null) } })
