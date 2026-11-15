# Three coupled parts: another way to put them together (Phase 3D.9)

Phases 3D.6 to 3D.8 put a string and a small metal bar side by side on the
approved damped body and found that they hardly hear each other: the
string's energy has to cross the damped board to reach the bar. Mounting
pads were explored to exhaustion and are not the answer. This phase asks
whether a different mechanical arrangement is.

**It is an isolated feasibility study.** Nothing is in the builder. The
production engine, the processor, the approved instruments, the examples and
every playback gain are unchanged. The approved string, bridge spring, board
and air cavity are used as they are. No output is filtered, compressed or
boosted, and no sound of the bar or the string is added to the body's.

I cannot hear audio. Everything here is measured; the listening judgment is
yours. Mechanical energy and radiated sound are accounted for separately.

Reproduce with `npm run render:three-body-architecture`
(`renders/three-body-architecture/measurements.json`) and
`tests/three-body-architecture.test.ts`.

**In short.** One arrangement works: **make the bar the string's bridge.**
The string is tied to the bar instead of standing on the board, and the bar
stands on the board where the bridge stood. The bar's bending then takes
about twenty times more of a pluck than in any earlier prototype, the string
takes thirteen times more of a stroke, the string keeps its pitch and its
fundamental, and the bar's note is heard with every pluck. It needs the bar
to lie along the board's nodal line and firm pads; it costs one more
connection.

## 1. The problem, quantified

The existing path is string, approved bridge, damped board, pads, bar. For a
pluck of 2 N on the Phase 3D.6 tuned prototype:

| | |
| --- | --- |
| Most the instrument held | 5.08 mJ |
| Taken back by the plucking force as it relaxes | 47.8 % of that |
| Lost in the string itself | 50.9 % |
| Went through the bridge into the board and air | 1.2 % |
| Reached the bar's material | 0.014 % |
| Most the bar's lowest bending mode held | 0.236 uJ: 0.005 % |
| Most the string held of a stroke on the bar | 0.29 % of what the mallet gave |

**A correction.** Phase 3D.7 reported that 98.7 % of a pluck is "lost in the
string itself". That figure was everything that did not go through the
bridge, measured against the most the instrument held. This phase accounts
for it fully: about half of the peak is taken back by the plucking force
(a finger's force that relaxes over several milliseconds does negative work
on a string that is already swinging back), and about half is lost in the
string. The conclusion is unchanged: under 2 % ever enters the board. The
label was wrong, and is corrected in THREE_BODY_MOUNTING.md.

## 2. Architectures and screening

The useful number for screening is the string's wave impedance (0.514 kg/s)
times the mobility of whatever its end stands on. Near 1 the string gives up
its energy at once; near 0 it keeps it. "Size" is the whole mobility
(including motion that gives the energy back); "real" is the part that takes
energy for good.

| The string's end stands on | Size at 110 Hz | Real at 110 Hz | Size at 660 Hz | Real at 660 Hz | Share of a pluck predicted to leave |
| --- | --- | --- | --- | --- | --- |
| Approved board, approved bridge (existing, and A) | 0.00026 | 0.00004 | 0.0054 | 0.0005 | 2.0 % |
| **The bar, at 0.2 of its length (B)** | **0.029** | 0 | **0.025** | 0.008 | not predictable this way |
| The bar at its end | 0.053 | 0 | **2.2** | 0.8 | |
| The bar at its node (0.224) | 0.026 | 0 | 0.004 | 0 | |
| C: approved board, bridge at (0.15, 0.5) | 0.0028 | 0.0002 | 0.0084 | 0.0011 | 12.1 % |
| C: a 3 mm board, approved bridge place | 0.020 | 0.0010 | 0.091 | 0.079 | 13.7 % |
| C: a 3 mm board, bridge at (0.3, 0.5) | 0.092 | 0.0061 | 0.067 | 0.066 | 35.3 % |

(The bar is taken free in the air here; its pads and the board then decide
where the energy goes.)

### Architecture A: shared bridge point

The string stands on the board by its approved bridge. The bar lies along
the nodal line the bridge stands on, with its first pad on the very point
where the bridge stands, so string and bar push the same point of the board.

- *Screening:* the string still meets the board (4e-5 at the fundamental).
  The bar is closer, but the point they share was chosen because it hardly
  moves. Expect a modest gain.
- *Verdict:* cheap to try (it is the existing prototype with the bar moved);
  **built as the second architecture.**

