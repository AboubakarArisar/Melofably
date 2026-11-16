# The hybrid lab: playing the bar-as-bridge instrument (Phase 3D.12)

Phases 3D.9 to 3D.11 established, by measurement, an instrument in which a
string is tied to a small aluminium bar that stands on the approved
soundboard: it can be plucked, struck, muted and damped. Nobody had played
it. This phase puts it on a page where it can be played in real time and
judged by ear.

It is a usability and validation phase. No new physics was added.

*Phase 3D.13 used the page as a player would and corrected what it found:
four defects, new starting strengths (4 N and 0.5 m/s), the model's level
shown beside both strength controls, latency figures and a listening
checklist. See [HYBRID_LAB_PLAYABILITY.md](HYBRID_LAB_PLAYABILITY.md).
Where this document and that one differ about the page, that one is
current.*

- **Page:** `hybrid-lab.html`. Run `npm run dev` and open
  `http://localhost:5173/hybrid-lab.html` (or whatever port Vite reports;
  development only, like
  `experimental.html`; it is not part of the production build).
- **Separate from everything approved.** The four approved instruments, the
  builder, the production engine (`assembly/engine.ts`) and the engine's
  AudioWorklet processor (`src/experimental/wasm/processor.js`) are not
  modified. No earlier research configuration is changed.
- **Everything heard is the validated model.** The output is the approved
  body's radiated sound pressure, by the approved radiation conversion.
  There is no sample, filter, compressor, fade or added resonance. A sound
  stops because a damper in the model took its energy.

I cannot hear audio. I have driven the page in Chromium and measured what
the engine did; I have not listened to it, and nothing here is a listening
approval.

## 1. Baseline

Before editing: HEAD was `d67cc54` with nothing after it; working tree
clean; 418 tests passed; lint and build exited 0; the four reference WAV
hashes were unchanged. `d67cc54` was tagged `phase-3d11-approved` (it was
not tagged before).

## 2. What was built

| file | what it is |
|---|---|
| `hybrid-lab.html` | the page: controls, a schematic, a listening procedure, diagnostics |
| `src/experimental/hybrid/lab.ts` | the page's code: audio context and node, buttons, keys, picture, diagnostics |
| `src/experimental/hybrid/instrument.ts` | what the controls mean to the engine: which instrument is built, and the engine calls each action sends. Pure functions and one small class, tested in Node |
| `src/experimental/hybrid/hybrid-processor.js` | an experimental AudioWorklet processor that **extends** the engine's own: several fingers at once, and timing |
| `src/experimental/hybrid/capture.js` | six lines that let the processor above extend the engine's without that file being edited |
| `analysis/hybrid-worklet.ts` | runs the same three worklet files in Node, in the browser's order, for the tests |
| `tests/hybrid-lab.test.ts` | 12 tests |

### The instruments

Three choices, each built once and then only played:

| choice | what it is |
|---|---|
| Hybrid, string tied at 0.20 of the bar (default) | Phase 3D.11's `dampable(0.5)`: the sixth-harmonic bar, the 5 g striker |
| Hybrid, string tied at 0.18 | `dampable(0.5, 0.18)`: the same with the other tie |
| Approved string on its body | the builder's string instrument, for comparison; the bar's controls are disabled |

To each the page adds only things that cost the model nothing while unused:

- **Six places to pluck the string** (0.5, 0.65, 0.75, 0.8, 0.85, 0.9 of
  its length). These are extra read-and-force points on the string
  resonator; they add no connection and do not enter the solver. The
  string's mute stays where the approved instrument has it (0.8).
- **Three places for a finger on the bar** (the middle, the end by the
  string, by the string's tie: the three distinct effects found in Phase
  3D.11). Each is a spring-and-damper connection of no strength until
  touched, exactly as Phase 3D.11's one was.

**Unused, these change nothing.** In the tests, each hybrid plucked and
struck through the lab is identical, sample for sample, to its Phase 3D.11
reference on the engine's own processor, and the approved string through
the lab is identical to the approved string.

### Controls

