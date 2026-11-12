# Experimental physics engine (Phase 3A proof of concept)

Status: **an experiment**. `src/experimental/` is not used by the application.
The four approved instruments and their reference audio are unchanged.

- Engine: `src/experimental/physics/` (TypeScript, about 500 lines)
- Faust comparison: `src/experimental/faust/coupled.dsp`
- Tests: `tests/experimental.test.ts` (22 tests)
- Listening files and measurements: `npm run render:experimental`, into
  `renders/experimental/`

The question this answers: can a data-driven engine, in which objects are
tables of modes and connections are solved inside each sample, reproduce an
approved instrument, do genuine two-way coupling and nonlinear contact, and
be edited while sounding?

## 1. Architecture

```
Resonator (interface)          Connection (interface)
  ModalResonator                 SpringDamper     linear, two-way
  (later: a waveguide)           HertzContact     nonlinear, one-sided
          \                        /
           System: solves all connection forces together, each sample
```

A **resonator** is anything that stores vibrational energy and exposes
*ports*: points where force is applied and motion is read. A **connection**
joins two ports and defines the force between them from their relative
displacement and velocity. The **system** advances everything one sample at a
time.

### Resonator interface

A step is split so that forces between objects can be solved together with
their motion:

1. `predict(external, free)`: mid-step port velocities if no connection force
   acted (prescribed external forces included).
2. The system solves the connection forces, using `mobility(i, j)`: how much
   mid-step velocity at port i one newton at port j produces in this step.
3. `commit(forces)`: finish the step with those forces applied.

The interface is not modal. A digital waveguide could implement it: its
mobility is its wave admittance at the port, and `predict` is what arrives at
the port from the delay lines this sample. That is not built. Nor does the
design assume every object reduces to a small mode table: a string needs tens
to hundreds of modes, and objects with dense or nonlinear behaviour (plates
with thousands of modes, membranes under large amplitude, air columns with
turbulence) need other resonator types behind the same interface.

### Modal data

Each mode is physical data, not a filter coefficient:

| Field | Unit |
| --- | --- |
| Frequency | Hz (0 = a rigid-body mode, i.e. a free mass) |
| Decay time (60 dB) | s |
| Effective modal mass | kg |
| Mode shape at each port | dimensionless |

For the free-free bar, with mode shapes normalised to unit mean square, every
mode's effective mass is the mass of the bar, `rho L w h`. This required a
width, which the approved bar model never needed.

## 2. Numerical method

### Choice: the implicit midpoint rule, with corrected modes

Each mode obeys `m dv/dt + c v + k q = phi . F`, `dq/dt = v`. With `T` the
sample period and "mid" meaning the average of a quantity over the step:

```
v_mid = (v[n] + v[n+1]) / 2
q[n+1] = q[n] + T v_mid
m (v[n+1] - v[n]) / T = phi . F_mid - c v_mid - k (q[n] + T v_mid / 2)
```

which solves to

```
v_mid = a (v[n] - g q[n]) + b (phi . F_mid)
D = 1 + T c / (2m) + T^2 k / (4m),   a = 1/D,   g = T k / (2m),   b = T / (2 m D)
```

Why this rule:

- **It has an exact energy balance.** Multiply the update by `v_mid` and sum
  over modes: stored energy changes by exactly the work done by forces minus
  what the dampers dissipate, for any step size. With connections whose force
  is consistent with the same midpoint values, the whole system inherits
  that. Stability then does not depend on stiffness or sample rate.
- **It allows the forces to be solved within the step**, because `v_mid`
  depends on `F_mid` through a single known number per port (`b`, summed
  into the mobility).
- Alternatives considered: explicit (symplectic) Euler, which is what Faust
  expresses naturally, is conditionally stable (section 6); an exact
  exponential integrator has no frequency error but no simple energy balance
  once nonlinear connections are attached.

The midpoint rule's known flaw is frequency warping: it is the bilinear
transform, which places a mode of true frequency `f` at
`(SR / pi) atan(pi f / SR)` and weakens its response towards Nyquist. Both are
corrected per mode, without leaving the class of positive mass-spring-damper
systems (so passivity is kept):

