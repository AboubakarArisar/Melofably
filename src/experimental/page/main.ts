// EXPERIMENTAL (Phase 3A.1). Development-only test page for the WebAssembly
// physics engine in a real AudioWorklet. Plain DOM; not part of the application.
import { createInstrumentNode } from '../../audio/worklet/instruments.ts'
import { EXAMPLES } from '../../builder/examples.ts'
import { instrumentCalls, translate } from '../../builder/translate.ts'
import { buildInstrument, STRING_PLUCK } from '../string/instrument.ts'
import { DEFAULT_LOSS, type StringParams } from '../string/modalString.ts'
import { plateModes, SPRUCE_PLATE, type PlateParams } from '../string/soundboard.ts'
import { unbaffledCorner } from '../string/soundboardRefined.ts'
import { INSTANT, RAMP, ZERO_CROSSING, type Call } from '../wasm/engine.ts'
import { createPhysicsNode, type PhysicsNode } from '../wasm/host.ts'
import { LAYOUTS, toCalls, tuneCalls, type Layout } from '../wasm/layouts.ts'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const el = {
  error: $('error'),
  layout: $<HTMLSelectElement>('layout'),
  start: $<HTMLButtonElement>('start'),
  suspend: $<HTMLButtonElement>('suspend'),
  stop: $<HTMLButtonElement>('stop'),
  state: $('state'),
  strikes: $('strikes'),
  rapid: $<HTMLButtonElement>('rapid'),
  stiffness: $<HTMLInputElement>('stiffness'),
  damping: $<HTMLInputElement>('damping'),
  tune: $<HTMLInputElement>('tune'),
  decay: $<HTMLInputElement>('decay'),
  joined: $<HTMLInputElement>('joined'),
  status: $('status'),
  verify: $<HTMLButtonElement>('verify'),
  bench: $<HTMLButtonElement>('bench'),
  dropouts: $<HTMLButtonElement>('dropouts'),
  strings: $<HTMLButtonElement>('strings'),
  results: $('results'),
}

const PLAYABLE = { oneBar: LAYOUTS.oneBar, twoBars: LAYOUTS.twoBars, threeBars: LAYOUTS.threeBars, keyboard: LAYOUTS.keyboard }
type LayoutId = keyof typeof PLAYABLE
for (const id of Object.keys(PLAYABLE) as LayoutId[]) el.layout.add(new Option(PLAYABLE[id](48000).name, id))

/** Strength of the half-sine strike (N s) and its contact time (s). */
const PULSE = { impulse: 0.05, contact: 0.0005 }
const MALLET_SPEED = 1.5 // m/s
const MASTER = 0.5

// A timer in a worker: timers on a page that is not in front are slowed to
// one a second, which would make "rapid playing" anything but.
const clock = new Worker(URL.createObjectURL(new Blob(['onmessage = (e) => setTimeout(() => postMessage(e.data.id), e.data.ms)'])))
const waiting = new Map<number, () => void>()
let nextTimer = 1
clock.onmessage = (e) => {
  waiting.get(e.data)?.()
  waiting.delete(e.data)
}
const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    waiting.set(nextTimer, resolve)
    clock.postMessage({ id: nextTimer++, ms })
  })

// ---- The running system --------------------------------------------------------

interface Running {
  ctx: AudioContext
  physics: PhysicsNode
  analyser: AnalyserNode
  layout: Layout
  built: ReturnType<typeof toCalls>
}
let running: Running | null = null
let starting: Promise<Running> | null = null
const counts = { nodesCreated: 0, nodesDisposed: 0, contextsCreated: 0, contextsClosed: 0 }

function showError(error: unknown) {
  el.error.textContent = error instanceof Error ? error.message : String(error)
}

/** Start audio with the selected system. Calling it again while running or starting changes nothing. */
function start(): Promise<Running> {
  if (running) return Promise.resolve(running)
  starting ??= (async () => {
    el.error.textContent = ''
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    counts.contextsCreated++
    try {
      const layout = PLAYABLE[el.layout.value as LayoutId](ctx.sampleRate)
      const built = toCalls(layout, ctx.sampleRate)
      const physics = await createPhysicsNode(ctx, built.calls, { measure: true })
      counts.nodesCreated++
      const gain = new GainNode(ctx, { gain: MASTER })
      const analyser = new AnalyserNode(ctx, { fftSize: 2048 })
      physics.node.connect(gain).connect(analyser).connect(ctx.destination)
      await ctx.resume()
      running = { ctx, physics, analyser, layout, built }
      ctx.onstatechange = render
      buildStrikeButtons()
      render()
      return running
    } catch (error) {
      await ctx.close()
      counts.contextsClosed++
      showError(error)
      throw error
    } finally {
      starting = null
    }
  })()
  return starting
}

