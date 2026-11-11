# String model

Source: `src/audio/models/string.dsp`. Tests: `tests/string.test.ts`.
Before/after comparison: `npm run compare` (see the end of this file).

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

The string drives a small model of an instrument body, which shapes the tone
but has no path back into the string.

## Signal flow

```
pluck -> impulse * strength -> pick lowpass x2 -> pluck-position comb -> leaky integrator
                                                                               |
        +----------------------------------------------------------------------+
        v
       (+)-------------------------------+--> body mix -> gain -> soft limiter -> out
        ^                                |
        |                                v
   loop gain <- loss FIR x2 <- fractional delay (N - 3)
```

This is a single-delay-loop digital waveguide (the Karplus-Strong structure as
extended by Jaffe and Smith). The two travelling waves and both reflections
are consolidated into one delay line holding one round trip, `N = SR / f`
samples.

| Part | Implementation | Why |
| --- | --- | --- |
| Delay line | `N - 3` samples, 4th-order Lagrange interpolation (`de.fdelay4`) | `N` is rarely an integer; interpolation keeps the pitch exact. The other 3 samples are the loss filter (2) and the feedback path (1). |
| Loss filter | two 3-tap symmetric FIRs `[a, 1-2a, a]` | High partials decay faster. Linear phase: exactly 2 samples of delay at every frequency, so it never detunes the string. `a` scales with the loop length (see below). |
| Loop gain | `10^(-3 N / (SR * T60))` | Frequency-independent decay with a 60 dB decay time of `T60`. |
| Excitation | one-sample impulse, two one-pole lowpasses | An ideal pluck is an impulse in acceleration. The lowpasses model a finger or plectrum of finite width. |
| Pluck position | `x[n] - x[n - pos * N]` | The wave leaving the pluck point the other way arrives `pos * N` samples later, inverted. This cancels every harmonic with a node at the pluck point. |
| Integrator | one pole at 20 Hz | Converts acceleration to force. The string's output is the force on the bridge: a rectangular wave whose duty cycle equals the pluck position. The leak keeps DC out of the loop. |
| Body | 5 parallel two-pole resonators plus a band-limited direct path | Turns bridge force into something closer to radiated sound. |
| Soft limiter | linear below 0.8, tanh knee above | Never reaches 1; does nothing at normal levels. |

The excitation is fully deterministic (no noise burst), so identical inputs
give bit-identical output.

## Controls

Physical: length, tension, density (set the pitch), damping, pluck position,
excitation strength.

Sound character, added in Phase 1.1:

| Control | What it changes in the DSP | Range |
| --- | --- | --- |
| Tone brightness | The high-frequency loss coefficient of the string. Expressed as the 60 dB decay time of a 5 kHz partial. | 0.25 s (dull) to 2.5 s (bright), default 0.63 s |
| Attack softness | Cutoff of the pick lowpass, i.e. how wide and soft the plucking object is. | 8 kHz (hard plectrum) to 600 Hz (soft fingertip), default about 3.2 kHz |
| Body resonance | Crossfade between the raw bridge force (0) and the body model (1). | default 0.6 |

Damping still sets the overall decay time (12 s to 0.25 s) and also scales the
high-frequency loss (a damped string is duller). Excitation strength scales
the level and slightly lowers the pick cutoff for weak plucks.

## Frequency-dependent loss

Each FIR section loses about `a * w^2` per round trip (`w` in rad/sample). A
string makes `f` round trips per second, so with a fixed `a` (Phase 1) the same
3 kHz partial died about four times faster on a 440 Hz note than on a 110 Hz
note: low notes kept their buzz, high notes went dull.

A real string loses energy at a rate set mainly by the frequency of the
partial, roughly `sigma * (2 pi f)^2` per second. Matching that requires

```
a_total = sigma * SR * N
```

so longer loops are filtered more per trip. Measured decay of a ~3 kHz partial
is now 30.6 dB/s on a 110 Hz note and 31.6 dB/s on a 440 Hz note.

## Body

