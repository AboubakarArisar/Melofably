# Wooden bar model (Phase 2C)

Source: `src/audio/models/wood.dsp` (with `modal.lib`). Reference maths:
`src/audio/engine/physics.ts`. Tests: `tests/wood.test.ts`. Listening renders:
`npm run render:wood`.

## What is modelled

A set of 25 uniform rectangular wooden bars (an idealised xylophone), each
free at both ends, struck by a mallet, with a tuned tube resonator under each
bar. Each bar is a bank of 6 damped resonators, one per bending mode. The bars
differ only in length, so the keyboard plays two octaves, and bars keep
ringing after others are struck.

## Same beam, different material

The bar's bending modes come from the same Euler-Bernoulli free-free beam
equation as the metal bar:

```
cos(k) cosh(k) = 1          f_n = k_n^2 * h / (2 pi L^2) * sqrt(E / (12 rho))
```

so the mode ratios are the same: 1, 2.757, 5.404, 8.933, 13.34, 18.64. A
uniform bar has these ratios whatever it is made of, and they were not altered
to make the two instruments differ. A test confirms the measured ratios are the
free-free ones.

Mode shapes and the strike-position rule (each mode weighted by its shape
squared at the strike point) are also the same as the metal bar's.

What makes this wood, each a physical difference:

| | Metal bar | Wooden bar |
| --- | --- | --- |
| Material (defaults) | aluminium: 2700 kg/m^3, 70 GPa | rosewood-like: 950 kg/m^3, 18 GPa along the grain |
| Damping law | constant loss factor: decay rate proportional to f | viscoelastic: decay rate proportional to f^2, plus a constant |
| Mallet contact | elastic (half-sine), 0.15 to 1.2 ms | lossy (critically damped), 0.2 to 2 ms |
| Radiation | none | tube resonator on the fundamental |
| Modes kept | 8 | 6 |

## Damping

Chaigne and Doutaut's xylophone model damps the bar with two terms, one
independent of frequency and one viscoelastic. That structure is used here,
written as a 60 dB decay time:

```
1 / T60 = 1 / 0.7 s + eta_1k * f^2 / 2200
```

- The constant term is losses to the air and the cord supports.
- `eta_1k` is the wood's loss factor at 1 kHz (the "internal damping"
  control). In a viscoelastic (Kelvin-Voigt) material the loss factor is
  proportional to frequency, `eta(f) = eta_1k * f / 1000`, and
  `T60 = 2.2 / (eta(f) f)`.

So low bars are limited by the constant term and ring about half a second,
while upper modes last only a few cycles. At the defaults the 589 Hz bar's
modes decay in 421, 116 and 34 ms. Measured decay rates match the formula to
within 0.1 dB/s.

Established: the two-term structure. Not established: the numbers. The 0.7 s
constant and the default `eta_1k` = 0.006 are estimates chosen to give
xylophone-like decay times; they are not taken from the paper, whose full text
was not available.

## Mallet

Xylophone mallets (yarn, rubber, soft wood) are lossy: the head compresses and
recovers without bouncing. The contact is modelled as a critically damped mass
on a spring, whose force is

```
F(t) ~ t * e^(-t / tc)        contact time about 4 tc
```

a quick rise to a peak at `tc`, then a slower release. Its spectrum is
`1 / (1 + (2 pi f tc)^2)`: flat to `1 / (2 pi tc)`, then falling 12 dB per
octave, with no nulls. Contact time runs from 2 ms (soft) to 0.2 ms (hard) and
shortens slightly with velocity (`velocity^(-1/5)`, as in Hertz contact). The
pulse's area, the impulse delivered, is proportional to strike velocity.

In the DSP this pulse is an impulse through two identical one-pole lowpasses.
It is the input signal to the resonators; no mode amplitudes are set directly.

The metal bar and glass use an elastic half-sine pulse instead. A half-sine has
spectral nulls, which on this model left some bars nearly silent with soft
mallets; the lossy pulse is both more appropriate for these mallets and free of
that artefact.

## Resonator tubes

Under each bar of a real xylophone hangs a tube closed at the bottom and tuned
to the bar's fundamental. The air column resonates with that mode, radiating
it more efficiently and adding a short bloom after the attack. Here it is one
more two-pole resonator at the bar's fundamental, fed by the bar and added to
it:

- quality factor 10 (decay `2.2 Q / f` seconds: 37 ms at 589 Hz),
- peak gain `2.5 x` the "resonator tubes" control (default 0.35).

Measured: with the control at 1 the fundamental gains 11.3 dB and the second
mode changes by 0.08 dB. The pitch does not move.

