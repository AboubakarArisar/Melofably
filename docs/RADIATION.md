# Physical radiation and a shared sound-pressure output (Phase 3D.3)

**Status: research and isolated prototypes.** Nothing here is used by the
application or the builder. No instrument's sound was changed: the four
approved Faust instruments, their reference recordings, the engine, the
AudioWorklet processor and every builder instrument are as they were. No
listening was done: the model that wrote this cannot hear. **Every sound
pressure below is a model's, in free air, and is not calibrated against any
measurement.**

| Piece | Where |
| --- | --- |
| The bar-radiation model | `src/experimental/radiation/barRadiation.ts` |
| Three ways to get pressure from one vibration, and the tools to compare them | `analysis/radiation.ts` |
| Tests (11) | `tests/radiation.test.ts` |
| Comparison renders, measurements, Node cost | `analysis/render-radiation.ts` (`npm run render:radiation`) |
| AudioWorklet timing | `experimental.html`, `sonicmatterExperimental.radiationBench()` |

## 1. How every instrument makes its output today

"Physical" below means: the quantity has a unit and follows from the model.
"Loudness choice" means: a number chosen so that the result sits well in a
loudspeaker.

### The four approved Faust instruments (`src/audio/models/*.dsp`)

| | Metal bars (`bar.dsp`) | Wooden bars (`wood.dsp`) | Glass vessels (`glass.dsp`) | String (`string.dsp`) |
| --- | --- | --- | --- | --- |
| What vibrates | free-free bending modes of a bar | the same | wall modes of a thin cylinder, cos(n theta) round it and a clamped-free shape up it | a travelling-wave loop (delay line) |
| Modal coordinate | one two-pole resonator per mode; no mass: an impulse gives the same peak at every frequency | the same | the same | none: a waveguide |
| Mode shapes | unit mean square along the bar (2 at a free end) | the same | unit mean square up the wall | not used |
| Output quantity | **the bar's velocity at the point where it was struck**: each mode weighted by its shape there squared (once for the force, once for the listening point) | the same, **plus a tube**: one more resonator at the fundamental, added | the wall's velocity at the strike height, the same way | **the force of the string on its bridge**, then a fixed "body" filter (five resonances, a high-pass and a low-pass) mixed in |
| Unit | none: the weights are divided by their root-sum-square per bar | none | none | none |
| Scaling | x 0.2, then a soft limiter | per-bar level by pitch (up to 24 dB), tube gain 2.5 x the Resonator control, x 0.12, soft limiter | x 0.16, soft limiter | x 0.58, soft limiter |
| Radiation modelled | **no** | **no** for the bar; the tube is a resonance added by a gain, not air coupled to the bar | **no** | **no**: the body is a filter after the string with no path back |
| Missing for a pressure | physical amplitudes (masses, forces in newtons), then everything in sections 2 to 5 | the same, and a tube that is driven by the bar's motion and radiates from its mouth | the same, and a radiation model for a shell (section 5) | a body that the string drives (which is what the box instrument is) |

These four are frozen by their reference recordings. They carry no physical
amplitude at all, so a sound pressure cannot be derived from them without
rebuilding them on the engine. They are not candidates for this work and
are not touched by it.

### The experimental engine's instruments (the builder)

Here everything mechanical is physical: each mode has a frequency, a decay
time, a **mass in kilograms** and a **shape at each port**; forces are in
newtons; a port's velocity is the sum over modes of shape x modal velocity,
in m/s. The engine's one output is a fixed weighted sum of modal velocities.

