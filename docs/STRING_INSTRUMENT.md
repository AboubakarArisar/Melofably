# The string-and-body instrument in the builder (Phases 3C.3 and 3D.1)

Sections 1 to 8 describe the instrument as approved in Phase 3C.3. Section 9
describes how it is played since Phase 3D.1: retriggered and additive
plucks, a finger that touches and mutes, and a string pulled aside and
released. Where section 9 changes something said earlier, it says so.

**Status: experimental, limited.** One string, one body, one bridge. The four
approved Faust instruments, their reference recordings, the WebAssembly
engine and the three bar examples of the builder are unchanged. No listening
was done: the model that wrote this cannot hear. Every statement about sound
below is a measurement.

| Piece | Where |
| --- | --- |
| The string on the damped box: numbers, engine system, radiation | `src/experimental/string/stringBody.ts` |
| Plucking and radiated pressure in the AudioWorklet | `src/experimental/wasm/processor.js` |
| The builder's parts, validation, translation, live edits | `src/builder/graph.ts`, `translate.ts` |
| Canvas, inspector, example, audio output | `src/builder/shapes.ts`, `Canvas.tsx`, `Inspector.tsx`, `examples.ts`, `audio.ts`, `Builder.tsx` |
| The worklet processor run in Node | `analysis/worklet.ts` |
| Tests (18) | `tests/string-body.test.ts` |
| Reference renders and comparison | `analysis/render-string-body.ts` (`npm run render:string-body`) |

## 1. What was added

- Two parts in the builder's palette, under "String instrument
  (experimental)": **String** and **Damped box body**; and one connection,
  **Bridge**, made the usual way by dragging from the string's dot to the
  body.
- An example, "A string on a damped box body", in its own group of the
  example menu. The list of approved bar examples (`EXAMPLES`) is exactly as
  it was; the string example is in `STRING_EXAMPLES`.
- A pluck, and sound pressure as the output.
- Play instrument, Space, double-click and the inspector's button all pluck
  the string, as they strike a bar.

## 2. Physical architecture

```
finger ──force──▶ STRING (100 modes) ──bridge spring 1e6 N/m──▶ SOUNDBOARD (76 modes)
                                                                    │  ▲
                                                       air spring   │  │ pressure of the air
                                                                    ▼  │
                                                     AIR IN THE HOLE (a mass, through a screen)

sound pressure at 1 m  =  rho/(2 pi r) d/dt [ flow from the soundboard + flow from the hole ],  as from a box
```

Everything left of the last line is one system in the existing engine,
solved together every sample: the string pushes the soundboard through the
bridge and is pushed back; the soundboard compresses the air, which pushes
the plug of air in the hole and the soundboard. It is exactly the system of
Phase 3C.2.3 (`DAMPED_BOX`): a test checks that the builder's example
produces the same list of engine calls as the prototype, call for call.
Nothing is mixed in: there is one output, the flow of air out of the body.

**The engine was not changed.** Two things it does not do are done in the
AudioWorklet processor, which wraps it:

1. **Pluck.** `['pluck', resonator, port, force, cutoff, seconds]`: a force
   on the string's pluck point that steps to `force` newtons and relaxes
   (an impulse through two one-pole lowpasses, then a 20 Hz leaky
   integrator), applied for 0.2 s. It is the approved Faust string's
   excitation and the one every prototype used. While a pluck lasts, the
   processor steps the engine one sample at a time to apply the force.
2. **Radiation.** `['radiate', ...]`: the engine's output (flow per plate
   area, m/s) is differentiated and passed through the box's first-order
   shelf to give pascals at 1 m on the axis (`radiation()` in
   `stringBody.ts`; the arithmetic of `radiatedPressure()` and `enclosed()`).

Both are off unless asked for, and a rebuild turns them off, so bar
instruments run exactly as before: a test compares the worklet's output for
each bar example with a bare engine's, sample for sample.

**Levels.** The audio node carries pascals divided by 2 (so 2 Pa, 97 dB SPL,
is its ceiling). The volume control and a listening gain come after it, in
the browser's audio graph, and do not touch the model: the meter, the status
line and the renders are in pascals. There is no equaliser.

## 3. Controls