async function stop() {
  if (starting) await starting.catch(() => {})
  if (!running) return
  const { ctx, physics } = running
  running = null
  physics.dispose()
  counts.nodesDisposed++
  await ctx.close()
  counts.contextsClosed++
  el.strikes.replaceChildren()
  render()
}

async function toggleSuspend() {
  if (!running) return
  await (running.ctx.state === 'running' ? running.ctx.suspend() : running.ctx.resume())
  render()
}

const send = (calls: Call[]) => running?.physics.send(calls)
const strike = (index: number, strength = 1) => {
  if (!running) return
  const [r, p] = running.layout.strikePorts[index % running.layout.strikePorts.length]
  send([['strike', r, p, PULSE.impulse * strength, PULSE.contact]])
}
const mallet = (index: number, speed = MALLET_SPEED) => {
  if (running?.built.mallets.length) send([['launch', running.built.mallets[index % running.built.mallets.length], speed]])
}

function buildStrikeButtons() {
  if (!running) return
  const buttons: HTMLButtonElement[] = []
  const add = (label: string, action: () => void) => {
    const b = document.createElement('button')
    b.textContent = label
    b.onclick = action
    buttons.push(b)
  }
  const name = (i: number) => (running!.layout.strikePorts.length > 3 ? `bar ${i + 1}` : `bar ${'ABC'[i]}`)
  running.layout.strikePorts.forEach((_, i) => add(`Strike ${name(i)}`, () => strike(i)))
  if (running.built.mallets.length) {
    add('Soft mallet on bar A', () => mallet(0))
    add('Hard mallet on bar A', () => mallet(1))
  }
  el.strikes.replaceChildren(...buttons)
}

// ---- Editing --------------------------------------------------------------------

const show = (id: 'stiffness' | 'damping' | 'tune' | 'decay', text: string) => ($(`${id}Value`).textContent = text)
function applyEdits(which: 'stiffness' | 'damping' | 'tune' | 'joined' | 'all') {
  const stiffness = 10 ** Number(el.stiffness.value)
  const damping = Number(el.damping.value)
  const [ratio, decay] = [Number(el.tune.value), Number(el.decay.value)]
  show('stiffness', `${stiffness.toExponential(2)} N/m`)
  show('damping', `${damping.toFixed(1)} N s/m`)
  show('tune', `x ${ratio.toFixed(3)}`)
  show('decay', `x ${decay.toFixed(2)}`)
  if (!running) return
  const link = running.built.springs[0]
  // Stiffness glides over 10 ms; damping is passive and applied at once.
  if (link && (which === 'stiffness' || which === 'all')) send([['setStiffness', link.spring, stiffness, RAMP, Math.round(0.01 * running.ctx.sampleRate)]])
  if (link && (which === 'damping' || which === 'all')) send([['setDamping', link.damper, damping]])
  if (which === 'tune' || which === 'all') send(tuneCalls(running.layout, 0, ratio, decay))
  const joint = running.built.springs[1]
  if (joint && which === 'joined') {
    // Connect at the present length (adds no energy); release when the spring next passes through rest.
    send(el.joined.checked ? [['attach', joint.spring], ['setStiffness', joint.spring, running.layout.springs[1].stiffness, INSTANT, 0]] : [['setStiffness', joint.spring, 0, ZERO_CROSSING, 0]])
  }
}
el.stiffness.oninput = () => applyEdits('stiffness')
el.damping.oninput = () => applyEdits('damping')
el.tune.oninput = el.decay.oninput = () => applyEdits('tune')
el.joined.onchange = () => applyEdits('joined')

// ---- Status ---------------------------------------------------------------------

interface PlaybackStats {
  underrunEvents: number
  underrunDuration: number
  totalDuration: number
}
const playbackStats = (ctx: AudioContext) => (ctx as AudioContext & { playbackStats?: PlaybackStats }).playbackStats

async function status() {
  if (!running) return { state: 'stopped', ...counts }
  const { ctx, physics } = running
  const report = await physics.report()
  const audioMs = (report.blocks * 128 * 1000) / ctx.sampleRate
  const stats = playbackStats(ctx)
  return {
    state: ctx.state,
    sampleRate: ctx.sampleRate,
    baseLatencyMs: Number((ctx.baseLatency * 1000).toFixed(2)),
    blocksProcessed: report.blocks,
    cpuPercentOfOneCore: audioMs ? Number(((100 * report.busyMs) / audioMs).toFixed(2)) : 0,
    blocksOver2ms: report.slowBlocks,
    nonFiniteSamples: report.faults,
    newtonIterationsWorst: report.worstIterations,
    engineMemoryBytes: report.memoryBytes,
    engineInitMs: Number(physics.initMs.toFixed(1)),
    underrunEvents: stats?.underrunEvents ?? 'not reported by this browser',
    underrunSeconds: stats?.underrunDuration ?? 'not reported by this browser',
    ...counts,
  }
}

