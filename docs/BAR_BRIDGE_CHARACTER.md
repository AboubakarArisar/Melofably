# The bar-as-bridge instrument: its voices and how it answers to playing (Phase 3D.10)

Phase 3D.9 found one arrangement of string, metal bar and damped body in
which the string and the bar really exchange energy: the string is tied to
the bar, and the bar stands on the board where the bridge stood
(architecture B, `BAR_BRIDGE`). This phase asks what that instrument can be
made to do by physically justified changes: a bar tuned to another harmonic
of the string, the string tied at another place on the bar, a lighter
striker, and ordinary playing.

**It is an isolated study.** Nothing is in the builder. The production
engine, the processor, the approved instruments, the builder examples and
every playback gain are unchanged. `BAR_BRIDGE` itself is unchanged and is
the reference throughout. No output is filtered, compressed or boosted;
every sound is the approved body's radiated pressure and nothing else.

I cannot hear audio. Everything below is a measurement of a model. Where a
number is large or small I say so; whether the result is pleasant, bright,
metallic or musical is for you to decide by listening. Nothing here is a
listening approval.

Reproduce with `npm run render:bar-bridge`
(`renders/bar-bridge/measurements.json`, `performance.json`,
`manifest.json`) and `tests/bar-bridge-character.test.ts`.

**In short.**

- The bar can be tuned to other harmonics, but the effect is not "the
  reference, transposed". The reference bar (6th harmonic, 660 Hz) is the
  only one that makes a pluck clearly louder (+6 dB by the meter). A 440 Hz
  bar raises the 4th harmonic by 16 dB but most of that is the longer bar
  sitting on its pads, not its note, and the pluck is 2 dB *quieter* than
  the approved instrument. An 880 Hz bar changes a pluck very little. A
  330 Hz bar is rejected; a 550 Hz bar is not driven by the usual pluck.
- A bar tuned *exactly* to a harmonic removes that harmonic from the
  sustained sound (it acts as an absorber). A bar 8 to 15 cents flat adds to
  it. The reference bar happens to be 14 cents flat, which is why it works.
- The tie point is a usable setup adjustment between 0.224 and 0.18 of the
  bar's length. Outside that range the string stops being the same string.
- A 5 g striker in place of the 20 g mallet brings a medium stroke from
  23 dB above a 2 N pluck to 15 dB, and a gentle one to 9 dB, with nothing
  scaled. With the light striker the stroke is mostly the bar's note; with
  the 20 g mallet it is mostly the knock of the mallet on the board.
- A pluck is linear: plucking harder makes it louder and changes nothing
  else. *Where* the string is plucked decides whether the bar is heard at
  all (a factor of 70 in the 660 Hz component between the middle and three
  quarters of the string).
- All kept configurations conserve energy, are passive, are deterministic
  and stay bounded under hard playing. Cost is about 1.4 times the approved
  string instrument's.

## 1. Baseline

Before any change: 391 tests in 26 files passed, lint and build clean, the
four reference WAVs' hashes unchanged, working tree clean. Phase 3D.9 is
tagged `phase-3d9-approved` at `d3adbc6`.

The reference, measured again here (pluck 2 N at 0.8 of the string; stroke
20 g, hardness 0.5, 1.5 m/s; sound pressure 1 m in front of the board,
levels in dB re 20 µPa, LAFmax A-weighted with a 125 ms time constant):

| | approved string on its box | reference B, plucked | reference B, struck |
|---|---|---|---|
| peak | 0.102 Pa | 0.187 Pa | 5.51 Pa |
| LAFmax | 61.1 dB | 67.3 dB | 90.6 dB |
| time to fall 20 dB | 1.0 s | 0.88 s | 0.65 s |
| string pitch re 109.913 Hz | −0.54 cents | −0.73 cents | |
| fundamental re approved | | +0.5 dB | |
| 6th harmonic re approved | | +5.0 dB | |
| bar's bending, share of the pluck | | 0.098 % (5.0 µJ) | |
| string's share of the stroke | | | 3.86 % |
| bar's note as it stands | | | 660.28 Hz (+2.1 cents re 6th harmonic) |

