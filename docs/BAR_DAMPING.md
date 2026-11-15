# A finger on the bar: damping and two playing gestures (Phase 3D.11)

Phase 3D.10 left the bar-as-bridge instrument (architecture B, `BAR_BRIDGE`)
with one gap for a player: a struck bar rang until it stopped by itself.
This phase gives the bar a physical damper, a finger or the edge of a hand
laid on it, and asks whether that makes the instrument controllable.

**It is an isolated study.** Nothing is in the builder. The production
engine (`assembly/engine.ts`), the AudioWorklet processor, the approved
instruments, the builder examples and every playback gain are unchanged.
Every earlier research configuration is unchanged. No sound is faded,
filtered, compressed or boosted: where a sound stops, it stops because a
damper took its energy.

I cannot hear audio. Everything below is a measurement of a model. Whether
any of it sounds good is for you to decide; nothing here is a listening
approval.

Reproduce with `npm run render:bar-damping`
(`renders/bar-damping/measurements.json`, `performance.json`,
`manifest.json`) and `tests/bar-damping.test.ts`.

**In short.**

- A finger modelled as a spring and a damper between one point of the bar
  and a hand that does not move stops the bar's note: a medium finger on
  the bar's middle takes it down 29 dB in 50 ms; the untouched bar takes
  0.25 s to lose 20 dB.
- It is passive. With the finger resting, energy never rises; every joule
  lost is accounted for to 1 part in 10¹³; the finger takes about half of
  what a struck bar loses.
- Landing and leaving make no click and no unexplained energy. One thing
  is not zero and is reported: as the finger's spring stiffens on a moving
  bar the hand does a little work on it (0.0006 to 1.3 µJ in ordinary
  playing, under half a percent of what is then dissipated).
- **Bar damping and string muting are separate gestures.** A finger on the
  bar's middle leaves the string's energy, pitch and fundamental unchanged
  (0.0 dB, 0.01 cent, −0.3 dB). A finger on the string leaves the bar
  ringing (−2.5 dB). Both fingers stop everything.
- Where the finger is laid matters: on an antinode of the note it stops it,
  on the note's node it does nothing to it. Too firm a press at the middle
  is *less* effective than a firm one: it pins the bar rather than damping
  it.
- Never used, the finger changes no sample of the Phase 3D.10 reference.
  It costs about 10 % more computation whether used or not.
- Real-time safety is still not demonstrated in the browser; the evidence
  gathered here points at scheduling and the timer's resolution rather
  than at the engine, but does not prove it.

## 1. Baseline

Before any change: HEAD was `eeaa3b5` with no commits after it; the working
tree was clean; lint and build exited 0; the four reference WAV hashes were
unchanged; `eeaa3b5` was tagged `phase-3d10-approved` (it was not tagged
before). All 404 tests passed. One caveat: I started that test run and,
while it was running, made the first edit to `stringBarBody.ts` (an
addition that does nothing unless asked for), so the run was not on a
strictly untouched tree for its whole duration. The same 404 tests pass
again at the end, with the additions in place.

## 2. What a finger on a bar is: three candidate contacts

All three were tried on the same event: the bar struck by the 5 g striker
at 1 m/s and touched at its middle 0.2 s later.

| contact | bending energy 50 ms after (38.1 µJ before) | note falls 20 dB in | sound falls 20 dB in | 660 Hz in the sound, 0.1–0.4 s after |
|---|---|---|---|---|
| untouched | 5.06 µJ | 0.25 s | 0.26 s | 29.6 mPa |
| a damper alone, 6 N s/m | 0.0073 µJ | 0.02 s | 0.13 s | 11.1 mPa |
| **a spring and a damper, 2000 N/m and 6 N s/m** | 0.0063 µJ | 0.02 s | 0.13 s | 10.9 mPa |
| the same flesh on a 5 g fingertip held by the arm (300 N/m, 3 N s/m) | 0.0141 µJ | 0.03 s | 0.17 s | 11.7 mPa |

They agree closely, and the reason is simple. At the bar's note (660 Hz)
a damper of 6 N s/m resists like 25 000 N/m; the flesh's spring (2000 N/m)
is small beside it, and a 5 g fingertip on that flesh has its own resonance
near 100 Hz, far below the note, so above it the fingertip barely moves and
behaves as if it were the still hand.

**The model kept is the spring and damper to a still hand** (the middle
row). It is the simplest that is physically a finger rather than a dashpot:
the spring is what makes pressing harder raise the bar's pitch slightly,
as it does on a real bar, and it costs nothing more to compute than the
damper alone (one connection). The finger with its own mass adds a
resonator and two connections for a difference of a few dB at 50 ms; it is
not adopted.

The damper is not implemented by scaling modal amplitudes, by muting the
output or by a fade. It is one ordinary spring-and-damper connection of the
engine between a port of the bar and the engine's fixed body, the same kind
of thing as the bar's pads and the finger that mutes the string.

**Strengths.** Pressing harder flattens more flesh on the metal, so
stiffness and damping grow together. Four are defined (`BAR_TOUCH`):

| | stiffness | damping |
|---|---|---|
| light | 500 N/m | 2 N s/m |
| medium | 2000 N/m | 6 N s/m |
| firm | 8000 N/m | 20 N s/m |
| palm | 20 000 N/m | 60 N s/m |

