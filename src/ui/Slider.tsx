// Melofably's slider: a label, the value with its unit, a fully drawn track
// and thumb, and the ends of the range. Underneath is a native range input,
// so the keyboard, touch, min, max and step are the browser's own and the
// value has one source of truth. Styles: controls.css (.m-slider).
import { useId } from 'react'

export interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  /** The slider moves in equal ratios (for values spanning decades). */
  log?: boolean
  /** How the value is written; by default as many decimals as the step has. */
  format?: (value: number) => string
  /** Shown after the unit, in the value's line (for example a level in dB). */
  note?: string
  hint?: string
  disabled?: boolean
  showRange?: boolean
  onChange: (value: number) => void
}

const decimalsOf = (step: number) => Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))))
const plain = (value: number, step: number) => (Math.abs(value) >= 10000 ? value.toExponential(2) : value.toFixed(decimalsOf(step)))

export function Slider({ label, value, min, max, step, unit, log, format, note, hint, disabled, showRange = true, onChange }: SliderProps) {
  const id = useId()
  const write = format ?? ((v: number) => plain(v, step))
  return (
    <div className="m-slider" title={hint}>
      <div className="m-slider-head">
        <label htmlFor={id} className="m-slider-label">
          {label}
        </label>
        <output htmlFor={id} className="m-slider-value">
          {write(value)}
          {(unit || note) && <small>{[unit, note].filter(Boolean).join(' · ')}</small>}
        </output>
      </div>
      <div className="m-slider-track">
        <input
          id={id}
          type="range"
          disabled={disabled}
          min={log ? Math.log10(min) : min}
          max={log ? Math.log10(max) : max}
          step={log ? 0.01 : step}
          value={log ? Math.log10(value) : value}
          aria-valuetext={`${write(value)}${unit ? ` ${unit}` : ''}`}
          onChange={(e) => onChange(log ? Number((10 ** e.target.valueAsNumber).toPrecision(3)) : e.target.valueAsNumber)}
        />
      </div>
      {showRange && (
        <div className="m-slider-range" aria-hidden="true">
          <span>{write(min)}</span>
          <span>{write(max)}</span>
        </div>
      )}
    </div>
  )
}
