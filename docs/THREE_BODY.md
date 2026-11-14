# Three coupled parts: a string and a metal bar on one soundboard (Phase 3D.6)

A feasibility study. One string and one metal bar both stand on the damped
enclosed body of the approved string instrument, in one engine system. The
string and the bar never touch: each pushes the board, the board moves, and
that motion pushes the other. What is heard is the body's radiated pressure
only.

**It is an isolated prototype.** Nothing is in the builder, no palette item
or example was added, and no engine, processor, approved instrument, example
or playback gain was changed.

I cannot hear audio. Everything here is measured. The pressure is a model's,
1 m in front of the board, uncalibrated.

Reproduce with `npm run render:three-body` (writes
`renders/three-body/measurements.json`, the source of every number below)
and `tests/three-body.test.ts`.

## 1. What already existed, and what was reused

| Part | Where | Mechanical ports | Units and masses |
| --- | --- | --- | --- |
| Modal string | `string/modalString.ts` | bridge end, pluck point, a point 0.3 along | 100 modes; 3.6 g/m; modal coordinates in m, forces in N |
| Bridge | `string/instrument.ts` | spring between the string's end and a board port | 1e6 N/m, with the allowance for the string's missing modes |
| Soundboard | `string/soundboard.ts` | any points on the plate, plus a radiation port (mean motion) | spruce 0.5 x 0.4 m x 8 mm, 672 g; 76 modes to 5 kHz, each of modal mass 168 g |
| Air in the box | `string/airCavity.ts` | a spring on the radiation port, a plug of air in the hole, a screen | 30 litres; plug 3.3 g; Helmholtz 121 Hz; board on the air 118 Hz |
| Metal bar | builder `barModes` (approved bar formulas) | strike point, connection point | 8 bending modes, each of the bar's mass |
| Joints | engine `addSpring` | any two ports | N/m and N s/m; equal and opposite forces by construction |
| Mallet | engine `addContact` | a free mass against a port | Hertz contact, N/m^1.5 |
| Observation taps | engine `addTap` (Phase 3D.4) | any port, read-only | m/s |
| Output | engine `addOutput` + processor `radiate` | board radiation port and hole flow | Pa at 1 m on the board's axis |
| Bar radiation | processor `radiator` (Phase 3D.4) | 16 taps on a bar | Pa, free air |

**Reused without change:** all of the above, and the solver. The prototype
is one short file that puts the same pieces together
(`src/experimental/string/stringBarBody.ts`).

**Two things had to be added**, both because standing on a board requires
them:

1. **The bar moves as a whole.** Every bar in this project so far has
   bending modes only. That is the same as holding the bar's middle still in
   space, and a bar standing on a board would then hold the board still as
   well. The prototype's bar also has its two rigid-body modes: up and down,
   and rocking (frequency zero, the bar's mass, shapes 1 and
   sqrt(3) (2 xi - 1)). They are at right angles to every bending shape
   (tested), so nothing is counted twice.
2. **Two supports.** On one point the bar would be free to spin. It stands
   on two pads, each a spring and a damper.

## 2. The prototype

```
string --bridge--> soundboard <--two pads-- bar <--mallet
                       |
                 air in the box --> hole
```