function render() {
  const on = running !== null
  el.state.textContent = running?.ctx.state ?? 'stopped'
  el.start.disabled = el.layout.disabled = on
  el.suspend.textContent = running?.ctx.state === 'suspended' ? 'Resume' : 'Suspend'
  for (const control of [el.suspend, el.stop, el.rapid, el.stiffness, el.damping, el.tune, el.decay]) control.disabled = !on
  el.joined.disabled = !on || running!.built.springs.length < 2
}
setInterval(async () => {
  if (running) el.status.textContent = JSON.stringify(await status(), null, 2)
}, 500)

/** Peak of the live output over the analyser's last 2048 samples. */
function livePeak(): number {
  if (!running) return 0
  const data = new Float32Array(running.analyser.fftSize)
  running.analyser.getFloatTimeDomainData(data)
  return data.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
}

// ---- Rapid playing ----------------------------------------------------------------

/** 40 events a second for `seconds`: strikes on every bar in turn, mallets, and edits of every kind. */
async function rapid(seconds = 5) {
  await start()
  await sleep(1500) // let the start-up settle and playbackStats catch up, so that only the playing is counted
  const before = await status()
  let peak = 0
  for (let i = 0; i < seconds * 40; i++) {
    strike(i, 0.5 + 0.5 * ((i * 7) % 5) / 4)
    if (i % 5 === 0) mallet(i / 5, 0.3 + 0.3 * (i % 3))
    if (i % 4 === 0 && running) {
      const link = running.built.springs[0]
      if (link) send([['setStiffness', link.spring, 4e5 * (1 + (i % 9)), i % 8 ? RAMP : ZERO_CROSSING, 480], ['setDamping', link.damper, 0.5 + (i % 6)]])
      send(tuneCalls(running.layout, 0, 0.9 + 0.01 * (i % 30)))
      const joint = running.built.springs[1]
      if (joint) send(i % 8 ? [['setStiffness', joint.spring, 0, RAMP, 480]] : [['attach', joint.spring], ['setStiffness', joint.spring, 2e5, INSTANT, 0]])
    }
    await sleep(25)
    peak = Math.max(peak, livePeak())
  }
  await sleep(1500) // playbackStats is refreshed about once a second
  const after = await status()
  applyEdits('all') // back to what the sliders say
  return { system: running?.layout.name, events: seconds * 40, livePeak: Number(peak.toFixed(3)), before, after }
}

// ---- Lifecycle checks --------------------------------------------------------------