| | Builder bars (metal, wood) | String on its damped box | String tied to a metal bar |
| --- | --- | --- | --- |
| Vibration | bar modes, mass = the bar's mass, shapes of unit mean square | string modes, plate modes, a plug of air; one coupled system | string modes and bar modes; one coupled system |
| Output quantity | **velocity of each bar at its strike point, m/s**, summed over bars | **sound pressure at 1 m on the axis, Pa** | **velocity of the bar at its strike point, m/s** |
| Physical scaling | x 0.25 in the engine (headroom) | rho / (2 pi r) d/dt of [plate area x mean velocity + hole flow], then a shelf for a box; carried as Pa / 2 | x 0.25 |
| Playback gain (not physics) | x 4 x Volume, then a limiter | x 8 x Volume, then a limiter | x 4 x Volume, then a limiter |
| Radiation modelled | **no** | **yes**: a monopole (the plate's net flow and the hole's), with radiation loss fed back as a damper | **no** |
| Missing for a pressure | how a bar's motion becomes pressure at a listener: this phase | nothing for this listener; its listener is fixed on the axis | the same as for bars |

So the two outputs that exist are **velocity at a point** (bars) and
**pressure from a net flow** (the box). The first is not a sound; the second
is, for one kind of source. A point velocity over-weights nothing and
under-weights nothing by design; it simply is not what reaches an ear,
which hears pressure, and pressure favours high frequencies and depends on
how the moving parts of the source cancel.

## 2. The model, and what it assumes

**Setting.** One bar in open, still air at 20 degrees C (density 1.2 kg/m^3,
sound speed 343 m/s). No floor, no walls, no frame or cords, no tube under
the bar. A listener at a stated distance from the middle of the bar and a
stated angle from the line straight out from its struck face, in the plane
that holds that line and the bar's length.

**Each piece of the bar is a small body pushing on the air.** A bar bending
moves across its own flat face. Take a short piece of it. Where the bar is
narrow beside the wavelength, the air pushed away from one face slips round
the edge to the other face, and the piece radiates as a **dipole**: as a
force on the air of

    rho (w t + pi w^2 / 4) a      per metre of bar

where a is the piece's acceleration, w t the air it displaces and
pi w^2 / 4 the air a thin strip of width w drags along (its added mass).
This is the standard result for a small rigid body oscillating in a fluid;
for a sphere it reproduces the textbook pressure exactly. For the bars here
the bracket is 16.6 cm^2 (metal, 40 x 10 mm) and 29.1 cm^2 (wood, 50 x
19 mm).

**The bar is a line of such pieces**, each moving as the bar's modes move it
there. Their pressures are added at the listener, each with its own distance
(the travelling part falls as 1/R, the near field as 1/R^2), its own
direction (a dipole's cosine) and its own travel time. **The cancellation
between neighbouring parts of the bar moving opposite ways is therefore in
the sum; it is not assumed and not tuned.**

**Above a crossover the piece is no longer a dipole.** Where the bar is wide
beside the wavelength, the air cannot slip round; each face radiates into
its own side, like a piston in a wall. The two regimes give the same
pressure at 2 w c / (w t + pi w^2/4), which is **2636 Hz for the metal bar
and 1874 Hz for the wooden one**; they are joined by a first-order rolloff
of the dipole's rise with frequency. Below it the model is the dipole
exactly; far above it, the piston exactly (both limits are tested); in
between it is an interpolation.

**What it does not include.**

1. *Radiation reaction.* The air's push back on the bar is not applied; the
   engine's mechanics are untouched (tested: the same velocities and
   energies to the last bit). What that neglects is estimated in section 3.
2. *Shadowing and diffraction by the bar itself* beyond the crossover rule;
   the bar's thickness as a radiating edge; its end faces.
3. *The added-mass figure* is for a thin strip. For these rectangles it is
   low by an estimated 10 to 25 %, which is 1 to 2 dB in level.
4. *Everything round the bar*: a frame, a floor, a room, and above all a
   resonator tube.
5. *Bending only*: no torsional or lateral modes, as in the engine.

## 3. A metal bar

The builder's metal bar (aluminium, 0.30 m x 40 x 10 mm; modes at 582, 1603,
3143, 5195 Hz), struck by its 20 g mallet at 1.5 m/s. One run of the engine;
velocity and pressure from the same vibration.