- **Poles.** The mode's `k/m` and `c/m` are replaced by those of the s-plane
  point whose bilinear image is the intended z-plane pole
  `e^(-sigma T) e^(j 2 pi f T)`. The discrete mode then has exactly the
  intended frequency and decay.
- **Mass.** The mass is scaled by `(4/T^2) / (4/T^2 + (2/T) c/m + k/m)`, which
  restores the intended amplitude of the mode's response to an impulse.

Measured effect on the bar's eighth mode (18 535 Hz) at 48 kHz:

| Correction | Mode 1 error | Mode 4 error | Mode 8 frequency | Mode 8 level | Whole-signal difference from the approved bar |
| --- | --- | --- | --- | --- | --- |
| none | -0.05 % | -3.6 % | 13 467 Hz (-27 %) | +6.2 dB | -0.7 dB |
| poles | 0 | 0 | 18 535 Hz | -18.2 dB | -30.5 dB |
| poles and mass | 0 | 0 | 18 535 Hz | 0.0 dB | -50.9 dB |

The energy that is conserved is that of the corrected mass, stiffness and
damping, not of the physical ones. For low modes they coincide; near Nyquist
they differ by the factors above.

### Connections

For connection k between port a and port b, with `eta = x_a - x_b` and
`w = u_a - u_b` (mid-step), the connection exerts `-F` on a and `+F` on b.
Equal and opposite is structural: one number is applied with two signs.

- **Spring and damper:** `F = k (eta + T w / 2) + c w`. Stored energy
  `k eta^2 / 2`.
- **Hertz contact:** stored energy `V = K max(eta, 0)^(alpha+1) / (alpha+1)`;
  the force for a step is the **discrete gradient**
  `F = (V(eta + T w) - V(eta)) / (T w)`, so the work done over the step equals
  the change in stored energy exactly (Chatziioannou and van Walstijn, 2015).
  This is what stops a stiff, one-sided contact gaining energy numerically.

### Solving a step

Mid-step relative velocities satisfy

```
w = w_free - G F(w)
```

where `w_free` comes from the resonators' predictions and `G` (connections x
connections) is assembled from port mobilities. This is solved by Newton's
method with step halving. Linear connections converge in one iteration;
contacts took at most 3 in every test and render.

There is **no delay between objects**: the force used in a step is consistent
with the motion it causes in that step.

### Units

SI throughout: force N, displacement m, velocity m/s, mass kg, stiffness N/m,
damping N s/m, energy J. The output is a port velocity in m/s; a gain converts
it to an audio level.

### Stability assumptions and limits

- Unconditionally stable for positive masses, stiffnesses and dampings, and
  for connection energies that are bounded below. Verified with a spring of
  1e12 N/m and a contact of 1e12 N/m^1.5 at 24 kHz.
- **Stable is not accurate.** The corrections make each *mode* exact. A
  *connection* is integrated with the plain midpoint rule, so resonances
  created by a connection are warped. Measured: a coupled mode intended at
  2200 Hz came out 0.07 % low; one intended at 8800 Hz, 1.1 % low.
- A contact much shorter than a sample is stable but its timing is quantised
  (section 5).
- The Newton solve is assumed to converge; it has a cap of 60 iterations and
  falls back to the best point found. That fallback was never reached in the
  tests, but it is not proven unreachable.
- Changing a stiffness while a spring is stretched is not passive
  (section 6).

## 3. Experiment A: metal bar parity

One bar in the engine, driven by the approved model's own half-sine force
pulse and read at the strike point, against the approved Faust bar.

**Result: the engine's resonator is the approved filter.** Algebraically, the
midpoint rule with both corrections gives each mode the transfer function
`(phi^2 / m)(T / 2) (1 - z^-2) / (1 - 2 r cos(theta) z^-1 + r^2 z^-2)`: the
same poles and zeros as the approved bar's resonator, times a constant.
Numerically:

| Comparison | Difference |
| --- | --- |
| Engine vs the same filter written out in 64-bit | -147 dB |
| Engine vs approved Faust bar, first 20 ms | -80 dB |
| Engine vs approved Faust bar, first 200 ms | -61 dB |
| Engine vs approved Faust bar, 2 s | -52 dB |
| 32-bit version of the filter vs 64-bit version, 2 s | -65 dB |

The gap to the approved model starts at -80 dB and grows with time: slow
phase drift from the approved model's 32-bit coefficients, which round each
mode's frequency by a few parts per million. It is the approved model that is
the less exact of the two.

Mode by mode (hard strike on the end, all eight modes):

| Mode | Beam theory | Faust | Engine | Level difference | Decay, Faust / engine |
| --- | --- | --- | --- | --- | --- |
| 1 | 581.55 Hz | 581.55 | 581.55 | 0.000 dB | 13.2 / 13.2 dB/s |
| 2 | 1603.05 | 1603.05 | 1603.05 | -0.001 | 18.7 / 18.7 |
| 3 | 3142.63 | 3142.62 | 3142.62 | -0.001 | 27.1 / 27.1 |
| 4 | 5194.92 | 5194.92 | 5194.92 | 0.001 | 38.3 / 38.3 |
| 5 | 7760.31 | 7760.31 | 7760.31 | 0.001 | 52.3 / 52.3 |
| 6 | 10838.78 | 10838.79 | 10838.79 | -0.001 | 69.1 / 69.1 |
| 7 | 14430.33 | 14430.33 | 14430.33 | -0.001 | 88.7 / 88.7 |
| 8 | 18534.96 | 18534.96 | 18534.96 | 0.000 | 111.1 / 111.1 |

Attack (first 5 ms sample for sample, largest sample-to-sample jump), peak,
RMS and time to -20 dB also match within 0.1 %.

### What differs, and why

- **Resonator algorithm: nothing audible.** Only the precision above.
- **Output normalisation: a constant.** The engine's output is physical: for
  the default stroke the bar's velocity peaks at 9.5e-5 m/s. The approved
  model divides its mode weights by their root-sum-square and multiplies by
  0.2 (a loudness choice); the engine divides by the bar's mass. The ratio is
  one number per stroke (1838 for the default). It depends on strike
  position, because the approved model's normalisation does: the approved bar
  is equally loud wherever it is struck, the physical one is not.
- **Excitation: identical in this experiment by construction.** Both were
  driven by the same pulse, to isolate the resonator. A physical mallet
  (Experiment C) is a different excitation and will not sound the same.

Energy: what the pulse supplied equals what the bar dissipated plus what it
still held, to 1 part in 1e9.

## 4. Experiment B: coupling by a spring

**Two equal oscillators** (440 Hz, 0.1 kg each), spring chosen to put the
out-of-phase mode at 480 Hz:

| Check | Theory | Measured |
| --- | --- | --- |
| In-phase mode | 440 Hz | 439.989 Hz |
| Out-of-phase mode | 480 Hz | 479.997 Hz |
| All energy in the second oscillator after | 12.5 ms | 12.4 ms |
| Energy back in the first after | 25 ms | 24.9 ms |
| Drift of total energy over 0.5 s (undamped) | 0 | 6e-12 |
| Change in total momentum of two free masses over 1 s | 0 | 2.8e-14 |

**Mixing is not coupling.** With no spring, the struck oscillator rings at
440 Hz alone, the other never moves (peak exactly 0, energy exactly 0), and
the sum has one spectral peak. With the spring each oscillator carries both
frequencies and more than 99 % of the energy passes to the second one.

**Two eight-mode bars** (the aluminium bar and one 0.32 m long), undamped,
joined by a 4e5 N/m spring between a point on each. The reference is
independent: the eigenvalues of the joined system in continuous time,
`M^-1/2 (diag(m w^2) + k g g^T) M^-1/2`.

| Uncoupled | Theory, coupled | Measured | Error |
| --- | --- | --- | --- |
| 511.12 Hz | 516.59 | 516.60 | 0.002 % |
| 581.55 | 612.85 | 612.80 | -0.008 % |
| 1408.93 | 1427.18 | 1427.11 | -0.005 % |
| 1603.05 | 1605.29 | 1605.27 | -0.001 % |
| 2762.07 | 2765.46 | 2765.40 | -0.002 % |
| ... | | | |
| 18534.96 | 18536.34 | 18535.60 | -0.004 % |