async function verify() {
  const checks: Record<string, unknown> = {}
  const expect = (name: string, ok: boolean, detail?: unknown) => (checks[name] = detail === undefined ? ok : { ok, detail })
  await stop()
  const created = counts.nodesCreated

  // Two starts at once must give one context and one node.
  const [a, b] = await Promise.all([start(), start()])
  expect('start: AudioContext running', a.ctx.state === 'running', a.ctx.state)
  expect('two simultaneous starts give one node', a === b && counts.nodesCreated === created + 1)
  await start()
  expect('start while running creates nothing', counts.nodesCreated === created + 1)
  expect('engine initialised in the worklet', true, `${a.physics.initMs.toFixed(1)} ms from request to ready`)

  await sleep(300)
  expect('silent before anything is struck', livePeak() === 0, livePeak())
  strike(0)
  await sleep(150)
  const struck = livePeak()
  expect('real-time output after a strike', struck > 0.01 && struck <= 1, Number(struck.toFixed(4)))
  mallet(1)
  await sleep(150)
  expect('real-time output after a mallet strike', livePeak() > 0.01, Number(livePeak().toFixed(4)))

  await a.ctx.suspend()
  const blocksAtSuspend = (await a.physics.report()).blocks
  await sleep(400)
  expect('suspend stops processing', a.ctx.state === 'suspended' && (await a.physics.report()).blocks === blocksAtSuspend)
  await a.ctx.resume()
  await sleep(300)
  expect('resume continues', a.ctx.state === 'running' && (await a.physics.report()).blocks > blocksAtSuspend)

  const report = await a.physics.report()
  expect('no non-finite samples', report.faults === 0, report.faults)
  expect('engine memory is the fixed 3 MB it starts with', report.memoryBytes === 3145728, report.memoryBytes)

  await stop()
  expect('stop closes the context', a.ctx.state === 'closed', a.ctx.state)
  expect('every node disposed, every context closed', counts.nodesCreated === counts.nodesDisposed && counts.contextsCreated === counts.contextsClosed, { ...counts })

  // Stop and start repeatedly: no leftovers.
  for (let i = 0; i < 3; i++) {
    await start()
    strike(i)
    await sleep(120)
    await stop()
  }
  expect('three more start/stop cycles leave nothing behind', counts.nodesCreated === counts.nodesDisposed && counts.contextsCreated === counts.contextsClosed && running === null, { ...counts })

  // Failures must be reported, not swallowed, and must leave nothing running.
  const offline = () => new OfflineAudioContext(1, 4800, 48000)
  const failure = async (attempt: () => Promise<PhysicsNode>) => {
    try {
      ;(await attempt()).dispose()
      return 'no error raised'
    } catch (error) {
      return (error as Error).message
    }
  }
  const good = toCalls(LAYOUTS.oneBar(48000), 48000).calls
  const corrupt = await failure(() => createPhysicsNode(offline(), good, { source: new Uint8Array([0, 97, 115, 109, 1, 2, 3, 4]).buffer }))
  expect('corrupt WebAssembly is reported', corrupt.startsWith('Physics engine:'), corrupt)
  const unknown = await failure(() => createPhysicsNode(offline(), [['notAnEngineFunction' as Call[0], 1]]))
  expect('an unknown engine call is reported', unknown.includes('unknown engine call'), unknown)
  // Too large to fit: the engine refuses (returns -1) rather than writing out of bounds.
  const huge = offline()
  const refused = await createPhysicsNode(huge, [['reset', 48000, 2], ['addResonator', 1, 1_000_000], ['build']])
  refused.node.connect(huge.destination)
  const rendered = (await huge.startRendering()).getChannelData(0)
  expect('an oversized system is refused, output stays silent and finite', rendered.every((v) => v === 0))

  await start()
  expect('starts again after the failures', running !== null && (running as Running).ctx.state === 'running')
  await stop()
  return checks
}

// ---- Benchmarks ---------------------------------------------------------------------

const SECONDS = 20
const median = (values: number[]) => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)]

/** Renders `SECONDS` of audio through `make`'s node in an OfflineAudioContext, three times; returns the median speed. */
async function offlineSpeed(make: (ctx: OfflineAudioContext) => Promise<AudioNode>) {
  const speeds: number[] = []
  let initMs = 0
  let peak = 0
  for (let run = 0; run < 4; run++) {
    const ctx = new OfflineAudioContext(1, SECONDS * 48000, 48000)
    const t0 = performance.now()
    const node = await make(ctx)
    if (run > 0) initMs = performance.now() - t0 // run 0 also loads the worklet module and fetches files
    node.connect(ctx.destination)
    const t1 = performance.now()
    const data = (await ctx.startRendering()).getChannelData(0)
    if (run > 0) speeds.push(SECONDS / ((performance.now() - t1) / 1000)) // run 0 is the warm-up
    peak = data.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
    if (!data.every(Number.isFinite)) throw new Error('non-finite output')
  }
  const x = median(speeds)
  return { xRealtime: Math.round(x), cpuPercentOfOneCore: Number((100 / x).toFixed(2)), msPer128SampleBlock: Number((2.6667 / x).toFixed(4)), createNodeMs: Number(initMs.toFixed(1)), outputPeak: Number(peak.toFixed(4)) }
}

const referenceModules = new WeakSet<BaseAudioContext>()
async function referenceNode(ctx: BaseAudioContext, layout: Layout, impulse: number) {
  if (!referenceModules.has(ctx)) {
    await ctx.audioWorklet.addModule(new URL('./ts-processor.ts', import.meta.url))
    referenceModules.add(ctx)
  }
  const node = new AudioWorkletNode(ctx, 'sonicmatter-physics-reference', { numberOfInputs: 0, outputChannelCount: [1], processorOptions: { layout, impulse } })
  await new Promise<void>((resolve) => (node.port.onmessage = () => resolve()))
  return node
}

/** The approved Faust bar; `notes` bars are struck 20 ms apart from the start. */
async function faustBar(ctx: BaseAudioContext, notes: number) {
  const node = await createInstrumentNode(ctx, 'bar')
  const [key, trigger] = [node.parameters.get('/bar/key'), node.parameters.get('/bar/strike')]
  if (!key || !trigger) throw new Error('Faust parameters are not exposed as AudioParams')
  for (let i = 0; i < notes; i++) {
    key.setValueAtTime(i, ctx.currentTime + 0.02 * i)
    trigger.setValueAtTime(i + 1, ctx.currentTime + 0.02 * i)
  }
  return node
}