One number from Phase 3D.9 needs a qualification. I reported that in the
first half second of a pluck the strongest component is 660 Hz at 32 mPa.
That is true, but the approved instrument, with no bar at all, already has
11 mPa there (the string's own 6th harmonic through the board). The bar
roughly triples it; it does not create it.

## 2. The bar on other harmonics

**Method.** All bars are the same aluminium, 5 mm thick, and are given the
reference bar's mass (54 g) by narrowing them as they lengthen, so that the
only thing changed is the note. Each was tuned *as it stands*: on its pads,
on the board, with the string cut loose, struck, and its length adjusted
until its lowest bending mode read the wanted frequency (the free bar's
frequency is 0.6 to 4 Hz higher). Then the string was tied on and the bar's
length was varied to put its note −30 to +30 cents from the harmonic.

Geometry is plausible in every case: 17 to 28 cm long, 14 to 23 mm wide,
the second pad at 0.28 to 0.40 of the board's length, on the board.

| bar for | length × width | note on pads, string tied | pluck LAFmax re approved | that harmonic re approved | largest rise elsewhere | bending, share of pluck | string's share of a stroke | verdict |
|---|---|---|---|---|---|---|---|---|
| 3rd, 330 Hz | 281.5 × 14.2 mm | 329.2 Hz | +1.1 dB | +8.0 dB | **4th: +22 dB** | 1.9 % | 4.3 % | rejected |
| 4th, 440 Hz | 243.7 × 16.4 mm | 440.2 Hz | −2.0 dB | +15.9 dB | 6th: +2.9 dB | 0.29 % | 3.3 % | kept, with a caveat |
| 5th, 550 Hz | 217.7 × 18.3 mm | 550.1 Hz | −0.7 dB | (see text) | 4th: +9.1 dB | 0.005 % | 1.4 % | rejected for this pluck |
| 6th, exactly | 198.6 × 20 mm | 658.1 Hz | +6.4 dB | **−11 dB** | 4th: +5.6 dB | 0.073 % | 3.6 % | not kept: absorbs |
| 6th, reference | 199.4 × 20 mm | 660.3 Hz | +6.2 dB | +5.0 dB | 4th: +5.8 dB | 0.098 % | 3.9 % | reference |
| 8th, exactly | 172.4 × 23.2 mm | 878.5 Hz | +0.2 dB | −1.2 dB | 7th: +1.7 dB | 0.20 % | 9.4 % | not kept: absorbs |
| 8th, 8 cents flat | 172.8 × 23.2 mm | 874.9 Hz | +0.2 dB | +5.2 dB | 7th: +2.0 dB | 0.084 % | 4.0 % | kept, subtle |

In every case the string's pitch is −0.73 cents, its fundamental within
0.5 dB of the approved instrument's, and 1.0 % of its energy remains after
a second (1.1 % on the approved instrument). Tuning the bar does not damage
the string.

**What the detuning scans show.**

- *Exact tuning absorbs.* With the bar exactly on the 6th harmonic, that
  harmonic over the whole note is 11 dB *below* the approved instrument's,
  and from one second on it is 55 dB below. The bar and the string's 6th
  mode become one pair of coupled modes; the bar's material and pads then
  drain what the string would have kept. The attack is still there (26 mPa
  in the first half second). The same happens at the 8th harmonic (−1.2 dB
  exact, +5 dB when 8 to 30 cents flat). Flat is better than sharp in both.
- *The reference is robust.* From −30 to +30 cents the 660 Hz bar keeps the
  pluck 3.2 to 6.7 dB louder than the approved instrument and the early
  660 Hz component at 16 to 33 mPa. Only the sustained harmonic is
  sensitive to tuning.
- *The 440 Hz rise is mostly not the bar's note.* With a bar of the same
  size that cannot bend, the 4th harmonic is already +10 dB; bending adds
  5.7 dB. It grows with the bar's length whatever the bar is tuned to
  (reference bar +5.8 dB, 550 Hz bar +9 dB, 330 Hz bar +22 dB, of which
  +13 dB without bending). So there is a resonance of the bar-on-pads-on-
  board system near 440 Hz that longer bars excite more. I have measured
  that it exists and that it is not the bending mode; I have not isolated
  which mode it is. Across the detuning scan the 440 Hz bar's 4th harmonic
  wanders between +5 and +16 dB without a clear pattern, which is the same
  thing seen from another side.

**Verdicts.**

- **330 Hz: rejected.** It has the strongest exchange of all (1.9 % of a
  pluck into bending), but the unwanted 440 Hz component is +22 dB
  whatever the tuning, and still +26 dB with a heavier bar on stiffer pads.
  That is the "unwanted soundboard resonance" the brief asks to reject.
- **440 Hz: kept as `BAR_BRIDGE_440`, with the caveat above.** It is a
  measurably different spectrum from the reference (4th harmonic 2.4 mPa
  against 0.76; 660 Hz early component 19 mPa against 32; pluck 8 dB
  quieter than the reference by the meter; falls 20 dB in 1.2 s against
  0.88 s). Whether "quieter and with more 4th harmonic" is a voice worth
  having is a listening question.
- **550 Hz: rejected for the usual pluck.** A string plucked at 0.8 of its
  length has no 5th harmonic, so nothing drives the bar (0.005 % of the
  pluck). The "+43 dB" in the measurements file is relative to an approved
  value of 0.001 mPa and means nothing. Struck, this bar rings longest
  (0.65 s to fall 20 dB) precisely because the string does not take its
  energy. It would need a different pluck position to be a string-and-bar
  instrument.
- **880 Hz: kept as `BAR_BRIDGE_880`, 8 cents flat, as the higher-harmonic
  candidate, but it is weak.** Its effect on a pluck is small: +5 dB at
  the 8th harmonic (1.35 mPa beside a 6 mPa fundamental), meter reading
  unchanged. And that rise is not the bar's note: a bar of the same size
  that cannot bend gives 2 dB *more* there. The bending mode only takes
  away (a little when flat, 6 dB when exact). It also loses the
  reference's 660 Hz presence (9 mPa early, below the approved
  instrument's 11) and its 3rd harmonic is 11 dB down. Struck, it does ring
  at 875 Hz. I expect it to be hard to tell from the approved instrument
  when plucked, and say so as an estimate, not a measurement.

I did not force every target to work. Two of five are kept; one of those is
subtle and the other carries a caveat.

## 3. Where the string is tied

The reference bar, the string tied at ten places from 0.224 (just outside
the pad at 0.215) to 0.1 of the bar's length. "Z × Y" is the string's wave
impedance times the free bar's mobility at the tie point (dimensionless;
larger means the string moves the bar more easily).