| Property | Range | Live or rebuild | What happens |
| --- | --- | --- | --- |
| Tension | 30 to 120 N | **live** | Every string mode is retuned where it is, keeping its energy (the engine's `tune`), and the bridge spring's allowance for the string's missing modes follows. Like turning a tuning peg while the string rings. |
| Length | 0.5 to 0.8 m | **rebuild** (↻) | The string's mass changes: the instrument is rebuilt and its sound restarts, with the builder's usual short fade. |
| Pluck position | 0.05 to 0.95 | **live** | Only where the next pluck's force goes. A ringing string is not disturbed (test: identical samples). |
| Pluck strength | 0.2 to 8 N | **live** | Read when the string is plucked. |
| Body | fixed | | Shown, not editable: spruce 0.5 x 0.4 m x 8 mm (672 g), 30 litres, hole of 80 mm radius with a 100 Pa s/m screen, bridge at (0.08, 1/3). |
| Bridge | fixed, 1e6 N/m | removing it rebuilds | Without it the string still moves when plucked and nothing is heard. |
| Volume | 0 to 1 | live | After the model. |

The string is 3.6 g/m (the A2 string of the prototypes). The ranges keep all
100 of its modes below the highest playable frequency at 44.1 kHz and above;
its pitch runs from 57 Hz to 183 Hz. Values outside a range are refused,
not clamped.

*(Since Phase 3D.1 the string also has Pluck softness and Touch before
plucking: section 9.)*

**A new pluck adds to the vibration already there; it does not reset it**
(unless Touch before plucking is on: section 9).
The system is linear, so two plucks are exactly the sum of each alone
(test). A real finger would damp the string as it touches it; this one does
not. Up to eight plucks' forces can overlap (each lasts 0.2 s); a ninth
takes over the oldest.

**Not supported, and refused with the reason:** a second string or body; a
string or body on a canvas with bars, mallets or impulse strikes; anything
but a bridge between string and body. A saved instrument that breaks these
is not loaded.

## 4. Verification

All through what the browser uses: the builder's graph, translation and
Session, and the worklet processor file itself run in Node.

| What | Result |
| --- | --- |
| Same engine system as the Phase 3C.2.3 prototype | identical call list |
| Sound against the prototype (A2, 2 N, 4 s) | largest sample difference 7.5e-9 Pa: **-143 dB** re the peak (the 32-bit audio path) |
| Pitch, attack, decay, harmonics against the prototype | identical to the digits shown: 109.879 Hz, loudest at 17 ms, rise 10 ms, T60 3.569 s, harmonics 2/3/4/6 at -3.9/-15.0/-23.8/-3.5 dB |
| Pitch as loaded | 109.88 Hz, **-0.53 cents** from the string formula (A2) |
| Pitch across the ranges (9 settings, 57 to 183 Hz) | -0.80 to +1.20 cents |
| Two plucks equal the sum of each alone | within 1e-5 of the peak |
| 42 plucks a second for 5 s | peak 0.179 Pa against 0.102 for one; no fault; largest sample step in proportion no bigger than one pluck's; level steady; energy gone 4 s after stopping |
| Pluck strength | sound exactly in proportion (4 x force, 4 x pressure) |
| Pluck position, live | matches a string built with that position; plucked in the middle the second harmonic is 20 dB or more down |
| Tension 73.5 to 90 N while ringing | live, no rebuild; pitch 121.58 Hz, the same as a string built at 90 N; stored energy 0.371 mJ before, 0.368 mJ after |
| Tension swept 30 to 120 N and back while plucking | no rebuild, no fault, energy never rises between plucks |
| Energy transfer with the bridge | the soundboard holds up to 0.55 % of the energy; 0.102 Pa peak |
| **Without the bridge** | string energy 0.312 mJ, soundboard energy **exactly 0**, output **exactly 0** |
| Removing and restoring the bridge in the builder | rebuilt, silent, with a note saying why; restored, sounds again |
| Edges of every property (8 combinations, 8 N pluck) | no fault, finite, energy only falls after the pluck, Newton iterations at most 3 |
| Rebuilding | length rebuilds; tension, pluck position and strength do not |
| Undo and redo | through tension, length and bridge edits; the engine follows each step |
| Save and restore | round trip identical; two strings, a string with a bar, a spring in place of the bridge are refused with the reason |
| Switching instruments | each bar example after the string: bit-identical to a bare engine; the string after the bars: identical to its first play |
| Canvas | each part is picked up by its body and connected from its dot; the pluck marker follows the property |
| Existing builder tests (41) | unchanged, passing |

**Browser.** In Chromium, the string example rendered offline through the
real AudioWorklet gives the same peak, the same sum of squares and the same
five spot samples as the Node reference **to all 17 digits**. The page was
also driven live (section 5).

## 5. Real-time performance

Chromium 156 AudioWorklet at 48 kHz on the development machine (Ryzen 5
7430U, 12 threads), **on battery, with another program using 25 to 70 % of
the processor**, through the laptop's speakers, the builder page live. The
worklet's clock resolves 1 ms and its report counts blocks of 2 ms or more
(the budget is 2.67 ms); it does not report the longest block.

| What was done | Engine CPU, of one core | Blocks of 2 ms or more | Blocks processed / expected | Engine faults | Output-device dropouts |
| --- | --- | --- | --- | --- | --- |
| A pluck every 0.29 s for 12 s | 12.2 % | 7 of 4537 | 4537 / 4536 | 0 | 0 |
| 13 plucks a second for 10 s | 14.7 % | 7 of 3761 | 3761 / 3759 | 0 | 0 |
| **906 live edits in 10 s** (tension and pluck position, 90 a second) with plucks | 12.5 % | 1 of 3754 | 3754 / 3754 | 0 | 0 |
| 5 rebuilds in 10 s (length) with plucks | 10.6 % | 1 of 3832 | 3832 / 3840 | 0 | 0 |

- **Slow blocks.** 16 of about 15 900 (0.1 %) took 2 ms or more on the 1 ms
  clock. None caused a dropout: the output device reported none. This is
  comfortable but not empty margin on a loaded machine, and average CPU
  alone would not show it.
- **Memory.** The engine's memory stayed at 3 145 728 bytes throughout (it
  never grows). The page's JavaScript heap went from 51 MB to 109 MB during
  the 906 edits (each edit is a new graph object and a message of about 100
  calls) and was back at 66 MB afterwards. One audio node and one audio
  context existed from start to finish.