| | control | what reaches the engine |
|---|---|---|
| String | Pluck (`A`) | the approved string's pluck, at the chosen place and force |
| | Pluck strength | 0.5 to 8 N |
| | Pluck position | one of the six places |
| | Mute string (button toggles; hold `M`) | the approved instrument's finger on the string: lands in 2 ms, leaves in 4 ms |
| Bar | Strike (`S`), Gentle/Medium/Strong (`1` `2` `3`) | the 5 g striker thrown at the bar's middle at 0.25 to 2 m/s (0.5, 1, 2 for the three) |
| | Damp bar (button toggles; hold `D`) | Phase 3D.11's finger: lands in 4 ms, leaves in 8 ms |
| | Damping position | which of the three places. Moving a finger that is down lifts it where it was and lays it where it now is |
| | Damping strength | light, medium, firm, palm. Changing it with the finger down changes its pressure where it is; it does not land again |
| Audio | Instrument | builds another instrument (see below) |
| | Listening volume | one plain gain after the instrument, the same for every choice: an amplifier's volume knob, not gain compensation |

Mouse, touch and pen act on press (not on release), for immediacy; the
keyboard works both through the keys above and through Tab and Enter on
every control. A key held when the window loses focus is treated as let
go.

Not added, as instructed: MIDI, recording, sequencing, presets, export.

**Levels.** The audio node's ceiling is 8 Pa for every instrument. A strong
stroke peaks at about 4.1 Pa (−5.8 dB re the ceiling); a 2 N pluck at 0.19
Pa (−32.6 dB). At one volume setting plucks are therefore much quieter
than strokes. That is the instrument (Phase 3D.10), not the page, and the
page does not hide it. If the volume is turned up for plucks and a stroke
then passes full scale, the diagnostics say so in words.

### Changing the attachment

The tie's place is part of the bar's mode shapes, so 0.20 and 0.18 are
different models. Choosing another instrument **makes a new engine**: the
old node is stopped and disconnected, a new processor is created for the
new choice, and the page's control state (both fingers) starts lifted. The
page says this next to the selector. Nothing can carry over, because
nothing is shared; the tests check that an instrument reached by switching
is identical to the same instrument built first. Ordinary playing never
rebuilds anything: plucking, striking, both fingers, pluck position,
damping position and damping strength are all messages to the running
engine.

### Starting, stopping, errors

- Audio is created only by the Start button (a user gesture).
- The instrument is built at whatever sample rate the browser's context
  has (tested at 44.1, 48 and 96 kHz).
- A browser with no AudioWorklet, a processor that fails to load or to
  answer within 10 s, an engine that fails to build, and an error while
  running are each reported in words at the top of the page; the audio
  context is closed and Start is offered again.
- Stop closes the context; Start makes a new one.

## 3. Two fingers at once

**The limitation.** The engine's processor has one `touch`: it moves one
finger's damper along its ramp and remembers only that one. A second
`touch` on another connection abandons the first where it stands. Phase
3D.11's harness worked round this by spacing gestures; a page a person
plays cannot.

**What was done.** `hybrid-processor.js` is a subclass of the engine's
processor that takes over the `touch` call and nothing else of playing:

- every touched connection has its own slot (up to four: the string's
  finger and the three places on the bar);
- each slot is advanced by the same arithmetic as the engine's processor
  uses for its one finger, copied line for line;
- the engine's processor's own finger is used only to tell its loop how
  finely to step (16 samples at a time while any finger is moving), which
  is what it did before.

A finger is still only the engine's own damper (`setDamping`); the bar
finger's spring is still stiffened by the engine's own ramp, which counts
the work it does. Nothing is serialized: two gestures sent in the same
message both begin at that sample.

**Why a subclass and not an edit.** The engine's processor is the
builder's audio path. Extending it leaves that file byte-for-byte as it
was, so the builder cannot be affected, while the lab still runs the same
code for everything except fingers and timing. The cost is `capture.js`,
which notes the engine's processor class as it registers so that the
subclass can name it.

**Evidence** (tests):

| requirement | result |
|---|---|
| With one finger, nothing has changed | a phrase with a pluck, a stroke, a mute, a release, a retrigger and a bar touch and release is identical, sample for sample, on the engine's processor and on the lab's; so is the approved string instrument |
| Both gestures engage and release independently | sent together, after 64 samples the string's damper is at 64/96 of its value and the bar's at 64/192 of its own, exactly; each then rests or leaves on its own schedule while the other does something else |
| Their transitions do not interfere | the order in which two simultaneous gestures are sent makes no difference to any sample; with both down the string is as muted as by the mute alone (within 2 %) |
| The old behaviour really was a limitation | the engine's own processor, sent the same two gestures, leaves the string ringing: over a thousand times more string energy half a second later |
| Energy accounting stays valid | through nine overlapping moves of both fingers (landing during the other's landing, leaving during the other's leaving, moved, pressed harder) the instrument's loss equals what was dissipated less what the stiffening spring is counted as giving, to better than 10⁻⁹; that work is under 0.5 % of the loss; once every finger has settled, energy never rises |
| Rapid repeated gestures are deterministic | two seconds of events every 8 ms (plucks, strokes, both fingers, place and pressure changes), run twice: identical samples; no fault; at most 6 solver iterations; every finger off at the end, every finger spring at zero stiffness |
| No unexpected clicks | both fingers landing at once on a ringing instrument: no rougher than the instrument left alone (under 1 dB) |