| | Prototype (as first built) | Tuned (most promising) |
| --- | --- | --- |
| String | A2, 73.5 N, 0.65 m, 109.91 Hz; bridge where the approved body has it | the same |
| Bar | aluminium 0.200 m x 20 mm x 5 mm, 54 g; free note 654 Hz | 0.1987 m; free note 663 Hz |
| Pads on the bar | at 0.1 and 0.9 of its length | at 0.215 and 0.785 (its lowest mode's nodes are 0.224 and 0.776) |
| Pads | 1e6 N/m and 5 N s/m each | the same |
| Bar on the board | middle at (0.5, 0.65), along the board's length | the same |
| Mallet | 20 g, hardness 0.5 (the builder's default), 1.5 m/s | the same |
| Pluck | 2 N, softness 0.3 (the approved string instrument's) | the same |

One engine system: 6 resonators (string, board, air plug, ground, bar,
mallet), 189 modes, 7 connections (bridge, hole screen, air spring, finger,
two pads, mallet contact). The engine's two outputs are exactly the approved
string instrument's (board radiation port, hole flow); nothing of the string
or the bar is added (tested).

A small bar was chosen because the board weighs 672 g: the builder's default
bar (432 g) would be most of the board's weight again.

**Reference check.** With the bar's pads removed, the prototype's pressure
and the string's motion are the approved string instrument's, sample for
sample.

## 3. Energy

Energies in mJ. "Put in" is the most the instrument held for a pluck, and
what the mallet gave (thrown less kept) for a stroke.

| Case | Put in | Most in string | Most in board | Most in bar | Crossed pads: to bar / to board |
| --- | --- | --- | --- | --- | --- |
| String plucked | 5.08 | 5.05 | 0.0071 | 0.00055 | 0.056 / 0.056 |
| Bar struck | 18.9 | 0.045 | 12.8 | 5.36 | 37.6 / 55.6 |
| Both together | (5.08 + 18.9) | 5.02 | 12.9 | 5.37 | 37.7 / 55.7 |
| String disconnected, bar struck | 18.9 | **0** | 12.8 | 5.37 | 37.6 / 55.6 |
| Bar disconnected, string plucked | 5.08 | 5.05 | 0.0132 | **0** | 0 / 0 |
| Both disconnected, plucked | 21.6 | 21.6 | **0** | **0** | no sound at all |
| Both disconnected, struck | 22.5 | **0** | **0** | 22.2 | no sound at all |
| Tuned: string plucked | 5.08 | 5.05 | 0.0077 | 0.00077 | 0.065 / 0.065 |
| Tuned: bar struck | 22.0 | 0.064 | 10.8 | 6.97 | 26.0 / 45.4 |

- **Both directions work.** A pluck moves the board, and the bar answers. A
  stroke moves the board, and the string answers (the bridge's net work on
  the board is then negative: the board is feeding the string).
- **A removed joint passes exactly nothing.** The zeros above are exact.
- **The exchange between string and bar is small.** After a pluck the bar
  never holds more than 0.015 % of the energy; after a stroke the string
  never holds more than 0.3 %. The reason is the approved body: its bridge
  stands on a nodal line chosen so that the string gives up its energy
  slowly (the board itself never holds more than 0.15 % of a pluck).
- **A stroke is mostly the bar bouncing on its pads.** The board takes up to
  two thirds of the mallet's energy within 10 ms, through the bar's
  up-and-down motion, not its bending.
- Pluck and stroke together are their sum to within 2 % (the system is
  linear except for the mallet's contact).

**Conservation.** With every loss removed (no decay, no damper, no screen),
energy from 0.3 s to 2.5 s is constant to 3 parts in a trillion in all six
cases (prototype and tuned; plucked, struck, both), and also with a direct
tie and with soft pads. With losses, the energy lost in half a second equals
what the engine counted as dissipated to 1 part in a million, and never
rises. More pad damping takes more from the bar. No joint creates energy.

## 4. What is heard

| Sound | Peak | LAFmax | Fall of 20 dB | Sound energy: under 200 / 200-500 / 500-1000 / 1000-2000 Hz |
| --- | --- | --- | --- | --- |
| Approved string on its box, plucked | 0.102 Pa | 61.1 dB | 1.0 s | 26 / 11 / 32 / 29 % |
| Three parts, string plucked | 0.086 Pa | 58.4 dB | 1.1 s | 23 / 21 / 44 / 9 % |
| Three parts, bar struck | 4.34 Pa | 87.9 dB | 0.67 s | 7 / 85 / 8 / 0 % |
| Three parts, both | 4.39 Pa | 88.0 dB | 0.67 s | 7 / 85 / 8 / 0 % |
| Tuned, string plucked | 0.097 Pa | 60.7 dB | 1.2 s | 14 / 13 / 51 / 21 % |
| Tuned, bar struck | 5.03 Pa | 93.9 dB | 0.68 s | 3 / 13 / 83 / 2 % |

LAFmax is the largest A-weighted level with a sound level meter's fast
weighting: a meter's reading, not a judgement of loudness.

**The string.**

| | Approved | Prototype | Tuned |
| --- | --- | --- | --- |
| String pitch, cents from the string between fixed ends | -0.54 | -0.48 | -0.48 |
| Fundamental (110 Hz) in the sound | 5.98 mPa | 4.83 mPa (-1.9 dB) | 4.64 mPa (-2.2 dB) |
| 2nd harmonic | 3.79 mPa | +1.4 dB | +1.3 dB |
| 6th harmonic (659 Hz) | 4.08 mPa | -1.1 dB | **+7.4 dB** |

- **The string keeps its pitch** (the bar moves it by 0.06 cents) **and its
  fundamental is heard**, 2 dB lower than without the bar.
- For comparison, through a bar alone (Phase 3D.5) the fundamental was
  0.00018 mPa: 88 dB lower. The soundboard is what makes the string audible.
- Plucked, the instrument is the string instrument, slightly changed by the
  weight on its board. With the tuned bar, the 6th harmonic is 7 dB
  stronger: the bar rings with it and the board radiates that.

**The bar.**

| | Prototype | Tuned |
| --- | --- | --- |
| Bar's note free / on the board | 654 Hz / 669 Hz (+37 cents) | 663 Hz / 659.6 Hz (on the 6th harmonic within 0.4 cents) |
| Bar's energy 0.5 s after a stroke | 0.0013 mJ (of 5.4) | 0.0055 mJ (of 7.0) |
| Bar's note in the sound, from 0.3 s on | under 1 mPa | **18.6 mPa** |
| Stroke's strongest component | 419 Hz: the bar bouncing on its pads against the board | the bar's note, 659 Hz |
| String's fundamental in the sound after a stroke | 0.13 mPa | 0.11 mPa |

- In the first prototype the pads (a tenth of the way in) drain the bar's
  bending in under half a second. What is heard of a stroke is a thump at
  419 Hz, a resonance of the bar on its pads and the board, not a bar's
  note.
- With the pads near the nodes the bar rings, leaks into the board, and its
  note is in the sound. This is the same trade as on a real instrument:
  exactly at the nodes the bar rings longest and the board hears least.
- **A stroke is 27 to 33 dB above a pluck by the meter**, and falls in
  two thirds of the time. Nothing was done to even them out.

**Would the bar's own sound matter?** An estimate only, by the free-air
model of Phase 3D.3, for the tuned bar's note after a stroke: 0.10 mPa at
1 m and 45 degrees, 0.03 mPa straight in front, against 18.6 mPa through
the board. The board is about 45 dB stronger, so a second pressure source
for this bar is not needed. (The free-air model was validated for a bar
alone, not for a bar a few millimetres above a board, so this is a size,
not a result.) Nothing was implemented.

## 5. Exploration

One thing changed at a time from the prototype; 25 configurations, each
plucked and struck. All ran without a fault and with at most 4 solver
iterations. String pitch stayed within 0.7 cents of nominal in all but one.

| Changed | Effect |
| --- | --- |
| Pad stiffness 1e4, 1e5, 1e7 N/m | Softer pads make the stroke much quieter (peak 1.1, 3.4, 4.4 Pa) and cut the bar off from the string (string gets 0.01 % at 1e4). Stiffer than 1e6 changes little |
| Pad damping 0.5, 50 N s/m | The bar's energy falls 20 dB in 0.34 s and 0.05 s. Little effect on the pluck |
| **Pads at 0.224, 0.215, 0.2, 0.18, 0.15, 0 of the bar** | Bar's note in the sound after a stroke: 2.4, **33**, 9.4, 3.1, 0.7, 1.0 mPa. Its ring (20 dB): 0.72, 0.48, 0.33, 0.26, 0.14, 0.49 s. Its pitch on the board falls as the pads leave the nodes: 0, -6, -31, -75 cents |
| Bar's middle at (0.5, 0.5), (0.3, 0.33), (0.25, 0.5), (0.7, 0.8) of the board | The string's share of a stroke: 0.34, 0.36, 0.93, 0.19 %. Stroke peak 3.8 to 7.0 Pa. Near the board's edge-quarter the coupling is strongest |
| Bar tuned to 6, 5.5, 3, 2 times the string's pitch | On a harmonic the bar's note reaches the sound; between harmonics (5.5) it does not show beside the string's. At 2 times, the bar takes the 6th harmonic's place and removes 20 dB of it |
| A large bar (432 g) at the board's middle | Fundamental -9.3 dB: the weight holds the board. Too heavy for this board |
| Bridge at (0.08, 0.44), (0.3, 0.5) | The pluck is 5.2 and 12.2 dB louder and gives the bar more (0.016, 0.084 %); at (0.3, 0.5) the pitch moves to +0.17 cents and the sound dies faster. This changes the approved body, so it was not taken further |
| A direct tie from string end to bar end as well (1e5 N/m) | The string takes 1.3 % of a stroke, but its pitch moves by 1.3 cents and the 6th harmonic falls 17 dB. Not needed, and not kept |

**The tuned configuration** is the prototype with two changes to the bar:
pads at 0.215 and 0.785, and 1.3 mm shorter so that its note on the board is
the string's 6th harmonic. It was chosen because it keeps the string's pitch
(-0.48 cents), makes the bar's note audible through the board (18.6 mPa
against under 1), and lets the bar colour a pluck (+7.4 dB at the 6th
harmonic), with the approved body untouched. It is not the loudest
configuration found, and loudness was not the aim.

## 6. Performance

**In Node** (the browser's own processor file; 20 s each; plucked and struck
in turn, ten events a second):

| System | Modes | Connections | % of one core | Solver iterations |
| --- | --- | --- | --- | --- |
| Approved string on its box (plucked) | 178 | 4 | 10.1 | 1 |
| Approved string tied to a bar | 110 | 3 | 6.7 | 2 |
| Three parts, prototype (plucked only) | 189 | 7 | 13.1 | 1 |
| Three parts, prototype | 189 | 7 | 12.8 | 3 |
| Three parts, tuned | 189 | 7 | 13.1 | 3 |

Three parts cost about 30 % more than the string instrument: three more
connections for the solver, eleven more modes. Engine memory is unchanged
(3 145 728 bytes). No faults. Node's longest blocks (4 to 8 ms) include
Node's own pauses and say nothing about an audio thread.

**In a real Chromium AudioWorklet** (`threeBodyBench(20)` on the development
test page, which is not the builder; 48 kHz, Chrome 156, on battery at 64 %;
two runs of each):

| System | CPU, % of a core | Longest block | Blocks of 2 ms or more | Blocks made / due | Faults |
| --- | --- | --- | --- | --- | --- |
| Approved string on its box, plucked | 15.8 / 16.5 | 3 ms | 21 / 20 | 7500 / 7500, 7518 / 7518 | 0 |
| Three parts, prototype | 18.6 / 18.1 | 3 ms | 19 / 29 | 7515 / 7515 twice | 0 |
| Three parts, tuned | 18.7 / 19.1 | 3 ms | 9 / 15 | 7515 / 7515, 7511 / 7511 | 0 |
| Three parts, tuned, pads edited 19 times a second | 18.6 / 18.6 | 3 / 2 ms | 23 / 16 | 7508 / 7508, 7515 / 7515 | 0 |

- Memory 3 145 728 bytes; at most 3 solver iterations; no block missed.
- Three parts cost about 15 % more than the string instrument here.
- **Device dropouts could not be assessed in this session.** The output
  device reported about ten underruns a second in every case, the approved
  instrument included (184 to 253 in 20 s). A control showed the same for
  the approved radiated examples, which had 0 or 1 an hour earlier, and a
  context with no engine at all (a silent oscillator) had 84 in 8 s. The
  cause is the machine's audio output at the time, not the engine. The
  dropout figures therefore say nothing either way about the prototype.
- Blocks of 2 ms or more were also more frequent than in earlier phases for
  the approved instrument as well (about 0.3 % of blocks), and the longest
  block reached 3 ms, which is longer than a block lasts (2.67 ms).
- So: the prototype is not measurably worse than the approved string
  instrument beyond its 15 % higher average. Whether either is real-time
  safe on this machine was not established today, and I do not claim it.

`integratedThreeBody()` renders the tuned prototype offline in the browser's
own AudioWorklet; its peak, sum of squares and five samples equal Node's to
every digit (peak 0.31736674904823303, sum of squares 69.69236391194978).

## 7. Listening files

`npm run render:three-body` writes `renders/three-body/` (not committed):
nine sounds, 4 s, 48 kHz, 24-bit, each twice. Every one is the body's sound
pressure in pascals.

| File | True peak | LAFmax | `common/` (x0.177 per Pa, -15.0 dB) | `matched/` gain |
| --- | --- | --- | --- | --- |
| 1-approved-string-and-body-plucked | 0.102 Pa | 61.1 dB | -34.9 dBFS | +11.5 dB |
| 2-three-parts-string-plucked | 0.0858 Pa | 58.4 dB | -36.4 dBFS | +13.6 dB |
| 3-three-parts-bar-struck | 4.34 Pa | 87.9 dB | -2.3 dBFS | -13.7 dB |
| 4-three-parts-both-together | 4.39 Pa | 88.0 dB | -2.2 dBFS | -13.8 dB |
| 5-string-disconnected-bar-struck | 4.35 Pa | 88.0 dB | -2.3 dBFS | -13.7 dB |
| 6-bar-disconnected-string-plucked | 0.102 Pa | 61.1 dB | -34.9 dBFS | +11.5 dB |
| 7a-tuned-string-plucked | 0.0972 Pa | 60.7 dB | -35.3 dBFS | +10.8 dB |
| 7b-tuned-bar-struck | 5.03 Pa | 93.9 dB | -1.0 dBFS | -19.6 dB |
| 7c-tuned-both-together | 5.08 Pa | 93.9 dB | -0.9 dBFS | -19.6 dB |

- **`common/`: relative loudness.** Every file is multiplied by the same
  0.177 per pascal (the loudest peaks at 0.9). The plucks are 35 dB down in
  their files, which is the finding. Turn the playback up, not the file.
- **`matched/`: timbre.** Each file is scaled to the same A-weighted sound
  exposure. Loudness cannot be compared there.
- File 6 is the same samples as file 1 (the reference check of section 2).
- In files 4 and 7c the pluck and the stroke start together, and the stroke
  covers the pluck's beginning.
- One multiplication is all that is done to any file; all gains are in
  `listening.json`.

I have not heard any of them.

## 8. Tests and regressions

`tests/three-body.test.ts`, 13 tests: the bar's bending modes equal the
builder's; its rigid modes are at right angles to them; the only outputs are
the body's; the reference check; energy both ways; joints removed;
lossless conservation; dissipation; pitch and fundamental; the tuned bar's
note; determinism; hard playing (8 N plucks and 5 m/s strokes in turn for
5 s, four pad settings: no fault, bounded, dies away).

No existing test or assertion was changed. Results of the full run are in
the phase report. Reference WAV hashes are unchanged.

## 9. Decision gate

| Question | Answer |
| --- | --- |
| Is three-component coupling physically coherent? | **Yes.** One solved system; energy conserved to 3 parts in a trillion without losses; dissipation accounted for; removed joints pass nothing; reproduces the approved instrument when the bar is taken off |
| Does the string retain a useful pitch? | **Yes.** -0.48 cents, 0.06 cents from the approved instrument; fundamental 2 dB lower and clearly present |
| Does the bar contribute meaningful resonances? | **When struck and well mounted, yes** (its note at 18.6 mPa through the board). **When the string is plucked, only slightly:** it never holds more than 0.015 % of the energy, and shows as +7 dB on one harmonic. With pads away from its nodes it contributes a thump, not a note |
| Does the soundboard radiate both? | **Yes.** Everything heard goes through the board and the hole. The bar's own radiation is estimated 45 dB below what the board makes of it |
| Is performance practical? | **Probably:** 30 % more than the string instrument in Node, 15 % in the browser, no faults, same memory. Not established as real-time safe (section 6) |

## 10. Limitations

- **String and bar barely hear each other.** By the approved body's design
  the string gives the board its energy slowly, so little reaches the bar
  and little comes back. Stronger exchange needs a different bridge
  position, which changes the approved string instrument's sound.
- **Pluck and stroke are far apart in level** (27 to 33 dB), and the stroke
  is short. Softer pads and a softer mallet reduce it; this was measured for
  pads only.
- **The stroke is dominated by the bar's bounce on its pads.** The pads are
  plain springs and dampers; real felt or rubber is neither linear nor
  frequency-independent. The 419 Hz thump depends on them.
- **No weight, no preload.** The bar does not press on its pads; it cannot
  lift off or rattle.
- **The pads are points** on the board, and the bar a line of two.
- **One bar, one board, one string, one geometry.** The board is the
  approved one, unchanged. A heavier bar (432 g) was too heavy for it.
- **The existing builder bars have no rigid-body modes.** That is unchanged
  here, and would have to be addressed before any bar could stand on a board
  in the builder.
- **The bar's own sound is left out** (estimated negligible for this bar).
- **Browser timing** was disturbed by the output device (section 6).
- Uncalibrated: no measurement of a real instrument was used.

## 11. Recommendation

Three-part coupling works and is worth continuing, but **it is not ready
for the builder**, and I recommend not integrating it yet.

1. **Next, still isolated: make it playable.** The open physical questions
   are the stroke's thump and level (pads and mallet), and whether the
   string and bar should exchange more (bridge position, at the cost of
   changing the approved body's sound). These need listening as well as
   measurement.
2. **Then decide what a builder version would be.** It needs a bar that can
   stand on a board (rigid-body modes, two pads), which is a new kind of
   component and connection, not a new example of existing ones.
3. **Repeat the browser benchmark** when the machine's audio output is
   behaving, before any claim about real-time use.
