# Three coupled parts: a more realistic pad under the bar (Phase 3D.8)

Phases 3D.6 and 3D.7 ([THREE_BODY.md](THREE_BODY.md),
[THREE_BODY_MOUNTING.md](THREE_BODY_MOUNTING.md)) left two reference
mounts for the bar: stiff pads, whose stroke is mostly the bar's note but
loud and short, and soft pads, whose stroke is quieter and longer but mostly
knock, with a bar that ignores the string. Both use the same pad: a spring
and a damper side by side. This phase asks whether a more realistic pad
gives a better balance.

**It is research in the isolated prototype.** Nothing is in the builder. The
production engine, the processor, the approved instruments, the examples and
every playback gain are unchanged. No output is filtered, compressed or
boosted, and no new pressure source was added.

I cannot hear audio. Everything here is measured; the listening judgment is
yours. Mechanical energy and radiated sound are accounted for separately
(the radiation takes nothing from the mechanics).

Reproduce with `npm run render:three-body-pads`
(`renders/three-body-pads/measurements.json`) and
`tests/three-body-pads.test.ts`.

## 1. What a mount can and cannot do

A stroke, step by step (20 g mallet at 1.5 m/s on the 54 g bar):

| Step | What happens | Can the mount change it? |
| --- | --- | --- |
| Momentum | The mallet hands the bar 0.034 to 0.045 N s in about 0.3 ms. The bar stands on the board, so the board must receive all of it | **No.** Only over how long: a softer mount spreads the push out |
| Elastic storage | The bar's up-and-down motion (about 5 to 8 mJ) goes into the pads' springs and comes back: the bar bounces | Yes: stiffness sets how fast it bounces; this is the knock's pitch |
| Dissipation | The pads' dampers, the bar's material, the board, the air | Yes, for the pads' share |
| Bending | The stroke leaves 7 to 12 mJ in the bar's lowest bending mode, which then rings at 660 Hz | No (it depends on where and how it is struck) |
| Board | Both the bounce and the ringing push the board through the same two pads | **This is the limit:** one path carries both |
| Radiation | The board and the hole make pressure from whatever moves the board | No |

So a mount has exactly two things it can do for the balance between knock
and note: be **softer for the bounce than for the ringing**, and **take
more energy from the bounce than from the ringing**. The bounce is at
roughly 300 to 500 Hz depending on the pads; the ringing is at 660 Hz.

**The existing pad does both the wrong way round.** A spring and damper side
by side (a Kelvin-Voigt element) has

    force = k x + c dx/dt

- its stiffness k is the same at every frequency, and
- its loss factor c w / k rises in proportion to frequency: it always damps
  the 660 Hz ringing more than the slower bounce (0.064 against 0.016 for
  the plain pad compared below).

Real rubber and felt are softer for slow motion than for fast, and their
loss factor has a broad maximum instead of rising for ever. That is a
physically meaningful limitation of the existing pad, and it points the
wrong way for this instrument. It justifies trying one better model. It does
not promise that the result will be better.

## 2. Mounts considered

| Mount | Verdict |
| --- | --- |
| **Standard linear solid** (below): a spring, and beside it a spring and damper in series | **Built.** The simplest model with the two properties wanted; one internal state per pad; made of the engine's own parts |
| A pad with its own mass between two springs (two-stage isolation) | Not built. It isolates above its own resonance, which would have to be below 660 Hz to calm the knock, and would then isolate the bar's note as well |
| Several relaxing paths (a generalized Maxwell model) | Not built. It only widens the loss maximum; one path already shows what the mechanism is worth (section 5) |
| Other pad positions | Already explored in Phase 3D.7; repeated here for the new pad (section 6) |
| Nonlinear or one-sided contact (a bar that can lift off) | Not built: a different question (rattle), and not needed for the balance |

### The standard linear solid as built

```
bar ----[ k ]----+---- board        k    always acts          N/m
bar ----[ c ]----+                  c    plain damping        N s/m
bar --[ k1 ]-- lump --[ c1 ]-- board     the relaxing path
                (m)                 k1 N/m, c1 N s/m, m kg
```

Each pad has one internal state: the position of a small lump of the pad's
own material (0.2 g: a piece of felt or rubber a centimetre across).