| tied at | Z × Y at 660 Hz | pitch | fundamental re approved | 6th harm. re approved | LAFmax re approved | 500–1000 Hz share of sound energy | bending, share of pluck | string's share of a stroke |
|---|---|---|---|---|---|---|---|---|
| 0.224 | 0.004 | −0.71 c | +1.2 dB | +5.3 dB | +5.2 dB | 48 % | 0.023 % | 0.97 % |
| 0.215 | 0.007 | −0.71 c | +0.9 dB | +6.4 dB | +5.6 dB | 56 % | 0.046 % | 1.9 % |
| 0.21 | 0.011 | −0.72 c | +0.8 dB | +6.2 dB | +5.8 dB | 60 % | 0.061 % | 2.5 % |
| **0.2 (reference)** | 0.025 | −0.73 c | +0.5 dB | +5.0 dB | +6.2 dB | 66 % | 0.098 % | 3.9 % |
| 0.19 | 0.047 | −0.74 c | +0.1 dB | +4.7 dB | +6.4 dB | 70 % | 0.14 % | 5.3 % |
| **0.18 (kept)** | 0.077 | −0.77 c | −0.2 dB | +2.1 dB | +6.4 dB | 73 % | 0.18 % | 6.8 % |
| 0.165 | 0.14 | −0.81 c | −0.8 dB | +0.4 dB | +6.2 dB | 79 % | 0.23 % | 8.5 % |
| 0.15 | 0.22 | −0.87 c | −1.4 dB | −2.0 dB | +5.8 dB | 84 % | 0.29 % | 11 % |
| 0.125 | 0.40 | −0.99 c | −2.6 dB | −7.4 dB | +5.4 dB | 90 % | 0.36 % | 13 % |
| 0.1 | 0.64 | −1.16 c | −4.0 dB | −6.6 dB | +6.1 dB | 84 % | 0.44 % | 15 % |

Attack (0.08 to 0.13 s to LAFmax) and decay (0.76 to 0.94 s to fall 20 dB)
hardly move. The solver needs at most 3 iterations and reports no fault
anywhere.

**Is it a tone control?** Between 0.224 and 0.18 every energy measure rises
smoothly and monotonically, the share of sound energy in the 500–1000 Hz
band goes from 48 % to 73 %, and the string stays within 0.1 cent and
1.5 dB of itself. That is a stable, usable range. Beyond 0.18 the sustained
6th harmonic falls (the bar begins to absorb it, as in section 2), the
fundamental drops, the pitch drifts past a cent, and the band share stops
being monotonic. So:

