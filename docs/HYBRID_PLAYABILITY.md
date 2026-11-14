# Why the radiated hybrid's pluck is quiet, and what physics can do about it (Phase 3D.5)

In the experimental example of Phase 3D.4 (a string tied to a metal bar,
heard as sound pressure a metre away; [RADIATOR.md](RADIATOR.md)) a pluck
is 42 dB below a mallet stroke. This phase measures why, tries every
physical property the instrument has, and ends with two research
candidates. It is research: **nothing was added to the builder, and no
existing instrument, example or model was changed.**

No gain, compression or EQ was used anywhere. A candidate is the same
instrument with ordinary properties set differently, all inside the ranges
the builder already allows.

I cannot hear audio. "Louder" below always means a measured level. The
pressures are a model's, in free air at 1 m and 45 degrees, uncalibrated.
The radiator takes no energy from the bar (no radiation reaction), so
mechanical energy and radiated sound are accounted for separately here and
are not claimed to balance.

Everything is reproducible: `npm run render:hybrid-study` writes
`renders/hybrid-study/measurements.json`, from which every number below is
taken, and `tests/hybrid-study.test.ts` asserts the main ones.

## 1. Levels used

| Measure | What it is |
| --- | --- |
| Peak | Largest instantaneous pressure. What Phase 3D.4 reported. |
| SEL | Sound exposure level: all the sound energy that arrived, dB re 20 uPa and 1 s. |
| SEL-A | The same, A-weighted. |
| LAFmax | Largest A-weighted level with a sound level meter's "fast" (125 ms) weighting. The closest of these to how loud a short sound seems; still a meter's reading, not a judgement of loudness. |

## 2. The 42 dB, step by step

Pluck: 4 N, softness 0.3. Stroke: 20 g mallet, hardness 0.5, 1.5 m/s. One
of each, followed for 4 s.

| Along the chain | Pluck | Stroke | Stroke over pluck |
| --- | --- | --- | --- |
| Energy put into the instrument | 20.3 mJ | 7.2 mJ (the mallet arrives with 22.5 mJ and leaves with 15.2) | **-4.5 dB** |
| Most the string held | 20.2 mJ | 1.08 mJ | |
| Most the bar held | 0.70 mJ (9.7 % of what was there) | 7.19 mJ | **+10.1 dB** |
| Bar velocity at the strike point, peak | 0.047 m/s | 0.308 m/s | +16.3 dB |
| Sound pressure, peak | 0.0096 Pa (53.7 dB) | 1.15 Pa (95.2 dB) | **+41.6 dB** |
| SEL | 36.2 dB | 77.8 dB | +41.7 dB |
| SEL-A | 34.7 dB | 79.0 dB | +44.3 dB |
| LAFmax | 39.8 dB | 85.4 dB | +45.6 dB |
| Time to LAFmax | 0.11 s | 0.08 s | |
| Time to fall 20 dB from it | 0.95 s | 0.65 s | |

**The difference is not smaller by energy or by a meter's ear than by
peak. It is larger:** 41.7 dB in sound energy and 45.6 dB in LAFmax, because
the stroke's sound sits near 3 kHz where A-weighting is most generous.

Where it comes from:

1. **Not the excitation.** The pluck puts in nearly three times the energy
   the mallet leaves behind (-4.5 dB the other way).
2. **The string keeps its energy.** After a pluck the bar never holds a
   tenth of it: 14.6 dB less of the energy put in reaches the bar than for a
   stroke, which goes straight into the bar.
3. **What reaches the bar is in the wrong mode: about 31 dB.** Per joule
   in the bar, the pluck makes 31.4 dB less sound.

   | Bar mode | Pluck: share of bar energy | Stroke: share |
   | --- | --- | --- |
   | 1, 327 Hz | 99.85 % | 31.2 % |
   | 2, 902 Hz | 0.14 % | 60.3 % |
   | 4, 2922 Hz | 0.00 % | 7.6 % |

   The stroke's sound is 95 % between 2 and 5 kHz: it is mostly mode 4.
   The string moves mode 4 two hundred times less than the mallet does.

