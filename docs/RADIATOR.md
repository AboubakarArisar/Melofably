# Several engine outputs and the experimental bar radiator (Phase 3D.4)

Phase 3D.3 ([RADIATION.md](RADIATION.md)) found that the sound pressure of a
bar could be computed well from its velocity at 16 points, and that the
engine could not supply them: it had one output. This phase gives the engine
read-only observation points ("taps"), puts the 16-point method in the
AudioWorklet processor as an optional output stage, and adds one
experimental builder example that is heard through it.

Nothing approved changed. The four Faust instruments, their reference WAVs,
the three bar examples, the string on its box and the string-and-bar hybrid
produce the samples they produced before, checked against the engine binary
of Phase 3D.3, which is kept as a test fixture.

I cannot hear audio. Everything below is from signal analysis of the
rendered output. The pressures are a model's, in pascals, and have not been
compared with a microphone.

## 1. Engine: observation taps

`assembly/engine.ts`. Two new exports:

| Call | Meaning |
| --- | --- |
| `addTap(r, port): i32` | Watch port `port` of resonator `r`. Returns the tap's index (0 to 31), or -1 if all 32 are in use. |
| `tapPointer(): usize` | Address of the tap buffer. |

A tap is the mid-step velocity of the port in m/s: the sum over the
resonator's modes of shape x modal velocity, the same quantity and the same
arithmetic as the existing `velocity(r, port)`. It is 64-bit; nothing is
scaled or rounded to 32 bits.

What was and was not touched:

- `step()`, the coupling solver, the integration and `addOutput` are
  unchanged, line for line.
- In `process()`, after a sample's step is finished, its fault check done
  and its output written, a new block reads the taps. It runs only if there
  is at least one tap. It writes nothing but the tap buffer.
- `reset()` sets the number of taps to zero.
- A tap applies no force and is not part of the mix. The solver does not
  know it exists.

**Memory layout.** All fixed, allocated when the module starts, as
everything else in the engine:

| Array | Type | Size | Contents |
| --- | --- | --- | --- |
| `tShape` | i32 x 32 | 128 B | first shape entry of the tap's port |
| `tStart` | i32 x 32 | 128 B | first mode of its resonator |
| `tCount` | i32 x 32 | 128 B | number of modes of its resonator |
| `taps` | f64 x 32 x 128 | 32 768 B | tap `t` at sample `i` of the last `process()` call: entry `t * 128 + i` |

The buffer is tap-major, so that the processor reads each point's 128
samples as one contiguous run. It holds the first 128 samples of a
`process()` call: with taps in use, ask for at most 128 at a time (an
AudioWorklet block is 128). The first output is not limited by this.

The engine's memory is 3 145 728 bytes, as before: the new arrays fit in the
last page already reserved. The binary grew from 26 494 to 26 836 bytes.

**Cost.** Per sample and per tap, one multiply-add per mode of the tapped
resonator. Sixteen taps on a bar of 8 modes are 128 multiply-adds a sample.
With no taps the added cost is one comparison per sample. Nothing is
allocated.

**Verified** (`tests/radiator.test.ts`):

- 16 taps equal `velocity()` for every sample of 40 blocks, exactly (81 920
  comparisons, not one differing bit).
- With 16 taps the first output, `energy()`, `dissipated()` and the solver's
  worst iteration count are bit for bit those of the same system without
  taps, over 375 blocks.
- A 33rd tap is refused; `reset` removes all; the memory size does not
  change while running.

## 2. Processor: the radiator

`src/experimental/wasm/processor.js`, a new call answered by the processor:

```
['radiator', fullScale, b0, a1, tap, far, near, late, tap, far, near, late, ...]
```

Per point and per sample, exactly the arithmetic validated offline in
Phase 3D.3 (`pressureByPoints`):

```
a   = rate (v[n] - v[n-1])                acceleration of the point, m/s^2
low = b0 (a[n] + a[n-1]) - a1 low[n-1]    one-pole lowpass at the crossover
s   = far (a - low) + near a              pressure this point sends, Pa
```