### Architecture B: the bar is the string's bridge

The string's end is tied to the bar, and the bar stands on the board. The
string pushes the bar directly; everything the board hears of the string
comes through the bar.

- *Screening:* the string meets a 54 g bar instead of a 672 g board: its
  impedance match is a hundred times better at the fundamental (0.029
  against 0.00026). At 660 Hz it meets the bar's own bending mode, and how
  strongly depends on where it is tied: 2.2 at the bar's end (far too
  strong: the bar would take the 6th harmonic whole and detune it), 0.004 at
  the node (nothing), 0.025 a little off the node. **The tie's position is
  the coupling dial**, as the pads' position was the leak's dial.
- *String loading:* at the fundamental the bar is reactive (real part 0): it
  moves with the string and gives the energy back, which is what a bridge
  should do. The bar on firm pads is stiff enough to hold the string's pitch.
- *Radiation path:* bar, pads, board, as before. If the pad that carries the
  string's force stands where the approved bridge stood, the string drives
  the board at the same quiet point as in the approved instrument.
- *Cost:* one connection more.
- *Verdict:* **built as the main architecture.**

### Architecture C: a different body

A livelier board or a bridge off the nodal line lets 6 to 17 times more of
the string's energy into the body (12 to 35 % predicted).

- *Why rejected for this phase:* every one of these is a change the project
  already made in the other direction, for cause. The 3 mm board is the one
  Phase 3C.2.1 replaced (its lowest mode is at 36 Hz; it boomed and pulled
  the string's pitch). A bridge off the nodal line is the 330 Hz resonance
  Phase 3C.2.3 removed, which Phase 3D.7's candidate B brought back at
  +24 dB. And more energy in the board is not more energy in the bar: the
  board is damped, and in Phase 3D.7 a bridge at (0.3, 0.5) raised the bar's
  bending only to 0.006 %.
- C changes the radiator, so its sound could not be compared with anything
  approved.
- *Verdict:* **not built.** B reaches the bar without touching the body.

## 3. The two prototypes

Both are options of the existing prototype builder
(`src/experimental/string/stringBarBody.ts`); with the options absent it
builds exactly what it built before (tested).

| | A: shared bridge point | B: the bar is the bridge |
| --- | --- | --- |
| String | approved (A2, 73.5 N, 0.65 m) | the same |
| String's end | on the board, by the approved bridge at (0.08, 1/3) | **tied to the bar at 0.2 of its length** |
| Joint | the bridge's spring, 1e6 N/m (6.4e4 N/m with the allowance for the string's missing modes) | the same spring, landing on the bar |
| Bar | aluminium 0.1994 m x 20 mm x 5 mm, 54 g; note on the string's 6th harmonic | the same |
| Pads | 1e6 N/m, 5 N s/m, at 0.215 and 0.785 of the bar | the same |
| Pads stand at | (0.08, 1/3) and (0.307, 1/3): along the nodal line, the first on the bridge's point | the same |
| Struck at | the bar's middle, 20 g mallet | the same |
| Body, air, output | approved, unchanged | approved, unchanged |

In B the tie is 3 mm from the pad that stands where the bridge stood, so
that pad carries nearly all of the string's steady force to the approved
bridge point.

**New in the model:** one port on the bar (its mode shapes at the tie) and
one spring. No new kind of part, no solver change. The spring's energy and
the bar's are in the engine's totals as always.

## 4. Energy

### A pluck (2 N; most held 5.08 mJ in every case)

| | 3D.6 tuned | 3D.7 soft mount | A | **B** |
| --- | --- | --- | --- | --- |
| Through the string's joint: forward / back | 0.165 / 0.099 mJ | 0.319 / 0.218 | 0.180 / 0.086 | **0.431 / 0.315** |
| Net, of the pluck | 1.29 % | 1.99 % | 1.86 % | 2.29 % |
| Through the pads: to the bar / to the board | 65 / 65 uJ | 116 / 116 | 95 / 93 | 346 / 458 |
| Bar at its most (all of it) | 0.015 % | 0.041 % | 0.035 % | **0.166 %** |
| Bar's lowest bending mode at its most | 0.236 uJ (0.005 %) | 0.019 (0.0004 %) | 0.903 (0.018 %) | **5.00 uJ (0.098 %)** |
| Rocking / up-and-down at their most | 0.014 / 0.010 % | 0.037 / 0.009 | 0.026 / 0.020 | 0.081 / 0.028 |
| Board at its most | 0.15 % | 0.34 % | 0.11 % | 0.14 % |
| **Where it went:** taken back by the plucking force | 47.8 % | 47.8 | 47.8 | 47.8 |
| the string's own losses | 50.9 % | 50.2 | 50.3 | 49.9 |
| board and air | 1.23 % | 1.79 | 1.75 | 2.00 |
| pads' dampers | 0.054 % | 0.194 | 0.093 | 0.207 |
| the bar's own material | 0.014 % | 0.002 | 0.023 | **0.078** |
| String's energy 1 s after the pluck | 1.12 % of its most | 1.08 | 1.06 | 1.05 |