**Equations of motion** (x: bar at the pad, y: board at the pad, z: lump;
all in metres):

    force on the bar   = -k (x - y) - c (x' - y') - k1 (x - z)
    force on the board = +k (x - y) + c (x' - y') + c1 (z' - y')
    m z''              =  k1 (x - z) - c1 (z' - y')

**Stored energy** (J): k (x - y)^2 / 2 + k1 (x - z)^2 / 2 + m z'^2 / 2.

**Dissipated power** (W): c (x' - y')^2 + c1 (z' - y')^2. Never negative.

**Passivity.** For k, c, k1, c1 >= 0 and m > 0 the pad is a network of
springs, dampers and a mass. It stores energy only in the three terms above
and loses it only in the two dampers, so it cannot return more than it was
given, at any frequency and for any motion. No condition on the numbers is
needed beyond their signs.

**As the bar feels it** (leaving out the lump's small inertia), with
relaxation time t = c1 / k1 and w the angular frequency:

    stiffness    k + k1 (w t)^2 / (1 + (w t)^2)      from k up to k + k1
    loss part    c w + k1 (w t) / (1 + (w t)^2)      largest near w t = 1

Slow motion: the damper lets the lump follow the bar and the path carries
nothing. Fast motion: the damper holds the lump and the path's spring adds
its stiffness.

**Integration.** Nothing new. The lump is an ordinary one-mode resonator and
the path is two ordinary connections, so the existing implicit-midpoint
solver handles them, with its existing guarantees. The lump on its spring
would resonate at 5 kHz but the damper overdamps it forty times; a lump four
times lighter or five times heavier changes the stroke by under 0.3 dB
(tested), so its mass is not a tuning.

**Cost.** Per pad: one resonator of one mode and two connections. For the
instrument: 8 resonators instead of 6 and 11 connections instead of 7. The
solver's work grows with the square of the connections.

**No change to the production engine or the processor was needed.** The pad
is a few lines in the prototype (`Mount.relaxing` in
`src/experimental/string/stringBarBody.ts`).

**Energy accounting.** The engine's total energy already sums every
resonator and every spring, so the lumps and the paths' springs are in it
without special treatment, and its dissipation already sums every damper.
The conservation tests use that total: nothing is left out. The harness
additionally reports what the pads hold and what their dampers take, split
between the plain damper and the relaxing path.

## 3. The four mounts compared

All four carry the same string, bridge, body, mallet and small bar. The bar
is retuned by fractions of a millimetre so that its note as it stands is the
string's 6th harmonic in every case (within 1.1 cents).

| | A: stiff pads (3D.6 tuned) | B: soft pads (3D.7 candidate A) | **C: viscoelastic pads** | D: plain pads of C's stiffness |
| --- | --- | --- | --- | --- |
| Pad | 1e6 N/m, 5 N s/m | 1e5, 1 | 2e4 slow, 2.2e5 fast; relaxation 2.65 ms | 2.2e5, 3.4 |
| Stiffness at 60 / 168 / 660 Hz, N/m | 1e6 throughout | 1e5 throughout | 1.2e5 / 1.97e5 / 2.18e5 | 2.2e5 throughout |
| Loss factor at 60 / 168 / 660 Hz | 0.002 / 0.005 / 0.021 | 0.004 / 0.011 / 0.041 | **0.84 / 0.32 / 0.092** | 0.006 / 0.016 / 0.064 |
| Struck at | 0.35 | 0.5 | 0.5 | 0.5 |

D is the honest control: the simple pad with C's stiffness and nearly C's
loss at the bar's note. What C adds over D is what the viscoelastic model is
worth.

### The stroke (20 g mallet at 1.5 m/s)

| | A | B | C | D |
| --- | --- | --- | --- | --- |
| Mallet's impulse / energy given | 0.034 N s / 22.0 mJ | 0.034 / 22.1 | 0.043 / 18.2 | 0.045 / 17.3 |
| Bar's kinetic energy: up-and-down / rocking | 4.8 / 0.77 mJ | 8.2 / 0 | 7.7 / 0 | 7.5 / 0 |
| Bending 1 / bending 3 | 6.7 / 0.06 mJ | 11.9 / 1.35 | 11.9 / 1.25 | 11.9 / 1.21 |
| Pads held at most | 2.2 mJ | 4.7 mJ | 4.0 mJ | 4.2 mJ |
| **Where it went:** pads' dampers | 13 % | 19 % | 34 % (31 % in the relaxing paths) | 26 % |
| the bar's own material | 12 % | 49 % | 24 % | 24 % |
| board, air and string | 75 % | 32 % | 42 % | 50 % |
| accounted for | 100 % | 100 % | 100 % | 100 % |
| **Sound:** peak / LAFmax | 5.03 Pa / 93.9 dB | 3.78 / 86.2 | 5.36 / 89.8 | 5.52 / 90.3 |
| Time to LAFmax / to fall 20 dB | 0.07 / 0.68 s | 0.06 / 0.80 | 0.07 / 0.71 | 0.07 / 0.73 |
| **Knock alone** (a bar that cannot bend): LAFmax / sound energy | 91.7 / 86.4 dB | 87.8 / 86.9 | **89.1 / 84.6** | 91.2 / 87.2 |
| Lowest bending mode only: LAFmax | 94.9 dB | 86.5 | 90.9 | 91.6 |
| Bar's note: its motion falls 20 dB in | 0.32 s | 0.67 s | 0.40 s | 0.43 s |
| in the sound from 0.3 s on | 18.6 mPa | 26.6 mPa | 14.1 mPa | 19.2 mPa |
| share of the stroke's sound energy | 73 % | 20 % | 60 % | 53 % |
| Sound energy 200-500 / 500-1000 Hz | 13 / 83 % | 66 / 24 % | 10 / 80 % | 19 / 72 % |

("Where it went" is of the energy the mallet gave. The pads' and the bar's
shares are measured from their own dampers; the rest is the board, the air,
the screen and the string. The engine's own count of everything dissipated
equals what the mallet gave to within 1 %.)

### The pluck (2 N)

| | Approved string | A | B | C | D |
| --- | --- | --- | --- | --- | --- |
| Peak / LAFmax | 0.102 Pa / 61.1 dB | 0.097 / 60.7 | 0.103 / 61.1 | 0.106 / 61.1 | 0.111 / 61.1 |
| String pitch | -0.54 cents | -0.48 | -0.48 | -0.48 | -0.48 |
| Fundamental re approved | | -2.2 dB | -2.7 | -2.6 | -2.4 |
| 3rd / 4th / 6th harmonic re approved | | -0.3 / -6.3 / +7.4 dB | +10.3 / +4.5 / -0.8 | +2.3 / **+14.1** / +1.7 | +2.2 / **+16.3** / +2.0 |
| Time to LAFmax / to fall 20 dB | 0.12 / 1.0 s | 0.15 / 1.2 | 0.13 / 1.0 | 0.13 / 1.1 | 0.13 / 1.1 |
| String's energy 1 s after the pluck | | 1.1 % of its most | 1.1 % | 1.1 % | 1.1 % |
| Entered the board | | 1.29 % of the pluck | 1.99 % | 1.64 % | 1.46 % |
| Crossed the pads: to the bar / back | | 65.4 / 64.7 uJ | 116 / 116 | 5.9 / 3.1 | 51.6 / 51.3 |
| Pads' dampers took / pads held at most | | 2.7 / 0.16 uJ | 9.9 / 2.2 | 16.0 / 0.46 | 5.7 / 0.51 |
| Bar's bending 1 at most | | 0.236 uJ | 0.019 | 0.095 | 0.106 |
| What bending adds at the 6th harmonic | | +3.8 dB | +0.1 | +5.3 | +5.7 |

### Pluck against stroke

| Stroke over pluck, LAFmax | A | B | C | D |
| --- | --- | --- | --- | --- |
| Standard stroke | 33.2 dB | 25.1 | 28.7 | 29.2 |
| Light stroke (5 g at 1 m/s): a different excitation | 21.6 dB | 13.8 | 19.4 | 20.0 |

## 4. What the new pad achieves

Against the five outcomes asked about, relative to both baselines:

| Outcome | Result |
| --- | --- |
| 1. Less low-frequency mounting response while keeping the bar's note | **Partly.** C's knock alone is 2.6 dB below A's and its stroke is still mostly the bar's note (60 % against A's 73 %, B's 20 %). But it is 1.3 dB above B's knock, and its note from 0.3 s on is the weakest of the four (14.1 mPa) |
| 2. More useful bar resonance without a soundboard resonance | **Mixed.** The note rings longer than on A (0.40 against 0.32 s). There is no 330 Hz rise (3rd harmonic +2.3 dB against B's +10.3). But the bar's bounce on these pads is near 430 Hz, beside the string's 4th harmonic, which rises 14 dB in the pluck. That is a mounting resonance colouring the string, and D has it too (+16 dB) |
| 3. Better relation between pluck and stroke | **A little.** 28.7 dB against A's 33.2, but B's 25.1 is better. With the light stroke 19.4 dB |
| 4. String's pitch and sustain | **Preserved** in all four: -0.48 cents, level within 0.4 dB of the approved instrument, the same sustain |
| 5. More energy transfer without amplification | **Yes against B, no against A.** The bar's bending gets five times B's share of a pluck and adds 5.3 dB at the 6th harmonic (A: +3.8 dB with 2.5 times C's bending energy) |

So C is a genuine middle between A and B. **But nearly all of that comes
from its stiffness, not from its being viscoelastic.** D, the plain pad of
the same stiffness, is the same middle: the stroke within 0.5 dB, the note
within 2.7 dB (D's is the stronger), the same answer to the string, the same
440 Hz colour.

## 5. What viscoelasticity itself is worth

Plain pads and viscoelastic pads at the same stiffness, each with its loss
varied, compared where the bar's note is equally strong:

| Pad | Loss factor at 168 Hz / at the note | Knock alone: LAFmax / sound energy | Bar's note from 0.3 s | Note's share |
| --- | --- | --- | --- | --- |
| Plain 2.2e5 N/m, 1 N s/m | 0.005 / 0.019 | 93.2 / 89.8 dB | 34.3 mPa | 46 % |
| Plain 2.2e5, 3.4 (D) | 0.016 / 0.064 | 91.2 / 87.2 | 19.2 | 53 % |
| Plain 2.2e5, 10 | 0.048 / 0.19 | 88.3 / 84.3 | 4.5 | 56 % |
| Viscoelastic, change centred at 40 Hz | 0.22 / 0.065 | 90.0 / 85.6 | 19.6 | 59 % |
| Viscoelastic, 60 Hz (C) | 0.32 / 0.092 | 89.1 / 84.6 | 14.2 | 60 % |
| Viscoelastic, 100 Hz | 0.53 / 0.15 | 87.6 / 83.2 | 7.6 | 62 % |
| Viscoelastic, 150 Hz | 0.76 / 0.22 | 86.3 / 82.0 | 3.6 | 63 % |
| Viscoelastic, 400 Hz | 1.4 / 0.55 | 82.5 / 79.1 | 4.3 | 63 % |

- **At equal note** (19.2 and 19.6 mPa: plain with 3.4 N s/m against
  viscoelastic at 40 Hz) the viscoelastic pad knocks **1.2 dB less by the
  meter and 1.6 dB less in sound energy**.
- With softer pads (1.2e5 N/m at the note) the same comparison gives 2.1 to
  2.7 dB.
- In both models, **more loss lowers the knock and the note together**. The
  viscoelastic pad shifts that trade by one to three decibels in the knock's
  favour. It does not break it.

That is the physics of section 1 showing through: the bounce and the ringing
are little more than an octave apart and use the same two pads, and a
passive pad's loss cannot change sharply over an octave. Momentum still has
to reach the board.

## 6. Is C a narrow tuning?

Candidate C with one thing changed (stroke level; bar's note from 0.3 s):

| Changed | Stroke LAFmax | Bar's note | Comment |
| --- | --- | --- | --- |
| C | 89.8 dB | 14.1 mPa | |
| Lump 0.05 g or 1 g (instead of 0.2 g) | 89.8 | 14.1 | No effect: the lump's mass is not a setting |
| Slow stiffness 5e3 or 5e4 N/m (instead of 2e4) | 89.1 / 91.0 | 13.2 / 13.0 | Robust |
| Fast stiffness adds 1e5 or 4e5 N/m (instead of 2e5) | 84.7 / 94.4 | 26.3 / 2.4 | **Sensitive:** this is the stiffness dial again |
| Pads at 0.21 or 0.22 of the bar (instead of 0.215) | 91.8 / 86.6 | 3.2 / 29.8 | **Sensitive:** 1 mm of pad position is 2 to 3 dB of stroke and 6 to 13 dB of note |
| String 6 cents flat or sharp | 89.8 | 14.8 / 14.9 | Robust; the pluck's level moves by 1 dB |
| Struck at 0.35 or 0.2 (instead of the middle) | 87.3 / 86.3 | 9.3 / 4.0 | The middle gives the most note |

The viscoelastic parameters themselves (lump, slow stiffness, where the
change is centred) are forgiving. The two things that were sensitive before
are still sensitive: how stiff the pad is at the bar's note, and exactly
where the pads sit near the bar's nodes. The second is a real concern: it is
a tolerance of about a millimetre on a 20 cm bar.

## 7. Playing it

Through the browser's own processor, with the existing pluck, mallet and
finger calls. A, B and C alike:

| Scene | Result for C |
| --- | --- |
| Plucked four times a second for 3 s | Peak 0.123 Pa; energy settles at 6.8 mJ; nothing left 3 s later |
| Struck four times a second for 3 s | Peak 6.84 Pa (the strokes add); settles at 19.9 mJ |
| Pluck and stroke in turn, every 0.75 s | Peak 5.35 Pa; 89.8 dB |
| Pluck and stroke at the same instant | Peak 5.34 Pa: the stroke covers the pluck |
| Plucked, then a finger on the string | The string is left with 1.4e-6 uJ: muted |
| Struck, then a finger on the string | The string is muted; the bar rings on |
| 8 N plucks and 5 m/s strokes in turn, ten a second for 3 s | Peak 20.9 Pa (120 dB); no fault; 3 solver iterations; dies away |
| Gentle: 0.5 N pluck / 0.3 m/s stroke | 49.1 dB / 76.1 dB |

- **No fault, no instability, no unbounded energy** in any scene for any
  mount. Energy three seconds after the last event is under a hundred
  thousandth of its most.
- **No clicks:** the largest step between two samples is 0.06 to 0.23 of the
  peak in every scene (a click would be near 1).
- **Plausible response:** a pluck four times as hard is 12.0 dB louder
  (linear, as it should be). A stroke four times as fast is 9.8, 12.4 and
  11.3 dB louder for A, B and C.
- **The level difference is not under control.** The gentlest stroke tried
  (0.3 m/s) is 27 dB above the gentlest pluck, and the hardest playing
  reaches 14 to 21 Pa, above the 16 Pa ceiling these prototypes were given.
  No mount changes that; it is the difference between pushing a board
  through a bar and coaxing it through a string.

## 8. Performance

**Browser** (development test page, not the builder; Chrome 156, visible;
48 kHz; on battery). Device baseline with no engine, before and after: 1 and
1 dropouts in 10 s (empty context), 1 and 0 (oscillator). Two runs of 20 s
each, plucked and struck in turn about ten times a second:

| System | CPU, % of a core | Longest block | Blocks of 2 ms or more | Blocks made / due | Device dropouts | Faults | Solver iterations |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Approved string on its box | 14.4 / 17.1 | 2 / 3 ms | 0 / 1 | 7515 / 7515, 7503 / 7503 | 0 / 0 | 0 | 1 |
| A: stiff pads | 20.7 / 18.1 | 2 / 2 ms | 14 / 8 | 7507 / 7507, 7515 / 7515 | 0 / 0 | 0 | 4, 6 |
| B: soft pads | 18.2 / 20.8 | 2 / 2 ms | 5 / 8 | 7508 / 7508, 7504 / 7504 | 0 / 0 | 0 | 5, 4 |
| **C: viscoelastic pads** | **27.2 / 24.3** | 2 / 2 ms | **61 / 96** | 7519 / 7519, 7504 / 7504 | 0 / 0 | 0 | 3 |
| C, pads edited 17 times a second | 24.6 / 26.6 | 2 / 3 ms | 39 / 74 | 7511 / 7511, 7519 / 7519 | 0 / 0 | 0 | 3, 4 |

Engine memory 3 145 728 bytes throughout. A block lasts 2.67 ms.

- **No device dropouts and no missed blocks in any of the ten runs**, with a
  healthy device. This is the cleanest set so far.
- **C costs about a third more than A or B** (26 against 19 % of a core) and
  **has five to ten times as many slow blocks**: 0.5 to 1.3 % of its blocks
  took 2 ms or more, against 0.1 to 0.2 %. Four more connections for the
  solver are not free.
- The clock reads whole milliseconds, and these are ten short runs on one
  machine. They show that C has clearly less margin than the simpler mounts.
  They do not show that any of them is real-time safe, and I do not claim
  it.

The pad needed no change to the engine or the processor to run in the
AudioWorklet: it is ordinary engine calls.

**In Node** (the same processor file, 20 s each, the same playing, run on
its own): the string instrument 16.7 % of a core; A 23.3, B 26.9, D 23.9;
C 32.9, with 8 resonators and 11 connections against 6 and 7. The same
picture: C costs about a third more. No faults; at most 4 solver iterations.

## 9. Listening files

`npm run render:three-body-pads` writes fourteen sounds twice into
`renders/three-body-pads/` with `manifest.json` (not committed): 48 kHz,
24-bit, all the body's sound pressure in pascals.

| File | Excitation | True peak | LAFmax | `common/` (x0.163 per Pa, -15.8 dB) | `matched/` gain |
| --- | --- | --- | --- | --- | --- |
| 01-approved-string-and-body-plucked | pluck 2 N | 0.102 Pa | 61.1 dB | -35.6 dBFS | +10.5 dB |
| 02-A-phase-3d6-tuned-plucked | pluck 2 N | 0.0972 | 60.7 | -36.0 | +9.9 |
| 03-A-phase-3d6-tuned-struck | 20 g at 1.5 m/s | 5.03 | 93.9 | -1.7 | -20.6 |
| 04-B-phase-3d7-soft-mount-plucked | pluck 2 N | 0.103 | 61.1 | -35.5 | +10.4 |
| 05-B-phase-3d7-soft-mount-struck | 20 g at 1.5 m/s | 3.78 | 86.2 | -4.2 | -13.1 |
| 06-C-viscoelastic-pads-plucked | pluck 2 N | 0.106 | 61.1 | -35.2 | +10.3 |
| 07-C-viscoelastic-pads-struck | 20 g at 1.5 m/s | 5.36 | 89.8 | -1.2 | -16.9 |
| 08a-C-pluck-and-stroke-in-turn (5 s) | pluck, stroke, pluck, stroke, 0.75 s apart | 5.35 | 89.8 | -1.2 | -19.9 |
| 08b-C-pluck-and-stroke-together | both at once | 5.34 | 89.8 | -1.2 | -17.0 |
| 09a-A-struck-lightly | 5 g at 1 m/s | 1.30 | 82.3 | -13.5 | -8.9 |
| 09b-B-struck-lightly | 5 g at 1 m/s | 1.10 | 74.9 | -15.0 | -1.7 |
| 09c-C-struck-lightly | 5 g at 1 m/s | 1.90 | 80.5 | -10.2 | -7.3 |
| 10a-D-plain-pads-of-the-same-stiffness-plucked | pluck 2 N | 0.111 | 61.1 | -34.8 | +10.3 |
| 10b-D-plain-pads-of-the-same-stiffness-struck | 20 g at 1.5 m/s | 5.52 | 90.3 | -0.9 | -17.4 |

- **`common/`: relative loudness.** Every file is multiplied by the same
  0.163 per pascal (the loudest peaks at 0.9). The plucks are 35 dB down in
  their files. Turn the playback up, not the file.
- **`matched/`: timbre.** Each file is scaled to the same A-weighted sound
  exposure.
- Measured differences worth listening for: 07 against 03 (4.1 dB quieter,
  a longer note); 07 against 05 (3.6 dB louder, the weight at the bar's
  note instead of near 330 Hz); **07 against 10b** (the viscoelastic pad
  against the plain pad of the same stiffness: 0.5 dB apart, the knock 2 dB
  lower); 06 against 01 (the 4th harmonic, 440 Hz, 14 dB stronger).
- The light strokes (09) are a different excitation, not a mounting change.
- One multiplication is all that is done to any file. `manifest.json` gives
  each file's excitation, peak, levels, band shares and gains.

None of these has had listening approval. I have not heard them.

## 10. Tests and regressions

`tests/three-body-pads.test.ts`, 12 tests: the pad's parts and units; its
stiffness and loss by frequency, and that it is passive at every frequency;
conservation with every loss removed, with the pads' own energy included;
dissipation counted sample by sample and split between the pads' two
dampers, the bar and the rest; both directions and removed joints (with its
pads removed, C is the approved string instrument sample for sample); C
against D at equal note; C between A and B; the string's pitch, fundamental,
level and sustain; which settings are narrow; repeated and combined playing;
muting and dynamics; hard playing at three strike positions, the same
samples every time.

No existing test or assertion was changed. The earlier candidates build
exactly as before (no lump, the same calls) and their tests pass. The
production engine, the processor, the builder and the examples are
unchanged. Reference WAV hashes are unchanged.

## 11. Decision gate

| Question | Answer |
| --- | --- |
| 1. Does a more realistic mounting model materially improve the result? | **No.** At equal bar note it lowers the knock by 1 to 3 dB. The useful middle between the two earlier mounts comes from the pad's stiffness, and a plain pad of that stiffness (D) gives it too |
| 2. Is the improvement robust? | The viscoelastic settings are forgiving. The pad's stiffness at the note and the pads' position (to about a millimetre) are not, for any pad |
| 3. Does the string keep its fundamental, pitch and sustain? | **Yes**, in all four. But pads of this stiffness put the bar's bounce near the string's 4th harmonic, which rises 14 to 16 dB |
| 4. Is the bar's acoustic contribution meaningful? | When struck, yes: 53 to 73 % of the stroke's sound is its note on A, C and D. When the string is plucked, a few decibels on one harmonic, as before |
| 5. Is the mount passive and numerically stable? | **Yes.** Passive by construction; energy conserved to a part in a billion with losses off; every joule lost is counted; no fault in any scene |
| 6. Is real-time implementation feasible? | It runs in the AudioWorklet unchanged, without dropouts in these runs, but costs a third more and has five to ten times the slow blocks |
| 7. Does the added complexity justify its benefit? | **No.** One to three decibels of knock for a third more processor time and less real-time margin |
| 8. Keep the new mount, retain the simpler one, or reconsider the architecture? | **Retain the simpler pad.** Keep the viscoelastic pad in the prototype as a validated option, unused by default. The remaining problems are not the pad's to solve |

## 12. Limitations

- One relaxing path per pad. A real elastomer has a broader loss maximum;
  more paths would flatten the loss curve, not sharpen it, so they would not
  help separate knock from note.
- The pad is linear and always in contact: no lift-off, no rattle, no
  preload.
- The bar's ring is capped by the builder's metal-bar decay law.
- The radiation model is the approved body's only: the board's mean motion
  and the hole. It takes nothing from the mechanics, and the bar's own
  radiation is left out (estimated negligible in Phase 3D.6).
- Levels are a meter's. No listening has been done on any file since Phase
  3D.5.
- Browser timing: ten 20-second runs, one machine, a 1 ms clock.

## 13. Recommendation

1. **Do not adopt the viscoelastic pad.** It is correct, passive and stable,
   and it is not worth its cost here.
2. **The mount is no longer the open question.** Three phases have mapped
   it: stiffness sets the balance, position near the nodes sets the note,
   and the knock is the mallet's momentum. The plain pad at an intermediate
   stiffness (D) is the best simple setting found, with its 440 Hz colour as
   the price; a slightly different stiffness would move that colour between
   harmonics and is worth one more try if D is liked.
3. **Listen now.** A, B and D (and C beside D) are distinct enough that
   your ear should choose before more is built. Files 03, 05, 07 and 10b.
4. **The two problems that remain are architectural**, not mounting: a
   stroke is 20 to 30 dB above a pluck whatever the mount, and the string
   hardly reaches the bar through the damped body. If either must change,
   the choices are a lighter striker as part of the instrument, or a
   different body for this instrument. Those are decisions, not tunings.
5. Not ready for the builder.