-4.5 + 14.6 + 31.4 = 41.5 dB, against 41.7 measured.

**The joint.** After a pluck 4.62 mJ crosses from string to bar in all, but
the net work on the bar is never more than 0.85 mJ and ends at 0.51 mJ:
energy goes to and fro. Peak power through the joint 0.13 W. (With all
losses removed, the joint's net work equals the bar's energy to within 1 %,
which checks the measurement.)

**The comparison is with a hard, fast stroke.** The mallet matters more
than anything about the string:

| Mallet | Stroke LAFmax | Stroke over pluck |
| --- | --- | --- |
| As the example: hardness 0.5, 1.5 m/s | 85.4 dB | 45.6 dB |
| Hardness 0.15, 1.5 m/s | 58.3 dB | 18.5 dB |
| Hardness 0, 1.5 m/s (soft felt) | 43.7 dB | 4.0 dB |
| Hardness 0.5, 0.5 m/s | 69.4 dB | 29.7 dB |
| Hardness 0.5, 0.1 m/s | 45.3 dB | 5.5 dB |

A soft mallet excites the bar's low modes, as the string does, and is then
about as quiet as the string. So much of the 42 dB is the difference
between a gentle way of exciting the bar and a hard one, and a player
controls the second.

## 3. Why the bar radiates the string's motion so badly

By the Phase 3D.3 model, for the example's bar (0.40 m x 40 mm x 10 mm;
crossover 2636 Hz).

**Each mode at its own frequency:**

| Mode | Hz | Pa at the listener per m/s | Radiation efficiency | Reactive / radiated power | Wavelength / bar length | / bar width |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 327 | 0.055 | 3.2e-6 (-55 dB) | 58 000 | 2.6 | 26 |
| 2 | 902 | 0.92 | 8.8e-4 (-31 dB) | 590 | 0.95 | 9.5 |
| 3 | 1768 | 6.2 | 0.033 (-15 dB) | 31 | 0.49 | 4.9 |
| 4 | 2922 | 20.2 | 0.26 (-6 dB) | 6.6 | 0.29 | 2.9 |
| 5 | 4365 | 14.1 | 0.71 (-1.5 dB) | 3.6 | 0.20 | 2.0 |

**The lowest mode's shape, driven at the string's harmonics:**

| Harmonic | Hz | Pa per m/s | Efficiency | Reactive / radiated |
| --- | --- | --- | --- | --- |
| 1 | 110 | 0.0011 | 6e-10 (-92 dB) | 106 000 000 |
| 2 | 220 | 0.011 | 1.5e-7 (-68 dB) | 875 000 |
| 3 | 330 | 0.057 | 3.4e-6 (-55 dB) | 55 000 |
| 6 | 659 | 0.77 | 6.0e-4 (-32 dB) | 630 |
| 12 | 1319 | 5.8 | 0.037 (-14 dB) | 21 |
| 24 | 2638 | 7.2 | 0.34 (-5 dB) | 4.4 |

- *Efficiency* is sound power over that of a piston the size of the bar's
  face moving at the same mean-square velocity.
- *Reactive / radiated* is the power that goes back and forth in the air the
  bar drags with it, over the power that leaves as sound.

What this says:

- **Low-frequency motion of this bar is almost entirely reactive.** At its
  lowest note 58 000 times more power sloshes in the air beside the bar than
  leaves; at the string's fundamental, a hundred million times.
- **Two cancellations stack.** Across the bar, front and back cancel (a
  dipole: the wavelength is 26 to 78 bar widths). Along the bar, a free
  bar's mode pushes as much air one way as the other, so the dipoles cancel
  each other too until the wavelength is about the bar's length (near
  900 Hz). Below that, pressure per m/s rises about 20 dB per octave.
- **The string's fundamental cannot be heard through this bar at all.**
  Its component at 110 Hz is 0.18 uPa. What is heard of a pluck is the bar's
  own modes, rung by whichever harmonics of the string lie near them.

**Listener position** (frequency-domain reference, same recorded motion):