async function bench() {
  await stop()
  const results: Record<string, unknown> = { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, secondsRenderedPerRun: SECONDS }
  const scenarios: [string, () => Layout][] = [
    ['one bar (8 modes)', () => ({ ...LAYOUTS.oneBar(48000), mallets: [] })],
    ['two coupled bars (16 modes, spring and damper)', () => ({ ...LAYOUTS.twoBars(48000), mallets: [] })],
    ['three coupled bars (24 modes, two springs)', () => ({ ...LAYOUTS.threeBars(48000), mallets: [] })],
    ['three coupled bars with two mallets attached', () => LAYOUTS.threeBars(48000)],
    ['25 independent bars (200 modes), all ringing', () => LAYOUTS.keyboard(48000)],
    ['one resonator, 200 modes', LAYOUTS.manyModes(200)],
    ['one resonator, 500 modes', LAYOUTS.manyModes(500)],
  ]
  const offline: Record<string, unknown> = {}
  for (const [name, make] of scenarios) {
    const layout = make()
    const strikes: Call[] = layout.strikePorts.map(([r, p]) => ['applyForce', r, p, 0.01 * 48000])
    offline[name] = {
      wasm: await offlineSpeed(async (ctx) => (await createPhysicsNode(ctx, [...toCalls(layout, 48000).calls, ...strikes])).node),
      typescript: await offlineSpeed((ctx) => referenceNode(ctx, layout, 0.01)),
    }
    el.results.textContent = `benchmarking... ${name} done`
  }
  const keyboard = LAYOUTS.keyboard(48000)
  offline['25 bars, idle (never struck)'] = {
    wasm: await offlineSpeed(async (ctx) => (await createPhysicsNode(ctx, toCalls(keyboard, 48000).calls)).node),
    typescript: await offlineSpeed((ctx) => referenceNode(ctx, keyboard, 0)),
    faust: await offlineSpeed((ctx) => faustBar(ctx, 0)),
  }
  ;(offline['25 independent bars (200 modes), all ringing'] as Record<string, unknown>).faust = await offlineSpeed((ctx) => faustBar(ctx, 25))
  results.offlineAudioContext = offline

  // Live: each engine plays through the speakers for a few seconds while the
  // browser counts underruns. Only the WebAssembly engine can time itself.
  const live: Record<string, unknown> = {}
  const liveRun = async (make: (ctx: AudioContext) => Promise<{ node: AudioNode; physics?: PhysicsNode; tick?: (i: number) => void }>) => {
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    const { node, physics, tick } = await make(ctx)
    node.connect(new GainNode(ctx, { gain: 0.2 })).connect(ctx.destination)
    await ctx.resume()
    await sleep(1500)
    const before = playbackStats(ctx)?.underrunEvents ?? 0
    for (let i = 0; i < 160; i++) {
      tick?.(i)
      await sleep(25)
    }
    await sleep(1500)
    const stats = playbackStats(ctx)
    const report = await physics?.report()
    physics?.dispose()
    node.disconnect()
    await ctx.close()
    return {
      state: 'ran 4 s of rapid playing',
      underrunEvents: stats ? stats.underrunEvents - before : 'not reported by this browser',
      ...(report ? { cpuPercentOfOneCore: Number(((100 * report.busyMs) / ((report.blocks * 128 * 1000) / ctx.sampleRate)).toFixed(2)), blocksOver2ms: report.slowBlocks, blocks: report.blocks, nonFiniteSamples: report.faults } : {}),
    }
  }
  for (const id of ['oneBar', 'twoBars', 'threeBars', 'keyboard'] as LayoutId[]) {
    live[`wasm: ${PLAYABLE[id](48000).name}`] = await liveRun(async (ctx) => {
      const layout = PLAYABLE[id](ctx.sampleRate)
      const built = toCalls(layout, ctx.sampleRate)
      const physics = await createPhysicsNode(ctx, built.calls, { measure: true })
      return {
        node: physics.node,
        physics,
        tick: (i) => {
          const [r, p] = layout.strikePorts[i % layout.strikePorts.length]
          physics.send([['strike', r, p, PULSE.impulse, PULSE.contact]])
          if (built.mallets.length && i % 5 === 0) physics.send([['launch', built.mallets[(i / 5) % 2], 1]])
          if (i % 4 === 0) physics.send(tuneCalls(layout, 0, 0.9 + 0.01 * (i % 30)))
        },
      }
    })
  }
  live['typescript: 25 independent bars'] = await liveRun(async (ctx) => ({ node: await referenceNode(ctx, LAYOUTS.keyboard(ctx.sampleRate), 0.01) }))
  live['faust: approved metal bar, 25 bars struck'] = await liveRun(async (ctx) => ({ node: await faustBar(ctx, 25) }))
  results.liveAudioContext = live
  return results
}

