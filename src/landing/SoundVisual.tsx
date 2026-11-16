// The landing page's picture of sound being made: a string is pulled aside
// and let go, rings as the sum of its standing waves, and shakes the metal
// bar it is tied to, which sends rings of sound outward. It is a drawing of
// the physics, not the audio engine: nothing here makes or touches sound.
// It stops drawing when it is off screen or the tab is hidden, and is a
// single still picture for anyone who asked for reduced motion.
import { useEffect, useRef } from 'react'

const PERIOD = 5 // seconds from one pluck to the next
const PULL = 0.7 // of which the finger spends this long pulling the string aside
const PLACES = [0.24, 0.42, 0.16, 0.6] // where along the string each pluck is made
const MODES = 14
const INK = '54 92 67' // the dark green of the string and its fixings
const SAGE = '120 149 117' // the bar and the sound it sends out

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  ctx.clearRect(0, 0, w, h)
  const turn = Math.floor(time / PERIOD)
  const t = time - turn * PERIOD // time in this turn
  const place = PLACES[turn % PLACES.length]
  const y0 = h * 0.5
  const x0 = w * 0.06
  const barFrom = w * 0.58
  const barTo = w * 0.94
  const x1 = barFrom + (barTo - barFrom) * 0.2 // the string is tied a fifth of the way along the bar
  const amplitude = Math.min(h * 0.2, 90)
  const ring = t - PULL // seconds since the string was let go (negative: still being pulled)

  // The string: a triangle while it is held, then that triangle's own standing waves, each dying at its own rate.
  const shape = (s: number) => {
    if (ring < 0) return (t / PULL) ** 0.6 * (s < place ? s / place : (1 - s) / (1 - place))
    let y = 0
    for (let n = 1; n <= MODES; n++) y += ((2 * Math.sin(n * Math.PI * place)) / (n * n * Math.PI * Math.PI * place * (1 - place))) * Math.sin(n * Math.PI * s) * Math.cos(n * 2 * Math.PI * 1.15 * ring) * Math.exp(-ring * (0.45 + 0.1 * n))
    return y
  }
  const energy = ring < 0 ? 0 : Math.exp(-ring * 0.75)
  // The bar answers a moment later, in the first bending shape of a bar free at both ends.
  const barSwing = ring < 0 ? 0 : (1 - Math.exp(-ring * 6)) * Math.exp(-ring * 0.6) * Math.sin(2 * Math.PI * 2.6 * ring) * amplitude * 0.12

  // Rings of sound leaving the bar.
  const cx = (barFrom + barTo) / 2
  for (let k = 0; k < 5; k++) {
    const age = ((ring % 0.8) + 0.8) % 0.8 + 0.8 * k
    const born = ring - age
    if (ring < 0 || born < 0) continue
    const alpha = Math.exp(-born * 0.75) * (1 - age / 4) * 0.5
    if (alpha <= 0.01) continue
    ctx.beginPath()
    ctx.ellipse(cx, y0, 30 + age * w * 0.11, 14 + age * h * 0.16, 0, 0, 2 * Math.PI)
    ctx.strokeStyle = `rgb(${SAGE} / ${alpha * 1.4})`
    ctx.lineWidth = 1.25
    ctx.stroke()
  }

  // The rest position of the string, faintly, so the motion has something to be measured against.
  ctx.setLineDash([3, 7])
  ctx.strokeStyle = `rgb(${INK} / 0.22)`
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x0, y0)
  ctx.lineTo(x1, y0)
  ctx.stroke()
  ctx.setLineDash([])

  // The bar, bending, on its two pads.
  const bend = (s: number) => barSwing * Math.cos(2 * Math.PI * s)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  for (let i = 0; i <= 40; i++) ctx.lineTo(barFrom + ((barTo - barFrom) * i) / 40, y0 + bend(i / 40))
  ctx.strokeStyle = `rgb(${SAGE} / ${0.6 + 0.4 * energy})`
  ctx.lineWidth = Math.max(8, h * 0.035)
  ctx.stroke()
  for (const s of [0.224, 0.776]) {
    ctx.beginPath()
    ctx.arc(barFrom + (barTo - barFrom) * s, y0 + Math.max(8, h * 0.035) / 2 + 9, 4, 0, 2 * Math.PI)
    ctx.fillStyle = `rgb(${INK} / 0.55)`
    ctx.fill()
  }

  // The string, with a soft glow while it holds energy.
  const tieY = y0 + bend(0.2)
  ctx.beginPath()
  for (let i = 0; i <= 160; i++) {
    const s = i / 160
    ctx.lineTo(x0 + (x1 - x0) * s, y0 + (tieY - y0) * s - shape(s) * amplitude)
  }
  ctx.shadowColor = `rgb(${SAGE} / ${0.8 * energy})`
  ctx.shadowBlur = 18 * energy
  ctx.strokeStyle = `rgb(${INK})`
  ctx.lineWidth = 2.5
  ctx.stroke()
  ctx.shadowBlur = 0

  // Where it is fixed, where it is tied, and the finger that plucks it.
  for (const [x, y] of [[x0, y0], [x1, tieY]]) {
    ctx.beginPath()
    ctx.arc(x, y, 6, 0, 2 * Math.PI)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = `rgb(${INK})`
    ctx.lineWidth = 2
    ctx.stroke()
  }
  if (ring < 0.25) {
    ctx.beginPath()
    ctx.arc(x0 + (x1 - x0) * place, y0 - shape(place) * amplitude * (ring < 0 ? 1 : 0) - (ring < 0 ? 0 : amplitude + ring * 120), 7, 0, 2 * Math.PI)
    ctx.fillStyle = `rgb(${INK} / ${ring < 0 ? 0.9 : 0.9 * (1 - ring / 0.25)})`
    ctx.fill()
  }
}

export function SoundVisual({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    let time = PULL + 0.22 // a still picture shows the string just after it is let go
    let frame = 0
    let last = 0
    let onScreen = true
    const paint = () => {
      const scale = Math.min(devicePixelRatio || 1, 2)
      const { width, height } = canvas.getBoundingClientRect()
      if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
        canvas.width = Math.round(width * scale)
        canvas.height = Math.round(height * scale)
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      draw(ctx, width, height, time)
    }
    const tick = (now: number) => {
      time += Math.min(0.05, (now - last) / 1000) // a long gap (a hidden tab) does not jump the picture forward
      last = now
      paint()
      frame = requestAnimationFrame(tick)
    }
    const run = () => {
      cancelAnimationFrame(frame)
      frame = 0
      if (still || !onScreen || document.hidden) return paint()
      last = performance.now()
      frame = requestAnimationFrame(tick)
    }
    const seen = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      run()
    })
    seen.observe(canvas)
    const sized = new ResizeObserver(() => frame || paint())
    sized.observe(canvas)
    document.addEventListener('visibilitychange', run)
    run()
    return () => {
      cancelAnimationFrame(frame)
      seen.disconnect()
      sized.disconnect()
      document.removeEventListener('visibilitychange', run)
    }
  }, [])
  return <canvas ref={ref} className={className} role="img" aria-label="A string is plucked, rings, and sets the metal bar it is tied to ringing, which sends out sound." />
}