**Remaining limitation, stated.** Four fingers is the page's maximum (it
has four). Moving the bar's finger quickly between all three places while
the string is also touched uses all four slots; a fifth simultaneous
finger is refused with an error message, not silently dropped. The page
cannot ask for a fifth.

## 4. Timing diagnostics

Measured in the audio thread by the lab's processor, in one
`Float64Array` made when the processor is made. `process()` allocates
nothing, logs nothing and posts nothing; the numbers are sent only when
the page asks (about three times a second), from the message handler,
between blocks. In the tests, a processor asked for its numbers every
block produces the same samples as one never asked.

| shown | how it is obtained |
|---|---|
| processing time per block: mean, worst, distribution | clock read before and after the engine's `process()` |
| blocks longer than a block's duration (2.67 ms at 48 kHz) | the same, compared with the quantum |
| time between calls: mean and longest | clock at the start of successive calls |
| solver iterations (worst), engine faults, memory | the engine |
| output peak in Pa; blocks at the node's ceiling | the output block |
| underruns and their duration | `AudioContext.playbackStats`, where the browser provides it: **the browser's report of the device, not an engine measurement** |
| audio clock behind the wall clock | `currentTime` against `performance.now()` on the main thread since counting began: **an inference** (it grows when blocks are not delivered) |

**The clock.** The processor uses `performance.now()` if the worklet
scope has it and `Date.now()` otherwise. **In the Chromium tested here
(156, embedded) an audio worklet has no `performance`**, so the clock is
`Date.now()`, which counts whole milliseconds. I could not find a finer
clock that is available inside a worklet without making the page
cross-origin isolated and running a second thread purely as a clock, which
is not a narrow change and was not made.

What a millisecond clock can and cannot say is built into what the page
reports, not left to the reader:

- A reading of *r* ms means the block took between *r* − 1 and *r* + 1 ms.
- The **mean** over many blocks is accurate, because the errors average
  out.
- An overrun is reported as **certain** only when *r* − 1 exceeds the
  quantum (a reading of 4 ms or more at 48 kHz).
- Readings of 2 and 3 ms are reported separately as **possible**: the
  clock cannot place them on either side of 2.67 ms.
- The distribution is shown as counts of readings (0 ms, 1 ms, 2 ms, …),
  labelled as readings.

A test feeds the processor a clock that reads 0, 1, 2, 3, 4 and 12 ms and
checks exactly that classification. With a fine clock (as in Node) there
are no "possible" overruns and the distribution is in fractions of a
millisecond.

"Time between calls" needs a caution that the page also gives: the browser
asks for several blocks at a time (here in batches about 10 ms apart), so
gaps longer than one block are normal and are not underruns.

## 5. Validation in Chromium

The page was loaded in the embedded Chromium, started with a real click,
and then driven through its own controls (pointer and key events on the
page's elements), reading the engine's state through the diagnostics.
This is what each control did to the model:

| action on the page | measured in the engine |
|---|---|
| pluck at 0.5 N, then at 8 N | string energy 0.098 mJ and 25.0 mJ: a ratio of 256.0, which is 16² |
| pluck at 0.5, 0.75 and 0.8 of the string | the bar holds 0.034, 2.5 and 0.62 µJ 150 ms later: the pluck place decides how much the bar gets (Phase 3D.10) |
| keys `1`, `2`, `3` | bar energy 37, 145 and 565 µJ 40 ms later: ×3.9 per doubling of speed |
| strike slider at 0.5 m/s, Strike button | 37 µJ: the same as `1` |
| hold `M` after a pluck | string finger landing, then resting at 1.03 N s/m; string energy 768 µJ → 0.0024 µJ in 0.3 s; button shown pressed; on release, no finger |
| Damp button after a stroke | bar energy 114 → 2.5 µJ in 60 ms; bar finger resting at 6 N s/m |
| strength to firm with the finger down | the same finger at 20 N s/m |
| position to "end by the string" with the finger down | the first finger gone, the second resting at 20 N s/m |
| `A` and `2` together, then `M` and `D` together | both fingers landing in the same block; 0.4 s later string 0.025 µJ, bar 0.00007 µJ |
| release `M` while `D` is held | the string's finger leaves; the bar's stays at 6 N s/m |
| 40 rapid events in one second (both fingers, plucks, strokes) | no fault; 3 solver iterations at most; no finger left down; every finger spring at zero |
| choose "tied at 0.18" while a pluck rings and `D` is held | new instrument: energy 0, no fingers, controls lifted; a stroke then gives 90 µJ in the bar |
| choose "Approved string" | Strike and Damp disabled; pluck gives string energy; no error |
| Stop, then Start, then pluck | stopped (controls disabled); running again; string energy 1.35 mJ; no error |

No console error occurred. The schematic was checked in a screenshot: bar,
pads, string, tie, pluck place and both finger markers are drawn where the
model has them.

I did not test on a touch device or in another browser. Touch input uses
the same pointer events as the mouse, which were exercised.

## 6. Performance in Chromium

The page's own `bench()` (from the console:
`sonicmatterHybridLab.bench(20, true)`) plays by itself: a pluck and a
medium stroke in turn every 100 ms and, with gestures, the string's finger
toggling every 500 ms and the bar's every 300 ms, so that they overlap in
every combination. 20 s each, two rounds, 48 kHz, with a 10 s empty
AudioContext before each round as a control.