// ---- Dropout comparison ---------------------------------------------------------------
// The same measurement for an AudioContext with nothing in it, a native
// oscillator, the physics engine (as this page and as the builder use it) and
// the approved Faust bar, so that dropouts can be attributed.

interface DropoutCase {
  name: string
  hint: AudioContextLatencyCategory
  make?: (ctx: AudioContext) => Promise<{ node: AudioNode; physics?: PhysicsNode; tick?: () => void }>
}

async function measureDropouts(c: DropoutCase, seconds: number) {
  const ctx = new AudioContext({ latencyHint: c.hint })
  const made = await c.make?.(ctx)
  made?.node.connect(new GainNode(ctx, { gain: 0.05 })).connect(ctx.destination)
  if (made?.node instanceof OscillatorNode) made.node.start()
  await ctx.resume()
  await sleep(2000) // start-up, and playbackStats' once-a-second refresh
  const stats = () => {
    const s = (ctx as AudioContext & { playbackStats?: PlaybackStats }).playbackStats
    return { events: s?.underrunEvents ?? NaN, duration: s?.underrunDuration ?? NaN }
  }
  const [s0, t0, c0, r0] = [stats(), performance.now(), ctx.currentTime, await made?.physics?.report()]
  let [last, worstGap] = [t0, 0]
  while (performance.now() - t0 < seconds * 1000) {
    made?.tick?.()
    await sleep(100)
    worstGap = Math.max(worstGap, performance.now() - last)
    last = performance.now()
  }
  await sleep(1200)
  const [s1, t1, c1, r1] = [stats(), performance.now(), ctx.currentTime, await made?.physics?.report()]
  const result: Record<string, unknown> = {
    underrunEvents: Number.isNaN(s1.events) ? 'not reported by this browser' : s1.events - s0.events,
    underrunMs: Math.round((s1.duration - s0.duration) * 1000),
    // If the device really ran dry, the context's clock falls behind the wall clock by about that long.
    contextClockBehindWallClockMs: Math.round(t1 - t0 - (c1 - c0) * 1000),
    measuredSeconds: Number(((t1 - t0) / 1000).toFixed(1)),
    baseLatencyMs: Math.round(ctx.baseLatency * 1000),
    outputLatencyMs: Math.round(ctx.outputLatency * 1000),
    worstTimerGapMs: Math.round(worstGap),
  }
  if (r0 && r1) {
    const blocks = r1.blocks - r0.blocks
    Object.assign(result, {
      blocksProcessed: blocks,
      blocksExpected: Math.round(((c1 - c0) * ctx.sampleRate) / 128),
      engineCpuPercent: Number(((100 * (r1.busyMs - r0.busyMs)) / ((blocks * 128 * 1000) / ctx.sampleRate)).toFixed(2)),
      blocksOver2ms: r1.slowBlocks - r0.slowBlocks,
      nonFiniteSamples: r1.faults - r0.faults,
    })
  }
  made?.physics?.dispose()
  made?.node.disconnect()
  await ctx.close()
  return result
}