- It is a **setup adjustment with a stable range of 0.224 to 0.18**, not a
  wide continuous control, and I do not describe it as one.
- Its effect on a pluck's overall level is small (5.2 to 6.4 dB above the
  approved instrument across the whole table). What it changes is how much
  of the sound is in the bar's band, and how much the struck bar feeds the
  string (1 % to 7 %).
- It cannot be moved while playing in any physical sense; retying a string
  is not a gesture.

`BAR_BRIDGE_FIRMER_TIE` (0.18) is kept as the far end of the stable range:
twice the reference's bending share, 1.8 times the string's share of a
stroke, fundamental −0.2 dB, pitch −0.77 cents.

A detail for honesty: the struck bar's strongest component jumps between
about −10 and +4 cents of the 6th harmonic along this table. Bar and string
form two coupled modes a few hertz apart and the measurement reports
whichever is stronger; it is not the bar changing pitch.

## 4. Striking

The 20 g mallet at 1.5 m/s of earlier phases is a heavy blow for a 54 g
bar. The question was whether a lighter, slower striker, which is what a
player would actually use on a bar this size, brings strokes and plucks
closer. Nothing is scaled: the striker is a mass with a Hertzian contact,
launched at a speed, and the sound is whatever comes out.

**Mass and speed** (hardness 0.5, struck at the middle of the bar; "over
pluck" is LAFmax above the 2 N pluck's 67.3 dB):

| striker | momentum | energy | contact | peak force | LAFmax | over pluck | knock alone | bar's note, share of sound energy | string's share |
|---|---|---|---|---|---|---|---|---|---|
| 2 g, 0.5 m/s | 1 g·m/s | 0.25 mJ | 0.21 ms | 17 N | 70.6 dB | +3.2 dB | 63.6 dB | 37 % | 6.5 % |
| 2 g, 1 m/s | 2 | 1 mJ | 0.19 ms | 37 N | 77.0 dB | +9.7 dB | 69.6 dB | 35 % | 6.1 % |
| 5 g, 0.5 m/s (gentle) | 2.5 | 0.63 mJ | 0.29 ms | 27 N | 75.9 dB | +8.6 dB | 70.8 dB | 44 % | 7.5 % |
| 5 g, 1 m/s (medium) | 5 | 2.5 mJ | 0.25 ms | 60 N | 82.5 dB | +15.2 dB | 77.0 dB | 41 % | 7.0 % |
| 5 g, 2 m/s (strong) | 10 | 10 mJ | 0.21 ms | 136 N | 89.0 dB | +21.7 dB | 83.1 dB | 38 % | 6.6 % |
| 10 g, 1 m/s | 10 | 5 mJ | 0.31 ms | 81 N | 85.9 dB | +18.6 dB | 82.1 dB | 47 % | 7.8 % |
| 20 g, 1 m/s | 20 | 10 mJ | 0.79 ms | 103 N | 86.7 dB | +19.4 dB | 86.7 dB | 35 % | 4.3 % |
| 20 g, 1.5 m/s (earlier phases) | 30 | 22.5 mJ | 0.75 ms | 164 N | 90.6 dB | +23.3 dB | 90.4 dB | 31 % | 3.9 % |

"Knock alone" is the same stroke on a bar of the same mass that cannot
bend: the part of the sound that is the striker's momentum reaching the
board. (The full grid, with 2 m/s for every mass, is in
`measurements.json`.)

What this shows:

- **The imbalance is reduced physically.** The medium light stroke is
  15 dB above the pluck instead of 23; the gentle one 9 dB; a 2 g striker
  at 0.5 m/s 3 dB. A firm pluck (8 N: 79.4 dB) is louder than a gentle
  stroke (75.9 dB), so the two ranges now overlap. They are not equal, and
  I have not made them equal.
- **The character of the stroke changes, not only its level.** With the
  20 g mallet the knock alone is as loud as the whole stroke (90.4 against
  90.6 dB): the meter is reading the thump. With the 5 g striker the knock
  is 5.5 dB below the whole: the bar's note is most of what is measured,
  and it holds 38 to 44 % of the sound's energy instead of 31 %.
- **It is a real collision.** Striking harder shortens the contact (0.29 to
  0.21 ms) and raises the peak force faster than the speed (5.1 times for
  4 times the speed), so loudness rises 6.5 dB per doubling of speed, a
  little more than the 6.0 a linear system would give, and the bar's
  note's share falls slightly. That is a small, physical dynamic change of
  timbre.

**Hardness** (5 g at 1 m/s): from 0.2 to 0.8 the contact shortens from 0.75
to 0.08 ms, LAFmax rises from 79.6 to 84.1 dB, and the bar's note's share
of the sound falls from 54 % to 29 %.

**Where it is struck** (5 g at 1 m/s): at the middle the bar's note is 41 %
of the sound; at 0.35 it is 13 %; at 0.2 (near a node of the bending mode)
4 %, and the stroke is mostly knock; at 0.05 (the free end) 29 %, with the
string taking 8.9 %. The middle is the place to strike it for its note.

`LIGHT_STRIKER` (5 g, hardness 0.5) and `STROKES` (0.5, 1, 2 m/s) are kept
as the gentle, medium and strong strokes. The 20 g mallet remains the
default of `BAR_BRIDGE`, unchanged.

## 5. Playing it

Only mechanisms that already exist were used: the pluck, the mallet
launch, the finger on the string, and the pluck that rests a finger first
(retrigger). No sequencer, MIDI or keyboard was added; the phrases are
lists of timed events in the analysis harness.

**Plucking harder or softer.** 0.5, 2 and 8 N give 55.3, 67.3 and 79.4 dB:
exactly 12.04 dB per fourfold force. The bar's share of the pluck (0.0983 %)
and the string's pitch (−0.73 cents) are identical at all three. The model
of a pluck is linear, so plucking dynamics change loudness and nothing
else. That is a limitation worth knowing: on a real string a hard pluck is
also brighter. It is a property of the approved string's pluck, not of
architecture B.

**Plucking in another place.** This is the strong tone control:

| plucked at | LAFmax | 660 Hz in the first half second | fundamental | 500–1000 Hz share | bending, share of pluck |
|---|---|---|---|---|---|
| 0.5 (middle) | 66.0 dB | 0.8 mPa | 10.7 mPa | 36 % | 0.002 % |
| 0.65 | 62.9 dB | 16.5 mPa | 9.6 mPa | 59 % | 0.021 % |
| 0.75 | 69.2 dB | 56.2 mPa | 7.6 mPa | 83 % | 0.20 % |
| 0.8 (usual) | 67.3 dB | 32.2 mPa | 6.3 mPa | 66 % | 0.098 % |
| 0.85 | 65.5 dB | 18.4 mPa | 4.9 mPa | 40 % | 0.030 % |
| 0.9 | 69.1 dB | 53.8 mPa | 3.3 mPa | 88 % | 0.47 % |

It follows the string's own shape: a pluck at a node of the 6th harmonic
(1/2, 2/3, 5/6 of the string) gives the bar nothing; halfway between nodes
gives it the most. The player can bring the bar in or leave it out by
where they pluck. It is not a smooth control (it rises and falls three
times between 0.5 and 0.9), but it is a real one and it costs nothing.

**Phrases.**

| what was played | peak | largest step between samples / peak | energy left at the end | worst solver iterations | faults |
|---|---|---|---|---|---|
| 12 plucks, four a second | 0.218 Pa | 0.12 | 0.0001 % | 1 | 0 |
| the same, each retriggered (finger rests 30 ms) | 0.189 Pa | 0.13 | 0.0002 % | 1 | 0 |
| 12 medium light strokes, four a second | 1.98 Pa | 0.36 | < 0.0001 % | 3 | 0 |
| pluck, medium, pluck, gentle, 4 N pluck, strong, 0.75 s apart | 4.14 Pa | 0.38 | 0.0005 % | 3 | 0 |
| pluck and medium stroke at the same instant | 1.91 Pa | 0.36 | < 0.0001 % | 3 | 0 |
| pluck, finger laid on the string at 0.5 s | 0.187 Pa | 0.13 | < 0.0001 % | 1 | 0 |
| medium stroke, finger on the string at 0.2 s | 1.90 Pa | 0.36 | < 0.0001 % | 3 | 0 |
| one pluck left alone for 8 s | 0.187 Pa | 0.13 | 3 × 10⁻¹² % | 1 | 0 |
| 8 N plucks and 5 m/s strokes of the 20 g mallet, ten a second | 23.3 Pa | 0.41 | 0.0004 % | 3 | 0 |

- Repeated plucks build up by 17 % in peak over a single pluck (0.218
  against 0.187 Pa); retriggered ones do not (0.189 Pa). Nothing runs away.
- A single pluck is last above −20 dB of its peak at 0.80 s, −40 dB at
  1.62 s and −60 dB at 2.76 s. It dies away smoothly to nothing.
- A finger on the string after a pluck leaves 7 × 10⁻⁷ µJ in the string.
  Muting the string after a *stroke* does little to the sound, because the
  stroke's sound is the bar and the board; there is no way in the present
  model to damp the bar with a hand. That is a gap for a playable
  instrument and is noted under limitations.
- Played together, pluck and stroke give the stroke's level (82.3 dB
  against 82.5): the stroke covers the pluck. In the phrase the plucks are
  9 to 16 dB below the strokes around them.