| Listener | Pluck LAFmax | Stroke LAFmax | Gap |
| --- | --- | --- | --- |
| 1 m, 0 degrees (straight in front) | 26.6 | 49.8 | 23.3 |
| 1 m, 30 degrees | 39.7 | 80.6 | 41.0 |
| 1 m, 45 degrees (the example) | 40.0 | 85.7 | 45.7 |
| 1 m, 60 degrees | 36.9 | 78.8 | 41.9 |
| 0.5 m, 45 degrees | 46.2 | 91.4 | 45.2 |
| 0.25 m, 45 degrees | 51.7 | 95.6 | 43.9 |
| 0.1 m, 45 degrees | 69.6 | 102.2 | 32.6 |

Moving the listener closer raises both together down to about 0.25 m; only
inside 0.1 m, in the near field, does the pluck gain on the stroke. Straight
in front the gap is smaller only because both are far quieter there. The
listener was left where it is.

The real-time radiator was compared with this reference again for every
candidate below (section 6): within 0.4 dB.

## 4. Every property, one at a time

Everything else as the example. Pluck LAFmax is 39.8 dB as it is. All 51
settings, plucked and struck: no faults, at most 4 solver iterations.

| Property | Values tried | Pluck LAFmax, dB | Note |
| --- | --- | --- | --- |
| String tension | 40, 60, 90, 120 N | 50.2, 43.0, 53.5, 43.4 | Not a trend: it is whichever harmonic lands on a bar mode |
| String length | 0.5, 0.58, 0.72, 0.8 m | 37.8, 37.3, 44.0, 41.0 | The same |
| Pluck position | 0.5, 0.65, 0.9, 0.95 | 39.2, 39.9, 39.4, 39.8 | No effect on level |
| Pluck force | 1, 8 N | 27.7, 45.8 | Exactly linear: 6 dB per doubling. Playing harder, not a design change |
| Pluck softness | 0, 1 | 43.4, 29.1 | A sharp pluck has more high harmonics: +3.6 dB |
| Bar length | 0.2, 0.3, 0.35, 0.5, 0.7 m | 49.7, 33.3, 43.1, 58.4, 58.4 | Tuning again. At 0.7 m the string's pitch moves 9 cents |
| Bar thickness | 2, 4, 6, 20 mm | 43.1, 48.4, 50.5, 42.3 | Thin bars pull the string's pitch: +7.4 and -6.7 cents at 2 and 4 mm |
| Bar width | 10, 20, 80, 200 mm | 34.3, 37.0, 42.7, 48.1 | Wider radiates more, and the stroke rises with it (gap 41 to 45 dB) |
| Bar material | steel, brass, bronze | 31.8, 37.4, 32.0 | Aluminium, the lightest, is best |
| Joint stiffness | 1e4, 1e5, 1e7, 1e8 N/m | 43.8, 40.0, 39.7, 39.7 | Soft joints detune the string: -19.6 cents at 1e4 |
| Joint damping | 1, 10, 100 N s/m | 38.6, 38.0, 39.3 | Only takes energy away |
| **Connection position** | 0, 0.05, 0.224, 0.35, 0.5 | **54.1**, 48.3, 50.6, 45.3, 50.3 | The example's 0.1 is the worst place tried |

Three things come out:

1. **Where the string is tied.** The example ties it a tenth of the way
   along the bar, close to where modes 2 to 4 hardly move. Every mode of a
   free bar moves most at its ends. Tied there the pluck is 14.4 dB louder
   and nothing else changes.
2. **Tuning.** Whenever a bar mode lies on a string harmonic the pluck jumps
   by 10 dB or more, and the higher the mode the more it radiates.
3. **Width** helps radiation directly but raises the stroke as much, makes
   the bar heavier, and at 200 mm the bar is half as wide as it is long:
   neither the beam model nor the strip-dipole radiation model was validated
   for that. Not pursued.

**Bar length in 5 mm steps, string tied at the end** (81 lengths, 0.20 to
0.60 m): pluck LAFmax ranges from 46.7 to 64.8 dB, mean 54.7. The peaks
are where modes meet harmonics:

| Bar length | Pluck LAFmax | Bar modes 1 to 5 as multiples of the string's pitch |
| --- | --- | --- |
| 0.485 m | 64.8 dB | 2.02, 5.58, 10.94, 18.08, 27.01 |
| 0.430 m | 64.6 dB | 2.58, 7.10, 13.92, 23.01, 34.37 |
| 0.440 m | 64.2 dB | 2.46, 6.78, 13.29, 21.97, 32.82 |
| 0.390 m | 63.6 dB | 3.13, 8.63, 16.92, 27.97, 41.78 |

## 5. The candidates

Defined in `src/experimental/radiation/hybridCandidates.ts`. Each differs
from the experimental example only in the bar: where the string is tied,
and for one its length. String, pluck, mallet, joint, listener, output gain
and the pressure ceiling are the example's (tested).

| | Example (3D.4) | **End-tied** | **End-tied and tuned** |
| --- | --- | --- | --- |
| Bar | 0.40 m, tied at 0.1 | 0.40 m, tied at 0 | 0.485 m, tied at 0 |
| Pluck, peak | 0.0096 Pa | 0.040 Pa | 0.119 Pa |
| Pluck, LAFmax | 39.8 dB | 54.1 dB (+14.4) | 64.8 dB (+25.1) |
| Pluck, SEL-A | 34.7 dB | 49.2 dB | 58.6 dB |
| Pluck sound energy, 1 to 2 kHz / 2 to 5 kHz | 6 % / 31 % | 65 % / 20 % | 34 % / 66 % |
| Stroke, LAFmax | 85.4 dB | 85.3 dB | 85.9 dB |
| Stroke over pluck, LAFmax | 45.6 dB | 31.2 dB | 21.1 dB |
| Stroke over pluck, peak | 41.6 dB | 29.1 dB | 23.0 dB |
| Most of the energy the bar held | 9.7 % | 13.3 % | 30.8 % |
| String pitch | -0.34 cents | -0.77 cents | -1.36 cents |
| Pluck: time to fall 20 dB | 0.95 s | 0.83 s | 0.71 s |

**Played differently** (properties of the string and the mallet, not of the
instrument):

| | Example | End-tied | Tuned |
| --- | --- | --- | --- |
| Sharp pluck (softness 0), LAFmax | 43.4 dB | 56.5 dB | 68.3 dB |
| Soft slow mallet (hardness 0.15, 1 m/s), LAFmax | 51.1 dB | 50.9 dB | 50.7 dB |
| Soft mallet over sharp pluck | +7.7 dB | -5.6 dB | -17.6 dB |

On the tuned candidate a sharp pluck is 17.6 dB below the hard stroke and
17.6 dB **above** a soft one: the two ways of playing overlap.

**Tradeoffs.**

- *End-tied* does not depend on tuning. Over 71.5 to 75.5 N of tension
  (-47 to +47 cents) its pluck stays between 53.1 and 62.4 dB, at least
  13 dB above the example as it is tuned. It is the smaller, safer change.
- *Tuned* is 10 dB louder again, but only near its tuning:

  | Tension | 71.5 | 72.5 | 73.0 | 73.5 | 74.0 | 74.5 | 75.5 N |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | Cents from 73.5 N | -47 | -24 | -12 | 0 | +12 | +23 | +47 |
  | Pluck LAFmax | 52.7 | 58.2 | 60.1 | 64.8 | 64.8 | 63.1 | 55.8 dB |

  Within about 12 cents it holds within 5 dB; 47 cents off it is back at the
  end-tied level. It never falls below that. A real instrument with
  sympathetic parts behaves this way.
- *Tuned* shortens the pluck's sound a little (0.71 s to fall 20 dB against
  0.95 s) and moves the string's pitch by 1.4 cents, because the bar takes
  nearly a third of the string's energy at the second harmonic.
- *Tuned* changes the stroke too: a longer bar is a lower bar (223 Hz
  against 327 Hz), and its stroke peaks at 1.68 Pa instead of 1.15 Pa.
- Neither makes the string's own pitch audible (section 3). What is heard
  of a pluck is higher bar modes ringing: for the tuned candidate mostly
  1988 Hz and 2969 Hz, the 18th and 27th harmonics of the string. It is in
  tune with the string, but it is the bar's voice.