async function dropoutCheck(seconds = 6, rounds = 2) {
  await stop()
  const engine = (calls: (rate: number) => { build: Call[]; play: Call[] }, playing: boolean) => async (ctx: AudioContext) => {
    const { build, play } = calls(ctx.sampleRate)
    const physics = await createPhysicsNode(ctx, build, { measure: true })
    return { node: physics.node, physics, tick: playing ? () => physics.send(play) : undefined }
  }
  const testPage = (rate: number) => {
    const layout = LAYOUTS.threeBars(rate)
    return { build: toCalls(layout, rate).calls, play: layout.strikePorts.map(([r, p]): Call => ['strike', r, p, PULSE.impulse, PULSE.contact]) }
  }
  const builder = (rate: number) => {
    const graph = EXAMPLES[2].make() // a wooden bar joined to a metal bar, with a mallet
    const translation = translate(graph, rate)
    if (!translation.ok) throw new Error('builder example did not translate')
    return { build: translation.built.calls, play: instrumentCalls(graph, translation.built) }
  }
  const cases: DropoutCase[] = [
    { name: '1. AudioContext with nothing in it', hint: 'interactive' },
    { name: '2. native oscillator, no worklet', hint: 'interactive', make: async (ctx) => ({ node: new OscillatorNode(ctx, { frequency: 440 }) }) },
    { name: '3. Phase 3A.1 engine (three coupled bars), idle', hint: 'interactive', make: engine(testPage, false) },
    { name: '4. Phase 3A.1 engine, struck 10 times a second', hint: 'interactive', make: engine(testPage, true) },
    { name: '5. builder instrument (wood + metal + mallet), idle', hint: 'interactive', make: engine(builder, false) },
    { name: '6. builder instrument, played 10 times a second', hint: 'interactive', make: engine(builder, true) },
    { name: '7. approved Faust bar, 25 bars struck', hint: 'interactive', make: async (ctx) => ({ node: await faustBar(ctx, 25) }) },
    { name: '8. AudioContext with nothing in it, larger buffer ("playback")', hint: 'playback' },
    { name: '9. builder instrument, played, larger buffer ("playback")', hint: 'playback', make: engine(builder, true) },
  ]
  const results: Record<string, unknown[]> = {}
  for (let round = 0; round < rounds; round++) {
    for (const c of cases) {
      ;(results[c.name] ??= []).push(await measureDropouts(c, seconds))
      el.results.textContent = `dropout comparison... round ${round + 1}: ${c.name} done`
    }
  }
  return { visibility: document.visibilityState, hardwareConcurrency: navigator.hardwareConcurrency, secondsPerCase: seconds, results }
}

// ---- Strings on a soundboard (Phase 3C.2 prototype) -------------------------------------
// The same instruments as analysis/render-soundboard.ts, timed in a real AudioWorklet.

const SOUNDBOARD: PlateParams = { ...SPRUCE_PLATE, thickness: 0.004 }
const GUITAR_SET: StringParams[] = ([[82.41, 0.0064], [110, 0.0036], [146.83, 0.0021], [196, 0.0012], [246.94, 0.0007], [329.63, 0.0004]] as const).map(([f, density]) => ({ length: 0.65, density, tension: density * (2 * 0.65 * f) ** 2 }))

// Phase 3C.2.1: the refined board is 8 mm with the bridge near one end, and its sound passes through unbaffled()'s filter.
const REFINED_BOARD: PlateParams = { ...SPRUCE_PLATE, thickness: 0.008 }

function stringInstrument(strings: StringParams[], modesPerString: number, boardLimit: number, rate: number, refined = false) {
  const points = strings.map((_, i): [number, number] => [refined ? 0.08 : 0.3, 0.44 + ((i - (strings.length - 1) / 2) * 0.01) / SOUNDBOARD.width])
  const built = buildInstrument({ strings, loss: DEFAULT_LOSS, stringModes: modesPerString, pluckAt: 0.8, body: plateModes(refined ? REFINED_BOARD : SOUNDBOARD, points, rate, boardLimit), bridge: { stiffness: 1e6 }, output: { port: strings.length, gain: 4 } }, rate)
  // Every string plucked (a short push at its pluck point), in turn.
  const play = (i: number): Call[] => [['strike', built.strings[i % strings.length], STRING_PLUCK, 0.002, 0.002]]
  return { built, play }
}