### A stroke (20 g at 1.5 m/s)

| | 3D.6 tuned | 3D.7 soft mount | A | **B** |
| --- | --- | --- | --- | --- |
| Mallet gave | 22.0 mJ | 22.1 | 15.5 | 15.5 |
| **String at its most** | 0.29 % | 0.03 % | 0.76 % | **3.86 %** |
| The string's joint, net work on what it lands on | -0.138 mJ | -0.020 | -0.102 | -0.335 |
| Pads' dampers / bar's material / everything else | 13 / 12 / 75 % | 19 / 49 / 32 | 20 / 7 / 74 | 19 / 7 / 74 |
| Bar's note: its motion falls 20 dB in | 0.32 s | 0.67 s | 0.25 s | 0.24 s |

What the numbers say:

- **B's gain is in the bar's bending, which is what was wanted:** 21 times
  the tuned prototype's, 270 times the soft mount's. Peak stored energy and
  cumulative flow agree: 2.6 times more goes forward through the joint, and
  5.5 times more of the pluck ends in the bar's own material.
- **It is still a small share of the pluck** (0.1 %). The string keeps its
  energy, as a string must to sustain: its energy a second after the pluck
  is the same in all four (1.05 to 1.12 %).
- **Both directions grew.** Struck, the string takes 3.9 % of what the
  mallet gave: thirteen times the tuned prototype.
- **A is a modest step:** four times the bending, 2.6 times the string's
  share of a stroke.
- The bar's note now decays faster in A and B (0.24 s) than on the same
  pads elsewhere on the board (0.32 s): on the nodal line and tied to a
  string, it gives its energy away sooner.

## 5. What is heard

All of it is the approved body's pressure.

### Plucked

