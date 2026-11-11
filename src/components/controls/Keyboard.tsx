import { useEffect } from 'react'

/** Two octaves: frets 0..24 above the open string. */
const FRETS = Array.from({ length: 25 }, (_, i) => i)
// Piano-style layout only; fret 0 is whatever pitch the open string has.
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
  /** Fret of the most recent note, highlighted. */
  active: number | null
  frequencyOf: (fret: number) => number
  onPluck: (fret: number) => void
}

export function Keyboard({ disabled, active, frequencyOf, onPluck }: Props) {
  useEffect(() => {
    if (disabled) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const fret = CODES.indexOf(e.code)
      if (fret >= 0) onPluck(fret)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [disabled, onPluck])

  const key = (fret: number) => {
    const black = isBlack(fret)
    const on = active === fret
    return (
      <button
        key={fret}
        type="button"
        disabled={disabled}
        aria-label={`Fret ${fret}, ${frequencyOf(fret).toFixed(1)} hertz`}
        title={`Fret ${fret}: ${frequencyOf(fret).toFixed(1)} Hz`}
        onPointerDown={() => onPluck(fret)}
        // Keyboard users: Enter/Space on a focused key.
        onClick={(e) => e.detail === 0 && onPluck(fret)}
        style={
          black
            ? { left: `${(WHITE.filter((w) => w < fret).length / WHITE.length) * 100}%` }
            : undefined
        }
        className={
          'flex items-end justify-center pb-1 text-xs select-none disabled:opacity-40 ' +
          (black
            ? `absolute top-0 z-10 h-3/5 w-[4.5%] -translate-x-1/2 rounded-b border border-neutral-950 text-neutral-400 ${on ? 'bg-emerald-600' : 'bg-neutral-800'}`
            : `h-full flex-1 rounded-b border border-neutral-950 text-neutral-600 ${on ? 'bg-emerald-300' : 'bg-neutral-200'}`)
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