and `s` arrives `late` samples later, split between the two samples either
side of that time. The arrivals are added into one ring of pascals that is
read as the block is written out. The node's output is that sum divided by
`fullScale`. The engine's own output is still computed, unchanged, and is
simply not copied to the node.

The numbers come from `radiatorArguments()` in
`src/experimental/radiation/barRadiation.ts`, from the model of Phase 3D.3
with no change of assumption:

| Number | Formula | Unit |
| --- | --- | --- |
| strength of point j | rho B cos(theta_j) (L / 16) / (4 pi), B = w t + pi w^2 / 4 | kg/m |
| `far` | strength x w_c / (c R_j), w_c = 2 w c / B | Pa per m/s^2 |
| `near` | strength / R_j^2 | Pa per m/s^2 |
| `late` | (L / c + (R_j - r) / c) x sample rate | samples |
| `b0`, `a1` | bilinear lowpass at w_c | |

R_j and theta_j are each point's own distance and direction to the listener,
so spatial cancellation and the differences in travel time are in the sum.
The whole output is late by L / c (1.2 ms for the 0.40 m bar) so that points
nearer than the bar's middle can be heard first.

**Pressure and playback volume are separate.** The radiator's output is
pascals / fullScale and nothing else: no normalization, no EQ, no
correction. Tested: the same playing with a ceiling of 4 Pa and of 16 Pa
gives the same pascals to within 0.0001 dB, and twice the pluck force gives
twice the pressure. How loud that is played is the builder's gain, after the
node (section 4).

**Off unless asked for.** With no `'radiator'` call the processor takes the
same path as before, in one `engine.process(count)`. A `'reset'` (every
rebuild) turns it off. No approved instrument's calls contain `addTap` or
`radiator` (tested for all five earlier examples).

**Memory.** Made when the call arrives, between blocks: 9 numbers per point
(144 doubles for 16) and a ring of 256 doubles for this bar (a power of two
holding one block plus the longest travel time). `process()` allocates
nothing.

A defect found and fixed while building it: the first version's ring was
shorter than a block, so sound written ahead wrapped onto sound not yet
read. The comparison with the offline method caught it (differences of
several dB); after the fix the two agree to rounding.

## 3. Against the Phase 3D.3 references

Listener 1 m from the bar's middle, 45 degrees off the line straight out
from its face. 48 kHz. Levels are spectral peaks from 0.1 s on.

**Against the offline 16-point calculation** (the same method, computed from
recorded modal motion): the plucked hybrid is identical to rounding
(-385 dB); the struck hybrid differs by less than -110 dB from 2 ms on. In
the first 2 ms they differ at -47 dB because the offline prototype of
Phase 3D.3 leaves out the very first sample of motion; the processor does
not. That is a small defect of the prototype, not of the radiator.

**Against the frequency-domain reference** (exact within the model):

| Source | Component | Real-time re reference |
| --- | --- | --- |
| Metal bar, struck (modes ringing) | 582 Hz | -0.09 dB |
| | 1603 Hz | -0.17 dB |
| | 3143 Hz | -0.28 dB |
| | 5195 Hz | +0.09 dB |
| | 7760 Hz | +0.03 dB |
| | peak | -0.25 dB |
| Wooden bar, struck | 589 Hz | -0.09 dB |
| | peak | -0.12 dB |
| Hybrid, bar struck | 327, 902, 1768, 2922 Hz | -0.01, -0.01, -0.17, -0.31 dB |
| | peak | -0.39 dB |
| Hybrid, string plucked (bar driven off its own notes) | 110 Hz | -0.79 dB |
| | 220, 330, 440, 659, 989, 1319 Hz | +0.14, -0.02, -0.10, -0.16, -0.09, -0.13 dB |
| | peak | -0.14 dB |

These are the errors Phase 3D.3 measured for the offline 16-point method
(within 0.8 dB). The one-weight-per-mode method that ran before was wrong by
up to 36 dB on the string-driven components.

**Other physical checks:**