These are of the order reported for fingertip pulp under light to firm
pressure. They are my estimates of plausible values, not measurements of a
hand, and the conclusions below do not depend on their exact size.

## 3. The prototype

Added to the isolated prototype `src/experimental/string/stringBarBody.ts`:

- `touchBar?: { at }` on the instrument's description: a place on the bar
  where a finger can be laid. When present, the bar gets one more port
  there and one more connection (bar to the fixed body) with **no
  stiffness and no damping**. When absent, the instrument is built by
  exactly the calls it was built by before.
- `barTouchCalls` (the finger lands and stays) and `barReleaseCalls` (it
  leaves), `BAR_TOUCH`, `BAR_TOUCH_TIME` (4 ms to land, 8 ms to leave), and
  `dampable(touchAt, tieAt)`: architecture B with the 5 g striker and a
  place for a finger.

Bar geometry, sixth-harmonic tuning, pads, string, tie, soundboard and air
cavity are those of `BAR_BRIDGE`, untouched.

**The inactive finger reproduces the reference exactly.** Over 96 000
samples of a phrase (two plucks, a medium and a strong stroke) the
instrument with an unused finger and the Phase 3D.10 reference (with the
same 5 g striker) differ in **0 samples**, and hold the same energy at the
end to the last bit. There is no discrepancy to investigate.

**How it lands and leaves.**

1. `attach`: the finger's spring takes its present length as its rest
   length. The finger lands where the bar *is*, so landing itself gives the
   bar nothing.
2. The spring's stiffness rises along a ramp inside the engine over 4 ms
   (`setStiffness` with the ramp policy). The engine keeps a count of the
   energy that a changing stiffness adds or removes (`injected`); that
   count is in every energy balance below.
3. The damper is brought up over the same 4 ms by the processor's existing
   `touch` call, the one that mutes the string. A damper stores nothing, so
   changing it can never add energy.

Leaving is the reverse over 8 ms. No new engine or processor code was
needed: every call existed.

**One limitation of the existing processor, worked around in the harness
and not in the processor.** It moves one finger's damper at a time and
remembers only that one. If the string's finger has moved since the bar's
finger landed, a bare "release the bar" would drop the bar's damper in a
single step (still passive, but abrupt). The harness therefore releases in
two messages one block apart: the first only reminds the processor which
finger is meant, the second ramps it away. The consequence for playing is
that the two fingers must not be *moving* within about 6 ms of each other;
both can *rest* at once. If this is ever integrated, the narrow correction
would be a second touch slot in the processor; I have not made it.

## 4. Landing and leaving

Medium finger at the middle unless stated. "Rougher" compares the sum of
squared second differences of the pressure in the 5 ms after the move with
the untouched instrument at the same moment (a click would show as many
dB). "Unaccounted" is energy the instrument lost, less what was counted as
dissipated, plus what the stiffening spring was counted as adding, as a
fraction of what was lost.

| what happens | bar's note | sound | rougher than untouched | spring's work on landing | finger took | unaccounted | peak finger force |
|---|---|---|---|---|---|---|---|
| finger on before the stroke | 10 mPa in the sound against 98 | LAFmax −2.1 dB, peak −0.7 dB; falls 20 dB in 0.07 s against 0.23 | | 0 | 47 % | 6 × 10⁻¹⁴ | 1.9 N |
| lands 20 ms after the stroke | 618 → 4.3 µJ in 50 ms | falls 20 dB in 0.10 s against 0.23 | −0.1 dB | 0.77 µJ | 41 % | 7 × 10⁻¹⁴ | 0.71 N |
| lands 200 ms after | 38.1 → 0.006 µJ | 0.13 s against 0.26 | −0.3 dB | 0.045 µJ | 51 % | 6 × 10⁻¹⁴ | 0.22 N |
| lands 500 ms after | 0.19 → 0.028 µJ | 0.56 s against 0.83 | −0.1 dB | 0.0006 µJ | 28 % | 2 × 10⁻¹² | 0.02 N |
| lands 0.3 s into a pluck | 0.78 → 0.04 µJ (0.29 untouched) | LAFmax unchanged | −0.1 dB | 0.004 µJ | 0.3 % | 3 × 10⁻¹² | 0.03 N |
| lands 50 ms after, leaves 100 ms later | 166 → 0.5 µJ, then back to 5.6 µJ | | −0.2 dB landing, −6.9 dB leaving | about +1.2 µJ landing, about −1.0 µJ leaving (net 0.21) | 37 % | 6 × 10⁻¹⁴ | 0.56 N |
| plucked and struck, then five touches and releases | | | (step between samples never above the level before) | 0.048 µJ | 3 % | 3 × 10⁻¹² | 0.21 N |

Reading it:

- **No click.** In every case the sound just after a landing or a release
  is no rougher than the untouched instrument's at that moment (−0.1 to
  −0.3 dB; after a release it is smoother, because the bar has been
  quietened).
- **The books balance** to between 10⁻¹² and 10⁻¹⁴ of what was lost, in
  every scene.
- **The one external work, measured.** While the spring stiffens the bar
  is moving, so the spring is being stiffened while slightly stretched:
  that is the hand pressing in, and it does work on the bar. It is 0.0006
  to about 1.2 µJ here, at most 0.24 % of the energy the instrument then
  loses.
  On leaving, the same mechanism takes back whatever the spring holds
  (0.97 µJ in the fifth row) to the hand.