This is an approximation of the radiated sound, kept separate from the bar's
vibration: only the tube's first resonance is included, the tube does not load
the bar (in reality it shortens the fundamental's decay), and Q and gain are
estimates.

## Loudness choices (not physics)

- **Strike-position normalisation.** Each bar's mode weights are divided by
  their root-sum-square, so timbre changes with strike position but overall
  level does not.
- **Keyboard level compensation.** The same mallet delivers less force at a
  short bar's higher frequencies, so uncompensated the top of the keyboard
  would be far quieter than the bottom. Each bar is boosted by exactly what
  its fundamental loses to the mallet spectrum relative to the lowest bar, up
  to 24 dB. This stands in for the harder mallets and firmer strokes a player
  uses on upper bars. It scales a whole bar and does not change its timbre.
  Measured attack level across the keyboard varies by 3.1 dB and peak level by
  under 2 dB, at soft, medium and hard settings.
- **Output gain 0.12 and the soft limiter** (linear below 0.8, tanh knee).

## Faust implementation

| Part | Implementation |
| --- | --- |
| Bars | `par(i, 25, bar(i))`, summed. Bar length `L * 2^(-i/24)`. |
| Modes | 6 per bar, each `resonator(f, T60, gain)` from `modal.lib`: a two-pole/two-zero filter with its own frequency, decay and gain. |
| Tubes | 1 more resonator per bar. 175 resonators in all. |
| Coefficients | Recomputed once per block from the sliders, using polynomial `cos` and `e^-x`, so no library calls per resonator. |
| Mallet | One impulse through two one-pole lowpasses, routed to the bar selected at the strike. One `exp` per block. |
| Modes above the audio band | Gain 0 above 0.45 x sample rate. |
| Inputs | Every control is clamped inside the DSP. |

Nothing is allocated on the audio thread: all 25 bars exist from the start and
run continuously.

`modal.lib` holds the resonator, clamp and soft limiter, shared with the bar,
glass and string models.

## Limits of treating wood as a one-dimensional isotropic beam

- **Wood is orthotropic.** Its stiffness along the grain is 10 to 20 times
  that across it, and its shear stiffness is lower still. This model uses a
  single modulus, the one along the grain, which is the right one for bending
  of a bar cut with the grain along its length, and ignores the rest.
- **No shear deformation (Timoshenko effects).** Because wood's shear modulus
  is so low, shear matters far more than in metal. Real upper modes of a
  wooden bar lie noticeably below the Euler-Bernoulli values, and more so for
  thick, short bars. The ratios here are therefore too wide for real wood.
- **No torsional or lateral modes**, which real bars have and which hard
  mallets off-centre excite.
- **Uniform bar.** Real xylophone and marimba bars are undercut in the middle
  to tune the second mode to a harmonic ratio (3:1 or 4:1). This bar is not,
  so its overtones are the untuned 2.757 and 5.404.
- **Damping is a single material law.** Real wood's loss depends on species,
  grain direction, moisture and temperature, and shear losses are larger than
  longitudinal ones.
- **Grain, knots and density variation** are absent: every bar is perfectly
  uniform.
- **Six modes.** Higher ones would decay in under a millisecond at the
  defaults.
- **Output is the bar's velocity at the strike point** plus the tube
  resonance, not a radiated sound field.

## Measured modal frequencies

From `npm test` at 48 kHz, default bar (0.38 m x 19 mm), with least damping so
the modes can be measured:

| Mode | Beam equation | Measured | Decay time | Method |
| --- | --- | --- | --- | --- |
| 1 | 588.74 Hz | 588.74 Hz | 630 ms | FFT peak |
| 2 | 1622.87 Hz | 1622.87 Hz | 381 ms | FFT peak |
| 3 | 3181.48 Hz | 3181.48 Hz | 166 ms | FFT peak |
| 4 | 5259.14 Hz | 5259.14 Hz | 71 ms | FFT peak |
| 5 | 7856.25 Hz | 7856.25 Hz | 34 ms | scan |
| 6 | 10972.78 Hz | 10972.78 Hz | 18 ms | scan |

Modes that live at least 40 ms leave a sharp spectral peak and are held to
0.05 %. The shortest-lived are located by scanning a single-bin transform over
the first 30 ms and held to 0.5 %. The largest error over four bars and two
sample rates is 0.0025 %.

## Wood against metal

Same note (588.7 Hz), each model at its own default material, damping and
mallet, both struck at 0.35 of the length, velocity 0.8, hardness 0.7:

| | Wood | Metal |
| --- | --- | --- |
| Time to -20 dB | 0.16 s | 0.56 s |
| Time to -40 dB | 0.30 s | 1.30 s |
| Fundamental decay | 142 dB/s | 26 dB/s |
| Second mode decay | 517 dB/s | 54 dB/s |
| Spectral centroid, first 40 ms | 840 Hz | 1465 Hz |
| Spectral centroid at 200 ms | 588 Hz | 1094 Hz |
| Energy above 2 kHz, first 40 ms | -62 dB | -32 dB |
| Energy above 2 kHz at 100 ms | -130 dB | -51 dB |

These describe the signals. Whether the result sounds like wood is a listening
judgement.

## Performance

- Offline in Node, one thread: about 23 times faster than real time with all
  25 bars ringing, roughly 4 % of one core.
- In the browser (Chrome's `AudioContext.playbackStats`): no underruns while
  playing, at 25 and 50 notes per second, while dragging a slider, or when
  switching between instruments already loaded. Underruns were recorded when
  the audio context started (4 events, 60 ms) and during the first visit to
  each other instrument (4 events, 40 ms across three first loads), when the
  outgoing instrument is being cut off anyway.