Fifteen of the sixteen coupled modes were observed, all within 0.008 %. The
sixteenth has a node at the connection point: the spring does not move it and
the strike cannot reach it, so there is nothing to observe. The largest shift
was 31 Hz. Bar B was never struck and sounds.

Long render with damping (30 s): finite, and total energy never rose from one
sample to the next.

## 5. Experiment C: nonlinear mallet contact

A free mass meeting a resonator through `F = K eta^1.5`. The mallet is part
of the system, so its kinetic energy is in the system's energy and nothing is
supplied from outside.

Against an immovable wall (0.02 kg, 1 m/s, K = 1e7), where Hertz theory gives
the contact time exactly:

| Sample rate | Theory | Measured | Error | Rebound speed |
| --- | --- | --- | --- | --- |
| 48 kHz | 1.0666 ms | 1.0833 ms | 1.6 % | 1.000000000 m/s |
| 192 kHz | 1.0666 ms | 1.0677 ms | 0.1 % | 1.000000000 m/s |

Contact time against strike velocity (0.25 to 4 m/s): fitted exponent
-0.1997; theory -0.2.

Striking the aluminium bar (K = 1e8, 1 m/s):

| | |
| --- | --- |
| Contact | 0.438 ms, then the mallet separates |
| Peak force | 159.3 N |
| Mallet rebound | -0.8425 m/s |
| Energy before | 0.010000 J |
| Mallet after | 0.007098 J |
| Dissipated in the bar | 0.002902 J |
| Unaccounted | 5.7e-16 J |
| Largest single-step rise in total energy | 0 |
| Newton iterations, worst step | 3 |

Sensitivity to the time step (same strike):

| Sample rate | Contact | Peak force | Impulse | Rebound |
| --- | --- | --- | --- | --- |
| 24 kHz | 0.458 ms | 154.6 N | 0.03690 N s | -0.8448 m/s |
| 48 kHz | 0.438 ms | 159.3 N | 0.03685 | -0.8425 |
| 96 kHz | 0.438 ms | 160.4 N | 0.03684 | -0.8418 |
| 192 kHz | 0.427 ms | 160.6 N | 0.03683 | -0.8417 |

The delivered impulse at 48 kHz is within 0.05 % of the 192 kHz value and the
peak force within 1 %. (At 24 kHz the bar has only five modes below Nyquist,
which is a second difference besides the step.)

A contact of 1e12 N/m^1.5 at 24 kHz, far shorter than one sample: finite, and
energy never rose. It is stable, not accurate.