- **A finger that lands late finds less to take**, and takes a smaller
  share, because by then most of what is left is in the string and the
  board. The finger on the bar took 0.3 % of what a plucked string then
  lost: it is a bar damper, not a general one.
- **After a short touch the note comes back a little** (0.5 µJ just before
  the finger leaves, 5.6 µJ 100 ms after): the string, which took 7 % of
  the stroke, hands some back to the bar. That is the bidirectional
  coupling of Phase 3D.9 seen from a new side, and it is what a real
  coupled instrument would do.

**Why the landing is ramped.** A firm finger and a palm were put onto a
strongly struck bar (2 m/s) 50 ms after the stroke in three ways:

| | rougher than untouched (firm / palm) | spring's work (firm / palm) | peak force (firm / palm) |
|---|---|---|---|
| landing over 4 ms (as built) | −0.5 / −0.6 dB | 18.7 / 39.5 µJ | 2.6 / 5.2 N |
| landing over 0.5 ms | −0.6 / −0.4 dB | 3.6 / 7.3 µJ | 3.8 / 8.4 N |
| switched on in one sample, no landing | +0.7 / +2.0 dB | 17.2 / 43.1 µJ | 3.5 / 7.9 N |

Switched on in one sample it is measurably rougher; landed, it is not. The
books balance in all three (the engine counts what an abrupt stiffness
change does), so this is about the sound, not about energy. The spring's
work in this hard case is 0.9 to 1.9 % of what is then dissipated (2.07
mJ): larger than in ordinary playing because a strongly struck bar is
still bouncing on its pads by tens of micrometres when the hand comes
down. It is counted, not hidden. A faster landing does less of it and
costs a higher peak force.

## 5. How hard it is pressed

Struck at 1 m/s, touched at the middle 0.2 s later.

| | note falls 20 dB: predicted | measured | bending re untouched, 50 / 100 ms after | moving as a whole / rocking, re untouched | 660 Hz in the sound | predicted rise of the note |
|---|---|---|---|---|---|---|
| light | 0.045 s | 0.05 s | −14.3 / −7.6 dB | −2.5 / −2.9 dB | 17.7 mPa | 0.7 cents |
| medium | 0.022 s | 0.02 s | −29.1 / −13.8 dB | −3.9 / −5.9 dB | 10.9 mPa | 2.8 cents |
| firm | 0.008 s | 0.02 s | −26.0 / −19.5 dB | −6.5 / −10.5 dB | 8.0 mPa | 11 cents |
| palm | 0.003 s | 0.04 s | −22.2 / −19.2 dB | −7.4 / −14.3 dB | 7.5 mPa | 27 cents |

(Untouched: 29.6 mPa. The fall times are read in steps of 10 ms.)

- The prediction is the textbook one: a damper *c* at a point where the
  mode's shape is *s* takes the mode's amplitude down at *c s²* / 2*m* per
  second. Light and medium fingers follow it.
- **Firm and palm do not, and that is physics, not error.** Once the
  damper is stiffer than the bar at that point it stops absorbing and
  starts holding: the bar finds a new way to vibrate with a near-node
  under the hand, which the hand then cannot damp. The palm is no better
  than the firm finger at the note and slower over the first 50 ms. There
  is an optimum, and it is near "medium to firm".
- The contact responds to strength in a graded way from light to firm,
  which is the useful range.
- The 660 Hz that remains in the sound after the bar's own note has gone
  (8 to 11 mPa) is the *string's* sixth harmonic, which the stroke excited
  and the finger on the bar does not touch.
- "100 ms after" is higher than "50 ms after" for the same reason as in
  section 4: the string feeds the bar again.

I did not measure the rise in pitch under the finger (the note is gone too
quickly to measure a few cents); the last column is a calculation.

## 6. Where the finger is laid

Medium finger; struck (touched 0.2 s later) and plucked (touched 0.3 s
later). On this instrument three of the places a player might think of are
within 2.4 % of the bar's length of each other: the note's node (0.224),
the pad (0.215) and the string's tie (0.2). All were measured.

| place | shape of the note there | bending, struck | 2nd bending mode | whole / rocking | sound falls 20 dB | finger took (struck) | 660 Hz in a pluck's sound | string energy 2 s after a pluck |
|---|---|---|---|---|---|---|---|---|
| middle (0.5) | −1.22 | −13.8 dB | −5.2 dB | −3.9 / −5.9 dB | 0.13 s | 50 % | −6.8 dB | 0.0 dB |
| 0.35 | −0.83 | −7.7 dB | −2.3 dB | −3.4 / −3.0 dB | 0.28 s | 39 % | −4.6 dB | 0.0 dB |
| the note's node (0.224) | 0.001 | 0.0 dB | −0.6 dB | −1.3 / −0.5 dB | 0.26 s | 9 % | −2.7 dB | −0.1 dB |
| the pad (0.215) | 0.07 | −0.4 dB | −0.8 dB | −1.5 / −0.7 dB | 0.25 s | 15 % | −4.2 dB | −0.1 dB |
| the string's tie (0.2) | 0.20 | −1.6 dB | −1.3 dB | −2.0 / −1.2 dB | 0.07 s | 26 % | −6.8 dB | −0.1 dB |
| near the end (0.05) | 1.54 | −24.1 dB | −10.4 dB | −2.9 / −8.7 dB | 0.09 s | 56 % | −13.2 dB | −0.2 dB |
| the far node (0.776) | 0.001 | −2.5 dB | −2.0 dB | −6.0 / −2.8 dB | 0.07 s | 21 % | −2.1 dB | 0.0 dB |
| the far end (0.95) | 1.54 | −8.6 dB | −2.4 dB | −6.5 / −3.4 dB | 0.35 s | 22 % | −3.8 dB | −0.1 dB |