Five resonances (98, 204, 290, 425, 560 Hz; Q 8 to 10; peak gains 1.0 to 2.5
relative to the direct path), in parallel with a direct path band-limited to
70 Hz – 6 kHz. This is modal synthesis in its simplest form: each mode is a
two-pole resonator (`fi.resonbp`).

The frequencies are representative of a guitar-sized body (air resonance near
100 Hz, main top-plate resonance near 200 Hz). They are not measurements of a
particular instrument. Gains and Q are deliberately moderate: strong, narrow
modes make notes that land on them boom while their neighbours do not.

The body is a fixed linear filter after the loop. A test confirms the measured
pitch is the same with the body off and fully on.

## Stability and safety

- Each loss FIR's gain is `1 - 2a + 2a cos(w)` with `a <= 0.25`, so at most 1.
  The loop gain is below 1. Lagrange interpolation used around the centre of
  its taps is at most 1. The loop is passive at every frequency.
- The body resonators have fixed coefficients and finite Q; they are stable
  and outside the loop.
- Every control is clamped inside the DSP after smoothing, so out-of-range or
  hostile values cannot produce a zero density, a zero length, or an invalid
  delay.
- `N` is clamped to 8..8192 samples.
- A new pluck keeps the old vibration out of the loop for just under one round
  trip, and fades it at the output over at most 32 samples.
- The soft limiter bounds the output below 1. A single note at full strength
  peaks at 0.56 at most; the knee is at 0.8.

## Approximations

- **No stiffness.** The string is perfectly flexible, so partials are exact
  integer multiples of the fundamental. Real strings are slightly inharmonic.
- **Loss model.** `sigma * (2 pi f)^2` plus a constant is the standard
  simplified form, not derived from air drag or internal friction of a named
  material. The two FIR sections can only supply so much loss per trip: below
  about 100 Hz the dullest brightness settings saturate, so the lowest strings
  cannot be made as dull as higher ones.
- **Pluck position is a feed-forward comb on the excitation.** Exact for an
  ideal pluck on a lossless string. The pick lowpass stands in for the finite
  width of a finger or plectrum; it is a filter, not a contact model, and its
  cutoff is fixed in Hz rather than tied to the wave speed.
- **Body.** Five modes and a lowpass, mono, with no directional radiation, no
  coupling back to the string, and no sympathetic resonance. It colours the
  tone; it does not reproduce a specific instrument.
- **Fractional delay.** Lagrange interpolation is slightly lossy near Nyquist.
  The comb's own delay uses linear interpolation, which slightly softens the
  highest cancelled harmonics.
- **Re-pluck** leaves a residue of up to five samples of the old wave in the
  loop.
- **One string, monophonic.** A new note replaces the old one.
- **Parameter smoothing.** Length, tension, density and body amount are
  smoothed (about 20 ms). A pluck within that window of a large change starts
  slightly off pitch.
- **Tension does not change with fretting or amplitude.**

## Measured pitch accuracy

From `npm test`, measured by autocorrelation of the rendered audio (not from
the formula), at 48 kHz with default character settings:

| Expected | Measured | Error |
| --- | --- | --- |
| 22.822 Hz | 22.824 Hz | +0.21 cents |
| 109.913 Hz | 109.915 Hz | +0.03 cents |
| 164.683 Hz | 164.688 Hz | +0.05 cents |
| 219.826 Hz | 219.828 Hz | +0.02 cents |
| 439.652 Hz | 439.660 Hz | +0.03 cents |
| 1178.511 Hz | 1178.469 Hz | -0.06 cents |
| 4714.045 Hz | 4714.642 Hz | +0.22 cents |

Test tolerances are unchanged from Phase 1: 2 cents for absolute pitch, 1 cent
for the octave ratios (length x2, tension x4, density x4).

## Comparing versions

`npm run compare` compiles the frozen Phase 1 model
(`analysis/string-phase1.dsp`) and the current model, renders the same eight
notes, a retrigger sequence and a short phrase from each with the same
physical settings, and writes:

- `renders/before-phase1/*.wav` and `renders/after-phase1.1/*.wav` (24-bit,
  48 kHz, mono)
- `renders/metrics.json` and tables on stdout

The renders are deterministic and git-ignored. The metrics describe the
signal; whether it sounds better is a listening judgement.
