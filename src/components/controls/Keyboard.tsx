import { useEffect } from 'react'

/** Two octaves: notes 0..24 above the instrument's lowest. */
const FRETS = Array.from({ length: 25 }, (_, i) => i)
// Piano-style layout only; note 0 is whatever pitch the instrument's physics gives.
const isBlack = (fret: number) => [1, 3, 6, 8, 10].includes(fret % 12)
const WHITE = FRETS.filter((f) => !isBlack(f))
// Computer keys, by physical position: Z row = first octave, Q row = second.
const CODES = [
  'KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM',
  'KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU',
  'KeyI',
]

interface Props {
  disabled: boolean
  /** Most recent note, highlighted. */
  active: number | null
  /** What a key selects ("fret", "bar"), for labels. */
  noteName: string
  frequencyOf: (note: number) => number
  onPlay: (note: number) => void
}

export function Keyboard({ disabled, active, noteName, frequencyOf, onPlay }: Props) {
  useEffect(() => {
    if (disabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const fret = CODES.indexOf(e.code)
      if (fret >= 0) onPlay(fret)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [disabled, onPlay])

  const key = (fret: number) => {
    const black = isBlack(fret)
    const on = active === fret
    return (
      <button
        key={fret}
        type="button"
        disabled={disabled}
        aria-label={`${noteName} ${fret}, ${frequencyOf(fret).toFixed(1)} hertz`}
        title={`${noteName} ${fret}: ${frequencyOf(fret).toFixed(1)} Hz`}
        onPointerDown={() => onPlay(fret)}
        // Keyboard users: Enter/Space on a focused key.
        onClick={(e) => e.detail === 0 && onPlay(fret)}
        style={
          black
            ? { left: `${(WHITE.filter((w) => w < fret).length / WHITE.length) * 100}%` }
            : undefined
        }
        className={
          'm-key flex items-end justify-center pb-1 text-xs select-none disabled:opacity-40 ' +
          (black
            ? `absolute top-0 z-10 h-3/5 w-[4.5%] -translate-x-1/2 rounded-b border border-neutral-100 text-neutral-950 ${on ? 'bg-sky-500' : 'bg-neutral-100'}`
            : `h-full flex-1 rounded-b border border-neutral-600 text-neutral-400 ${on ? 'bg-amber-900' : 'bg-neutral-900'}`)
        }
      >
        {CODES[fret].replace(/Key|Digit/, '')}
      </button>
    )
  }

  return (
    <div className="relative flex h-40 touch-none">
      {WHITE.map(key)}
      {FRETS.filter(isBlack).map(key)}
    </div>
  )
}