(All re the untouched instrument 100 ms after the touch; untouched sound
falls 20 dB in 0.26 s. The firm finger's figures are in
`measurements.json`; they are the same picture, a few dB deeper.)

- **Position matters and follows the mode shape.** On an antinode (the
  middle, the end by the string) the note is stopped; on its node it is
  left alone, and the finger takes 9 % instead of 50 %.
- **The middle is the cleanest place.** It is an antinode of the note, a
  node of the second bending mode and of rocking, and it is where the
  striker lands, so a hand is already there. It damps the note and little
  else.
- **The end by the string damps most** (−24 dB) and also takes the
  second bending mode and the rocking with it, and the string's higher
  harmonics a little (the 7th falls 4.8 dB; the string holds 0.2 dB less
  after 2 s). A different, duller stop.
- **The two ends are not alike** (−24 against −9 dB) although the free
  bar's shape is the same at both. The bar is not free: the string is tied
  near one end, and the note of the bar-and-string together moves that end
  more.
- **Near the tie or the pad the finger hardly touches the bar's note but
  shortens the stroke's sound** (0.07 s against 0.26 s to fall 20 dB): it
  is damping the bar's motion as a whole on its pads, which is how the bar
  drives the board. A third, distinct effect.
- The sound's 20 dB fall time is a rough measure here: bar and string beat
  against each other, and where a beat falls moves the reading (the 0.35 s
  at the far end is a beat, not slower damping). The energy columns are
  the reliable ones.

Not every position is useful. The node, the pad and the far node do little
to the note; I would not offer them as "damping".

## 7. The string tied at 0.20 and at 0.18

Everything else identical; 5 g striker.

| | tied at 0.20 | tied at 0.18 |
|---|---|---|
| string pitch re 109.913 Hz | −0.73 cents | −0.77 cents |
| fundamental re approved instrument | +0.5 dB (6.31 mPa) | −0.2 dB (5.83 mPa) |
| 2nd / 3rd / 4th harmonic re approved | −0.3 / −5.7 / +5.8 dB | −1.1 / −3.9 / +7.3 dB |
| 6th harmonic over the whole note re approved | +5.0 dB | +2.1 dB |
| pluck LAFmax | 67.3 dB | 67.5 dB |
| pluck falls 20 dB in | 0.88 s | 0.84 s |
| string energy after 1 s, share of its most | 1.05 % | 1.06 % |
| bar bending, share of the pluck | 0.098 % (5.0 µJ) | 0.18 % (9.2 µJ) |
| 660 Hz in the first half second | 32.2 mPa | 31.5 mPa |
| …with a bar that cannot bend | 6.6 mPa | 6.2 mPa |
| what the bar's bending adds at 660 Hz over the note | +11.5 dB | +9.4 dB |
| stroke LAFmax | 82.5 dB | 82.3 dB |
| string's share of a stroke | 7.0 % | 12.6 % |
| medium finger, struck: bending re untouched | −13.8 dB | −14.9 dB |
| medium finger, plucked: string energy at 1 s and 2 s | 0.0, 0.0 dB | 0.0, 0.0 dB |
| …fundamental / 6th harmonic after the touch | −0.3 / −6.8 dB | −0.3 / −8.7 dB |

**Sensitivity** (plucked; 6th harmonic re approved / LAFmax re approved /
pitch):

| change | tied at 0.20 | tied at 0.18 |
|---|---|---|
| as it is | +5.0 dB / +6.2 dB / −0.73 c | +2.1 / +6.4 / −0.77 |
| bar 15 cents flatter | +5.2 / +4.1 / −0.73 | +5.9 / +4.3 / −0.77 |
| bar 15 cents sharper | −11.9 / +6.3 / −0.73 | −11.4 / +6.4 / −0.77 |
| pads half as stiff | −15.1 / +2.3 / −0.95 | −12.7 / +1.2 / −1.00 |
| pads twice as stiff | +1.7 / +5.9 / −0.62 | +1.6 / +5.6 / −0.65 |
| tie half as stiff | +4.6 / +6.2 / −0.92 | +2.4 / +6.4 / −0.96 |
| tie twice as stiff | +5.2 / +6.2 / −0.63 | +2.3 / +6.3 / −0.67 |

What the comparison shows:

- The two are close. Loudness, attack presence at 660 Hz, sustain, pitch
  and the effect of the finger are the same within measurement interest.