Limits of the integration: contact start and end are resolved to one sample;
a contact lasting only a few samples (the hard mallet's 0.167 ms is 8 samples)
has its duration quantised by several percent; the contact law has no loss of
its own (no felt hysteresis); and the mallet is a point mass.

## 6. Experiment D: editing a connection while it sounds

Two coupled oscillators; the spring is made four times stiffer at the moment
it is most stretched, the worst case.

| How the stiffness is changed | Energy added | Largest output jump, after / before |
| --- | --- | --- |
| Instantly | +12.8 % | 1.13 |
| Ramped over 10 ms | +5.9 % | 1.09 |
| At the next zero crossing of the stretch | +0.04 % | 1.06 |

- **An instant stiffness change is not passive.** It changes the stored
  energy by exactly `(k_new - k_old) eta^2 / 2`; the engine's account of that
  matched the measured jump in total energy to 1e-9. Stiffening while
  stretched creates energy; softening removes it (-3.2 % for a fourfold
  reduction).
- **A ramp does not fix that.** It spreads the change and avoids any abrupt
  step, but the energy is still added.
- **Waiting for the spring to pass through rest does**, because the stored
  energy is zero there. The cost is a delay of up to half a cycle of the
  spring's motion, and it never fires if the spring is not moving.
- **Changing damping is passive**: a damper stores nothing. Verified: energy
  never rose.
- None of the three produced a click: the output's largest jump grew by at
  most 13 %, consistent with the higher frequency content after stiffening.
- No state transformation was needed for these cases. It would be for
  changes that alter stored energy with no rest point to wait for (for
  example changing a mode's frequency while it rings): not investigated.

No recompilation is involved: an edit writes one or two numbers. Nothing is
allocated: 3 million samples with a strike and an edit every 100 ms triggered
zero garbage collections, as did 3 million samples of repeated contact.

That last result took work, and matters for running in an AudioWorklet. In
JavaScript, passing or returning a non-integer number across a function call
the engine has not inlined allocates a small object. The first version of the
engine did this several times per sample and caused a garbage collection every
few tens of thousands of samples. Every per-sample quantity now travels in a
typed array.

## 7. Faust comparison

The same two-oscillator system written in Faust
(`src/experimental/faust/coupled.dsp`, compiled in double precision). Faust
cannot solve a force and the motion it causes within one sample: every
feedback loop carries a sample of delay, so the natural formulation is
explicit (symplectic Euler).

| | Faust (explicit) | Experimental engine |
| --- | --- | --- |
| 440 / 480 Hz pair | 440.05 / 480.08 (+0.012 / +0.017 %) | 439.99 / 480.00 (-0.003 / -0.001 %) |
| 2000 / 2200 Hz pair | 2005.75 / 2207.68 (+0.29 / +0.35 %) | 1999.99 / 2198.44 (0.00 / -0.07 %) |
| 8000 / 8800 Hz pair | 8419.71 / 9377.80 (+5.2 / +6.6 %) | 7999.99 / 8702.67 (0.00 / -1.1 %) |
| Spring stiff enough for a 16 kHz mode | output becomes NaN | stable, peak 0.07 |
| Stability limit | every frequency below SR / pi = 15.3 kHz | none |
| Compile time for this program | 0.9 s | none |
| Change a stiffness or damping | live parameter | live parameter |
| Change the topology | edit source, recompile, replace the node | rebuild tables |

The Faust errors are those of this explicit scheme, not of Faust as such: an
implicit scheme could be written out by hand for a given topology, with the
algebra solved in advance. What Faust cannot do is solve it generally, or
iterate a nonlinear contact to convergence.

CPU cost was not compared for this two-oscillator case; see below for the
bar.

## 8. Performance

One thread, 128-sample blocks, times faster than real time (the share of one
core is 100 divided by this). The engine is TypeScript run by V8, the same
JavaScript engine as Chrome's.

| Configuration | Speed | Worst block |
| --- | --- | --- |
| One 8-mode bar | 158x | 0.48 ms |
| Two 8-mode bars joined by a spring | 22x | 0.55 ms |
| Mallet striking an 8-mode bar (Hertz contact) | 33x | 0.45 ms |
| One resonator, 16 modes | 107x | 0.41 ms |
| One resonator, 32 modes | 87x | 0.44 ms |
| One resonator, 64 modes | 44x | 0.53 ms |
| One resonator, 128 modes | 30x | 0.72 ms |
| One resonator, 256 modes | 14x | 0.96 ms |
| 8 independent 8-mode bars (64 modes) | 24x | 0.51 ms |
| 25 independent 8-mode bars (200 modes) | 8x | 1.07 ms |
| Approved Faust bar, 25 bars x 8 modes, WebAssembly | 19x | |

A block must finish within 2.67 ms.

- **The TypeScript engine is about 2.4 times slower than Faust's
  WebAssembly** for the same 200 resonators (8x against 19x).
- **Coupling is expensive in this implementation.** Two connected bars run at
  22x; one unconnected bar runs at 158x. A connected resonator is stepped in
  two passes, its port displacements are computed every sample, and the
  solve runs.
- Cost grows roughly linearly with mode count, with a fixed overhead per
  resonator and per sample.
- An earlier version was 2 to 3 times slower still; fusing the two passes for
  unconnected resonators recovered that.

### Is it suitable for an AudioWorklet?

**As a proof of concept, for small instruments, yes; as the production
engine, not in this form.**

- A handful of coupled objects with tens of modes fits comfortably (4 to 5 %
  of a core for two coupled bars).
- 25 always-sounding bars would take 12 % of a core with a worst block of
  1.07 ms out of 2.67 ms. That is too little headroom, although an engine
  with voice allocation would not run 25 idle bars.
- It triggers no garbage collection, which is the property that most often
  rules JavaScript out of the audio thread.
- **It has not been run inside an AudioWorklet.** All timings are from Node.
  Worst-block figures include the timing calls themselves and whatever else
  the machine was doing.
- A production engine should be compiled to WebAssembly. The 2.4x gap to
  Faust is an estimate of what that would recover, not a measurement.

## 9. Recommendation: continue, with two revisions

**Continue.** The three things that had to be true are true and measured:

1. The engine reproduces an approved instrument: same filter, difference
   below the approved model's own rounding.
2. Coupling is genuine and correct: mode splitting within 0.008 % of
   eigenvalue theory, energy exchange at the predicted rate, momentum and
   energy conserved to rounding, and visibly not what mixing produces.
3. Nonlinear contact is stable and accurate: Hertz contact time within 0.1 %,
   the velocity law to three decimal places, energy accounted for to 1e-16.

And live editing needs no recompilation and allocates nothing.

**Revise two things from the earlier proposal:**

- **Performance needs WebAssembly, and the coupled path needs redesign.** I
  estimated the engine's per-resonator cost would be similar to Faust's. In
  TypeScript it is 2.4 times worse, and coupling costs more again. Before
  building on this, port the core loops to WebAssembly and measure; do not
  assume.
- **Connections are only midpoint-accurate.** I did not anticipate that a
  resonance created by a stiff connection would be 1 % flat at 8.8 kHz while
  the modes themselves are exact. For musical couplings (bridges, soft
  springs, mallets) the affected frequencies are low and the error is
  hundredths of a percent. For stiff, high-frequency couplings it is audible
  as mistuning. The options are oversampling the coupled part, or computing
  coupled modes in advance for fixed linear connections (the modal
  substructuring of BUILDER_ARCHITECTURE.md, which this experiment's
  eigenvalue reference already implements in the tests).

**Not shown by this experiment**, and therefore still open:

- Running in a real AudioWorklet, with real-time measurements.
- A waveguide resonator behind the same interface (the string).
- More than one or two connections at once, where the solve grows.
- Modal mass for the glass vessel.
- Whether a physical mallet sounds as good as the approved, normalised
  excitation. That is a listening question: files C1 to C4.
- Any audible judgement at all. Every result above is a measurement.

## 10. Files to listen to

In `renders/experimental/` (24-bit, 48 kHz, mono):

| File | What it is |
| --- | --- |
| `A1-approved-faust-bar.wav` | The approved bar, default stroke |
| `A2-experimental-engine-bar.wav` | The engine, same stroke, level matched |
| `A3-faust-then-engine.wav` | One after the other |
| `A4-difference-times-100.wav` | Their difference, made 100 times louder |
| `A5-engine-without-frequency-correction.wav` | The uncorrected midpoint rule, for contrast |
| `B1-bar-A-alone.wav` | One bar |
| `B2-two-bars-mixed-not-coupled.wav` | Two bars struck separately and added |
| `B3-two-bars-coupled-by-spring.wav` | The same two joined by a spring, one struck |
| `B4-two-bars-coupled-by-stiffer-spring.wav` | A spring ten times stiffer |
| `B5-coupled-oscillators-the-struck-one.wav` | Energy leaving and returning, four times a second |
| `B6-coupled-oscillators-the-other-one.wav` | The same energy arriving and leaving |
| `C1` to `C4` | Soft and hard mallets, slow and fast, at their true relative loudness |
| `D1-stiffness-changed-instantly.wav` | Spring made 10x stiffer at 0.3 s and restored at 0.9 s |
| `D2-stiffness-ramped-over-10ms.wav` | The same, ramped |
| `D3-stiffness-changed-at-zero-crossing.wav` | The same, at the spring's rest point |