- No step between samples exceeds 0.41 of the peak anywhere: there is no
  discontinuity.

## 6. Physical and numerical integrity

For `BAR_BRIDGE_440`, `BAR_BRIDGE_880` and `BAR_BRIDGE_FIRMER_TIE`, with
the light striker (tests in `tests/bar-bridge-character.test.ts`):

| check | result |
|---|---|
| every loss removed, plucked and struck: energy over 1.7 s | constant to better than 1 part in 10⁹ |
| with losses: does total energy ever rise sample to sample over 0.5 s | never |
| with losses: energy that left against energy counted as dissipated | agree to 1 part in 10⁶ |
| energy through the tie, both directions, on a pluck | both above 0.1 mJ (e.g. firmer tie: 0.52 mJ forward, 0.40 mJ back) |
| struck bar moves the string | more than 2 % of what the striker gave in each (7.0 % on the reference bar) |
| string cut loose, plucked | bar and board receive exactly 0 |
| string cut loose, bar struck | string receives exactly 0 |
| pads removed, plucked | radiated pressure exactly 0 |
| solver | at most 3 iterations in these runs (5 at most anywhere in the study: a 2 g striker); no fault |
| same phrase twice | identical sample for sample |
| hard playing (8 N, 5 m/s, 20 g, ten a second, 3 s) | bounded, no fault, no clipping at a 64 Pa ceiling, energy decays to < 2 % |
| string pitch | −0.73, −0.73, −0.77 cents |
| units | pressure in Pa at 1 m; energies in J; forces N; the manifest states every gain |