- 0.18 moves more energy both ways (1.8 times the bending from a pluck,
  1.8 times the string's share of a stroke). It pays with 0.7 dB of
  fundamental and 2.9 dB of *sustained* 6th harmonic: the bar is starting
  to absorb what it is given.
- Neither is more robust. Both lose the sustained 6th harmonic if the bar
  goes 15 cents sharp or the pads are half as stiff, and both keep the
  pluck's level and the string's pitch under every change tried. The
  sustained harmonic is the fragile quantity in both; this confirms Phase
  3D.10's finding that the bar must sit flat of the harmonic.

**Which has the better physical balance?** By these numbers, 0.20: it
keeps more of the string's fundamental and the larger sustained
contribution from the bar, for the same loudness. 0.18 gives the struck
bar more of a string "tail" (12.6 % against 7 %). I am not choosing on
energy transfer alone, and the differences are small enough that the
choice is for the ear: both are kept (`dampable(0.5)` and
`dampable(0.5, 0.18)`; files 09 and 10).

## 8. Playing with it

5 g striker; medium finger at the middle unless stated.

**Strokes, open and with a finger already on the bar.**

| stroke | open: LAFmax, 660 Hz, falls 20 dB | finger on: LAFmax, 660 Hz, falls 20 dB |
|---|---|---|
| gentle, 0.5 m/s | 75.9 dB, 49.6 mPa, 0.23 s | 73.3 dB, 5.0 mPa, 0.07 s |
| medium, 1 m/s | 82.5 dB, 98.1 mPa, 0.23 s | 80.4 dB, 10.0 mPa, 0.07 s |
| strong, 2 m/s | 89.0 dB, 194 mPa, 0.23 s | 87.2 dB, 19.7 mPa, 0.07 s |

A stroke on a held bar is a short knock about 2 dB down with the note 20
dB down: a second kind of stroke, at every dynamic.

**Plucks in different places, open and with a finger on the bar.**

| plucked at | open: LAFmax, 660 Hz early, fundamental | finger on: LAFmax, 660 Hz early, fundamental |
|---|---|---|
| 0.5 | 66.0 dB, 0.8 mPa, 11.8 mPa | 65.9 dB, 0.2 mPa, 11.4 mPa |
| 0.75 | 69.2 dB, 56.2 mPa, 8.4 mPa | 65.5 dB, 30.3 mPa, 8.1 mPa |
| 0.8 | 67.3 dB, 32.2 mPa, 7.0 mPa | 65.6 dB, 17.6 mPa, 6.7 mPa |
| 0.9 | 69.1 dB, 53.8 mPa, 3.7 mPa | 65.9 dB, 28.9 mPa, 3.5 mPa |

With the bar held, a pluck loses about half of its 660 Hz component and
2 to 4 dB of level, keeps its fundamental (−0.3 dB), its pitch (−0.72
cents) and all of its string energy (0.0 dB at 1 s). What remains at 660
Hz is the string's own sixth harmonic through the bar as a rigid bridge.

**Are the two gestures separate?** This was the question the brief asked
me not to force. The measurements:

| gesture | string | bar's note | in the sound |
|---|---|---|---|
| string plucked, **bar damped** at 0.3 s | energy 0.0 dB at 1 s and 2 s (53.6 µJ both) | 0.0005 µJ against 0.0075 at 1 s | fundamental −0.3 dB, 6th harmonic −6.8 dB, level 0.5–1 s −1.8 dB |
| bar struck, **string muted** at 0.05 s | 0.17 µJ against 16.5 at 0.3 s | −2.5 dB (1.24 against 2.22 µJ) | bar's note −3.7 dB; string's fundamental −73 dB |
| plucked and struck, bar damped at 0.15 s | 371 against 374 µJ at 0.5 s | 0.03 against 0.69 µJ | fundamental −0.3 dB, 6th −9.9 dB |
| plucked and struck, string muted at 0.15 s | 0.06 against 374 µJ | −1.0 dB at 0.3 s | |
| plucked and struck, **both** (0.15 and 0.16 s) | 0.07 µJ at 0.5 s | 10⁻⁶ µJ at 0.5 s | falls 20 dB in 0.06 s; last above −60 dB of peak at 0.39 s |

**They are separate, and nothing was forced to make them so.** The
physical connection does not make a finger on the bar damp the string:
laid on the bar's middle it takes the bar's bending, which holds a tenth
of a percent of a pluck, and the string keeps its energy to within 0.05 dB
for two seconds. Nor does muting the string stop the bar: the bar loses
2.5 dB (the part the string was handing back) and rings on. The instrument
has three stops: bar, string, both.

The exception is the finger at the end by the string (section 6), which
begins to reach the string's upper harmonics.

**Retriggering.** Struck, damped, released, struck again: the second
stroke's peak and its note 100 ms later equal a fresh stroke's (0.0 dB
both). With the finger on the bar a retriggered pluck has 19.9 mPa at 660
Hz; after the finger lifts, the next has 32.3 mPa, the open value. The
finger leaves no trace.

**Phrases.**

| | peak | finger force at most | spring's work | worst solver iterations | faults |
|---|---|---|---|---|---|
| four times: pluck, stroke, bar damped, finger lifted | 1.93 Pa | 0.35 N | 0.23 µJ | 3 | 0 |
| phrase with both gestures (file 12) | 4.14 Pa | 1.1 N | 0.78 µJ | 3 | 0 |
| hardest playing (8 N plucks, 5 m/s with the 20 g mallet, ten a second) while a palm lands and lifts every 0.2 s | 23.5 Pa | 184 N | 66 µJ of 420 mJ | 3 | 0 |

The last row is a stress test, not a way of playing. Its 184 N is what the
model's hand, which cannot move, has to hold against a 20 g mallet at
5 m/s; a real hand would give way. The model is bounded and faultless
there, and that is all the row claims.

## 9. Energy and numerical validation

In `tests/bar-damping.test.ts` (14 tests):

| check | result |
|---|---|
| finger never used against the Phase 3D.10 reference | identical in every sample; same final energy; nothing injected |
| passive damping: energy while the finger rests | never rises, block to block |
| accounting, finger resting, 0.19 to 1.1 s | unaccounted < 10⁻⁹ of what was lost (measured ≈ 10⁻¹⁴) |
| every other loss removed | what the instrument loses equals what the finger takes (measured by force × speed at the finger) to within 2 %, and equals the engine's count to 10⁻⁹ |
| every loss removed, finger never used | energy constant to 10⁻⁹; dissipation zero |
| landing | spring's work positive and under 0.5 % of what is then lost |
| leaving | adds nothing; spring holds exactly 0 afterwards; energy only falls thereafter |
| clicks | no rougher than untouched (< 1 dB) at landing and at leaving, for medium, firm and palm; largest step between samples no larger than untouched |
| position | antinode: note −10 dB or more; node: within 1 dB; finger takes under a third as much at the node |
| two gestures | bar damped: string energy within 0.1 dB at 0.5, 1 and 2 s, pitch within 0.1 cent, fundamental within 1 dB. String muted: bar within 5 dB. Both: string below a thousandth, bar below a hundredth |
| retrigger | second stroke within 0.2 dB (peak) and 0.5 dB (note) of a fresh one |
| determinism | repeated touch-and-release and the phrase: identical sample for sample, twice |
| hard playing with a palm landing and lifting | finite, below the 64 Pa ceiling, at most 10 iterations, decays to < 1 % |
| abrupt contact, for comparison | rougher than a landed one; its books still balance |

"Disconnected joints" and "bidirectional response" for the instrument
itself are covered by the Phase 3D.9 and 3D.10 tests, which pass
unchanged; the finger's own disconnection is the first row (a finger of no
strength is no finger).

