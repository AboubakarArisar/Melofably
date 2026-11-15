# Three coupled parts: mounting and playability (Phase 3D.7)

Phase 3D.6 ([THREE_BODY.md](THREE_BODY.md)) showed that a string, a small
metal bar and the damped body work as one coupled system, and left three
problems: the string hardly reaches the bar, a stroke on the bar knocks
hard, and the browser's dropout figures were spoiled by the output device.
This phase investigates all three in the isolated prototype.

**Nothing is in the builder.** No engine, processor, approved instrument,
example or playback gain changed. No output is filtered, compressed or
boosted, and the bar keeps its rigid-body modes in every instrument.

I cannot hear audio. Everything here is measured; the listening judgment is
yours. The pressure is a model's, 1 m in front of the board, uncalibrated.
Mechanical energy and radiated sound are accounted for separately: the
radiation takes nothing from the mechanics, so no balance between them is
claimed.

Reproduce with `npm run render:three-body-mounting`
(`renders/three-body-mounting/measurements.json` holds every number below)
and `tests/three-body-mounting.test.ts`.

**Summary of what was found.**

1. The knock of a stroke is the mallet's push reaching the board. A bar that
   cannot bend at all knocks as hard. Softer pads lower it by 4 dB; a
   lighter stroke lowers it by 11 dB and more.
2. The "419 Hz thump" of the first prototype was misread in Phase 3D.6. It
   is the bar's own lowest bending mode, pulled down from 654 Hz because
   stiff pads near its ends turn a free bar into a supported beam.
3. The string hardly reaches the bar for three reasons that multiply, and
   none of them is a fault: the string keeps 98.7 % of its energy, the
   damped board absorbs 99 % of what it is given, and the bar only listens
   at its own note.
4. **No configuration improved the string's hold on the bar.** The Phase
   3D.6 tuned prototype remains the best for that. Two candidates improve
   the stroke instead, and one of them shows why the bridge should stay
   where it is.

## 1. The stroke

Standard stroke: 20 g mallet, hardness 0.5, 1.5 m/s. LAFmax is the largest
A-weighted level with a meter's fast weighting.

To see what the mounting does by itself, each instrument was also struck
with **a bar that cannot bend**: the same mass on the same pads, with only
its two rigid-body modes. This is a measurement, not an instrument.

| | 3D.6 prototype | 3D.6 tuned | A: soft mount |
| --- | --- | --- | --- |
| Pads | 1e6 N/m, 5 N s/m, at 0.1 / 0.9 | 1e6, 5, at 0.215 / 0.785 | 1e5, 1, at 0.215 / 0.785 |
| Struck at | 0.35 | 0.35 | 0.5 (its middle) |
| On rigid ground: up-and-down / rocking | 969 / 1342 Hz | 972 / 959 Hz | 307 / 303 Hz |
| Mallet's impulse / energy given | 0.042 N s / 18.9 mJ | 0.034 / 22.0 | 0.034 / 22.1 |
| Bar's kinetic energy at most: up-and-down / rocking | 7.1 / 1.3 mJ | 4.8 / 0.77 | 8.2 / 0.0000008 |
| Bending 1 / bending 2 / bending 3 | 4.0 / 6.2 / 0.009 mJ | 6.7 / 5.3 / 0.06 | 11.9 / 0.000000003 / 1.35 |
| Lowest bending mode: free / as mounted | 654 / **419 Hz** (-773 cents) | 663 / 659.9 (-8 cents) | 658.8 / 659.2 (+1 cent) |
| Its motion falls 20 dB in | 0.28 s | 0.32 s | 0.67 s |
| Pads' dampers took | 11 % | 13 % | 19 % |
| **Whole stroke:** peak / LAFmax | 4.34 Pa / 87.9 dB | 5.03 / 93.9 | 3.78 / 86.2 |
| Sound falls 20 dB in | 0.67 s | 0.68 s | 0.80 s |
| Strongest components, first 0.3 s | 419 Hz 0.74 Pa; 168 Hz 0.13 | 660 Hz 1.1 Pa; 485 Hz 0.22 | 659 Hz 0.38 Pa; 326 Hz 0.29 |
| Sound energy within 1 % of the bar's note | 69 % | 73 % | 20 % |
| Bar's note in the sound from 0.3 s on | 6.3 mPa | 18.6 mPa | 26.6 mPa |
| **Bar that cannot bend:** peak / LAFmax | 7.16 Pa / 92.4 dB | 6.52 / 91.7 | 4.89 / 87.8 |
| Its strongest components | 494, 169, 778 Hz | 487, 168, 672 Hz | 326, 166, 348 Hz |
| Whole stroke over mounting alone, sound energy | +0.1 dB | +3.3 dB | -1.7 dB |