The striker never gives more than it had (the 5 g striker gives 66 to 72 %
of its kinetic energy; the rest it keeps in rebounding).

No existing test was changed or weakened. The earlier configurations
(`TUNED`, `SOFT_MOUNT`, `VISCO_MOUNT`, `SHARED_POINT`, `BAR_BRIDGE`) are
untouched and their tests pass as before.

## 7. Performance

**Node** (the real processor, 20 s of audio, plucked and struck in turn
five times a second; median of five timed runs after one warm-up; percent
of one core; this machine, on mains):

| system | median | lowest – highest | connections | worst iterations |
|---|---|---|---|---|
| approved string on its box | 10.95 % | 9.82 – 12.63 | 4 | 1 |
| reference B, 20 g mallet | 15.70 % | 14.13 – 17.07 | 8 | 3 |
| reference B, light striker | 14.17 % | 14.10 – 14.69 | 8 | 3 |
| 440 Hz bar | 14.63 % | 14.16 – 20.61 | 8 | 3 |
| 880 Hz bar | 15.30 % | 14.06 – 15.96 | 8 | 3 |
| firmer tie | 14.51 % | 14.17 – 14.65 | 8 | 3 |

The new configurations cost the same as reference B, as they must: they
are the same resonators and connections with other numbers. The spread
between runs (one run of the 440 Hz bar at 20.6 %) is larger than any
difference between configurations. Engine memory is 3,145,728 bytes
throughout.

**Chromium AudioWorklet** (the experimental page, 48 kHz, 128-frame blocks
of 2.67 ms, 20 s each, the 20 g mallet; two complete runs; no change to
the production engine was needed):

| system | engine CPU, run 1 / run 2 | longest block | blocks ≥ 2 ms | blocks missed | device dropouts | worst iterations |
|---|---|---|---|---|---|---|
| empty AudioContext, 10 s (control) | — | — | — | — | 1 / 1 | — |
| oscillator only, 10 s (control) | — | — | — | — | 1 / 1 | — |
| approved string on its box | 15.1 % / 14.2 % | 2 / 3 ms | 10 / 25 | 0 / 0 | 0 / 1 | 1 |
| reference B | 20.6 % / 20.2 % | 3 / 3 ms | 9 / 17 | 0 / 0 | 0 / 1 | 6 / 5 |
| 440 Hz bar | 20.6 % / 18.9 % | 3 / 3 ms | 23 / 10 | 0 / 0 | 1 / 1 | 7 / 4 |
| 880 Hz bar | 19.8 % / 19.2 % | 2 / 3 ms | 5 / 12 | 0 / 0 | 0 / 0 | 4 / 3 |
| firmer tie | 18.7 % / 19.8 % | 3 / 3 ms | 23 / 5 | 0 / 0 | 1 / 0 | 3 / 4 |