| | mean per block (run 1 / 2) | share of the 2.67 ms block | worst reading | certainly over | possibly over, of ≈7520 | readings 0 / 1 / 2 ms (run 1) | device underruns |
|---|---|---|---|---|---|---|---|
| empty AudioContext, 10 s | — | — | — | — | — | — | 1 / 1 |
| approved string, plucked | 0.277 / 0.288 ms | 10.4 / 10.8 % | 2 / 1 ms | 0 / 0 | 1 / 0 | 5430 / 2080 / 1 | 0 / 0 |
| hybrid 0.20, plucked and struck | 0.481 / 0.451 ms | 18.0 / 16.9 % | 2 / 2 ms | 0 / 0 | 2 / 1 | 3906 / 3618 / 2 | 0 / 0 |
| hybrid 0.20, both fingers going down and up | 0.461 / 0.485 ms | 17.3 / 18.2 % | 2 / 1 ms | 0 / 0 | 3 / 0 | 4063 / 3464 / 3 | 0 / 0 |
| hybrid 0.18, both fingers going down and up | 0.493 / 0.477 ms | 18.5 / 17.9 % | 2 / 2 ms | 0 / 0 | 2 / 3 | 3818 / 3714 / 2 | 0 / 0 |

In every run: no engine fault, at most 3 solver iterations, memory
3 145 728 bytes, no block at the node's ceiling (peak 2.0 to 2.2 Pa), mean
time between calls 2.666 ms with a longest gap of 10 to 11 ms (the
browser's batches), and the audio clock within 5 ms of the wall clock in
either direction (which is the noise of that comparison, not a drift).

Reading it:

- The instrument uses about 18 % of one block's time on average, whether
  or not the fingers are being used, and 1.7 times what the approved
  string instrument uses.
- **No block was certainly over its deadline** in 160 s of playing.
- **0 to 3 blocks per 7500 read 2 ms**, which means they took between 1
  and 3 ms and may or may not have exceeded 2.67 ms. No block read 3 ms or
  more. In Phase 3D.11 this engine's blocks, timed in Node with a
  microsecond clock, had a 99.9th percentile of 1.05 ms; a reading of
  2 ms is consistent with that tail.
- No device underrun was reported while the instrument played. One was
  reported in each 10 s control with nothing running, so the device's own
  behaviour is at least as large as anything the engine could be blamed
  for.
- This is one machine, one embedded browser, 160 s. **It is not a
  demonstration of real-time safety and I do not claim one.**

Node cost was not re-measured: the engine and the model are those of Phase
3D.11 (15 % of a core there), and each extra bar finger adds one
connection.

## 7. How to listen

The same procedure is on the page ("How to listen"). It covers the eight
comparisons asked for:

1. Start audio. Set the volume with a **medium strike** (`2`) so that it
   is comfortable, and leave it there for steps 2 to 8. Plucks will be
   quiet: that is how much quieter a pluck is than a stroke.
2. **Approved string instrument.** Choose "Approved string on its body".
   Pluck (`A`) a few times at 2 N, position 0.8.
3. **Bar-as-bridge reference.** Choose "Hybrid: string tied at 0.20". The
   same plucks. Then positions 0.5, 0.75 and 0.9.
4. **Attachment 0.20 against 0.18.** Pluck, then strike (`2`) and let it
   ring; change to "tied at 0.18" and repeat.
5. **Bar without damping.** Tied at 0.20: strike (`2`) and let it die
   away.
6. **Bar with damping.** Strike and, a moment later, hold `D`. Then hold
   `D` first and strike. Try the three positions and the strengths.
7. **Gentle and medium strikes.** `1`, then `2`; then `3`.
8. **Pluck and strike together.** `A` and `2` at once. Then again and
   hold `D` (the bar stops, the string goes on), or `M` (the string stops,
   the bar goes on), or both.
9. To compare plucks closely, raise the volume for them, and lower it
   before striking.

The page does not rank anything. The model's sound pressure is not
calibrated, and your loudspeakers or headphones are part of what you hear.
For a like-for-like comparison of fixed recordings, the files of Phases
3D.10 and 3D.11 (`renders/bar-bridge`, `renders/bar-damping`) remain.

## 8. Regression

- The four reference WAV hashes are unchanged.
- **Not modified:** `assembly/engine.ts`, `src/experimental/wasm/**`
  (including the processor), `src/audio/**`, `src/App.tsx`,
  `src/builder/**`, `src/experimental/string/**`,
  `src/experimental/page/**`, `experimental.html`, `index.html`,
  `vite.config.ts`, the engine fixture. Every earlier test passes
  unchanged, so the builder, the approved instruments and the earlier
  prototypes behave as they did.
- **New only:** `hybrid-lab.html`, `src/experimental/hybrid/` (four
  files), `analysis/hybrid-worklet.ts`, `tests/hybrid-lab.test.ts`, this
  document. README, ROADMAP and TESTING gain a few lines.
- The production build does not include the page (it has a single entry,
  `index.html`, as before). Built with and without this phase's files,
  every file in `dist/assets` is byte-for-byte the same.
- The suite is 430 tests in 29 files (418 + 12 new).

## 9. Decision gate

1. **Can the hybrid be played interactively in Chromium?** Yes. It
   starts on a click, plays from buttons and keys, and was driven through
   every control.
2. **Do the controls trigger the intended physical events?** Yes: each
   was checked against the engine's energies and finger states (section
   5), and the exact engine calls are tested.