## 6. Numerical verification

For the example and both candidates (`tests/hybrid-study.test.ts`, 15
tests):

| Check | Result |
| --- | --- |
| Mechanical energy with every loss removed, plucked and struck, from 0.3 s to 2.5 s | Constant to better than 1 part in a billion in all six cases |
| With losses: energy lost in one second against what the engine counted as dissipated, sample by sample | Agree to better than 1 part in a million; the energy never rises once. Also with a 10 N s/m damper in the joint |
| Solver | At most 3 iterations plucked or struck; within the tested bound of 6 when played as hard as the builder allows |
| String pitch | Within 1.4 cents of the string between fixed ends |
| Determinism | The same playing gives the same samples |
| Hard playing (8 N sharp plucks, 0.5 kg mallet at 5 m/s, each five times a second, 5 s) | No fault, never at the 16 Pa ceiling, dies away |
| Real-time radiator against the frequency-domain reference, on these bars | Peak -0.2 to -0.4 dB, sound energy -0.17 to -0.30 dB, strongest component -0.01 to -0.20 dB |

This is mechanical energy only. The sound's energy is not taken from the
bar, so no balance between the two is claimed.

## 7. In a real Chromium AudioWorklet

`radiatorBench(20, true)` on the test page: each design live for 20 s,
plucked and struck in turn about ten times a second, then the same while the
joint's stiffness and damping are changed about 17 times a second. 48 kHz,
Chrome 156 (the app's browser pane, visible). Ryzen 5 7430U on battery at
61 %, 18 % loaded by other programs.

| Design | Playing | CPU, % of a core | Longest block | Blocks of 2 ms or more | Blocks made / due | Device dropouts | Faults |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Example | played | 13.8 | 3 ms | 0 | 7507 / 7507 | 0 | 0 |
| | played and edited | 13.1 | 3 ms | 1 | 7504 / 7504 | 0 | 0 |
| End-tied | played | 13.6 | 2 ms | 1 | 7503 / 7503 | 0 | 0 |
| | played and edited | 13.0 | 2 ms | 0 | 7503 / 7503 | 0 | 0 |
| Tuned | played | 15.0 | 2 ms | 0 | 7507 / 7507 | 0 | 0 |
| | played and edited | 14.6 | 2 ms | 1 | 7500 / 7500 | 0 | 0 |

- Memory 3 145 728 bytes in every report. Worst solver iterations 2 or 3.
- "Longest block" is since the node was made, start-up included, by a clock
  that reads whole milliseconds; "blocks of 2 ms or more" counts only the
  20 s measured. A block lasts 2.67 ms.
- The candidates cost what the example costs: they are the same system
  with different numbers. In Node, 7.7, 8.0 and 7.9 % of a core.
- No block was missed and the device reported no dropout in 120 s. But one
  block in each of three runs took 2 ms or more, and one block in the
  example's runs reached 3 ms, which is longer than a block lasts. Two
  minutes on one machine do not establish real-time safety, and I do not
  claim it.

No second engine or radiator was written: these are the engine and the
processor of Phase 3D.4, unchanged.

## 8. Listening files

`npm run render:hybrid-study` writes two folders in `renders/hybrid-study/`
with the same nine sounds (4 s, 48 kHz, 24-bit). Renders are not committed.

| File | Unit | True peak | LAFmax | `matched/` gain | `common/` gain | Peak in `common/` |
| --- | --- | --- | --- | --- | --- | --- |
| 1-original-hybrid-plucked-velocity | m/s | 0.0472 | n/a | +23.5 dB | +25.6 dB (its own) | -0.9 dBFS |
| 2-radiated-example-plucked | Pa | 0.00963 | 39.8 dB | +39.3 dB | -5.4 dB | -45.7 dBFS |
| 3-radiated-example-struck | Pa | 1.15 | 85.4 dB | -5.1 dB | -5.4 dB | -4.2 dBFS |
| 4-tuned-candidate-plucked | Pa | 0.119 | 64.8 dB | +15.4 dB | -5.4 dB | -23.9 dBFS |
| 5-tuned-candidate-struck | Pa | 1.68 | 85.9 dB | -6.2 dB | -5.4 dB | -0.9 dBFS |
| 6a-end-tied-candidate-plucked | Pa | 0.0404 | 54.1 dB | +24.7 dB | -5.4 dB | -33.3 dBFS |
| 6b-end-tied-candidate-struck | Pa | 1.15 | 85.3 dB | -5.0 dB | -5.4 dB | -4.2 dBFS |
| 7-tuned-candidate-sharp-pluck | Pa | 0.165 | 68.3 dB | +12.0 dB | -5.4 dB | -21.0 dBFS |
| 8-tuned-candidate-soft-mallet | Pa | 0.0363 | 50.7 dB | +27.9 dB | -5.4 dB | -34.2 dBFS |

- **`matched/`: for timbre.** Every file is scaled to the same A-weighted
  sound exposure (the largest that keeps every peak at or below 0.9).
  Loudness cannot be compared here.
- **`common/`: for relative loudness.** Every pressure file is multiplied
  by the same 0.535 per pascal (the loudest peaks at 0.9). File 2 is then
  46 dB down in its file, which is the finding. Turn the playback up rather
  than the file.
- File 1 is a velocity, not a pressure. In `common/` it has its own gain and
  its level means nothing beside the others; it is there for its timbre.
- Files 6a and 6b are the alternative that shows the tradeoff: quieter than
  4 and 5, but not dependent on tuning. Files 7 and 8 are the best
  candidate played two other ways.
- Nothing but the one gain is applied to any file. All gains are in
  `listening.json`.

I have not heard any of them.

## 9. Should anything go into the builder

Nothing was integrated, as instructed.

**Does a candidate pass?** Both pass every numerical, physical and
performance check made. Both are defensible as physics: one moves a knot,
the other also changes a length. Whether either is *meaningful* is a
listening question I cannot answer: by the meter the tuned candidate's pluck
is 25 dB louder and its gap to the stroke is halved (45.6 to 21.1 dB).

**If approved, the proposal is one more separate example**, nothing else:

- A new entry in `RADIATION_EXAMPLES` (the list that already holds the
  Phase 3D.4 example), e.g. "A string tied to the end of a longer metal bar,
  heard as sound pressure", whose graph is `design(CANDIDATES.tuned)`.
- No new component, property, engine call or processor code: the candidate
  is a builder graph already, and every value is inside existing ranges.
- The existing hybrid, the Phase 3D.4 example and the radiation model stay
  exactly as they are.
- The end-tied candidate needs no example of its own: it is the existing
  example with Connection position set to 0, which a user can already do.

## 10. Limitations

- Levels are a meter's (peak, energy, A-weighted fast), not loudness as
  heard. No listening has been done.
- The pressure model is uncalibrated, free-field, one listener, and takes no
  energy from the bar.
- The bar has only its bending modes. A real free bar pushed slowly would
  also move as a whole; that is not in the model (nor in any approved bar).
- The tuned candidate's advantage depends on the bar's modes being where
  ideal beam theory puts them. A real bar's would differ by a few percent
  and would be tuned by hand.
- The search was one property at a time, then bar length with the string
  end-tied, at one string pitch. It is not a global optimum.
- Wide bars were measured but not pursued: outside what the models were
  validated for.
- Browser timing: two minutes, one machine, 1 ms clock.

## 11. Recommendation

1. **The 42 dB is real physics of this instrument, and understood.** A
   narrow bar is a very poor radiator of slow motion, the string mostly
   moves the bar's lowest mode, and the comparison was with a hard stroke.
2. **Tie the string at the bar's end** if one change is wanted: +14 dB for
   the pluck, robust, nothing else affected.
3. **The tuned candidate is the best found** and is ready to be offered as a
   separate experimental example, if its sound is approved by listening.
4. **The deeper limit remains:** through a bar, the string's own pitch is
   never heard. If the aim is a string that sounds like a string with a
   bar's colour, the string needs a real radiator: for example the string
   and bar standing on the existing damped box. That is a larger step and a
   decision for a later phase, not something to do here.