Reading this honestly:

- Average cost is about 20 % of a core, 1.35 times the approved string
  instrument, and the same for every configuration within run-to-run
  variation.
- Every block that was due was processed. No sample was non-finite.
- The block timer has 1 ms resolution. "3 ms" means a block took between 3
  and 4 ms, which is over the 2.67 ms budget, and it happened for the
  approved instrument as well. The output device reported one dropout in
  ten seconds with *no engine at all*. So the dropouts seen (0 or 1 per
  20 s) cannot be attributed to the engine, and equally I cannot say the
  engine never causes one.
- **I do not claim real-time safety.** The average leaves ample headroom;
  the worst blocks do not prove it, on this machine, in this embedded
  Chromium. This is the same position as in Phases 3D.6 to 3D.9.

## 8. Listening files

`renders/bar-bridge/common/` (one gain for all, to compare loudness) and
`renders/bar-bridge/matched/` (each scaled to the same A-weighted sound
exposure, to compare timbre). 48 kHz, 24 bit, mono. One multiplication per
file and nothing else. `manifest.json` gives, for each: physical
parameters, excitation, peak in Pa, levels, harmonics 1 to 8, energy by
band, energy transfer, and both gains.

| file | what | peak | LAFmax | common: peak in file | matched gain |
|---|---|---|---|---|---|
| 01-approved-string-and-body-plucked | the approved instrument | 0.102 Pa | 61.1 dB | −33.1 dBFS | +12.2 dB |
| 02-reference-B-bar-as-bridge-660-plucked | 3D.9 reference | 0.187 Pa | 67.3 dB | −27.8 | +6.8 |
| 03-lower-harmonic-440-bar-plucked | 440 Hz bar | 0.106 Pa | 59.1 dB | −32.8 | +13.3 |
| 04-higher-harmonic-880-bar-plucked | 880 Hz bar, 8 c flat | 0.127 Pa | 61.3 dB | −31.2 | +12.0 |
| 05-firmer-tie-0p18-plucked | reference bar, tied at 0.18 | 0.200 Pa | 67.5 dB | −27.2 | +6.7 |
| 06-gentle-strike | 5 g at 0.5 m/s | 0.867 Pa | 75.9 dB | −14.5 | −0.3 |
| 07-medium-strike | 5 g at 1 m/s | 1.90 Pa | 82.5 dB | −7.7 | −6.8 |
| 08-strong-strike | 5 g at 2 m/s | 4.12 Pa | 89.0 dB | −1.0 | −13.2 |
| 09-phrase-plucks-and-strikes-in-turn | pluck, medium, pluck, gentle, 4 N pluck, strong | 4.14 Pa | 89.0 dB | −0.9 | −14.5 |
| 10-pluck-and-medium-strike-together | at the same instant | 1.91 Pa | 82.3 dB | −7.6 | −6.8 |

(Matched gains are in dB re 1 per pascal; on the same scale the common
gain is -13.3 dB, 0.217 per pascal. The manifest holds the factors.)

Suggested order for listening: in `matched/`, 01 against 02, 03, 04 and 05
for timbre; in `common/`, 02 then 06, 07, 08 for how far apart a pluck and
the three strokes are; then 09 and 10. The plucked files in `common/` are
quiet (−27 to −33 dBFS) because the strong stroke sets the gain; that is
the imbalance, shown rather than hidden. Files 09 and 10 were rendered at
the playing harness's 64 Pa ceiling and the others at 16 Pa; both are far
above every peak, and the pressures are the same either way.

None of these has been heard by me.

## 9. Regression

- Unchanged and verified by hash: the four reference WAVs.
- Not modified: `assembly/engine.ts`, the processor, `src/audio/**`,
  `src/App.tsx`, `src/builder/**`, the builder examples, the Phase 3D.3
  engine fixture.
- `BAR_BRIDGE` and every earlier research configuration: unchanged; a test
  asserts that `barBridgeWith({})` reproduces `BAR_BRIDGE` exactly.
