import type { InstrumentParam } from '../../types'
import { Slider } from '../../ui/Slider'

interface Props {
  /** Range, step and unit come from the compiled Faust metadata. */
  param: InstrumentParam
  label: string
  value: number
  onChange: (value: number) => void
}

export function ParamSlider({ param, label, value, onChange }: Props) {
  return <Slider label={label} value={value} min={param.min} max={param.max} step={param.step} unit={param.unit} onChange={onChange} />
}