- **Pluck cost.** While a pluck's force lasts (0.2 s) the processor steps the
  engine sample by sample; rapid plucking raised the load from 12.2 to
  14.7 %.
- During the rebuild row the count of blocks is 8 short of the wall clock's
  expectation; the two are read at slightly different moments.

## 6. Listening files

`npm run render:string-body` writes 15 files to `renders/string-body/`, with
`listening.json` (pascals and dB SPL at 1 m before any gain, and the gain)
and `comparison.json`.

| Files | What | Peak at 1 m | Gain |
| --- | --- | --- | --- |
| `1a`, `1b` | The builder's instrument and the Phase 3C.2.3 prototype, A2, one pluck | 71.1 dB SPL both | +13.8 dB both |
| `2` | The approved Faust string, A2 | not a pressure | +2.3 dB |
| `3a` to `3e` | Tension 30 / 73.5 / 120 N; length 0.5 / 0.8 m | 71.7 / 71.1 / 70.3 / 72.0 / 73.4 | +11.6 dB all |
| `4a` to `4c` | Plucked at 0.5, 0.8, 0.95 | 72.8 / 71.1 / 69.5 | +1.8 dB all |
| `4d`, `4e` | Plucked at 0.5 N and at 8 N | 59.1 / 83.2 | +1.8 dB |
| `5a` | Eight plucks half a second apart, then sixteen an eighth apart | 72.1 | +12.8 dB |
| `5b` | Tension turned from 73.5 to 100 N over a second while ringing, then plucked again | 71.1 | +13.8 dB |

Without the bridge every sample is zero, so there is no file.

## 7. Limitations

1. **One string.** Multi-string is not offered. Phase 3C.2.3 measured three
   strings as marginal for real time and the bridge's nodal-line position
   as exact for one string only.
2. **One string gauge.** 3.6 g/m. The body was validated from E2 to E4 with
   strings whose gauge changed with pitch; here only tension and length
   change, over 57 to 183 Hz, and pitch stayed within 1.2 cents.
