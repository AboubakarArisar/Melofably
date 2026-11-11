/** Equal-tempered MIDI note number to frequency in Hz (A4 = note 69). */
export function midiToFrequency(note: number, a4 = 440): number {
  return a4 * 2 ** ((note - 69) / 12)
}