The solver needed at most 3 iterations in every run of the study. No
existing test was changed.

## 10. Performance

**Node** (the real processor; 20 s of audio; five timed runs each, the
systems taking turns run by run so that the machine's other activity falls
on all alike; each 128-sample block timed with a microsecond clock):

| system | % of one core, median (range) | block: median | 99th percentile | 99.9th | longest | blocks over 2.67 ms, of 37 495 |
|---|---|---|---|---|---|---|
| approved string on its box | 9.2 (9.1–9.4) | 0.22 ms | 0.51 ms | 0.70 ms | 3.9 ms | 3 |
| Phase 3D.10 reference, 5 g striker | 13.6 (13.5–13.8) | 0.33 ms | 0.73 ms | 1.03 ms | 3.9 ms | 2 |
| finger never used | 14.9 (14.5–15.0) | 0.36 ms | 0.78 ms | 1.05 ms | 33.6 ms | 5 |
| finger held on the bar | 14.9 (14.7–15.1) | 0.36 ms | 0.80 ms | 1.07 ms | 5.5 ms | 1 |
| finger touching and leaving five times a second | 15.4 (14.7–16.9) | 0.37 ms | 0.80 ms | 1.07 ms | 3.2 ms | 2 |

- **The finger costs about 10 %, used or not.** It is one more connection
  for the solver (9 instead of 8) and one more port on the bar; the engine
  does not skip a connection of no strength. Using it costs nothing more.
- Engine memory is 3 145 728 bytes in every case. No faults.
- An earlier, non-interleaved run of this benchmark showed "finger never
  used" at 18 %. Interleaved, it is 14.9 %; the earlier figure was the
  machine, and is why the runs now take turns.

**Chromium AudioWorklet** (experimental page, 48 kHz, 2.67 ms blocks, 20 s
each, strokes at 1.5 m/s; two complete runs):

| system | engine CPU (run 1 / 2) | longest block | blocks ≥ 2 ms | blocks missed | device dropouts | worst iterations |
|---|---|---|---|---|---|---|
| empty AudioContext, 10 s | — | — | — | — | 1 / 1 | — |
| oscillator only, 10 s | — | — | — | — | 1 / 1 | — |
| approved string on its box | 15.5 / 15.8 % | 3 / 2 ms | 1 / 0 | 0 / 0 | 0 / 1 | 1 |
| Phase 3D.10 reference, 5 g striker | 20.8 / 21.4 % | 2 / 2 ms | 4 / 4 | 0 / 0 | 0 / 0 | 3 |
| finger never used | 22.6 / 22.3 % | 2 / 3 ms | 27 / 14 | 0 / 0 | 1 / 1 | 3 |
| finger held on the bar | 23.3 / 21.8 % | 2 / 3 ms | 38 / 31 | 0 / 0 | 0 / 1 | 3 |
| finger touching and leaving five times a second | 22.4 / 20.8 % | 2 / 3 ms | 30 / 26 | 0 / 0 | 0 / 1 | 3 |

