# String model (Phase 1)

Source: `src/audio/models/string.dsp`. Tests: `tests/string.test.ts`.

## What is modelled

One ideal string fixed at both ends. A disturbance travels along it at
`c = sqrt(T / mu)`, reflects (inverted) at each end, and returns after a round
trip of `2L`. The fundamental is therefore

```
f = sqrt(T / mu) / (2 L)
```

`T` (tension, N), `mu` (linear density, kg/m) and `L` (length, m) are the
controls. The DSP computes `f` from them on every sample; nothing else sets
the pitch. The keyboard frets the string: key `n` shortens the vibrating
length to `L * 2^(-n/12)`.

## Signal flow

```
pluck trigger -> impulse * strength -> pick lowpass -> pluck-position comb
              -> leaky integrator --(+)--------------------------> x0.5 -> clamp -> out
                                     ^                         |
                                     |                         v
                          loop gain * loss FIR * fractional delay (N - 2)
```

This is a single-delay-loop digital waveguide (the Karplus-Strong structure as
extended by Jaffe and Smith). The two travelling waves and both reflections
are consolidated into one delay line holding one round trip, `N = SR / f`
samples.

| Part | Implementation | Why |
| --- | --- | --- |
| Delay line | `N - 2` samples, 4th-order Lagrange interpolation (`de.fdelay4`) | `N` is rarely an integer; interpolation keeps the pitch exact. The other 2 samples are the loss filter (1) and the feedback path (1). |
| Loss filter | 3-tap symmetric FIR `[a, 1-2a, a]` | High partials decay faster, as on a real string. Linear phase: exactly 1 sample of delay at every frequency, so damping never detunes the string. |
| Loop gain | `10^(-3 N / (SR * T60))` | Frequency-independent decay with a 60 dB decay time of `T60`. |
| Excitation | one-sample impulse, one-pole lowpass | An ideal pluck is an impulse in acceleration. The lowpass models a pick of finite hardness; cutoff rises with strength (400 Hz to 12 kHz). |
| Pluck position | `x[n] - x[n - pos * N]` | The wave leaving the pluck point the other way arrives `pos * N` samples later, inverted. This cancels every harmonic with a node at the pluck point. |
| Integrator | one pole at 20 Hz | Converts acceleration to force. The output is the force on the bridge: a rectangular wave whose duty cycle equals the pluck position. The leak keeps DC out of the loop. |

The excitation is fully deterministic (no noise burst), so identical inputs
give bit-identical output.

## Stability and safety

- The loss filter's gain is `1 - 2a + 2a cos(w)`, at most 1. The loop gain is
  below 1. Lagrange interpolation used around the centre of its taps is at
  most 1. The loop is therefore passive at every frequency and cannot grow.
- Every control is clamped inside the DSP after smoothing, so out-of-range or
  hostile values cannot produce a zero density, a zero length, or an invalid
  delay.
- `N` is clamped to 8..8192 samples.
- The output is hard-clamped to ±1 as a last resort. Normal peaks are about
  0.25 to 0.5.
- A new pluck mutes the feedback for just under one round trip, so the old
  vibration is removed instead of adding to the new one.

## Approximations

- **No stiffness.** The string is perfectly flexible, so partials are exact
  integer multiples of the fundamental. Real strings (especially wound and
  piano strings) are slightly inharmonic. Adding it means an allpass
  dispersion filter in the loop.
- **Damping is a control, not a material property.** One `damping` value sets
  both the overall decay time (12 s down to 0.25 s) and the high-frequency
  loss (`a` from 0.01 to 0.25). It is not derived from air drag or internal
  friction, and the high-frequency loss is per round trip, so short strings
  lose brightness faster in seconds than long ones.
- **Pluck position is a feed-forward comb on the excitation.** That is exact
  for an ideal pluck on a lossless string. The pick lowpass stands in for the
  finite width of a finger or plectrum. The pluck is always a release from
  rest; there is no pick noise or pick-string interaction.
- **Fractional delay.** Lagrange interpolation is slightly lossy near Nyquist
  and its delay is not perfectly flat there. This shows only on the very
  shortest loops: about 1 cent sharp at 4.7 kHz, under 0.2 cents below 1.2 kHz.
  The comb's own delay uses linear interpolation, which slightly softens the
  highest cancelled harmonics.
- **Re-pluck muting leaves a residue** of up to four samples of the old wave.
- **No body, no bridge coupling, no second polarization, no sympathetic
  strings.** The output is the raw bridge force, so it is brighter and buzzier
  than an acoustic instrument.
- **One string, monophonic.** A new note replaces the old one. Polyphony is
  Phase 4.
- **Parameter smoothing.** Length, tension and density are smoothed (about
  20 ms) so slider moves bend the pitch. A pluck within that window of a large
  change starts slightly off pitch.
- **Tension does not change with fretting or amplitude.** No pitch glide from
  hard plucks.

## Measured accuracy

From `npm test`, at 44.1 and 48 kHz, measured by autocorrelation of the
rendered audio (not from the formula):

| Expected | Measured (48 kHz) | Error |
| --- | --- | --- |
| 22.822 Hz | 22.825 Hz | +0.21 cents |
| 109.913 Hz | 109.916 Hz | +0.05 cents |
| 164.683 Hz | 164.689 Hz | +0.06 cents |
| 219.826 Hz | 219.833 Hz | +0.06 cents |
| 439.652 Hz | 439.669 Hz | +0.07 cents |
| 1178.511 Hz | 1178.452 Hz | -0.09 cents |
| 4714.045 Hz | 4716.821 Hz | +1.02 cents |

The test tolerance is 2 cents for absolute pitch and 1 cent for the
octave ratios (length x2, tension x4, density x4).