3. **The body is fixed**, and is the body of Phase 3C.2.3 with all of its
   limitations (section 10.4 of [SOUNDBOARD.md](SOUNDBOARD.md)): a 30-litre
   box with a 16 cm screened hole, not a guitar; modest bass; whole-note
   levels that vary with the note.
4. **It cannot share a canvas with bars.** Bars are heard as velocity, the
   string instrument as pressure; one output cannot honestly be both.
5. **The pluck does not damp the string**, so repeated plucks pile up rather
   than restart the note; and it has one hardness (the approved string's).
6. **Quiet at low volume.** A 2 N pluck is 0.1 Pa (71 dB SPL) at 1 m. The
   listening gain after the model is fixed; the volume control has the rest.
7. **Sample rates below 44.1 kHz** would leave fewer than 100 string modes at
   the top of the ranges; a tension change is then still applied live, to
   the modes that exist.
8. **Performance was measured on one machine and one browser**, under load.
   The slow-block count is from a 1 ms clock.
9. **Not heard.** Nobody has listened to it yet.

## 8. Trying it

```
npm run dev
```

Open `http://localhost:5173/builder.html`.

1. In "Load an example…" choose **A string on a damped box body**
   (under "Experimental: string and body").
2. Press **Start audio**, then **Play instrument** (or Space, or
   double-click the string or the body).
3. Select the string. Drag **Tension**: the pitch moves while it rings, and
   the status line does not count a rebuild. Drag **Length**: marked ↻, the
   sound restarts. Change **Pluck position** and **Pluck strength** and
   pluck again.
4. Select the bridge (the line between the two dots) and press **Remove
   connection**: plucking is now silent and a note says why. Drag from the
   string's dot to the body to put it back, or press Undo.
5. The status line shows the sound pressure at 1 m in pascals and dB SPL,
   the engine's load, late blocks, and output-device dropouts.
6. Try to add a second string or a bar: the palette explains why it cannot.
7. Load a bar example and come back: both behave as before.

## 9. Playing it (Phase 3D.1)

Nothing in sections 1 to 8 was taken away, and **the default sound is the
approved one**: with no new gesture in use the instrument produces the
Phase 3C.3 samples (largest difference 7e-20 Pa on a peak of 0.102 Pa; the
browser's offline render gives the same 17 digits as before). The engine is
still unchanged. Not heard: every statement here is a measurement.

| Piece | Where |
| --- | --- |
| The finger, retrigger, pull and release as engine and processor calls | `src/experimental/string/stringBody.ts` (from `buildPlayableStringBody`) |
| Touch envelope, delayed pluck, held force in the AudioWorklet | `src/experimental/wasm/processor.js` |
| Session gestures: `touch`, `pull`, `release` | `src/builder/session.ts`, `translate.ts` |
| Clicking, pulling, the ringing haze, Hold to mute | `src/builder/shapes.ts`, `Canvas.tsx`, `Builder.tsx`, `Inspector.tsx` |
| Tests (24) | `tests/string-playing.test.ts` |
| Listening renders | `analysis/render-string-playing.ts` (`npm run render:string-playing`) |

### 9.1 The finger

One thing was added to the physical system: **a damper between the string's
pluck point and something that does not move**. It has no strength until a
finger is on the string. The finger that plucks is the finger that touches,
so it sits where the string is plucked and moves with the Pluck position.

- **Why a damper.** A soft fingertip resting on a string resists its motion
  and turns that motion into heat. A damper is the one element that can only
  take energy: its force always opposes the motion. Nothing is done to the
  sound; the string itself stops.
- **How strong.** Twice the string's wave impedance, 2 sqrt(T mu): 1.03 N s/m
  at 73.5 N. A damper at one point of a string takes the most from the waves
  passing it when it matches the two halves of string it sits between. Weaker,
  the waves pass it; stronger, they bounce off it as from a fret and the two
  halves ring on. Measured, time for the string to lose 30 dB: 45 ms at half
  this strength, **30 ms at this strength**, 66 ms at four times it. It
  follows the tension.
- **What it cannot do.** It cannot quiet an overtone that does not move
  where it rests. Resting on the middle of a ringing string it removes the
  fundamental altogether and leaves the octave (31 dB down, and more than
  100 dB above the fundamental): a harmonic, as on a real string. Because the
  finger is where the string is plucked, the overtones it cannot reach are
  also the ones that pluck does not excite.
- **It arrives and leaves gradually**, in 2 ms and 4 ms, moved by the
  processor in steps of at most sixteen samples (`['touch', ...]`).

### 9.2 The three ways to excite the string

| | What happens physically | Sound |
| --- | --- | --- |
| **Additive pluck** (Touch before plucking off: the default, and the approved behaviour) | The approved plucking force is added to whatever the string is doing. | A second note 0.5 s after the first differs from a first note by -11 dB in its first 100 ms; notes 8 a second range from 0.088 to 0.103 Pa, with 1.2 mJ still in the string as each is plucked. |
| **Retrigger** (Touch before plucking on) | The finger lands on the string (2 ms), rests (26 ms), and plucks as it leaves (2 ms): the approved pluck, 30 ms after it is asked for. | The old note is 28 to 33 dB down when the new one starts. A second note matches a first note to -45 / -38 / -29 / -27 dB at 1 / 0.5 / 0.25 / 0.15 s after it. 24 notes at 8 a second: every peak 0.1017 Pa. |
| **Pull and release** (drag across the string and let go) | The finger takes hold (it touches, so the string is damped), pulls the string aside with a force that follows the hand, and lets go: the force is removed as fast as the Pluck softness allows. The engine's string really is displaced while held. | Held 2.83 mm aside with 2.00 N it stores 2.82 mJ (the work of pulling it, F d / 2 = 2.83 mJ) and makes 0.0008 Pa. Released, its harmonics are within 0.13 dB of the approved 2 N pluck's and its peak is 0.1007 Pa against 0.1020. |

The force of a pull is the string's own: tension times displacement times
(1/a + 1/b), where a and b are the lengths of string either side of the
finger. At the loaded settings 1 mm takes 0.71 N. It is capped at the
largest Pluck strength (8 N).

**Why pull-and-release sounds like the approved pluck.** The approved pluck
is a force that steps up and dies away in 8 ms. Letting go of a held string
is a force that steps down and stays down. For everything above about 20 Hz
those are the same event, which is why the two agree to a tenth of a
decibel: the approved excitation already was a release.

**Retrigger does not reset anything.** The engine's state is never set by
hand: the old note leaves through the finger's damper, in the 30 ms the
finger rests. That is also its cost: a retriggered note sounds 30 ms after
it is asked for. No click: the finger arriving makes no larger jump between
samples than the string's own motion just before (0.8 to 1.0 times it on a
ringing string; 1.9 times on one that has nearly died away, where both are
small), and at most 0.4 of the jump a pluck itself makes.

### 9.3 Muting

Hold **Hold to mute** (or the M key): the finger rests on the string until
released.

| | Measured |
| --- | --- |
| Energy 0.1 s after the finger lands | -40.2 dB |
| Energy after 0.5 s | -69.1 dB; sound 0.0226 Pa to 0.000003 Pa |
| Energy while touching | never rises, in any block |
| A touch of 12 ms, then released | the note is quieter, not gone, and rings on at its own rate; no click as the finger lifts |
| Plucked while the finger rests on it | a short note: it speaks, and is a thousand times weaker 0.2 s later |
| 300 touches at random, strengths from 0.01 to 1000 N s/m, arriving and leaving in 0 to 20 ms | energy never rises; no fault; Newton iterations at most 3 |

### 9.4 Pluck controls

| Property | Range | | What it is |
| --- | --- | --- | --- |
| Pluck strength | 0.2 to 8 N | live | unchanged |
| Pluck position | 0.05 to 0.95 | live | unchanged; clicking the string sets it to where it was clicked |
| **Pluck softness** | 0 to 1 | live | How the finger lets go: the time the plucking force takes to arrive. It is the approved string's own softness, which was fixed at 0.3; 0.3 gives the approved samples exactly. Share of the sound above 2 kHz: -20.3 dB at 0, -22.8 dB at 0.3, -41.5 dB at 1. |
| **Touch before plucking** | off / on | live | Additive (off) or retrigger (on). A switch, saved with the instrument. |

No pluck duration was added: the approved pluck's length is already set by
its 20 Hz relaxation, and a pulled string is held for as long as the player
holds it.

### 9.5 The playing interface

- **Click the string**: it is plucked there, with the Pluck strength. The
  Pluck position follows.
- **Drag across the string and let go**: it is pulled aside and released.
  A quarter of a millimetre per canvas unit, at most 10 mm; the label by the
  finger shows the displacement and the force. The sideways movement is
  drawn about ten times larger than life, and the legend says so.
- **Drag the grey block at its left end** to move the string on the canvas.
- **The haze around the string** shows that the instrument still holds
  energy (the engine's own figure, read four times a second). It is not the
  string's shape, which moves far too fast to draw, and it is not shown
  while the string is held.
- **Hold to mute**, and the M key.
- Play instrument, Space and the inspector's button work as before.

What the interface shows is what the engine does: a click is the approved
pluck; a drag really displaces the engine's string; the haze is the engine's
energy; the finger is a damper in the engine.

### 9.6 Numerical validation against the approved sound

| | Phase 3C.3 reference | Now, nothing new in use | Pulled 2.83 mm and released |
| --- | --- | --- | --- |
| Pitch | 109.879 Hz (-0.48 cents) | the same | the same |
| Peak at 1 m | 0.1020 Pa, 71.1 dB SPL | the same | 0.1007 Pa, 71.0 dB SPL |
| Loudest at | 17 ms | the same | 17 ms |
| Decay of the fundamental (T60) | 3.569 s | the same | 3.569 s |
| Harmonics 2 / 3 / 4 / 6 against the fundamental | -3.9 / -15.0 / -23.8 / -3.5 dB | the same | -4.0 / -15.1 / -23.9 / -3.6 dB |
| Largest sample difference from the reference | | 6.7e-20 Pa | |

The 18 tests of Phase 3C.3 pass. One of them was changed, in one place: it
asserted that the builder's list of engine calls was the prototype's exactly;
it now asserts that it is the prototype's with one call added, the finger's
damper, and that the reference build is still the prototype's exactly. The
test that compares the sound with the prototype (-143 dB) is untouched.

Also tested (24 tests): 1000 random plucks, touches, pulls and edits in 10 s
(no fault, no rebuild, loudest 1.26 Pa under the 2 Pa ceiling, silent
afterwards with energy never rising); undo and redo of the new properties;
an instrument saved in Phase 3C.3 loads and gets the approved values; a
half-on switch is refused; switching to each bar example with a finger still
on the string gives the bars bit for bit as before; gestures give the same
sound in blocks of 16, 100 and 128 samples; a rebuild forgets fingers and
held forces.

### 9.7 Browser performance

Chromium 156 AudioWorklet at 48 kHz, the builder page live, **mains power,
machine otherwise lightly loaded (20 to 35 %)**. So these are not comparable
with section 5, which was measured on battery under heavier load.

| What was done for 10 s | Engine CPU, of one core | Blocks of 2 ms or more | Blocks processed / expected | Faults | Device dropouts |
| --- | --- | --- | --- | --- | --- |
| Nothing (the finger's damper present, off) | 5.0 % | 0 | 3060 / 3057 | 0 | 0 |
| Additive plucks, 6 a second | 7.1 % | 0 | 3783 / 3782 | 0 | 0 |
| Retriggered plucks, 4 a second | 6.5 % | 0 | 3885 / 3912 | 0 | 0 |
| Pluck, touch, release, 3 of each a second | 6.9 % | 0 | 3754 / 3756 | 0 | 0 |
| Pulling: a new displacement 44 times a second, let go three times in two seconds | 6.4 % | 0 | 3753 / 3755 | 0 | 0 |
| String held aside for 5 s (the engine stepped a sample at a time) | 6.9 % | 0 | 1962 / 1960 | 0 | 0 |

- The finger's damper is one more connection on the string. In Node the same
  note costs 6.1 % of a core with it against 5.7 % without (about a twelfth
  more).
- Applying a force costs the most: while a string is held or a pluck's force
  lasts the engine is stepped one sample at a time, 6.9 % against 5.0 %.
- Engine memory stayed at 3 145 728 bytes. The page's heap moved between 39
  and 70 MB with no trend; one audio node and one context throughout.
- The retrigger row counted 27 fewer blocks than the wall clock expected
  (0.7 %); the two are read at slightly different moments and no slow block
  or dropout was reported.

### 9.8 Listening files

`npm run render:string-playing` writes 13 files to `renders/string-playing/`,
with `listening.json` (pascals and dB SPL at 1 m before any gain, and the
gain) and `comparison.json`. Files in a pair share one gain.

| Files | What | Peak at 1 m | Gain |
| --- | --- | --- | --- |
| `1a`, `1b` | The approved pluck: Phase 3C.3 reference, and the instrument now | 71.1 dB SPL both | +13.8 dB both |
| `2`, `3` | Six slow notes then sixteen fast: retriggered, and additive | 71.2 / 72.1 | +12.8 dB both |
| `4` | Finger damping: a note touched for 5, 15, 40 and 120 ms | 71.1 | +13.8 dB |
| `5` | A note stopped by the finger; five plucks with the finger on; five with it off | 73.1 | +11.9 dB |
| `6` | Pluck strength 0.5, 1, 2, 4, 8 N | 83.2 | +1.8 dB |
| `7` | Pluck position 0.20 to 0.95 | 72.8 | +12.1 dB |
| `8` | Pluck softness 0, 0.3, 0.7, 1 | 72.5 | +12.5 dB |
| `9a`, `9b` | Pulled 2.83 mm and released; the approved 2 N pluck | 71.0 / 71.1 | +13.8 dB both |
| `10` | A finger on the middle of a ringing string leaves its octave | 68.9 | +16.1 dB |
| `11` | A short performance on one string: retriggered notes growing in strength, muted notes, a bend by tension, an additive roll stopped by the finger, a harmonic | 78.3 | +6.6 dB |

### 9.9 Limitations

1. **Retrigger is 30 ms late**, by design: that is how long the finger
   rests. A shorter rest leaves more of the old note.
2. **One finger, at the pluck point.** It cannot damp an overtone with a
   still point there. There is no separate muting hand (a palm by the
   bridge).
3. **The finger is a pure damper**: no mass, no stiffness, no width. A real
   fingertip also detunes the string slightly and, pressed hard, stops it
   like a fret. Pressing hard is not offered.
4. **Retuning a held string leaves a small still stress.** The engine's live
   retune keeps each part's stored energy; done while a finger holds the
   string aside, it leaves the parts pressing on each other after the finger
   goes. It moves nothing and makes no sound, was 4.7 microjoules after a
   thousand random gestures (a pluck is about 300), and a rebuild clears it.
5. **The haze updates four times a second** and shows total energy, not the
   string's motion.
6. **The pull is drawn ten times larger than life** across the string.
7. **Touch needs a pointer or the keyboard**: there is no pressure
   sensitivity; the finger is either on or off.
8. The limitations of section 7 remain, except that item 5 (the pluck does
   not damp the string) is now a choice.

### 9.10 Trying each interaction

Load **A string on a damped box body**, press **Start audio**.

1. **Approved pluck.** Press Play instrument or Space.
2. **Click to pluck.** Click the string in different places: the orange
   marker follows, and the tone changes with the place.
3. **Additive.** With Touch before plucking off, press Space quickly several
   times: the notes pile up.
4. **Retrigger.** Select the string, switch **Touch before plucking** on,
   and press Space the same way: each note starts clean.
5. **Mute.** Pluck, then hold **Hold to mute** or the M key. Tap it briefly
   to take only part of the note away.
6. **Muted notes.** Hold M and pluck.
7. **Pull and release.** Press on the string, drag up or down, read the
   millimetres and newtons, and let go. Grab it while it is ringing: it
   stops as you take hold.
8. **A harmonic.** Click the string a third of the way along (a pluck in
   the middle would not sound the octave at all). While it rings, type 0.5
   into Pluck position in the inspector, which moves the finger without
   plucking, and hold M: the fundamental stops and the octave is left.
9. **Softness.** Drag Pluck softness from 0 to 1 and pluck.
10. **Tension while ringing**, Undo, Redo, reload the page (the instrument
    and its switch come back), and load a bar example and return.