No sample was non-finite; memory 3 145 728 bytes throughout.

**The 3 to 4 ms blocks: what can and cannot be said.**

- *Measurement.* The processor times a block with `Date.now()`, which
  counts whole milliseconds; an audio worklet has no finer clock. "2 ms"
  means the clock ticked twice during the block: the block took more than
  1 ms and less than 3 ms. "3 ms" means between 2 and 4 ms. So "blocks ≥
  2 ms" counts blocks longer than about 1 to 2 ms, most of which are
  within the 2.67 ms budget, and a "3 ms" block may or may not have
  overrun. The browser figures cannot settle whether a deadline was
  missed.
- *Engine computation.* In Node, with a microsecond clock, the same
  engine's blocks have a median of 0.33 to 0.37 ms and a 99.9th percentile
  of about 1.05 ms. The engine's own work, including its worst solver
  iterations, does not come near 2.67 ms. The handful of longer blocks in
  Node (2 to 5 of 37 495, up to 34 ms) are far outside the engine's
  distribution and occur for the approved instrument too: they are the
  process being interrupted (the operating system, or the JavaScript
  engine's own housekeeping), not computation.
- *Browser scheduling.* The browser's blocks cost about 1.5 times Node's
  on average (20.8 % against 13.6 %). Blocks "≥ 2 ms" rise from about 4 to
  about 30 per 7500 with the finger's extra connection, while the average
  rises by under 10 %: a slightly longer typical block crosses a
  millisecond tick more often. That pattern is what a coarse clock gives,
  not what a slow engine gives.
- *The audio device.* The output device reports about one dropout per ten
  seconds with no engine at all, in both control runs. The 0 or 1 dropouts
  per 20 s seen with the engine running are at or below that rate. They
  cannot be attributed to the engine. Every block that was due was
  processed.
- *The damping model.* It did not cause the long blocks: they were there
  in Phase 3D.10 without it and are there for the approved instrument.

So: the evidence points to the timer's resolution and to scheduling, and
away from engine computation, but **it does not demonstrate real-time
safety**, and I do not claim it. What would settle it is a deadline
measurement the processor cannot presently make. The narrow change I would
recommend, and have not made, is diagnostic only: have the processor
report `currentTime` against the wall clock over a run (or count
`process` calls against expected blocks at finer grain), on a machine
whose audio device does not drop out by itself. I have not optimised any
production code.

## 11. Listening files

`renders/bar-damping/common/` (one gain for all: compare loudness) and
`renders/bar-damping/matched/` (each at the same A-weighted exposure:
compare timbre). 48 kHz, 24 bit, mono; one multiplication per file and
nothing else. `manifest.json` gives for each file the physical parameters,
the finger's position, stiffness and damping, when it lands and lifts, the
excitation, peak in Pa, levels, decay times (−20, −40, −60 dB), harmonics,
energy by band, the energies (instrument's most, left at the end, taken by
the finger, added by the stiffening spring, dissipated) and both gains.

| file | what | peak | LAFmax | last above −40 dB of peak | common: peak in file | matched gain |
|---|---|---|---|---|---|---|
| 01-approved-string-and-body-plucked | the approved instrument | 0.102 Pa | 61.1 dB | 2.03 s | −33.1 dBFS | +9.6 dB |
| 02-reference-B-plucked | Phase 3D.10 reference | 0.187 | 67.3 | 1.62 | −27.8 | +4.2 |
| 03-bar-struck-open | struck, nothing damped | 1.90 | 82.5 | 0.61 | −7.6 | −9.4 |
| 04-bar-struck-then-damped | finger lands 0.25 s after | 1.90 | 82.5 | 0.44 | −7.6 | −9.3 |
| 05-bar-struck-with-finger-already-on | finger on first | 1.76 | 80.4 | 0.30 | −8.3 | −5.8 |
| 06-string-plucked-bar-open | the same sound as 02 | 0.187 | 67.3 | 1.62 | −27.8 | +4.2 |
| 07-string-plucked-bar-held | finger on the bar first | 0.149 | 65.6 | 1.80 | −29.8 | +5.9 |
| 08-string-plucked-then-bar-damped | finger lands at 0.3 s | 0.187 | 67.3 | 1.66 | −27.8 | +4.4 |
| 09-tie-0p20-pluck-then-strike | tie at 0.20: pluck, stroke at 1.5 s | 1.90 | 82.5 | 2.12 | −7.7 | −9.5 |
| 10-tie-0p18-pluck-then-strike | tie at 0.18: the same | 1.91 | 82.3 | 2.14 | −7.6 | −9.4 |
| 11-pluck-and-strike-in-turn-with-damping | four rounds | 1.93 | 82.5 | 3.29 | −7.6 | −15.3 |
| 12-phrase-with-both-gestures | see the manifest | 4.14 | 89.0 | 3.38 | −0.9 | −16.8 |

(Matched gains in dB re 1 per pascal; the common gain is 0.217 per pascal,
−13.3 dB.)

Notes for listening, from the measurements only:

- 06 is deliberately the same recording as 02, so that the set of three
  plucks (06, 07, 08) can be heard together.
- 03 against 04 and 05 is the bar damper. By the numbers 04 and 03 are the
  same for the first 0.25 s.
- 06 against 07 and 08 is whether damping the bar under a ringing string
  is audible at all. The measured difference is small (−1.8 dB in level
  from 0.5 to 1 s, −6.8 dB at 660 Hz). It may well be subtle.
- In `common/` the plucked files are quiet (−28 to −33 dBFS) because the
  strong stroke in file 12 sets the gain.

None of these has been heard by me.

## 12. Regression

- The four reference WAV hashes are unchanged.
- Not modified: `assembly/engine.ts`, the AudioWorklet processor,
  `src/audio/**`, `src/App.tsx`, `src/builder/**`, the builder examples,
  the Phase 3D.3 engine fixture, every earlier research constant
  (`BAR_BRIDGE`, `BAR_BRIDGE_440`, `BAR_BRIDGE_880`,
  `BAR_BRIDGE_FIRMER_TIE`, `LIGHT_STRIKER`, `STROKES` and all before).
- Changed, by addition only: `stringBarBody.ts` (the optional `touchBar`,
  three fields on the built description, the finger's constants and
  calls); the experimental test page's benchmark gains a `'damping'`
  option. New: `analysis/bar-damping.ts`, `analysis/render-bar-damping.ts`,
  `tests/bar-damping.test.ts`, this document.
- The suite is 418 tests in 28 files (404 + 14 new); the earlier 404 pass
  unchanged, so earlier configurations still reproduce.

## 13. Decision gate

1. **Can a physical contact damp the bar effectively?** Yes. A medium
   finger on the middle: −29 dB of bending energy in 50 ms; the sound
   falls 20 dB in 0.13 s instead of 0.26 s; with the finger on first, the
   note is 20 dB down.
2. **Is damping passive and numerically stable?** Yes. Energy never rises
   under a resting finger; balances close to 10⁻¹² or better; at most 3
   solver iterations; no fault, including under the stress test.
3. **Can contact engage and release without unexplained energy
   injection?** Yes. The only energy that enters is the work of the
   stiffening spring, which is explained (the hand pressing on a moving
   bar), measured (0.0006 to 1.3 µJ in ordinary playing; up to 2 % of
   what is then dissipated when a palm comes down on a hard-struck bar)
   and included in the balance. Release adds none.
4. **Does contact position meaningfully change the response?** Yes:
   from −24 dB to 0 dB on the note, following the mode shape, with a third
   effect (shortening the knock) near the pad. Not every position is
   useful.
5. **Can bar damping and string muting produce distinct playing
   gestures?** Yes, clearly, and without being forced: each stops its own
   part and leaves the other (string 0.0 dB; bar −2.5 dB).
6. **Which attachment position gives the better physical balance?** 0.20,
   narrowly, on fundamental and sustained bar contribution; 0.18 gives the
   struck bar more string. The difference is small and both are kept for
   listening.
7. **Does the string retain a recognizable fundamental?** By measurement
   its fundamental is within 0.5 dB of the approved instrument's and
   within 0.3 dB of itself with a finger on the bar; pitch within 0.8
   cent. "Recognizable" is for the ear.
8. **Is the mechanism practical for real time?** In cost, yes: about 10 %
   more than the reference, 15 % of a core in Node and 22 % in Chromium on
   this machine, with the engine's own blocks under 1.1 ms at the 99.9th
   percentile. Real-time *safety* in the browser is not demonstrated.
9. **Unresolved clicks, transients or performance problems?** No click or
   transient was found from landing or leaving. Unresolved: (a) the
   browser's coarse block timing, so deadline overruns can be neither
   confirmed nor excluded; (b) the processor's single touch slot, which
   forbids two fingers *moving* within about 6 ms; (c) the hand is rigid,
   so finger forces under violent playing are overstated.
10. **Ready for subjective listening before any builder integration?**
    Yes. The physical and numerical questions this phase set are answered;
    what is missing is entirely the listening. I would not integrate
    anything before that.

## 14. Limitations

- One string, one bar, one body. The finger's stiffness and damping are
  estimates.
- The hand does not move. Fine for damping a ringing bar; wrong for the
  force it must hold under a heavy blow.
- The finger is a point. A real fingertip covers about a centimetre, 5 %
  of this bar, which would blur the node/antinode contrast of section 6
  somewhat.
- The finger's spring is linear and two-sided: a real finger can only
  push. With forces of a newton or less on a bar moving by micrometres
  under a pressing finger this does not arise in ordinary playing; it
  would in a model of a finger barely grazing the bar.
- The pitch rise under a pressing finger is calculated, not measured.
- Fall times read from the sound are disturbed by beating between bar and
  string; energies are the firmer evidence.
- The pluck is still linear (Phase 3D.10).
- Browser timing: one machine, an embedded Chromium, an output device that
  drops out by itself, a millisecond clock.
- Nothing has been heard.

## 15. Recommendation

Listen first, in this order: 03, 04, 05 (does the damper do what a hand on
a bar should?); 06, 07, 08 (is the bar under a string worth holding?); 09
against 10 (which tie?); then 11 and 12.

If the instrument is worth continuing after that, the next steps I would
propose, none begun, are small: pick the tie by ear; decide whether the
finger belongs at the middle or should be movable between the middle and
the end; and, only if integration is wanted, give the processor a second
touch slot and a finer deadline diagnostic. I would not begin builder
integration before the listening.
