# Metal bar model (Phase 2A)

Source: `src/audio/models/bar.dsp`. Reference maths:
`src/audio/engine/physics.ts`. Tests: `tests/bar.test.ts`. Listening renders:
`npm run render:bar`.

## What is modelled

A set of 25 uniform metal bars of rectangular cross-section, each free at both
ends, struck by a mallet. Each bar is a bank of 8 damped resonators, one per
bending mode (modal synthesis). The 25 bars differ only in length, so the
keyboard plays two octaves, and every bar keeps ringing after others are
struck, as on a glockenspiel or vibraphone.

It is a model of an idealised straight bar. It is not a model of arbitrary
metal objects: plates, bells, tubes, tuned (undercut) bars and anything with
supports that matter are outside it.

## Equations

Transverse bending of a uniform Euler-Bernoulli beam:

```
E I d4y/dx4 + rho A d2y/dt2 = 0
```

With both ends free (zero bending moment and zero shear force at x = 0 and
x = L), the allowed modes satisfy

```
cos(k) cosh(k) = 1      k_n = 4.7300, 7.8532, 10.9956, 14.1372, 17.2788, 20.4204, 23.5619, 26.7035
```

and mode n vibrates at

```
f_n = k_n^2 / (2 pi L^2) * sqrt(E I / (rho A))
```

For a rectangular section of thickness h, `I / A = h^2 / 12`, so

```
f_n = k_n^2 * h / (2 pi L^2) * sqrt(E / (12 rho))
```

Consequences, each verified by a test on rendered audio:

- Frequency goes as `1 / L^2`: doubling the length lowers every mode two
  octaves.
- Frequency is proportional to thickness.
- Frequency goes as `sqrt(E / rho)`. Width does not appear.
- The modes are inharmonic: `f_n / f_1 = (k_n / k_1)^2` = 1, 2.757, 5.404,
  8.933, 13.34, 18.64, 24.81, 31.87. This is what makes a bar sound metallic
  rather than string-like.

Key `i` is a bar shorter by `2^(-i/24)`, which raises every mode by `i`
semitones.

### Mode shapes and strike position

```
phi_n(xi) = cosh(k xi) + cos(k xi) - sigma_n (sinh(k xi) + sin(k xi)),   xi = x / L
sigma_n = (cosh k - cos k) / (sinh k - sin k)
```

normalised to unit mean square over the bar (`phi = 2` at a free end). The
tests check that these shapes are orthonormal and that the first mode's nodes
are at 0.2242 L from each end.

A force applied at `xi` drives mode n in proportion to `phi_n(xi)`. The output
is the velocity of the bar at the point where it was struck, which contains
mode n in proportion to `phi_n(xi)` again. So each mode's weight is
`phi_n(xi)^2`: a mallet landing on a node of a mode does not excite it.
Striking the middle (`xi` = 0.5) silences modes 2, 4, 6 and 8; striking at
0.224 silences the fundamental.

In single precision `cosh` and `sinh` of `k` up to 26.7 would cancel
catastrophically, so the DSP evaluates the equivalent form
`cos(k xi) - sigma sin(k xi) + (1 - c) e^(-k xi) + c e^(k xi)` with
`c = (1 - sigma) / 2` precomputed in double precision.

### Damping

Each mode has its own decay time:

```
1 / T60_n = 1 / 6 s + eta * f_n / 2.2
```

- `eta` is the material loss factor (the "internal damping" control). A fixed
  fraction of a mode's energy is lost per cycle, so the decay rate is
  `eta * pi * f` per second and `T60 = ln(1000) / (eta pi f) = 2.2 / (eta f)`.
  Higher modes die faster.
- The fixed 6 s term stands for losses to the supports and the air.

Measured decay rates of the first four modes match this formula to within
0.1 dB/s.

### Excitation

The mallet applies a half-sine force pulse to the selected bar. Its duration
is the contact time:

```
contact = 1.2 ms * (0.15 / 1.2)^hardness * velocity^(-1/5)
```

1.2 ms for a soft mallet, 0.15 ms for a hard one, shortening slightly with
velocity as Hertz contact theory predicts. The pulse's area (the impulse
delivered) is proportional to strike velocity. A longer contact is the same
push spread over more time, which carries less high-frequency force, so soft
mallets excite the upper modes less. The pulse is a real input signal to the
resonators; no mode amplitudes are set directly.

## Faust implementation