| | Approved string | 3D.6 tuned | 3D.7 soft mount | A | **B** |
| --- | --- | --- | --- | --- | --- |
| Peak | 0.102 Pa | 0.097 | 0.103 | 0.111 | 0.187 |
| LAFmax (re approved) | 61.1 dB | -0.5 | 0.0 | +3.2 | **+6.2** |
| String pitch | -0.54 cents | -0.48 | -0.48 | -0.51 | -0.73 |
| Time to LAFmax / to fall 20 dB | 0.12 / 1.0 s | 0.15 / 1.2 | 0.13 / 1.0 | 0.13 / 0.90 | 0.13 / 0.88 |
| Fundamental, 110 Hz | 5.98 mPa | 4.64 (-2.2 dB) | 4.36 (-2.7) | 6.59 (+0.8) | **6.31 (+0.5)** |
| 2nd harmonic | 3.79 mPa | +1.3 dB | +1.8 | -0.2 | -0.3 |
| 3rd (330 Hz, the board's resonance) | 1.07 mPa | -0.3 dB | **+10.3** | -8.5 | -5.7 |
| 4th | 0.39 mPa | -6.3 dB | +4.5 | +2.1 | +5.8 |
| 6th (660 Hz, the bar's note) | 4.08 mPa | +7.4 dB | -0.8 | +3.0 | +5.0 |
| 7th | 3.57 mPa | -2.1 dB | +0.4 | -8.1 | +3.8 |
| Strongest in the first half second | | 659 Hz, 21 mPa | 769 Hz, 12.8 | 660 Hz, 19.8 | **660 Hz, 32.2 mPa**, then 770 Hz 21.6, 110 Hz 16.1 |
| Sound at 660 Hz from 1 s on | 0.59 mPa | 1.21 | 0.57 | 0.72 | 0.48 |
| What the bar's bending adds at the 6th harmonic | | +3.8 dB | +0.1 | +12.8 | +11.5 |
| Sound energy under 200 / 200-500 / 500-1000 / 1000-2000 Hz | 26 / 11 / 32 / 29 % | 14 / 13 / 51 / 21 | 14 / 25 / 31 / 28 | 21 / 7 / 32 / 40 | 10 / 3 / 66 / 21 |

- **The string is still the string in B.** Its pitch is 0.2 cents from the
  approved instrument's; its fundamental and 2nd harmonic are within 0.5 dB.
- **The bar is in the pluck.** For the first half second the strongest
  thing in B's sound is the bar's note at 660 Hz, twice the fundamental's
  pressure. Two thirds of the sound energy is between 500 and 1000 Hz
  (a third on the approved instrument). The pluck is 6 dB louder by the
  meter, and that is the bar.
- **It is in the attack, not the tail.** From a second on, the 660 Hz
  component is no stronger than on the approved instrument. The bar does not
  ring on after the string.
- **No soundboard resonance came back.** The 3rd harmonic at 330 Hz is
  lower than on the approved instrument in A and B.
- **Sustain is a little shorter:** 0.88 s to fall 20 dB against 1.0 s,
  because the early sound is louder; the string's own energy lasts as long.

### Struck, and the two together

| | 3D.6 tuned | 3D.7 soft mount | A | **B** |
| --- | --- | --- | --- | --- |
| Peak / LAFmax | 5.03 Pa / 93.9 dB | 3.78 / 86.2 | 5.52 / 90.8 | 5.51 / 90.6 |
| Knock alone (a bar that cannot bend) | 91.7 dB | 87.8 | 90.4 | 90.4 |
| Time to LAFmax / to fall 20 dB | 0.07 / 0.68 s | 0.06 / 0.80 | 0.05 / 0.63 | 0.05 / 0.65 |
| Bar's note in the sound from 0.3 s | 18.6 mPa | 26.6 | 5.2 | 14.6 |
| Its share of the stroke's sound energy | 73 % | 20 % | 38 % | 31 % |
| String's fundamental / 2nd harmonic after a stroke | 0.112 / 0.031 mPa | 0.116 / 0.026 | 0.151 / 0.021 | 0.146 / 0.043 |
| **Stroke over pluck**, standard stroke | 33.2 dB | 25.1 | 26.5 | **23.3** |
| with the light stroke (5 g at 1 m/s) | 21.6 dB | 13.8 | 18.4 | 15.2 |

- The stroke itself is not improved by B: it is the mallet's momentum
  reaching the board, as before, 3 dB quieter than the tuned prototype's
  because the bar stands at a quieter place.
- **The gap between stroke and pluck is 10 dB smaller than in the tuned
  prototype** (23.3 against 33.2 dB), mostly because the pluck is louder.
  It is still large.

## 6. Is it robust?

Architecture B with one thing changed; 28 configurations, each plucked and
struck. All ran without a fault, with at most 3 solver iterations.

| Changed | Pluck LAFmax re approved | 3rd / 6th harmonic re approved | Bar bending, of the pluck | String pitch | Comment |
| --- | --- | --- | --- | --- | --- |
| **B** | +6.2 dB | -5.7 / +5.0 dB | 0.098 % | -0.73 cents | |
| Tie at 0.215, 0.18 of the bar | +5.6, +6.4 | -7.2 / +6.4; -3.9 / +2.1 | 0.046, 0.18 | -0.71, -0.77 | Robust; the dial works as predicted |
| Tie at 0.15, 0.1, 0 (the end) | +5.8, +6.1, +8.5 | 6th: -2.0, -6.6, -3.2 | 0.29, 0.44, 0.60 | -0.87, -1.16, **-2.32** | More coupling, but the bar swallows the 6th harmonic, and at the end the fundamental falls 16 dB |
| Pads 2e6 N/m | +5.9 | -7.2 / +1.7 | 0.24 | -0.62 | Robust upwards |
| Pads 5e5, 2.2e5 N/m | +2.3, +0.3 | 6th: -15.1, -9.0; 4th: +11.4, +14.8 | 0.14, 0.20 | -0.95, -1.54 | **Not robust downwards:** softer pads bring the bar's bounce onto the 4th harmonic |
| Pads' damping 1, 20 N s/m | +6.6, +5.1 | 6th: +6.1, +1.6 | 0.11, 0.085 | -0.73 | Robust |
| Tie 3e5, 3e6 N/m | +6.3, +6.1 | unchanged | 0.10, 0.097 | -1.18, -0.60 | Robust |
| Second pad 0.1, 0.2 of the board's width off the nodal line | +6.3, +7.1 | **3rd: +27.1, +27.2** | 0.23, 0.12 | -0.73 | **The bar must lie along the nodal line** |
| Bar across the board's middle (as in earlier phases) | +4.4 | 3rd +27.4, 4th +23.3 | 0.015 | -0.07 | The same, worse |
| String 6 cents flat, sharp | +6.6, +4.8 | 6th: +2.1, +5.8 | 0.12, 0.076 | as tuned | Robust |
| String 24 cents flat, 23 sharp | +0.3, +2.3 | 6th: -4.6, +5.5 | 0.064, 0.035 | as tuned | The bar's part fades; the string is unharmed |
| Bar's note at 5.5, 6.5 times the string's pitch | -0.6, +1.3 | 6th: +1.2, -7.1 | 0.020, 0.004 | -0.73 | Off a harmonic the bar is a plain bridge |
| Bar 30 mm wide (81 g) | +0.3 | 4th +13.3, 6th -9.1 | 0.093 | -0.71 | A heavier bar changes the balance |
| Plucked at the string's middle | +4.9 | even harmonics absent, as they should be | 0.002 | -0.73 | The bar is not driven: the 6th harmonic is not in such a pluck |

What is robust: the tie's stiffness, the pads' damping, pads stiffer than
1e6 N/m, the tie's place between 0.18 and 0.215, and the string's tuning
within about 6 cents. In all of these the string's pitch stays within
1.2 cents and its fundamental within 1 dB.

What is not: **the bar must lie along the board's nodal line** (a design
rule, not a tuning), the pads must be firm, and the bar's part depends on
the bar being tuned to a harmonic of the string, as any sympathetic
resonator's does. Out of tune, B degrades gracefully into the string
instrument with an inert bridge.

## 7. Playing it

Through the browser's own processor, with the existing pluck, mallet and
finger calls.

| Scene (B) | Result |
| --- | --- |
| Plucked four times a second for 3 s | Peak 0.218 Pa; energy settles at 7.1 mJ; nothing left 3 s later |
| Struck four times a second for 3 s | Peak 5.65 Pa; settles at 14.3 mJ |
| Pluck and stroke in turn, every 0.75 s | Peak 5.52 Pa |
| Pluck and stroke at the same instant | Peak 5.50 Pa: the stroke covers the pluck |
| Plucked, then a finger laid on the string | String left with 7e-7 uJ; the sound 2 s later is 0.006 mPa |
| Struck, then a finger laid on the string | The string is muted; the bar rings on (0.14 mPa in the last half second) |
| 8 N plucks and 5 m/s strokes in turn, ten a second for 3 s | Peak 23.3 Pa; no fault; 3 solver iterations; dies away |

- No fault, no unbounded energy; the same samples every time.
- No clicks: the largest step between two samples is 0.12 to 0.41 of the
  peak (a stroke's own onset is the largest).
- A pluck four times as hard is 12.0 dB louder; a stroke four times as fast
  is 14.7 dB louder.
- Hard playing reaches 23 Pa, above the 16 Pa ceiling these prototypes were
  given: the stroke's level is still not under control.

## 8. Numerical validation

`tests/three-body-architecture.test.ts`, 12 tests:

| Check | Result for A and B |
| --- | --- |
| Energy with every loss removed, plucked, struck and both | Constant to 1 part in a billion; the tie's spring is in the total |
| With losses | What goes equals what the engine counted to 1 part in a million; never rises |
| Both directions | Pluck feeds the bar; stroke feeds the string (the joint's net work changes sign) |
| A joint removed | B with the string cut loose: the string gets exactly nothing, and plucking it makes no sound at all. B without pads: the board hears nothing. A without pads is the approved string instrument sample for sample |
| Determinism | The same samples every time |
| Solver | At most 3 iterations in ordinary playing; within the tested bound of 10 when played as hard as allowed |
| Pitch | B: -0.73 cents; fundamental +0.5 dB |
| Units and state | The tie is the bridge's own spring (N/m) on a fifth port of the bar; the engine's outputs are the body's two and nothing else |
| The earlier prototypes | Build exactly as before: four bar ports, no tie |

## 9. Performance

**Node** (the browser's processor file; 20 s each; plucked and struck in
turn, ten events a second; run on its own):

| System | Connections | % of one core | Longest block | Solver iterations |
| --- | --- | --- | --- | --- |
| Approved string on its box | 4 | 7.8 | 1.5 ms | 1 |
| 3D.6 tuned | 7 | 11.0 | 1.7 ms | 3 |
| 3D.7 soft mount | 7 | 11.1 | 0.7 ms | 3 |
| A | 7 | 10.8 | 0.8 ms | 3 |
| **B** | 8 | 11.4 | 0.7 ms | 3 |

Memory 3 145 728 bytes; no faults. (Node's longest block includes Node's own
pauses.)

**Browser** (development test page, not the builder; Chrome 156, visible;
48 kHz). Device baseline with no engine, before and after: 1 and 1 dropouts
in 10 s (empty context), 1 and 1 (oscillator). Two runs of 20 s each:

| System | CPU, % of a core | Longest block | Blocks of 2 ms or more | Blocks made / due | Device dropouts | Faults |
| --- | --- | --- | --- | --- | --- | --- |
| Approved string on its box | 11.2 / 12.1 | 2 / 1 ms | 24 / 0 | 7504 / 7504, 7519 / 7519 | 0 / 0 | 0 |
| 3D.6 tuned | 13.8 / 15.4 | 3 / 1 ms | 8 / 0 | 7507 / 7507, 7500 / 7500 | 0 / 0 | 0 |
| A | 14.3 / 14.9 | 2 / 2 ms | 7 / 3 | 7500 / 7500, 7511 / 7511 | 0 / 0 | 0 |
| **B** | 15.4 / 15.4 | 2 / 2 ms | 16 / 9 | 7508 / 7508, 7515 / 7515 | 0 / 0 | 0 |
| B, pads edited 17 times a second | 16.3 / 15.3 | 1 / 3 ms | 0 / 4 | 7519 / 7519, 7523 / 7523 | 0 / 0 | 0 |

- No device dropouts and no missed blocks in any of the ten runs, with a
  healthy device.
- **B costs what the earlier three-part prototypes cost**, to within a
  point: a third to a half more than the string instrument. Engine memory
  is unchanged.
- Slow blocks (2 ms or more of the 2.67 ms available) occur in every
  system, the approved one included (24 in one run), and one run each of the
  tuned prototype and edited B had a 3 ms block. The clock reads whole
  milliseconds. This is not evidence of real-time safety and I do not claim
  it; it shows B is no worse placed than what came before.

No change to the engine or the processor was needed.

## 10. Listening files

`npm run render:three-body-architecture` writes twelve sounds twice into
`renders/three-body-architecture/` with `manifest.json` (not committed):
48 kHz, 24-bit, all the approved body's sound pressure in pascals.

| File | Excitation | True peak | LAFmax | `common/` (x0.163 per Pa, -15.8 dB) | `matched/` gain |
| --- | --- | --- | --- | --- | --- |
| 01-approved-string-and-body-plucked | pluck 2 N | 0.102 Pa | 61.1 dB | -35.6 dBFS | +11.1 dB |
| 02a-phase-3d6-tuned-plucked | pluck 2 N | 0.0972 | 60.7 | -36.0 | +10.5 |
| 02b-phase-3d6-tuned-struck | 20 g at 1.5 m/s | 5.03 | 93.9 | -1.7 | -20.0 |
| 03a-phase-3d7-soft-mount-plucked | pluck 2 N | 0.103 | 61.1 | -35.5 | +11.1 |
| 03b-phase-3d7-soft-mount-struck | 20 g at 1.5 m/s | 3.78 | 86.2 | -4.2 | -12.5 |
| **04-B-bar-as-bridge-plucked** | pluck 2 N | 0.187 | 67.3 | -30.3 | +5.8 |
| **05-B-bar-as-bridge-struck** | 20 g at 1.5 m/s | 5.51 | 90.6 | -0.9 | -15.7 |
| 06a-B-bar-as-bridge-both-together | both at once | 5.50 | 90.6 | -0.9 | -15.7 |
| 06b-B-bar-as-bridge-pluck-and-stroke-in-turn (5 s) | pluck, stroke, pluck, stroke, 0.75 s apart | 5.52 | 90.7 | -0.9 | -18.8 |
| 06c-B-bar-as-bridge-struck-lightly | 5 g at 1 m/s | 1.90 | 82.5 | -10.2 | -7.8 |
| 07a-A-shared-bridge-point-plucked | pluck 2 N | 0.111 | 64.3 | -34.9 | +8.7 |
| 07b-A-shared-bridge-point-struck | 20 g at 1.5 m/s | 5.52 | 90.8 | -0.9 | -16.0 |

- **`common/`: relative loudness.** Every file is multiplied by the same
  0.163 per pascal. The plucks are 30 to 36 dB down in their files. Turn the
  playback up, not the file.
- **`matched/`: timbre.** Each file is scaled to the same A-weighted sound
  exposure.
- The comparison that matters is **04 against 01**: the same string, the
  same pluck, with and without the bar as its bridge. Measured: the same
  fundamental, 6 dB more by the meter, the bar's note at 660 Hz the
  strongest thing in the first half second, less at 330 Hz.
- `manifest.json` gives each file's excitation, peak, levels, first eight
  harmonics, band shares, energy-transfer figures and gains.
- One multiplication is all that is done to any file.

None of these has had listening approval. I have not heard them.

## 11. Decision gate

| Question | Answer |
| --- | --- |
| 1. Did an alternative architecture meaningfully improve string-to-bar coupling? | **Yes: B.** The bar's bending takes 21 times more of a pluck than the best earlier prototype, and the string 13 times more of a stroke |
| 2. Was it demonstrated physically rather than inferred from loudness? | **Yes.** Measured as energy in the bar's bending mode, as flow through the joint in both directions, and as energy dissipated in the bar's material; and against the same bar unable to bend |
| 3. Did the string keep a useful pitch and fundamental? | **Yes.** -0.73 cents; fundamental +0.5 dB; the string's own decay unchanged |
| 4. Did the bar contribute meaningful resonances? | **Yes, to a pluck's attack:** its note is the strongest component for the first half second. Not to the tail |
| 5. Passive and stable? | **Yes.** Conserved to a part in a billion with losses off; every joule counted; no fault in any scene |
| 6. No severe unwanted resonances? | **Yes, if the bar lies along the nodal line** (330 Hz is 5.7 dB below the approved instrument). Off the line it returns at +27 dB. The 4th harmonic is 5.8 dB up |
| 7. Robust to reasonable variation? | **Partly.** Robust to the tie's stiffness and place, pad damping, stiffer pads, and a few cents of tuning. Not to softer pads, to the bar leaving the nodal line, or to a heavier bar |
| 8. Computationally practical? | **Yes.** One connection more; the cost of the earlier prototypes; no engine change |
| 9. Does the evidence justify further development? | **Yes, for B, after listening.** |

## 12. Limitations

- **It is still a small share of the pluck** (0.1 % in the bar's bending).
  The gain is large relative to before, not in absolute terms, and the
  string is meant to keep its energy.
- **The stroke is unchanged:** still the mallet's momentum, still 23 dB
  above a pluck with the standard stroke.
- **The bar is in the attack only.** It does not sustain after the string.
- **Geometry is constrained:** the bar must lie along one line of the board,
  with one pad on the bridge's point. That is one instrument, not a family.
- **The bar's part needs tuning** to a harmonic of the string.
- The bar has no weight or preload; the pads are linear and always in
  contact; a string pulling sideways on a bar would also twist it, which a
  bar with bending and two rigid-body modes cannot show.
- The tie is at one point and pulls across the bar's face only.
- Radiation is the approved body's only; the bar's own sound is left out.
- Levels are a meter's. No listening has been done.
- Browser timing: ten 20-second runs, one machine, a 1 ms clock.

## 13. Recommendation

1. **Architecture B is worth continuing.** It is the first arrangement in
   which the string and the bar demonstrably hear each other while the
   string stays the string, and it does so with the approved body untouched
   and one extra spring.
2. **Listen to 04 against 01 first.** Whether a pluck that begins with the
   bar's note is the sound wanted is not something the measurements decide.
3. **If it is, the next step is still research, not the builder:** explore B
   as an instrument (other harmonics for the bar, the tie's place as a
   tone control, a lighter stroke as its default), and check the constraint
   that the bar must lie on the nodal line against what a builder could
   offer.
4. **Keep A as a reference only.** It is a smaller step in the same
   direction.
5. **Leave C alone** unless the body itself is to be redesigned.
6. Not ready for the builder: it would need a bar that can stand on a board
   and carry a string, which is a new kind of component.
