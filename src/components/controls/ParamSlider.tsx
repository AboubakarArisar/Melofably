import type { InstrumentParam } from '../../types'

interface Props {
  /** Range, step and unit come from the compiled Faust metadata. */
  param: InstrumentParam
  label: string
  value: number
  onChange: (value: number) => void
}

export function ParamSlider({ param, label, value, onChange }: Props) {
  const decimals = Math.max(0, Math.ceil(-Math.log10(param.step)))
  return (
    <label className="block">
      <span className="flex justify-between text-neutral-400">
        <span>{label}</span>
        <output className="text-neutral-100 tabular-nums">
          {value.toFixed(decimals)} {param.unit}
        </output>
      </span>
      <input
        type="range"
        className="mt-1 w-full accent-emerald-400"
        min={param.min}
        max={param.max}
        step={param.step}
        value={value}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </label>
  )
}
