/**
 * One controllable DSP parameter. Mirrors the entries in the UI JSON that the
 * Faust compiler emits for every hslider/vslider/nentry, so controls are
 * generated from compiled DSP metadata instead of being hand-maintained.
 */
export interface InstrumentParam {
  /** Faust parameter path, e.g. "/string/damping". */
  address: string
  label: string
  min: number
  max: number
  init: number
  step: number
  unit?: string
}

export type EngineStatus =
  | { state: 'stopped' | 'starting' | 'running' | 'suspended' }
  | { state: 'error'; message: string }