| Part | Implementation |
| --- | --- |
| Bars | `par(i, 25, bar(i))`, summed. Bar length `L * 2^(-i/24)`. |
| Modes | 8 per bar: `fi.tf2(1, 0, -1, -2 r cos w, r^2)`, the same two-pole/two-zero filter as Faust's `pm.modeFilter`. `w = 2 pi f / SR`, `r = e^(-ln(1000) / (T60 SR))`. |
| Coefficients | Recomputed every block from the sliders. `cos` and `e^-x` are evaluated as polynomials (sine Taylor series to x^13, error below 2e-10; e^-x to x^3, error below 3e-9) because 400 library calls per block dominated the CPU cost. |
| Modes above the audio band | A mode above 0.45 x sample rate gets gain 0 and its resonator is parked at that limit. |
| Mallet | One counter since the last strike, one half-sine. The pulse is routed to the bar selected when the strike happened (`ba.sAndH`). |
| Trigger | The host increments `strike`; any change strikes bar `key`. |
| Output | Sum of bars x 0.2, then the same soft limiter as the string (linear below 0.8, tanh knee, never reaches 1). |
| Inputs | Every control is clamped inside the DSP. |

Stability: every pole radius is below 1 for any finite decay time, the
resonators are independent, and there is no feedback between them, so the
model cannot grow. A test strikes all 25 bars at full strength and checks the
level only falls afterwards.

### Level normalisation

Each bar's mode weights are divided by their root-sum-square over the modes
that bar can sound. This is a loudness choice, not physics. The relative
levels of a bar's modes are untouched. What it removes is the large change in
overall level with strike position (the raw driving-point response is four
times larger at a free end than at a typical interior point) and the penalty
short bars would otherwise pay for modes above the audio band.

## Assumptions and limits

- **Euler-Bernoulli theory.** No shear deformation or rotary inertia
  (Timoshenko effects). Accurate for slender bars and low modes; for thick
  bars and high modes real frequencies fall below these values. At the
  default 0.3 m x 10 mm the bar is slender (L/h = 30); at 0.1 m x 30 mm it is
  not, and the model is outside its valid range there.
- **Uniform rectangular bar.** Real glockenspiel bars are close to this.
  Vibraphone and marimba bars are undercut to tune the overtones to harmonic
  ratios; this model is not.
- **Bending in one plane only.** No torsional, lateral or longitudinal modes.
- **Free-free means no supports.** Real bars rest on cord or felt near the
  nodes of the first mode; the only trace of that here is the fixed 6 s loss.
- **Eight modes per bar.** Anything above the eighth is absent.
- **The output is driving-point velocity**, not radiated sound: no radiation
  efficiency, no directivity, no resonator tube.
- **The mallet is a prescribed force pulse**, not a contact simulation: it
  does not bounce, and its shape does not depend on the bar.
- **One mallet.** A second strike within the contact time (about 1 ms) cuts
  the first pulse short.
- **Damping** is a constant loss factor plus a constant. Real loss factors
  vary with frequency and temperature.
- **Changing geometry or material retunes all bars instantly,** including
  ones still ringing. Coefficients update once per audio block, so dragging a
  slider while bars ring steps the pitch slightly.
- **Low frequencies in single precision.** Resonator coefficients are 32-bit;
  measured error is under 0.003 % down to 124 Hz and grows below that.
- **Level across the keyboard.** With the default medium mallet, the highest
  bars are about 17 dB quieter than the lowest, because the contact pulse
  carries less force at their frequencies. A harder mallet evens this out.

## Measured modal frequencies

From `npm test` at 48 kHz: default aluminium bar (0.3 m x 10 mm, E = 70 GPa,
rho = 2700 kg/m^3), found by FFT peak-picking on the rendered audio.

| Mode | Beam equation | Measured | Error |
| --- | --- | --- | --- |
| 1 | 581.55 Hz | 581.55 Hz | 0.0000 % |
| 2 | 1603.05 Hz | 1603.05 Hz | -0.0004 % |
| 3 | 3142.63 Hz | 3142.62 Hz | -0.0001 % |
| 4 | 5194.92 Hz | 5194.92 Hz | 0.0000 % |
| 5 | 7760.31 Hz | 7760.31 Hz | 0.0000 % |
| 6 | 10838.78 Hz | 10838.79 Hz | 0.0000 % |
| 7 | 14430.33 Hz | 14430.33 Hz | 0.0000 % |
| 8 | 18534.96 Hz | 18534.96 Hz | 0.0000 % |

The largest error across the four bars tested (two sample rates, a 0.5 m steel
bar, and a bar an octave up) is 0.0024 %. The test tolerance is 0.05 %, under
one cent.

## Performance

Measured by rendering offline in Node, single thread, the same WebAssembly the
browser's audio thread runs:

- Metal bar (200 resonators, always running): about 30 times faster than real
  time, i.e. roughly 3 % of one core.
- String: about 190 times faster than real time.

The bar's cost does not depend on how many bars are ringing.
