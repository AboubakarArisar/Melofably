import { useEffect, useRef } from 'react'

const W = 1000
const H = 200
const F_MIN = 20
const F_MAX = 20000
const DB_MIN = -110
const DB_MAX = -10
const SCOPE_SAMPLES = 2048

const freqToX = (f: number) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * W

function clear(g: CanvasRenderingContext2D) {
  g.fillStyle = '#fffaf3'
  g.fillRect(0, 0, W, H)
  g.lineWidth = 1
}

function drawWaveform(g: CanvasRenderingContext2D, samples: Float32Array) {
  clear(g)
  g.strokeStyle = '#e6d9ce'
  g.beginPath()
  g.moveTo(0, H / 2)
  g.lineTo(W, H / 2)
  g.stroke()
  // Start at a rising zero crossing so a steady tone holds still.
  let start = 1
  const limit = samples.length - SCOPE_SAMPLES
  while (start < limit && !(samples[start - 1] < 0 && samples[start] >= 0)) start++
  if (start === limit) start = 0
  g.strokeStyle = '#790b13'
  g.beginPath()
  for (let i = 0; i < SCOPE_SAMPLES; i++) {
    const x = (i / (SCOPE_SAMPLES - 1)) * W
    const y = H / 2 - (samples[start + i] / 0.6) * (H / 2)
    if (i === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  }
  g.stroke()
}

function drawSpectrum(g: CanvasRenderingContext2D, db: Float32Array, sampleRate: number, fundamental: number) {
  clear(g)
  g.font = '11px monospace'
  g.fillStyle = '#746566'
  g.strokeStyle = '#e6d9ce'
  for (const f of [100, 1000, 10000]) {
    g.beginPath()
    g.moveTo(freqToX(f), 0)
    g.lineTo(freqToX(f), H)
    g.stroke()
    g.fillText(f < 1000 ? `${f} Hz` : `${f / 1000} kHz`, freqToX(f) + 4, H - 4)
  }
  // Where the formula says the fundamental should be.
  g.strokeStyle = '#a8650f'
  g.beginPath()
  g.moveTo(freqToX(fundamental), 0)
  g.lineTo(freqToX(fundamental), H)
  g.stroke()
  g.strokeStyle = '#790b13'
  g.beginPath()
  const binHz = sampleRate / (2 * db.length)
  for (let k = 1; k < db.length; k++) {
    const x = freqToX(k * binHz)
    if (x < 0) continue
    const level = Math.min(DB_MAX, Math.max(DB_MIN, db[k]))
    const y = H - ((level - DB_MIN) / (DB_MAX - DB_MIN)) * H
    if (x > W) break
    g.lineTo(x, y)
  }
  g.stroke()
}

interface Props {
  /** Tap on the engine's real output; null while audio is stopped. */
  analyser: AnalyserNode | null
  /** Calculated fundamental, drawn as a marker on the spectrum. */
  fundamental: number
}

/** Oscilloscope and spectrum of the synthesized output, read from an AnalyserNode. */
export function Visualizer({ analyser, fundamental }: Props) {
  const wave = useRef<HTMLCanvasElement>(null)
  const spectrum = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const gw = wave.current?.getContext('2d')
    const gs = spectrum.current?.getContext('2d')
    if (!analyser || !gw || !gs) return
    const samples = new Float32Array(analyser.fftSize)
    const db = new Float32Array(analyser.frequencyBinCount)
    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      analyser.getFloatTimeDomainData(samples)
      analyser.getFloatFrequencyData(db)
      drawWaveform(gw, samples)
      drawSpectrum(gs, db, analyser.context.sampleRate, fundamental)
    }
    draw()
    return () => cancelAnimationFrame(frame)
  }, [analyser, fundamental])

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <figure>
        <figcaption className="mb-1 text-neutral-400">Waveform</figcaption>
        <canvas ref={wave} width={W} height={H} className="w-full rounded border border-neutral-800 bg-neutral-950" />
      </figure>
      <figure>
        <figcaption className="mb-1 text-neutral-400">
          Spectrum <span className="text-amber-300">(line: calculated fundamental)</span>
        </figcaption>
        <canvas ref={spectrum} width={W} height={H} className="w-full rounded border border-neutral-800 bg-neutral-950" />
      </figure>
    </div>
  )
}