- Changed: `stringBarBody.ts` gains five exported constants, one helper and
  one `export` keyword; `analysis/three-body.ts` gains two fields on a
  measurement (`contactSeconds`, `contactForcePeak`) and `retriggerAt`; the
  experimental test page's `threeBodyBench` gains a `'character'` option.
- The suite is 404 tests in 27 files (391 + 13 new).

## 10. Decision gate

1. **Can architecture B produce several meaningfully different physical
   timbres?** By measurement, a few, and fewer than I hoped. Changing the
   bar's harmonic gives one clearly different spectrum (440 Hz) and one
   barely different (880 Hz). The larger differences come from how it is
   played: pluck position (the bar's band from 36 % to 88 % of the sound)
   and the striker (note-dominated or knock-dominated strokes). Whether
   any of these differences is *meaningful* is a listening judgment.
2. **Which harmonic tunings are viable?** The 6th (reference). The 4th,
   with the caveat that most of its effect is a mount resonance and it is
   quieter. The 8th, subtly. Not the 3rd (unwanted +22 dB at 440 Hz). Not
   the 5th with the usual pluck. In every case the bar should sit 8 to 15
   cents flat of the harmonic, never exactly on it.
3. **Is attachment position a useful tone parameter?** As a setup
   adjustment within 0.224 to 0.18 of the bar, yes: stable, monotonic, the
   string unharmed. Not as a wide or a live control.
4. **Can physically lighter strikes reduce the imbalance?** Yes: from
   23 dB to 15 dB (medium) and 9 dB (gentle) with a 5 g striker, 3 dB with
   2 g at 0.5 m/s, and the stroke becomes the bar's note more than a knock.
   A gap remains at medium and strong strokes, and it is real.
5. **Does the string retain a recognizable fundamental and stable pitch?**
   By measurement, yes, in every kept configuration: pitch within 0.8 cent,
   fundamental within 0.5 dB, sustain kept. "Recognizable" is for the ear.
6. **Does the bar contribute meaningful resonance?** In the reference and
   the firmer tie: its bending adds 9 to 12 dB at 660 Hz to a pluck and it
   is 38 to 44 % of a light stroke's sound. In the 440 and 880 Hz bars its
   contribution to a pluck is small (bending adds 5.7 dB at 440 Hz; the
   880 Hz bar's bending adds nothing over a bar that cannot bend). Struck,
   every bar rings at its own note.
7. **Are the configurations stable and robust?** Yes: conservative,
   passive, deterministic, bounded under hard playing, at most 5 solver
   iterations in measurement runs (up to 7 in the browser under repeated
   plucks and strokes), no fault anywhere. The reference is also robust to
   ±30 cents of bar tuning in its attack and level.
8. **Is performance practical?** On average, yes (about 20 % of a core in
   Chromium, 14 to 16 % in Node). Real-time safety is not demonstrated;
   see section 7.
9. **Which deserve listening?** The reference (02) and the firmer tie (05)
   against the approved instrument (01); the 440 Hz bar (03) to decide
   whether its quieter, 4th-harmonic spectrum is a voice or a defect; the
   three light strokes (06 to 08) and the phrase (09). I would give the
   880 Hz bar (04) the lowest priority.
10. **Is there enough evidence to consider eventual builder integration?**
    For the *reference* B with a lighter striker, the physical and
    numerical evidence is sufficient to consider it, pending your
    listening. The evidence does not support presenting "choose the bar's
    harmonic" as a feature: only one tuning is clearly effective.
    Integration is not begun and should not be without your approval.

## 11. Limitations

- One string (A2), one body, one bar material and thickness, one pad
  stiffness. Every statement is about this configuration.
- The pluck is linear; real plucks are not. Dynamics from plucking are
  loudness only.
- The 440 Hz resonance of longer bars on the board is measured but its mode
  is not identified.
- There is no way to damp the bar by hand in the model; a struck bar rings
  until it stops.
- The tie is a spring at a point. A real string on a real bar also pulls
  along the bar and twists it; neither is modelled.
- Sound pressure is the body's model radiation at 1 m, not a calibrated
  prediction.
- Browser timing was measured in an embedded Chromium on one machine whose
  output device drops out by itself.
- Nothing has been heard.

## 12. Recommendation

Listen to 01, 02, 05 and 06 to 09 first. If the reference with the light
striker is worth pursuing, the next step I would propose (not begun) is a
small one: decide between the 0.2 and 0.18 tie by ear, keep the 5 g
striker, and add a physical way to damp the bar. I would not pursue a
selectable bar harmonic unless the 440 Hz file changes your mind.