- *Symmetry.* A bar struck at its middle gives the same pressure at +45 and
  -45 degrees to 2 parts in a billion, and 8e-17 Pa along its own line
  (a dipole sends nothing sideways).
- *Distance.* At 45 degrees the 582 Hz component falls 6.0 dB per doubling
  from 2 to 8 m, and the radiator is within 0.1 dB of the reference from
  0.5 to 8 m. Straight in front it falls 12.0, 11.7 and 10.9 dB per doubling
  from 1 to 8 m: a free bar's mode pushes as much air one way as the other,
  so what is left there is the remainder of an almost complete cancellation.
- *Mode dependence.* Per m/s at the strike point, the second mode of the
  metal bar makes 20.8 dB more pressure than the first. A flat gain on the
  velocity would give 0 dB.
- *Energy.* With every loss removed, the energy of string, bar and mallet
  stays constant to better than 1 part in a billion over 2 s while the
  radiator runs.
- *Stability and determinism.* Plucked at 8 N and struck at 5 m/s with a
  0.5 kg mallet, each five times a second for 5 s: no fault, never at
  the node's ceiling, dies away afterwards, and a second run gives the same
  samples.

## 4. The builder example

A new component, **Listener in the air**, and one new example, "A string
tied to a metal bar, heard as sound pressure at 1 m" (`RADIATION_EXAMPLES`
in `src/builder/examples.ts`, a list of its own: the two earlier lists are
what earlier phases approved and test).

- The example is the approved hybrid, part for part, plus the listener.
  Removing the listener gives back the hybrid's graph and its exact engine
  calls. The original hybrid example is unchanged and still in the menu.
- With a listener, the bar is built with 16 more ports (its mode shapes at
  the 16 points), 16 taps, and the radiator. Nothing is attached to those
  ports. The rest of the call list is the hybrid's, call for call.
- The listener is fixed: 1 m, 45 degrees (`LISTENER`). It has no properties
  and no connection dot. It is allowed only beside a string and a metal bar,
  one at most; anything else is refused when added and when a saved
  instrument is loaded.
- Adding or removing it is a rebuild. The joint, the bar's damping and the
  string's tension stay live. Pluck, strike, touch, pull and release work as
  in the hybrid. Undo, redo, save and restore cover it.

**Units and gain in the builder.** The node carries pascals / 16
(`LISTENER_FULL_SCALE`; 16 Pa is 115 dB SPL). The level meter shows pascals.
The playback gain after the node is 8 x the volume control, the same as for
the string on its box, which for this ceiling is 0.5 of full scale per
pascal at full volume. It is a listening level and nothing else.