### Root cause of the knock

- **It is momentum.** The mallet hands the bar 0.034 to 0.042 N s. The bar
  cannot keep it: it stands on the board, so the board receives all of it
  through the pads within a few milliseconds. A 54 g lump with no bending at
  all gives the same sound energy as the real bar, within 3 dB either way.
  The pads only decide how the push is spread in time.
- **Softer pads spread it out.** With a tenth of the stiffness the bar's
  bounce moves from near 490 Hz to 326 Hz and the knock alone falls from
  91.7 to 87.8 dB.
- **The mallet matters most.** The knock follows the impulse. A 5 g mallet
  at 1 m/s (a quarter of the mass, two thirds of the speed) gives 74.2 dB
  for the mounting alone: 13.6 dB less. Softer mallets do not help: at
  hardness 0.2 the stroke is as loud (86.6 dB) and the bar's note is weaker.

### A correction to Phase 3D.6

Phase 3D.6 called the first prototype's 419 Hz "the bar bouncing on its
pads, not a bar's note". That was wrong in part. The bar's lowest bending
mode itself moves at 419 Hz there: stiff pads a tenth of the way in pin the
bar near its ends, and a beam supported near its ends has a much lower
fundamental than a free one. The bar's up-and-down motion moves at the same
frequency because the two are one motion. So it is a bar's note, but a
supported bar's, 773 cents flat of the free bar's, tightly tied to the board
and gone in a third of a second. The measurements of Phase 3D.6 stand; its
description of this one has been corrected in THREE_BODY.md.

### Where the pads are

Tuned bar, struck at the middle, pads of 1e6 N/m and 5 N s/m:

| Pads at | Bar's note, cents from free | Its motion falls 20 dB in | In the sound from 0.3 s |
| --- | --- | --- | --- |
| 0.224 (the nodes) | 0 | 0.71 s (the bar's own material) | 4.9 mPa |
| 0.215 | -8 | 0.31 s | 16.6 mPa |
| 0.200 | -36 | 0.26 s | 4.6 mPa |

At the nodes the bar is left alone and the board hears little. A hundredth
of the bar's length off, its note reaches the board and is drained three
times faster. Further off it is detuned and drained without being heard
more. The metal bar's own decay law allows 0.71 s for 20 dB at this note;
nothing on pads can ring longer.

### Rigid-body and bending modes together

- Struck at 0.35, the bar rocks (1.3 and 0.77 mJ) and its second bending
  mode takes as much energy as its first. Struck at its middle it does not
  rock at all and the second mode is silent (tested): the stroke goes into
  up-and-down motion and the first and third bending modes.
- With stiff pads off the nodes, bending and rigid motion are one mode (the
  419 Hz case). With pads near the nodes they are separate: the bending note
  keeps its pitch and the rigid motion is the knock.

## 2. The pluck: why the string hardly reaches the bar

Pluck of 2 N: 5.08 mJ.

| | 3D.6 prototype | 3D.6 tuned | A | B |
| --- | --- | --- | --- | --- |
| Through the bridge: to the board / back / **net** | 0.164 / 0.098 / **0.066 mJ** | 0.165 / 0.099 / 0.066 | 0.319 / 0.218 / 0.101 | 0.314 / 0.180 / 0.133 |
| Net, of the pluck | 1.30 % | 1.29 % | 1.99 % | 2.63 % |
| Lost in the string itself | 98.7 % | 98.7 % | 98.0 % | 97.4 % |
| Through the pads: to the bar / back | 56.1 / 56.0 uJ | 65.4 / 64.7 | 116 / 116 | 234 / 234 |
| Net into the bar | 0.03 uJ | 0.72 uJ | 0.08 uJ | 0.58 uJ |
| Net, of what entered the board | 0.04 % | 1.09 % | 0.08 % | 0.43 % |
| Pads' dampers took | 1.4 uJ | 2.7 uJ | 9.9 uJ | 19.7 uJ |
| Bar's kinetic energy at most: up-and-down / rocking | 0.30 / 0.81 uJ | 0.50 / 0.70 | 0.44 / 1.85 | 2.0 / 2.2 |
| Bending 1 | 0.037 uJ | **0.236 uJ** | 0.019 uJ | 0.141 uJ |
| Bending 1, of the pluck | 0.0007 % | 0.0047 % | 0.0004 % | 0.0028 % |
| What bending adds to the sound at the 6th harmonic | +0.8 dB | **+3.8 dB** | +0.1 dB | +1.0 dB |

("What bending adds" compares each pluck with the same instrument whose bar
cannot bend, so the bar's weight on the board is the same in both.)

### Root cause

Three things multiply.

1. **The string keeps its energy.** Its wave impedance is 0.514 kg/s; the
   board under the approved bridge moves 8e-5 m/s per newton at the
   fundamental. Their product is 4e-5: each time a wave reaches the bridge
   the board takes about a ten-thousandth of it. Against the string's own
   losses, the board's mobility predicts that 2.0 % of a pluck reaches the
   board; 1.3 % was measured. This is the approved body as designed: the
   bridge stands on a nodal line so that the string sustains.
2. **The board is damped.** Of what enters it, about 1 % ends in the bar.
   The rest is taken by the plate, the air and the screen over the hole,
   which Phase 3C.2.3 added on purpose. Energy does cross the pads (65 uJ
   each way), but almost all of it comes straight back.
3. **The bar listens at one note.** Only the string's 6th harmonic is near
   it, and that harmonic holds about 1 % of a pluck's energy.

So the bar's bending never holds more than 0.005 % of a pluck. Checked
against the candidates in the brief:

| Possible cause | Finding |
| --- | --- |
| String bridge placement | **Yes, the largest single factor.** Off the nodal line 3 to 8 times more is predicted to enter the board (5.9, 12.1, 15.7 % at three other places) |
| Soundboard mode shapes | Yes: the bridge's place matters through them, and so does the bar's (0.5, 0.5) gives the bar ten times more than (0.5, 0.65) |
| Bar support positions | Yes, strongly: at the nodes the bending gets over a thousand times less than at 0.215 |
| Frequency mismatch | Yes: on the harmonic 0.0047 %; half a harmonic off, the bar's note does not appear in the sound (Phase 3D.6) |
| Joint stiffness | Yes: stiff pads (1e6) pass 50 times more to the bending than soft (1e5) |
| Joint damping | Little, up to 30 N s/m |
| Impedance mismatch | **The root:** string to board 4e-5, and a 54 g bar on a 672 g damped board |

## 3. Exploration

43 configurations, each plucked and struck; all without a fault, with at
most 7 solver iterations and the string within 0.7 cents of nominal. The
full table is in `measurements.json`. What it shows:

| Changed | Effect |
| --- | --- |
| Pad stiffness 1e4, 1e5, 1e6 N/m (pads at 0.215, 1 N s/m) | Stroke LAFmax 68.3, 86.4, 93.9 dB. Bar's note in the sound from 0.3 s: 1.5, 28.7, 18.4 mPa. Bar bending from a pluck: 0.000001, 0.00009, 0.0049 % |
| Pad damping 1, 5, 30 N s/m (1e5 N/m at 0.215) | Bar's note falls 20 dB in 0.67, 0.57, 0.32 s; in the sound 28.7, 18.4, 2.9 mPa. Pads take 19, 35, 53 % of the stroke |
| Pads at 0.224, 0.215, 0.2 | See section 1. At the nodes the pluck gives the bending nothing |
| Struck at 0.2, 0.35, 0.5 | Bar's note in the sound: 4.1, 15.7, 26.6 mPa. Pads take 47, 39, 19 % |
| Mallet hardness 0.2, 0.35, 0.5, 0.8 | Bar's note: 20.7, 26.4, 26.6, 3.7 mPa; LAFmax 86.6, 86.3, 86.2, 85.9 dB. Very hard is worse: the stroke goes into higher modes |
| Mallet 5 g, 10 g, 20 g at 1.5 m/s | LAFmax 78.4, 82.8, 86.2 dB; bar's note 10.3, 17.5, 26.6 mPa: both follow the mallet |
| Bridge at (0.08, 0.44), (0.15, 0.5), (0.3, 0.5) | Pluck 2.6, 6.4, 10.1 dB louder; the string takes 0.24, 1.1, 1.3 % of a stroke (0.03 % as approved); pitch -0.39, -0.37, +0.39 cents. See candidate B for the cost |
| Bar's middle at (0.5, 0.5), (0.25, 0.5), (0.3, 0.33) of the board | Bar bending from a pluck 0.0037, 0.00006, 0.0005 %; stroke LAFmax 86.4, 83.0, 80.9 dB |
| Bar 30 mm wide (81 g) | The string's fundamental falls 6.5 dB: the weight holds the board |

## 4. Candidates and tradeoffs

Defined in `src/experimental/string/stringBarBody.ts`.

- **A, soft mount.** The tuned bar on pads a tenth as stiff and lightly
  damped (1e5 N/m, 1 N s/m), still at 0.215 and 0.785; struck at its middle;
  0.6 mm longer so that its note as it stands is the string's 6th harmonic.
  The approved string, bridge and body.
- **B, soft mount and bridge moved.** A, with the string's bridge at
  (0.08, 0.44) of the board instead of the approved (0.08, 1/3). A different
  body, in this prototype only.
- **Light stroke.** A way of playing, not a design: a 5 g mallet at 1 m/s.

| | Approved string | 3D.6 prototype | 3D.6 tuned | **A** | **B** |
| --- | --- | --- | --- | --- | --- |
| **Pluck:** peak | 0.102 Pa | 0.086 | 0.097 | 0.103 | 0.164 |
| LAFmax (re approved) | 61.1 dB | -2.7 | -0.5 | **0.0** | +2.6 |
| String pitch | -0.54 cents | -0.48 | -0.48 | -0.48 | -0.39 |
| Fundamental re approved | | -1.9 dB | -2.2 | -2.7 | -0.6 |
| 3rd / 6th harmonic re approved | | +1.0 / -1.1 dB | -0.3 / +7.4 | +10.3 / -0.8 | **+23.7** / +0.3 |
| Sound energy 200-500 Hz | 11 % | 21 % | 13 % | 25 % | **72 %** |
| Time to LAFmax / to fall 20 dB | 0.12 / 1.0 s | 0.13 / 1.1 | 0.15 / 1.2 | 0.13 / 1.0 | 0.15 / 1.1 |
| **Stroke:** peak | | 4.34 Pa | 5.03 | 3.78 | 3.78 |
| LAFmax | | 87.9 dB | 93.9 | 86.2 | 86.2 |
| Time to LAFmax / to fall 20 dB | | 0.08 / 0.67 s | 0.07 / 0.68 | 0.06 / 0.80 | 0.06 / 0.79 |
| Bar's note, cents from the 6th harmonic | | -787 | +1.1 | -0.8 | -0.8 |
| Bar's note in the sound from 0.3 s | | 6.3 mPa | 18.6 | 26.6 | 23.5 |
| String's share of a stroke | | 0.24 % | 0.29 % | 0.03 % | 0.24 % |
| String's fundamental after a stroke | | 0.13 mPa | 0.11 | 0.12 | 0.16 |
| **Stroke over pluck**, standard | | 29.5 dB | 33.2 | 25.1 | 22.4 |
| Light stroke: LAFmax | | 79.8 dB | 82.3 | 74.9 | 74.9 |
| Stroke over pluck, light stroke | | 21.4 dB | 21.6 | **13.8** | 11.2 |

**What A gains and loses.**

- Gains: the stroke is 7.7 dB quieter than the tuned prototype's and lasts
  longer (0.80 s against 0.68 s); the bar's note is stronger after the
  first moment (26.6 against 18.6 mPa) and rings as long as the bar's
  material allows; the pluck is as loud as the approved instrument's to a
  tenth of a decibel.
- Loses: the bar no longer answers the string. Its bending gets 13 times
  less from a pluck than in the tuned prototype and adds nothing to the
  pluck's sound (+0.1 dB against +3.8 dB). The string takes a tenth as much
  from a stroke.
- Loses also: the knock is a larger share of the stroke's sound. Only 20 %
  of the sound energy is at the bar's note, against 73 % for the tuned
  prototype, whose stiff pads feed the note to the board at once.
- And the bar's weight on softer pads puts more of the pluck near 330 Hz
  (3rd harmonic +10.3 dB).

**What B shows.** With the bridge off the nodal line the string and the bar
hear each other more (the string takes 8 times more of a stroke; the bar's
bending gets 7.6 times more of a pluck than in A). But the string's 3rd
harmonic lands on the board's (1,3) mode at 331 Hz and rises 23.7 dB, and
72 % of the pluck's sound energy is then between 200 and 500 Hz. That is the
resonance the approved bridge position was chosen to avoid (Phase 3C.2.3).
**B is not recommended.** It is kept as the alternative because it shows
what stronger coupling costs in this body.

**No candidate is better on every count.** Stiff pads give a stroke whose
sound is mostly the bar's note, and let the bar colour a pluck, at the price
of a louder, shorter stroke. Soft pads give a quieter, longer stroke with a
longer note, at the price of a knock that is most of the stroke and a bar
that ignores the string. The tuned prototype of Phase 3D.6 and candidate A
are two ends of one trade, and the pads' stiffness is the dial between them.
The mallet is the lever that helps both: with the light stroke, A's stroke
is 13.8 dB above its pluck instead of 25.1 dB.

## 5. Mechanical verification of the candidates

| Check | A | B |
| --- | --- | --- |
| Energy with every loss removed, 0.3 s to 2 s: plucked, struck, both | constant to 1 part in a billion or better | the same |
| With losses: lost against what the engine counted, over half a second | within 1 part in a million; never rises | the same |
| Pads' dampers | take 19 % of a stroke; counted within the engine's total | the same |
| Energy both ways | pluck moves the bar; stroke moves the string | the same |
| A joint removed | passes exactly nothing; with the pads removed A is the approved string instrument sample for sample | passes exactly nothing; B without its pads is not the approved instrument, because its bridge is elsewhere |
| Solver | at most 3 iterations | at most 4 |
| String pitch | -0.48 cents | -0.39 cents |
| Same playing, same samples | yes | yes |
| 8 N plucks and 5 m/s strokes in turn for 5 s | no fault, bounded, dies away; also with the light mallet and with 1e4 N/m pads | the same |

## 6. Browser performance and the output device

Development test page (not the builder), Chrome 156 in the app's browser
pane, visible; 48 kHz; Ryzen 5 7430U on battery at 78 %, 11 % loaded. Each
case 20 s; plucked and struck in turn about ten times a second.

**The device first, with no physics engine** (`deviceBaseline(10)`), before
and after the instruments:

| | Before | After |
| --- | --- | --- |
| Empty AudioContext, 10 s | 1 dropout | 1 |
| Oscillator at no volume, 10 s | 1 dropout | 1 |

The output device is healthy in this session (yesterday it underran ten
times a second with no engine). One dropout per context is its floor here,
most likely at start-up.

**The instruments**, two runs of each:

| System | CPU, % of a core | Longest block | Blocks of 2 ms or more | Blocks made / due | Device dropouts | Faults | Solver iterations |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Approved string on its box | 15.8 / 16.2 | 2 / 2 ms | 4 / 2 | 7504 / 7504, 7515 / 7515 | 0 / 1 | 0 | 1 |
| 3D.6 prototype | 18.6 / 19.8 | 2 / 3 ms | 6 / 17 | 7504 / 7504, 7444 / 7444 | 0 / **19** | 0 | 4, 5 |
| Candidate A | 18.9 / 18.9 | 2 / 3 ms | 9 / 24 | 7515 / 7515, 7519 / 7519 | 1 / 0 | 0 | 3, 5 |
| Candidate B | 19.2 / 20.1 | 2 / 2 ms | 10 / 16 | 7504 / 7504, 7511 / 7511 | 0 / 0 | 0 | 6, 3 |
| Candidate A, pads edited 17 times a second | 19.1 / 18.2 | 2 / 2 ms | 8 / 14 | 7504 / 7504 twice | 0 / 0 | 0 | 6 |

Engine memory 3 145 728 bytes in every report. A block lasts 2.67 ms.

What this does and does not show:

- **With a healthy device the three-part instruments ran without dropouts
  in nine of ten runs**, at the device's floor of 0 or 1.
- **One run did not:** the Phase 3D.6 prototype's second run had 19 dropouts
  and made 7444 blocks where the others made about 7510. The candidates run
  just before and after it in the same batch had none. I cannot tell from
  one run whether that was the machine or the instrument, and I do not
  attribute it to either.
- **Slow blocks are real and more frequent than for the string instrument:**
  6 to 24 blocks of 2 ms or more in 7500 (0.1 to 0.3 %) against 2 to 4, and
  three runs had a block of 3 ms, which is longer than a block lasts. The
  clock reads whole milliseconds, so these are coarse.
- The candidates cost what the Phase 3D.6 prototype costs: about 18 % more
  than the string instrument (19 against 16 % of a core).
- **This is not evidence of real-time safety**, and I do not claim it. It is
  ten 20-second runs on one machine. What can be said is that the three-part
  prototype has less margin than the string instrument, and that occasional
  blocks reach or pass the time available.

In Node the candidates cost 12.4 and 13.0 % of a core against 13.0 % for the
string instrument in the same session; those figures were taken while other
work was running and are rougher than usual.

## 7. Listening files

`npm run render:three-body-mounting` writes ten sounds twice into
`renders/three-body-mounting/` (not committed): 4 s, 48 kHz, 24-bit, all
the body's sound pressure in pascals.

| File | True peak | LAFmax | Sound energy under 200 / 200-500 / 500-1000 / 1000-2000 Hz | `common/` (x0.207 per Pa, -13.7 dB) | `matched/` gain |
| --- | --- | --- | --- | --- | --- |
| 1-approved-string-and-body-plucked | 0.102 Pa | 61.1 dB | 26 / 11 / 32 / 29 % | -33.5 dBFS | +10.5 dB |
| 2-phase-3d6-prototype-string-plucked | 0.0858 Pa | 58.4 dB | 23 / 21 / 44 / 9 % | -35.0 dBFS | +12.7 dB |
| 3-phase-3d6-prototype-bar-struck | 4.34 Pa | 87.9 dB | 7 / 85 / 8 / 0 % | -0.9 dBFS | -14.7 dB |
| 4-candidate-A-string-plucked | 0.103 Pa | 61.1 dB | 14 / 25 / 31 / 28 % | -33.4 dBFS | +10.4 dB |
| 5-candidate-A-bar-struck | 3.78 Pa | 86.2 dB | 10 / 66 / 24 / 0 % | -2.1 dBFS | -13.1 dB |
| 6-candidate-A-both-together | 3.81 Pa | 86.2 dB | 10 / 66 / 24 / 0 % | -2.1 dBFS | -13.1 dB |
| 7a-candidate-B-string-plucked | 0.164 Pa | 63.8 dB | 7 / 72 / 10 / 11 % | -29.4 dBFS | +7.5 dB |
| 7b-candidate-B-bar-struck | 3.78 Pa | 86.2 dB | 10 / 66 / 24 / 0 % | -2.1 dBFS | -13.1 dB |
| 7c-candidate-B-both-together | 3.79 Pa | 86.1 dB | 10 / 66 / 24 / 0 % | -2.1 dBFS | -13.1 dB |
| 8-candidate-A-bar-struck-lightly | 1.10 Pa | 74.9 dB | 8 / 66 / 24 / 0 % | -12.9 dBFS | -1.7 dB |

- **`common/`: relative loudness.** Every file is multiplied by the same
  0.207 per pascal (the loudest peaks at 0.9). The plucks are 30 to 35 dB
  down in their files. Turn the playback up, not the file.
- **`matched/`: timbre.** Each file is scaled to the same A-weighted sound
  exposure. Loudness cannot be compared there.
- Measured spectral differences worth listening for: file 3 against 5 (the
  stroke's weight moves from 419 Hz to the bar's note at 659 Hz with a knock
  at 326 Hz under it); file 1 against 4 (more near 330 Hz, less under
  200 Hz); file 1 against 7a (the 330 Hz resonance: 72 % of the energy).
- In files 6 and 7c the pluck and the stroke start together, and the stroke
  covers the pluck's beginning.
- File 8 is candidate A played with the light stroke.
- One multiplication is all that is done to any file; all gains are in
  `listening.json`.

I have not heard any of them.

## 8. Tests and regressions

`tests/three-body-mounting.test.ts`, 17 tests: what the candidates are and
that the earlier configurations are untouched; the knock equals a rigid
lump's; the supported-beam note at 419 Hz; pad position (cents and level);
no rocking when struck at the middle; candidate A against the tuned
prototype; the light stroke; the string's share and its prediction from the
board's mobility; what reaches the bar; the bridge's effect; lossless
conservation; dissipation; both directions and joint removal; pitch and
fundamental; determinism; hard playing.

No existing test or assertion was changed. The Phase 3D.6 tests still pass
with the measurement harness extended (the bar's modes are now watched
through read-only ports). Results of the full run are in the phase report.
Reference WAV hashes are unchanged.

## 9. Limitations

- **The string-to-bar exchange was not improved.** It is limited by the
  approved body, and the one change that helps (the bridge) brings back a
  resonance that body was designed to remove.
- **The pads are a spring and a damper side by side.** Real felt or rubber
  damps about equally at all frequencies; this pad damps more the higher the
  frequency. So it cannot damp the low knock without damping the bar's note
  more. A pad with its own mass, or a spring and damper in series, would be
  a more faithful mount and might separate the two; that was not built.
- **No weight or preload:** the bar cannot lift off its pads or rattle.
- **The bar's ring is capped by the builder's metal-bar decay law** (20 dB
  in 0.71 s at 660 Hz), which was not changed.
- One bar, one board, one string. The search was a controlled set of 43
  configurations, not an optimization.
- Browser timing: ten short runs on one machine with a 1 ms clock.
- Levels are a meter's. No listening has been done.

## 10. Recommendation

1. **Listen before anything else.** The choice between the tuned prototype
   (files of Phase 3D.6) and candidate A (files 4 to 6 and 8 here) is a
   matter of taste the measurements cannot settle: a stroke that is mostly
   the bar's note but loud and short, or one that is quieter and longer with
   more knock in it.
2. **Keep the approved bridge position.** Candidate B is the evidence.
3. **Use a lighter stroke as the default for any three-part instrument.**
   It is the one change that helps every configuration, and it is physics
   the player controls.
4. **If the knock still matters after listening, the next physical step is
   a better pad model** (section 9), still in the isolated prototype.
5. **If the string and the bar are meant to answer each other strongly, this
   body is the wrong one for it.** That would be a different, livelier
   soundboard, which is a larger design question than this prototype.
6. Not ready for the builder, for the reasons given in Phase 3D.6, which
   still hold.

## 11. What followed (Phase 3D.8)

Recommendation 4 above was carried out: a pad with a relaxing path (a standard linear solid) was built and validated in the prototype. It moves the trade between knock and note by one to three decibels and costs a third more to compute, so the plain pad is kept. See [THREE_BODY_PADS.md](THREE_BODY_PADS.md).

## 12. A correction (Phase 3D.9)

Section 2 above reports that 98.7 % of a pluck is "lost in the string itself". That number is everything that did not pass through the bridge, as a share of the most the instrument held, and the label was wrong. Phase 3D.9 accounted for it fully: 47.8 % of that peak is taken back by the plucking force as it relaxes, and 50.9 % is lost in the string. The measurements and the conclusion (under 2 % of a pluck ever enters the board) are unchanged. See [THREE_BODY_ARCHITECTURE.md](THREE_BODY_ARCHITECTURE.md), which also describes an arrangement in which the string does reach the bar.