**A free bar is a poor radiator straight in front, and a better one to the
side.** Every free mode moves no net air and has no net momentum (the mean
of each shape is zero: tested). Straight out from the middle of the bar its
moving parts are equally far away and cancel in the far field; what is left
falls as 1/r^2. To the side the parts are at different distances, the
cancellation is incomplete, and the sound falls as 1/r.

| Listener | Peak pressure, re 1 m at 45 degrees |
| --- | --- |
| 45 degrees, at 0.5 / 1 / 2 / 4 m | +5.6 / 0 / -5.8 / -11.8 dB |
| Straight in front, at 0.5 / 1 / 2 / 4 m | -7.9 / -20.3 / -32.2 / -44.2 dB |
| 1 m, at 0 / 15 / 30 / 45 / 60 / 75 / 90 degrees | -20.3 / -7.0 / +1.2 / 0 / -1.6 / -7.1 dB / silent |

Along the bar (90 degrees) the model gives nothing, because a dipole
radiates nothing in its own plane; a real bar's ends and thickness would
give a little. The antisymmetric modes (2, 4, ...) are silent straight in
front. **These prototypes therefore listen from 1 m at 45 degrees**, which
is neither a null nor a maximum.

**Pressure is a different balance of the same modes.**

| Mode | Velocity output (today), re mode 1 | Pressure at the listener, re mode 1 |
| --- | --- | --- |
| 1, 582 Hz | 0 dB | 0 dB |
| 2, 1603 Hz | -10.4 dB | **+10.5 dB** |
| 3, 3143 Hz | -81.7 dB | -24.7 dB |
| 4, 5195 Hz | -72.0 dB | -44.4 dB |