**What it sounds like, by the numbers.** The mallet's stroke is 1.15 Pa
peak (92 dB SPL). The pluck is 0.0096 Pa peak (51 dB SPL): 42 dB quieter. In
the approved velocity output the same two are 16 dB apart. This is the
model, not a fault: a string moves the bar slowly, mostly at 110 and 220 Hz,
far below the bar's lowest note, and a narrow bar moving slowly moves very
little air (a dipole's pressure rises 12 dB per octave). Nothing evens it
out, as instructed. Whether that balance is wanted is a decision for
listening.

## 5. In a real Chromium AudioWorklet

`radiatorBench()` on the test page (`experimental.html`). The hybrid, live,
with and without the listener; plucked and struck alternately about ten
times a second; and the same while the joint's stiffness and damping are
changed about 17 times a second. 48 kHz, Chrome 156 (the app's browser
pane, visible). Machine: Ryzen 5 7430U, on battery at 80 %, 22 % loaded by
other programs. Two runs of every case.

| Case | Run | CPU, % of one core | Blocks of 2 ms or more | Blocks made / due | Device dropouts | Faults |
| --- | --- | --- | --- | --- | --- | --- |
| Approved hybrid, played | 10 s | 11.7 | 0 | 3758 / 3758 | 1 | 0 |
| | 20 s | 9.6 | 0 | 7504 / 7504 | 1 | 0 |
| Approved hybrid, played and edited | 10 s | 7.6 | 0 | 3754 / 3754 | 0 | 0 |
| | 20 s | 10.6 | 0 | 7511 / 7511 | 0 | 0 |
| With radiator, played | 10 s | 12.4 | 0 | 3765 / 3765 | 0 | 0 |
| | 20 s | 12.2 | 0 | 7511 / 7511 | 0 | 0 |
| With radiator, played and edited | 10 s | 14.6 | 1 | 3773 / 3773 | 0 | 0 |
| | 20 s | 13.6 | 0 | 7500 / 7500 | 0 | 0 |

- Engine memory 3 145 728 bytes in every report. Worst solver iterations 2.
- The longest single block was 1 or 2 ms in every case, by a clock that
  reads whole milliseconds. A block lasts 2.67 ms.
- From the 20 s runs the radiator adds about 3 points of one core. Most of
  the cost in all eight is the hybrid's own: while a pluck's force is being
  applied the processor steps the engine one sample at a time (Phase 3D.2).
- The radiator's cost while the instrument only rings was not measured
  separately in the browser.

**What this does and does not show.** No block was missed in 60 s of
playing with the radiator, and there were no faults. One block reached 2 ms
of the 2.67 ms available, once, while being played and edited. The two
device dropouts were both in the first case run (the approved hybrid,
without the radiator), one in each run. These are short runs on one
machine with a 1 ms clock. They are not evidence of real-time safety over a
long session, on a slower machine, or with a busier page, and I do not claim
it. The average CPU figures say nothing about the worst block.

**The browser plays what was tested.** `integratedRadiated()` renders the
builder example in the browser's own AudioWorklet (offline) and returns its
peak, sum of squares and five samples. They equal Node's to every digit
(peak 0.0723317563533783, sum of squares 4.5835691686522155).

In Node (`npm run render:radiator`), the same playing costs 6.4 % of a core
without the radiator and 8.2 % with it.

In the builder page itself the example loads, the listener is drawn without
a connection dot, Play instrument works and the meter reads pascals
(0.13 Pa falling to 0.0006 Pa over 1.5 s after one play, sampled 0.4 s after
the stroke).

## 6. Listening files

`npm run render:radiator` writes `renders/radiator/` (not committed, as all
renders). Each instrument is played once and rendered twice: `a` as it is
heard today, `b` through the real-time radiator.

| File | Quantity | Peak | RMS | Gain applied |
| --- | --- | --- | --- | --- |
| 1a-metal-bar-struck-approved-output-velocity | m/s | 0.305 | 0.0255 | x1.64 (+4.3 dB) |
| 1b-metal-bar-struck-experimental-pressure | Pa | 0.783 (88.8 dB SPL) | 0.0580 | x0.639 (-3.9 dB) |
| 2a-wooden-bar-struck-approved-output-velocity | m/s | 0.265 | 0.0152 | x1.88 (+5.5 dB) |
| 2b-wooden-bar-struck-experimental-pressure | Pa | 1.72 (95.7 dB SPL) | 0.0333 | x0.290 (-10.7 dB) |
| 3a-hybrid-string-plucked-approved-output-velocity | m/s | 0.0472 | 0.00684 | x10.6 (+20.5 dB) |
| 3b-hybrid-string-plucked-experimental-pressure | Pa | 0.00963 (50.6 dB SPL) | 0.000643 | x51.9 (+34.3 dB) |
| 4a-hybrid-bar-struck-approved-output-velocity | m/s | 0.308 | 0.0259 | x1.62 (+4.2 dB) |
| 4b-hybrid-bar-struck-experimental-pressure | Pa | 1.15 (92.2 dB SPL) | 0.0780 | x0.433 (-7.3 dB) |
| 5a-hybrid-plucked-and-struck-approved-output-velocity | m/s | 0.316 | 0.0266 | x1.58 (+4.0 dB) |
| 5b-hybrid-plucked-and-struck-experimental-pressure | Pa | 1.16 (92.2 dB SPL) | 0.0782 | x0.432 (-7.3 dB) |

- **Units.** `a` files are the bar's velocity where it is struck, m/s (the
  approved output divided by its fixed gain of 0.25). `b` files are sound
  pressure, Pa, in free air, 1 m, 45 degrees.