async function stringBench() {
  await stop()
  const cases: [string, StringParams[], number, number, boolean?][] = [
    ['one string (100 modes), soundboard to 2 kHz', [GUITAR_SET[1]], 100, 2000],
    ['one string (100 modes), soundboard to 5 kHz', [GUITAR_SET[1]], 100, 5000],
    ['REFINED board, one string (100 modes), to 5 kHz', [GUITAR_SET[1]], 100, 5000, true],
    ['REFINED board, six strings (100 modes each), to 5 kHz', GUITAR_SET, 100, 5000, true],
    ['three strings (100 modes each), soundboard to 2 kHz', GUITAR_SET.slice(1, 4), 100, 2000],
    ['six strings (60 modes each), soundboard to 2 kHz', GUITAR_SET, 60, 2000],
    ['six strings (100 modes each), soundboard to 5 kHz', GUITAR_SET, 100, 5000],
  ]
  const results: Record<string, unknown> = {}
  for (const [name, strings, modesPerString, boardLimit, refined] of cases) {
    // The refined board's sound is its engine output through the no-baffle high-pass (a native filter node).
    const toOutput = (ctx: BaseAudioContext, node: AudioNode) => {
      if (!refined) return node
      const t = Math.tan((Math.PI * unbaffledCorner(REFINED_BOARD.length * REFINED_BOARD.width)) / ctx.sampleRate)
      const a = (1 - t) / (1 + t)
      return node.connect(new IIRFilterNode(ctx, { feedforward: [(1 + a) / 2, -(1 + a) / 2], feedback: [1, -a] }))
    }
    // Offline: how fast the worklet can go.
    const speeds: number[] = []
    let modes = 0
    let peak = 0
    for (let runIndex = 0; runIndex < 4; runIndex++) {
      const ctx = new OfflineAudioContext(1, 10 * 48000, 48000)
      const { built, play } = stringInstrument(strings, modesPerString, boardLimit, 48000, refined)
      modes = built.modes.body + built.modes.strings.reduce((a, b) => a + b, 0)
      const physics = await createPhysicsNode(ctx, [...built.calls, ...strings.flatMap((_, i) => play(i))])
      toOutput(ctx, physics.node).connect(ctx.destination)
      const t0 = performance.now()
      const data = (await ctx.startRendering()).getChannelData(0)
      if (runIndex > 0) speeds.push(10 / ((performance.now() - t0) / 1000))
      peak = data.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
      if (!data.every(Number.isFinite)) throw new Error('non-finite output')
    }
    // Live: plucked ten times a second for 6 s, through the speakers and then with no output device.
    const live: Record<string, unknown> = {}
    for (const sink of ['default device', 'no device'] as const) {
      const ctx = new AudioContext({ latencyHint: 'interactive', ...(sink === 'no device' ? { sinkId: { type: 'none' } } : {}) } as AudioContextOptions)
      const { built, play } = stringInstrument(strings, modesPerString, boardLimit, ctx.sampleRate, refined)
      const physics = await createPhysicsNode(ctx, built.calls, { measure: true })
      toOutput(ctx, physics.node).connect(new GainNode(ctx, { gain: 0.3 })).connect(ctx.destination)
      await ctx.resume()
      await sleep(1500)
      const stats = (ctx as AudioContext & { playbackStats?: PlaybackStats }).playbackStats
      const [r0, c0, u0, t0] = [await physics.report(), ctx.currentTime, stats?.underrunEvents ?? 0, performance.now()]
      for (let i = 0; performance.now() - t0 < 6000; i++) {
        physics.send(play(i))
        await sleep(100)
      }
      await sleep(1200)
      const r1 = await physics.report()
      const blocks = r1.blocks - r0.blocks
      live[sink] = {
        engineCpuPercentOfOneCore: Number(((100 * (r1.busyMs - r0.busyMs)) / ((blocks * 128 * 1000) / ctx.sampleRate)).toFixed(2)),
        blocksOf2msOrMore: r1.slowBlocks - r0.slowBlocks,
        blocksProcessed: blocks,
        blocksExpected: Math.round(((ctx.currentTime - c0) * ctx.sampleRate) / 128),
        deviceDropouts: stats ? stats.underrunEvents - u0 : 'not reported',
        nonFiniteSamples: r1.faults,
      }
      physics.dispose()
      await ctx.close()
    }
    const x = median(speeds)
    results[name] = { modes, offline: { xRealtime: Math.round(x), cpuPercentOfOneCore: Number((100 / x).toFixed(2)), outputPeak: Number(peak.toFixed(3)) }, live }
    el.results.textContent = `string benchmark... ${name} done`
  }
  return { userAgent: navigator.userAgent, results }
}

// ---- Wiring ---------------------------------------------------------------------------

const busy = async (button: HTMLButtonElement, work: () => Promise<unknown>) => {
  button.disabled = true
  el.results.textContent = 'running...'
  try {
    const result = await work()
    el.results.textContent = JSON.stringify(result, null, 2)
    return result
  } catch (error) {
    showError(error)
    el.results.textContent = `failed: ${String(error)}`
    throw error
  } finally {
    button.disabled = false
    render()
  }
}
el.start.onclick = () => start().then(() => applyEdits('all'), () => {})
el.stop.onclick = () => stop()
el.suspend.onclick = () => toggleSuspend()
el.rapid.onclick = () => busy(el.rapid, () => rapid())
el.verify.onclick = () => busy(el.verify, verify)
el.bench.onclick = () => busy(el.bench, bench)
el.dropouts.onclick = () => busy(el.dropouts, () => dropoutCheck())
el.strings.onclick = () => busy(el.strings, stringBench)
applyEdits('all')
render()

// For driving the page from the developer console.
Object.assign(window, { sonicmatterExperimental: { start, stop, strike, mallet, send, status, rapid, verify, bench, dropoutCheck, stringBench, livePeak, counts } })