3. **Can string muting and bar damping overlap independently?** Yes, with
   the lab's processor: same-sample engagement, independent ramps, order
   irrelevant, books balanced.
4. **Does it remain stable under repeated playing?** Yes: no fault and at
   most 3 solver iterations in 160 s of automatic playing in the browser,
   at most 6 in the densest test; deterministic.
5. **Are attachment configurations reproducible?** Yes: each is a new
   engine identical to its Phase 3D.11 reference, and switching back and
   forth gives identical samples.
6. **Is AudioWorklet performance acceptable in the tested environment?**
   On the evidence available, yes: about 18 % of a block on average, no
   certain overrun, no device underrun while playing. Subject to 7.
7. **Are the timing measurements reliable enough to identify deadline
   overruns?** Only partly. Overruns of 3 ms or more would be identified
   with certainty; a block between 2.67 and 3 ms cannot be told from one
   just under the deadline, because this browser gives an audio worklet
   only a millisecond clock. The page reports the two cases separately.
8. **Are approved instruments and the builder unchanged?** Yes: no file
   of theirs was edited.
9. **What usability or audio defects remain?**
   - Plucks are 27 dB quieter than strong strokes at one volume. Real, and
     left as it is; the listening procedure works round it.
   - The pluck is linear: harder is only louder (Phase 3D.10).
   - The string is muted at 0.8 of its length wherever it is plucked.
   - Latency is the browser's (about 10 ms base plus about 40 ms output
     here) plus up to one block for a message to arrive; not measured end
     to end.
   - Events are applied at the start of the next block (2.67 ms
     granularity), not at the sample.
   - Not tested on a touch screen or in Firefox or Safari.
   - The picture is a schematic; the glow follows energy three times a
     second, not vibration.
   - No sub-millisecond deadline measurement.
10. **Is the standalone prototype ready for your listening evaluation?**
    Yes. That evaluation is the one thing this project now lacks.

## 10. Recommendation

Play it, following section 7. What you hear decides what, if anything, is
worth doing next: the tie, the striker, where the finger belongs, whether
the pluck-to-stroke balance is acceptable, and whether the instrument is
worth bringing into the builder at all. I have not begun Phase 3D.13 or
any builder integration.