- **Normalization.** Each file is scaled on its own so that its peak is
  half of full scale, and nothing else is done to it. The gain is in the
  table and in `listening.json`. Because of this the files do **not**
  compare loudness: 3b is played 42 dB louder than 4b relative to its
  pressure. Loudness is in the Peak column.
- The `b` files start 0.9 to 1.2 ms later than the `a` files (the bar's
  length over the speed of sound).
- The metal and wooden bars alone are rendered through the analysis harness
  (the builder's own translation with ports and taps added). They are not
  builder examples, and the approved bar examples are untouched.
- The wooden bar's pressure peak is a sharp click of the mallet; its ringing
  note is small (0.09 mPa at 589 Hz from 0.1 s on), which is why its RMS is
  low for its peak.

I have not heard any of them.

## 7. Tests and regressions

`tests/radiator.test.ts`, 22 tests. Besides those described above:

- Every example of earlier phases (three bar examples, the string on its
  box, the hybrid), played, then played again with a finger's touch: the
  same samples and the same final energy on the new engine binary and on the
  Phase 3D.3 binary (`tests/fixtures/engine-phase-3d3.wasm`, 26 494 bytes).
- With the radiator on, the engine's own first output is bit for bit the
  approved hybrid's, sample by sample for a second, and the energies agree.
- After the radiated example has played, each bar example is bit for bit a
  bare engine's output.
- The builder example's sound is the prototype's, sample for sample.
- Validation, playing controls, live edits, undo and redo, save and restore.

No existing assertion was changed. One existing test fixes the list of
string examples at two; the new example was put in a list of its own rather
than alter it.

Results of the full run are in the phase report. Reference WAV hashes are
unchanged (`tests/baseline/*.wav`).

## 8. Limitations

- **One bar, one listener, fixed.** 1 m, 45 degrees, free still air: no
  room, floor, supports or resonator tube. Only the metal bar of the hybrid
  is wired to it in the builder.
- **Sixteen points far in front of the bar.** Where the sound is the small
  remainder of a near-total cancellation, 16 points get the remainder less
  exactly: +0.5 dB at 4 m and +1.7 dB at 8 m straight in front (where the
  level is 55 dB below that at 0.25 m). At 45 degrees it is within 0.1 dB at
  every distance tried.
- **-0.8 dB at 110 Hz** in the string-driven case, as in Phase 3D.3.
- **Modes 6 to 8** of the bar (above 10 kHz) were not compared one by one.
- **The delay between points is interpolated linearly**, which dulls very
  high frequencies slightly for points whose delay falls between samples
  (at worst about -2 dB at 10 kHz for one point). Its effect is inside the
  comparisons above, which include 7760 Hz.
- **Radiation takes nothing from the bar.** The bar's decay is its
  material's, as before; the energy it would lose to the air is not removed.
- **1.2 ms of added delay** for this bar (its length over the speed of
  sound).
- **Taps: 32, and 128 samples per call.** Enough for one bar at 16 points
  with room for a second. A larger audio block would be processed 128
  samples at a time.
- **The plucked string is very quiet through the bar** (section 4). This is
  the physics of the model, and may not be what is wanted musically.
- **Performance** was measured for tens of seconds on one machine
  (section 5).
- The pressure is uncalibrated: no measurement of a real bar was used.

## 9. Trying it

```
npm run dev
```

Open `/builder.html`, choose "A string tied to a metal bar, heard as sound
pressure at 1 m" under Load an example, Start audio, Play instrument. Select
the listener and Remove it to hear the approved hybrid again; Undo brings it
back.

## 10. What followed (Phase 3D.5)

The 42 dB between this example's pluck and its stroke was measured along the whole chain and explained, and two research candidates were found that raise the pluck by 14 and 25 dB by moving where the string is tied and retuning the bar. See [HYBRID_PLAYABILITY.md](HYBRID_PLAYABILITY.md). This example and the radiator are unchanged.
