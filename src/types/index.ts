/**
 * One controllable DSP parameter. Mirrors the entries in the UI JSON that the
 * Faust compiler emits for every hslider/vslider/nentry, so controls can be
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
}