The second mode goes from 10 dB under the first to 10 dB over it. Two
causes, both physical: pressure rises with frequency for the same velocity,
and the velocity output is taken at the strike point (0.35 of the length),
which happens to be near a still point of mode 3, while pressure is gathered
from the whole bar. The peak was 0.31 m/s at the strike point and
**0.81 Pa** at the listener (a model's figure; about 89 dB SPL).

**What radiation would take from the bar.** The sound power by this model,
set against the bar's energy, gives the decay time radiation alone would
cause:

| Mode | Decay time from material and supports (the engine's) | Decay time radiation alone would give |
| --- | --- | --- |
| 1, 582 Hz | 2.32 s | 13 000 s |
| 2, 1603 Hz | 1.12 s | 53 s |
| 3, 3143 Hz | 0.63 s | 3 s |

For the first two modes leaving radiation out of the mechanics changes
their decay by less than 2 %. For the third it would shorten it by about a
fifth, at a frequency where the model is at its roughest. The engine's
decay law already contains a fixed term "for the supports and the air".

## 4. A wooden bar

The same model, with no change: only the bar's size and its own modes
differ. The builder's rosewood bar (0.38 m x 50 x 19 mm; modes at 589, 1623,
3181 Hz), same mallet.

- It is wider and thicker, so it acts on more air per metre (29.1 against
  16.6 cm^2) and its crossover is lower (1874 Hz against 2636 Hz).
- Its overtones die within a tenth of a second (the approved wooden-bar
  damping law), so the sound after the stroke is its fundamental alone, in
  velocity and in pressure alike. Its decay is unchanged by listening to it
  as pressure (tested).
- Peak 0.27 m/s at the strike point, **1.75 Pa** at the listener (a model's
  figure; about 96 dB SPL). The peak is the stroke itself: a broad burst
  that pressure, rising with frequency, emphasises.

**No filter was added to make it sound like wood.** What makes it different
from the metal bar is what makes a wooden bar different: its damping, its
stiffness and density, and its size.

**Resonator tubes.** The builder's wooden bar has none. The approved Faust
wooden instrument has one, as an added resonance with a gain. A physical
tube is a pipe of air driven by the bar's motion above its mouth and
radiating from that mouth as a monopole, which is a far better radiator than
the bar. In this framework it would be a resonator joined to the bar through
the air between them, with its own radiation of the box's kind (a net flow).
It is not built. Without it, a bare wooden bar is what this model gives.

## 5. Glass: would the same framework do?

Not built; this is an assessment.

- **Same framework.** A vessel's modes, their masses and their shapes are in
  the same form as a bar's. Its output would again be the pressure of its
  moving surface at a listener, added to other radiators' at the same
  listener.
- **Different source.** A bar's piece moves bodily, so it is a dipole. A
  vessel's wall in mode cos(n theta) moves in and out in 2n alternating
  patches round a circle. For n = 2 (the fundamental "wine-glass" mode) that
  is a **quadrupole**: no net flow and no net force, so it radiates more
  weakly still than a dipole at low frequency, with a four-lobed pattern
  round the vessel. Higher n are higher multipoles. The rim, the height of
  the wall and the air inside the vessel all matter.
- **So a separate radiation model is necessary**: the same kind of sum over
  the surface, but of patches on a cylinder with their own directions, not a
  line of dipoles. The line-of-dipoles formula would be wrong for glass, not
  merely rough.
- **Not needed to validate the architecture.** The architecture question is
  whether one vibration can feed a pressure output without disturbing the
  mechanics, and whether several radiators add; bars and the hybrid answer
  it. And the approved glass instrument is a Faust model with no physical
  amplitudes; there is no engine vessel yet to radiate.

## 6. Three ways to compute it, and what the engine allows

| | Reference | One weight per mode | Points along the bar |
| --- | --- | --- | --- |
| How | each mode's recorded velocity through its own transfer at every frequency | one number per mode (its transfer at its own frequency) as an extra port's shape; the engine's ordinary output, differentiated | the bar's velocity at 16 points; each point a dipole with its own delay, near and far terms |
| Exact within the model | yes | only for a mode ringing at its own frequency | yes, to the spacing of the points |
| Runs in the AudioWorklet today | no (it needs the whole signal) | **yes, with no change to anything**: a port and the processor's existing differentiator | **no: the engine has one output, and this needs one per point** |

Each ringing mode of the struck metal bar, against the reference:

| | Modes 1 to 4 | Peak of the attack |
| --- | --- | --- |
| One weight per mode | within 0.1 dB | **-1.1 dB** (wood: -1.8 dB) |
| 16 points | within 0.2 dB | -0.3 dB |

One weight per mode is right for the ringing and short on the attack: while
the mallet is on the bar the modes are being driven at every frequency, not
ringing at their own.

## 7. The hybrid: a bar driven by a string

This is the case that decides the architecture. The string forces the bar
at the string's partials, which are not the bar's notes (except the third,
330 Hz, beside the bar's 327 Hz).

| String partial | Pressure (reference), re 330 Hz | One weight per mode, error | 16 points, error |
| --- | --- | --- | --- |
| 110 Hz | -66.7 dB | **+24.2 dB** | -0.8 dB |
| 220 Hz | -38.2 dB | **+10.2 dB** | +0.2 dB |
| 330 Hz | 0 dB | -0.3 dB | 0.0 dB |
| 440 Hz | -23.0 dB | **-8.0 dB** | -0.1 dB |
| 659 Hz | -22.5 dB | **-35.5 dB** | -0.1 dB |

- **One weight per mode is wrong by tens of decibels** for a driven bar,
  because a mode's radiation depends on the frequency it is moving at, and
  one number cannot. It would make the hybrid's low partials 10 to 24 dB too
  loud and its high ones up to 36 dB too quiet.
- **The points are right**, because they describe where the bar is moving,
  not which mode is moving it.
- **What the model says about the hybrid:** heard as pressure, a plucked
  string through this bar is almost all the bar's own note. The string's
  fundamental is 67 dB under it (it was 32 dB under in the velocity output).
  Peak **0.0098 Pa** plucked at 4 N (about 51 dB SPL), 1.21 Pa struck.
- **The coupling is untouched.** The string and the bar exchange energy
  exactly as before: the energy record with listening ports is the same, to
  the last bit, as without (tested). The pressure is computed from the
  motion; nothing is sent back.
- **Several radiators add.** Two joined bars, each with its own port for the
  same listener: the pressure of both together equals the sum of each alone
  (tested, to 1e-5). One listener position, one clock, pascals.

Nothing here is added to anything of another kind. The box's pressure and a
bar's pressure could be added at one listener; a bar's velocity could not be
added to either.

## 8. Cost

Node, bars like the builder's (8 modes each), each struck in turn:

| | Velocity output | With radiation ports and the differentiator |
| --- | --- | --- |
| 1 bar | 0.17 % of a core | 0.20 % |
| 4 bars | 0.62 % | 0.58 % |
| 16 bars | 2.5 % | 2.3 % |
| 64 bars (512 modes) | 9.4 % | 9.2 % |

- **A radiation port costs nothing measurable.** The engine's output is
  already one weighted sum over modes; a port changes the weights, not the
  work. About 3.7 ns per mode per sample either way, linear in the number
  of modes.
- **The 16-point arithmetic** for one bar took 0.67 % of a core in plain
  JavaScript with its allocations (per point and sample: one difference, one
  first-order filter, one delayed read, three multiplications). Its memory
  is 16 delay lines of about 45 samples. The engine would also have to
  produce 16 sums over the bar's modes instead of one: 16 x 8 multiply-adds
  per sample for a bar.
- Nothing in either method allocates in the audio loop. The processor's
  differentiator is the one the box instrument already uses.

Chromium AudioWorklet, live, one weight per mode:

| Bars (modes) | Output | Engine CPU, of one core | Blocks of 2 ms or more | Blocks processed / expected | Faults | Device dropouts |
| --- | --- | --- | --- | --- | --- | --- |
| 1 (8) | velocity | 0.56 % | 0 of 2295 | 2295 / 2294 | 0 | 0 |
| 1 (8) | radiated pressure | 0.16 % | 0 of 2291 | 2291 / 2291 | 0 | 0 |
| 16 (128) | velocity | 2.2 % | 3 of 2261 | 2261 / 2261 | 0 | 0 |
| 16 (128) | radiated pressure | 5.4 % | 2 of 2284 | 2284 / 2284 | 0 | 0 |
| 64 (512) | velocity | 17.2 % | 11 of 2261 | 2261 / 2261 | 0 | 0 |
| 64 (512) | radiated pressure | 17.3 % | 14 of 2261 | 2261 / 2261 | 0 | 0 |

Chromium 156 at 48 kHz, six seconds each, a bar struck ten times a second.
**The machine was on battery with another program using about 60 % of the
processor, and the browser pane was in the background**, so these figures
are noisy: the pairs do not order consistently (pressure is cheaper for one
bar and dearer for sixteen), and the worklet's clock resolves 1 ms. What
they support is this: with radiation ports the engine ran in a real
AudioWorklet at every size tried with no dropout and no fault, and at 512
modes the two outputs cost the same. They do not support a finer comparison;
Node's table above does. Engine memory was 3 145 728 bytes throughout. The
16-point method was **not** run in the browser: it needs the engine change of
section 10. The worklet does not report its longest block.

## 9. Listening files

`npm run render:radiation` writes 16 files to `renders/radiation/`, with
`listening.json`, `measurements.json` and `performance.json`. For each
instrument the four files are **one run of the engine**: the vibration is
identical, only what is listened to differs. Velocity and pressure are
different quantities and cannot share a gain; the three pressures of an
instrument share one.

| Files | Instrument | a: velocity today | b / c / d: pressure by reference / 16 points / one weight |
| --- | --- | --- | --- |
| `1a` to `1d` | The builder's metal bar, struck | 0.305 m/s, gain +4.3 dB | 0.806 / 0.783 / 0.712 Pa, gain -4.1 dB |
| `2a` to `2d` | A wooden bar, struck | 0.265 m/s, +5.5 dB | 1.75 / 1.72 / 1.41 Pa, -10.9 dB |
| `3a` to `3d` | String tied to a metal bar, string plucked (4 N) | 0.0472 m/s, +20.5 dB | 0.00978 / 0.00963 / 0.00869 Pa, +34.2 dB |
| `4a` to `4d` | The same, bar struck | 0.308 m/s, +4.2 dB | 1.21 / 1.15 / 1.20 Pa, -7.7 dB |

Each gain brings the loudest file of its group to half of full scale. The
pressures are peak values before any gain, at 1 m and 45 degrees in free
air, and are a model's.

## 10. Is it fit to integrate

| | |
| --- | --- |
| Physically defensible | **Yes, as a first model with stated limits**: a standard source (a line of dipoles), exact in both frequency limits, with the cancellation along the bar computed. Not calibrated; rough near and above the crossover; no surroundings. |
| Numerically stable | **Yes.** It is a sum of filtered copies of the motion; it cannot feed back. Finite and repeatable to the last bit. |
| Computationally practical | **Yes.** One weight per mode is free. Points cost under 1 % of a core per bar. |
| Suitable for several radiators | **Yes**: pressures at one listener add (tested). |
| Compatible with the engine | **One weight per mode: yes, today. Points: not yet**: the engine has one output. |

**Recommendation: do not integrate one weight per mode on its own.** It is
right for a struck bar's ringing and wrong for anything driven: the hybrid,
bars joined by springs, an attack. Used in the builder it would make
hybrids sound as they should not, and the error would look like physics.

**Recommended next step, narrowly:**

1. Give the engine **several outputs** (a small change: the same weighted
   sum, more than once), with a test that the first output is bit-identical
   to today's.
2. In the processor, an optional **point radiator**: for each radiating bar,
   its point velocities through the per-point filter and delay into one
   pressure at one listener. Off unless asked for, as 'radiate' is.
3. Offer it first as **one experimental example** (a bar heard as pressure),
   beside the existing one, changing no existing instrument. Only after
   listening should any existing output be considered for replacement.
4. Then the box and a bar could share a listener, and a hybrid of the three
   would have one honest output.

Not recommended yet: replacing any approved output; a glass radiation model
(there is no engine vessel); radiation reaction in the mechanics.

## 11. Limitations

1. **Not calibrated.** No pressure here has been compared with a
   measurement. Absolute levels may be off by several decibels (the
   added-mass figure alone is 1 to 2 dB).
2. **Free air only.** No frame, floor, room or tube. A real bar on a real
   instrument sounds mostly through its tube where it has one.
3. **Rough near and above the crossover** (about 2 to 3 kHz for these bars),
   and silent exactly along the bar's length.
4. **No radiation reaction**: under 2 % of the decay of the first two modes
   of the metal bar, about a fifth for the third by this model.
5. **One weight per mode is wrong for driven bars** (section 7). It is kept
   in the prototypes because it is what the engine can do today, and to
   show the size of the error.
6. **The frequency-domain reference** takes its transfers every 6 to 12 Hz
   and interpolates; the point method's delays are linearly interpolated.
7. **Bars only.** The plate keeps its own radiation (a net flow on its
   axis); glass has none.
8. **Performance was measured on one machine**; the browser pane was in the
   background.
9. **Not heard.**

## 12. What came of it (Phase 3D.4)

The engine now has read-only observation points, and the 16-point method of section 6 runs in the AudioWorklet processor on them, as an optional output stage used by one experimental builder example. See [RADIATOR.md](RADIATOR.md). One thing was found about this prototype there: `pressureByPoints` leaves out the very first sample of motion, which matters only in the first two milliseconds after a mallet's stroke (-47 dB). It has been left as it was, as the reference the real-time version was checked against.
