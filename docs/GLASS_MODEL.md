# Glass vessel model (Phase 2B)

Source: `src/audio/models/glass.dsp`. Reference maths:
`src/audio/engine/physics.ts`. Tests: `tests/glass.test.ts`. Listening renders:
`npm run render:glass`.

## What is modelled

A set of 25 thin-walled cylindrical glass vessels (straight-sided tumblers),
each closed and held rigid at its base and free at its rim, struck on the
wall. Each vessel is a bank of 8 damped resonators, one per wall-vibration
mode (modal synthesis). The 25 vessels are the same shape at different sizes,
so the keyboard plays two octaves, and every vessel keeps ringing after others
are struck.

It is a model of an idealised straight cylinder. Stemmed wine glasses, bowls,
bottles and anything with curved or tapered walls are outside it, and nothing
here is claimed to sound like a particular real glass.

## Sources

- A. P. French, "In vino veritas: a study of wineglass acoustics", *American
  Journal of Physics* 51(8), 688–694 (1983),
  [doi:10.1119/1.13147](https://doi.org/10.1119/1.13147). Not read directly;
  used through the next source.
- D. Terwagne and J. W. M. Bush, "Tibetan singing bowls",
  [arXiv:1106.6348](https://arxiv.org/abs/1106.6348). Section 2.1 restates
  French's model: equation (3) for the fundamental and equation (5) for
  general modes. This is the text the formula below was taken from.
- The circumferential part is the classical result for the in-plane bending
  modes of a thin ring (Hoppe 1871; Rayleigh, *The Theory of Sound*).

## Established equations

The wall bends without stretching (Rayleigh's inextensional assumption).
Mode (n, m) has radial motion proportional to `cos(n theta)` around the
circumference (n >= 2: n = 2 is the oval "wineglass" mode) and m nodal circles
along the height. For radius R, height H, wall thickness a, Young's modulus E
and density rho, Terwagne & Bush eq. (5), attributed to French:

```
f(n, m) = 1 / (12 pi) * sqrt(3 E / rho) * a / R^2
          * sqrt( ((n^2 - 1)^2 + (m R / H)^4) / (1 + 1 / n^2) )
```

and for the fundamental, their eq. (3) (French's result):

```
f0 = 1 / (2 pi) * sqrt(3 E / (5 rho)) * a / R^2 * sqrt(1 + 4/3 (R / H)^4)
```

The `(n^2 - 1)^2` term is bending around the circumference: on its own it is
exactly the thin-ring formula
`f_n = a / (2 pi R^2) * sqrt(E / (12 rho)) * n (n^2 - 1) / sqrt(n^2 + 1)`. The
`(R / H)^4` term is the extra stiffness from bending along the height.

Consequences, each verified by a test on rendered audio:

- Every mode is proportional to wall thickness.
- Every mode goes as `sqrt(E / rho)`.
- At fixed proportions, frequency goes as `1 / R^2`.
- The overtone ratios depend on the proportions `R / H`, so a squat vessel
  and a tall one have different timbres, not just different pitches.

## Approximations made here

- **The axial term.** Equations (3) and (5) as printed disagree for the
  fundamental: (5) with m = 0 has no height term, while (3) has
  `4/3 (R / H)^4`, which corresponds to `m^4 = 12`. This model replaces `m` in
  (5) by `b_m`, the eigenvalue of a clamped-free beam with m nodes
  (`b_0` = 1.8751, `b_1` = 4.6941), which is what a Rayleigh energy
  calculation gives if the wall's shape along the height is taken to be a
  clamped-free beam mode. `b_0^4` = 12.36, so the fundamental agrees with
  French's formula to better than 0.1 % (tested). For m = 1 the two readings
  differ substantially, and the choice of `b_1` is this model's, not the
  literature's.
- **Wall shape along the height** is the clamped-free beam mode
  `Z(zeta) = cosh(b zeta) - cos(b zeta) - sigma (sinh(b zeta) - sin(b zeta))`.
  A real shell's axial shape is not exactly this.
- **Mode set.** Eight modes: (2,0) (3,0) (4,0) (5,0) (6,0) and (2,1) (3,1)
  (4,1). Higher ones are absent.
- **No Poisson's ratio, no twisting energy, no stretching.** The formula uses
  beam-like bending stiffness. Real frequencies differ by some percent,
  more for higher m and for squat vessels.
- **Thin wall.** Valid when the wall is thin compared with the radius. At
  4 mm wall and 40 mm diameter it is not, and the model is outside its valid
  range there.
- **Perfect symmetry.** Real glasses are slightly uneven, which splits each
  mode into a close pair and produces slow beating. This model has no
  splitting; the only beating is between genuinely different modes that
  happen to be close, such as (4,0) and (4,1).
- **Rigid base, no stem, no contents.** Liquid in the vessel is not modelled.

### Strike position

Around the circumference a symmetric vessel has an antinode of every mode
wherever it is struck, so the angle does not matter and is not a control.
Along the height it does: a force at height `zeta` (fraction of H above the
base) drives mode (n, m) in proportion to `Z_m(zeta)`, and the wall's velocity
at that point contains the mode in proportion to `Z_m(zeta)` again. The output
is that driving-point velocity, so each mode's weight is `Z_m(zeta)^2`.

- The m = 0 shape grows steadily from the base to the rim.
- The m = 1 shape has a nodal circle at 0.7834 of the height: striking there
  silences the whole (n, 1) family.
- All modes with the same m share one axial weight, so strike height changes
  the balance between the two families.

### Damping

```
1 / T60 = 1 / 8 s + eta * f / 2.2
```

`eta` is the material loss factor (the "material damping" control): a fixed
fraction of a mode's energy is lost per cycle, so `T60 = 2.2 / (eta f)` and
higher modes die faster. The fixed 8 s term stands for losses to whatever
holds the vessel and to the air. Measured decay rates of four modes match this
formula to within 0.1 dB/s. The form is a standard simplification; real glass
loss varies with frequency, and radiation damping is not modelled separately.

### Excitation

The same striker model as the metal bar: a half-sine force pulse whose
duration is the contact time, `1.2 ms * (0.15 / 1.2)^hardness *
velocity^(-1/5)`, with area proportional to strike velocity. It is a real
input signal to the resonators.

## Artistic and engineering choices (not physics)

- **Level normalisation.** Each vessel's mode weights are divided by their
  root-sum-square over the modes it can sound. Relative mode levels are
  untouched; overall level no longer swings with strike height.
- **Output gain 0.16 and the soft limiter** (linear below 0.8, tanh knee).
- **The set of 25 vessels** and the rule that each key is the same shape
  scaled by `2^(-key/24)` with the wall unchanged.
- **Default values** (70 mm x 90 mm, 1.2 mm wall, E = 70 GPa, 2500 kg/m^3,
  loss factor 0.0005) are typical of soda-lime glass, not measurements.
- **No radiated-sound stage.** One was considered and left out: a simple
  multipole radiation weighting would favour the high-n modes, which is not
  obviously closer to what a struck glass sounds like, and it would add an
  unverified layer. The output is the wall's velocity at the strike point.
- **No reverb or other effect.**

## Faust implementation

| Part | Implementation |
| --- | --- |
| Vessels | `par(i, 25, vessel(i))`, summed. Vessel i has every mode raised by `2^(i/12)`. |
| Modes | 8 per vessel: `fi.tf2(1, 0, -1, -2 r cos w, r^2)`, `w = 2 pi f / SR`, `r = e^(-ln(1000) / (T60 SR))`. Each has its own frequency, decay and gain. |
| Coefficients | Recomputed every block. `cos` and `e^-x` are polynomials (sine Taylor series to x^13, error below 2e-10; e^-x to x^3, error below 1e-9) so the 200 resonators need no library calls per block. |
| Modes above the audio band | Gain 0 above 0.45 x sample rate. |
| Striker | One counter since the last strike, one half-sine, routed to the vessel selected at the strike. |
| Inputs | Every control is clamped inside the DSP. |

The striker, resonator and limiter come from `modal.lib`, shared with the bar
and wood models. (They were separate copies until Phase 2D; moving to the
library left this model's output bit-identical.)

Stability: every pole radius is below 1, the resonators are independent and
there is no feedback, so the model cannot grow. A test strikes all 25 vessels
at full strength and checks the level only falls afterwards.

## Measured resonant frequencies

From `npm test` at 48 kHz, default vessel, found by FFT peak-picking on the
rendered audio:

| Mode | Model | Measured | Error | Ratio to (2,0) |
| --- | --- | --- | --- | --- |
| (2,0) | 648.99 Hz | 648.99 Hz | 0.0003 % | 1.000 |
| (2,1) | 955.10 Hz | 955.10 Hz | -0.0001 % | 1.472 |
| (3,0) | 1811.43 Hz | 1811.44 Hz | 0.0004 % | 2.791 |
| (3,1) | 1957.98 Hz | 1957.99 Hz | 0.0005 % | 3.017 |
| (4,0) | 3467.79 Hz | 3467.79 Hz | -0.0002 % | 5.343 |
| (4,1) | 3550.11 Hz | 3550.11 Hz | 0.0001 % | 5.470 |
| (5,0) | 5606.02 Hz | 5606.02 Hz | 0.0000 % | 8.638 |
| (6,0) | 8222.85 Hz | 8222.85 Hz | 0.0000 % | 12.670 |

For comparison the metal bar's ratios are 1, 2.757, 5.404, 8.933. The largest
error across the four vessels tested is 0.0015 %; the test tolerance is
0.05 %. These numbers show the DSP reproduces the formula. They say nothing
about how close the formula is to a real glass.

## Performance

- Offline in Node, one thread: 22 to 30 times faster than real time across
  runs with all 25 vessels ringing (roughly 3 to 5 % of one core), about the
  same as the bar.
- In the browser (Chrome's `AudioContext.playbackStats`): no underruns while
  playing, during rapid playing (25 notes per second), while dragging a
  slider, or when switching instruments. One 10 ms underrun was recorded as
  the audio context started.
