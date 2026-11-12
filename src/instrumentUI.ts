// What the interface shows for each instrument: its controls, calculated
// readouts and note naming. Slider ranges, defaults and units are not here:
// they come from the compiled Faust models (instrumentParams).
import {
  BAR_MODE_K,
  barModeFrequencies,
  glassModeFrequencies,
  stringFundamental,
  woodDecayTime,
  type BarParams,
  type GlassParams,
} from './audio/engine/physics'
import { instrumentParams } from './audio/worklet/instruments'
import type { InstrumentId } from './types'
export type Values = Record<string, number>
interface Readout {
  label: string
  value: string
}
export interface InstrumentUI {
  label: string
  /** What a key selects, for labels: a fret of the string, a bar of the set. */
  noteName: string
  /** Slider ranges, defaults and units come from the compiled Faust model. */
  controls: { key: string; label: string }[]
  /** Calculated frequency in Hz of note `note` (its lowest mode). */
  frequency: (v: Values, note: number) => number
  readouts: (v: Values, note: number | null) => Readout[]
}

const hz = (f: number) => `${f.toFixed(2)} Hz`
const barFrequency = (v: Values, note: number) => barModeFrequencies(v as unknown as BarParams, note)[0]
// The first entry is the (2,0) mode, always the lowest.
const glassFrequency = (v: Values, note: number) => glassModeFrequencies(v as unknown as GlassParams, note)[0]

export const INSTRUMENTS: Record<InstrumentId, InstrumentUI> = {
  string: {
    label: 'String',
    noteName: 'fret',
    controls: [
      { key: 'length', label: 'String length' },
      { key: 'tension', label: 'Tension' },
      { key: 'density', label: 'Linear density' },
      { key: 'damping', label: 'Damping' },
      { key: 'pluckPosition', label: 'Pluck position' },
      { key: 'strength', label: 'Excitation strength' },
      { key: 'brightness', label: 'Tone brightness' },
      { key: 'softness', label: 'Attack softness' },
      { key: 'body', label: 'Body resonance' },
    ],
    frequency: (v, note) => stringFundamental(v.tension, v.density, v.length, note),
    readouts: (v, note) => [
      { label: 'Open string, f = √(T/μ) / 2L', value: hz(stringFundamental(v.tension, v.density, v.length)) },
      {
        label: note === null ? 'Last note' : `Last note (fret ${note})`,
        value: note === null ? '—' : hz(stringFundamental(v.tension, v.density, v.length, note)),
      },
      { label: 'Wave speed, √(T/μ)', value: `${Math.sqrt(v.tension / v.density).toFixed(1)} m/s` },
    ],
  },
  bar: {
    label: 'Metal Bar',
    noteName: 'bar',
    controls: [
      { key: 'length', label: 'Bar length (longest bar)' },
      { key: 'thickness', label: 'Thickness' },
      { key: 'density', label: 'Density' },
      { key: 'youngsModulus', label: "Young's modulus" },
      { key: 'lossFactor', label: 'Internal damping (loss factor)' },
      { key: 'strikePosition', label: 'Strike position (0 end, 0.5 middle)' },
      { key: 'hardness', label: 'Mallet hardness' },
      { key: 'velocity', label: 'Strike velocity' },
    ],
    frequency: barFrequency,
    readouts: (v, note) => [
      { label: 'Longest bar, mode 1 = k₁²h/(2πL²)·√(E/12ρ)', value: hz(barFrequency(v, 0)) },
      {
        label: note === null ? 'Last bar struck' : `Last bar struck (bar ${note})`,
        value: note === null ? '—' : hz(barFrequency(v, note)),
      },
      {
        label: 'Mode ratios (free-free beam)',
        value: BAR_MODE_K.slice(0, 4)
          .map((k) => ((k / BAR_MODE_K[0]) ** 2).toFixed(2))
          .join(' : '),
      },
    ],
  },
  wood: {
    label: 'Wooden Bar',
    noteName: 'bar',
    controls: [
      { key: 'length', label: 'Bar length (longest bar)' },
      { key: 'thickness', label: 'Thickness' },
      { key: 'density', label: 'Wood density' },
      { key: 'youngsModulus', label: "Stiffness along the grain (Young's modulus)" },
      { key: 'lossFactor', label: 'Internal damping (loss factor at 1 kHz)' },
      { key: 'strikePosition', label: 'Strike position (0 end, 0.5 middle)' },
      { key: 'hardness', label: 'Mallet hardness' },
      { key: 'velocity', label: 'Strike velocity' },
      { key: 'resonator', label: 'Resonator tubes' },
    ],
    // The same beam equation as the metal bar; only the material differs.
    frequency: barFrequency,
    readouts: (v, note) => [
      { label: 'Longest bar, mode 1 = k₁²h/(2πL²)·√(E/12ρ)', value: hz(barFrequency(v, 0)) },
      {
        label: note === null ? 'Last bar struck' : `Last bar struck (bar ${note})`,
        value: note === null ? '—' : hz(barFrequency(v, note)),
      },
      {
        label: 'Decay time (60 dB) of modes 1, 2, 3',
        value: barModeFrequencies(v as unknown as BarParams, note ?? 0)
          .slice(0, 3)
          .map((f) => `${Math.round(1000 * woodDecayTime(f, v.lossFactor))}`)
          .join(' / ')
          .concat(' ms'),
      },
    ],
  },
  glass: {
    label: 'Glass Vessel',
    noteName: 'vessel',
    controls: [
      { key: 'diameter', label: 'Diameter (largest vessel)' },
      { key: 'height', label: 'Height (largest vessel)' },
      { key: 'thickness', label: 'Wall thickness' },
      { key: 'youngsModulus', label: "Glass stiffness (Young's modulus)" },
      { key: 'density', label: 'Glass density' },
      { key: 'lossFactor', label: 'Material damping (loss factor)' },
      { key: 'strikeHeight', label: 'Strike height (0 base, 1 rim)' },
      { key: 'hardness', label: 'Striker hardness' },
      { key: 'velocity', label: 'Strike velocity' },
    ],
    frequency: glassFrequency,
    readouts: (v, note) => {
      const modes = glassModeFrequencies(v as unknown as GlassParams).sort((a, b) => a - b)
      return [
        { label: 'Largest vessel, mode (2,0)', value: hz(glassFrequency(v, 0)) },
        {
          label: note === null ? 'Last vessel struck' : `Last vessel struck (vessel ${note})`,
          value: note === null ? '—' : hz(glassFrequency(v, note)),
        },
        {
          label: 'Lowest mode ratios (depend on diameter/height)',
          value: modes
            .slice(0, 4)
            .map((f) => (f / modes[0]).toFixed(2))
            .join(' : '),
        },
      ]
    },
  },
}
export const IDS: InstrumentId[] = ['string', 'bar', 'glass', 'wood'] // selector order

/** Every instrument's control values, kept separately so each survives switching. */
export type AllValues = Record<InstrumentId, Values>

/** Each control at the default declared in its Faust model. */
export function defaultValues(): AllValues {
  return Object.fromEntries(
    IDS.map((id) => [id, Object.fromEntries(INSTRUMENTS[id].controls.map((c) => [c.key, instrumentParams[id][c.key].init]))]),
  ) as AllValues
}

/** A copy of `all` with one control of one instrument changed; the rest untouched. */
export function withValue(all: AllValues, instrument: InstrumentId, key: string, value: number): AllValues {
  return { ...all, [instrument]: { ...all[instrument], [key]: value } }
}
