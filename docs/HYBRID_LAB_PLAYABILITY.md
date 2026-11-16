# The hybrid lab under real use: audit, latency, fixes (Phase 3D.13)

Phase 3D.12 made a page, `hybrid-lab.html`, on which the bar-as-bridge
instrument can be played. This phase used it the way a player would,
looked for what goes wrong, measured how quickly it answers, and fixed
what was demonstrably broken. No instrument physics was added or changed.

- **Unchanged:** the production engine, the engine's AudioWorklet
  processor, the builder, the four approved instruments, every earlier
  research configuration, and the sound of everything.
- **Changed:** only the lab's own files (`hybrid-lab.html` and
  `src/experimental/hybrid/`), plus tests and documents.

I cannot hear audio. Everything here was measured in the engine or
reported by the browser; nothing was listened to, and nothing here is a
listening approval. Where a figure is the browser's own estimate rather
than a measurement, it says so.

Reproduce: `npm run render:hybrid-lab`
(`renders/hybrid-lab/measurements.json`), `tests/hybrid-lab.test.ts`, and
in the browser `sonicmatterHybridLab.bench(seconds, gestures, every,
strong)` from the console.

**In short.**

- Four reproducible defects were found and fixed: the playing keys died
  after using a drop-down list; a suspended audio context could not be
  resumed and played stored notes late; tapping `M` or `D` cancelled a
  latched button; and the strength sliders were too narrow to set (almost
  unusable at phone width).
- No playing event was dropped, duplicated or reordered in about 7000
  numbered events, including 30 a second and both fingers together.
- A playing action reaches the engine about 0.3 ms after it is posted
  (measured). It then takes effect at the start of the browser's next
  batch of blocks, which come every 10 ms here. The browser's own estimate
  of input to sound leaving the device is 48 ms on average (42 to 54).
  Loudspeaker and air are not included; I did not measure acoustic output.
- Sample-offset scheduling was investigated and **not** implemented: it
  could only smooth a 10 ms timing spread by adding about 10 ms to a
  latency that is already about 48 ms.
- Plucks (55 to 79 dB) and strokes (69 to 89 dB) overlap between 69 and
  79 dB. The page now starts inside that overlap (4 N, 0.5 m/s: 2.6 dB
  apart) and shows the model's level beside both strength controls.
  Nothing is done to the sound.
- Five minutes of continuous playing in Chromium: no fault, no certain
  overrun, no device underrun, no memory growth. Real-time safety is still
  not something a millisecond clock can prove.

## 1. Baseline

Before editing: HEAD was `ca51a9e` with nothing after it; working tree
clean; 430 tests passed; lint and build exited 0; the four reference WAV
hashes were unchanged. `ca51a9e` was tagged `phase-3d12-approved` (it was
not tagged before).

## 2. Audit of the page as it was

Done on the unmodified Phase 3D.12 page, in the embedded Chromium, before
any fix.

| checked | result |
|---|---|
| Audio starts only after user interaction | Yes: no AudioContext exists before the Start click; playing actions before it do nothing |
| A failed start is reported | Yes: with the engine's download made to fail, the page said "Physics engine: could not load engine.wasm (HTTP 404)", closed the context, and offered Start again, which then worked |
| A real click on Pluck plucks once | Yes: one `pointerdown` and one `click` arrived; string energy was that of one pluck |
| Enter on the focused Pluck button plucks once | Yes |
| Pluck and strike trigger correctly | Yes (Phase 3D.12's measurements repeated) |
| Mute and damp independent | Yes |
| Instrument switching resets state | Yes: new engine, energy 0, no fingers |
| Stop and restart | Yes |
| **Keys after using a list** | **Defect 1** |
| **Suspended audio** | **Defect 2** |
| **Latched button and its key** | **Defect 3** |
| **Slider width** (found during device validation, section 8) | **Defect 4** |

### Defect 1: the playing keys stop working after choosing from a list

*Reproduction.* Start; choose a pluck position (or any other list); press
`A`. Nothing sounds. Measured: with the list focused, `A` left the string
at 1.2 × 10⁻¹⁰ J; with nothing focused the same key gave 1.40 mJ. After a
choice the list still had the keyboard.

*Cause.* The page rightly ignores letters while a list has the keyboard,
because a list uses them itself (`m` jumps to "medium"). But a list keeps
the keyboard after a choice, so every playing key stayed dead until the
player clicked elsewhere.

*Fix.* Once a choice is made the list gives the keyboard back. While a
list is open or focused its letters are still its own, and Tab still
reaches every list.

*Verified.* After a choice the focus is on the page; `A` plucks (6.8 mJ at
the new 4 N default); with a list deliberately focused a letter still does
not pluck.

### Defect 2: a suspended audio context cannot be resumed, and plays stored notes late

*Reproduction.* With the instrument running, the audio context becomes
suspended (a browser can do this; here it was done with
`context.suspend()`). Measured on the old page:

- the state line said "suspended", but Start stayed disabled and there was
  no way to resume;
- Pluck and Strike stayed enabled, and the diagnostics froze on "audio:
  running";
- a pluck and a stroke made while suspended were accepted by the engine
  (its energy went from 2.5 × 10⁻¹² J to 2.5 mJ while no block was
  rendered) and **sounded 1.5 s later** when the context was resumed
  (string 2.07 mJ, bar 97 µJ, 60 ms after resuming).

*Cause.* The engine is told things by message and acts on them whether or
not blocks are being asked of it. The page never checked.

*Fix.* The page sends playing actions only while the context is running.
While it is suspended or interrupted, the playing controls are disabled,
the state line says what happened and what to press, the Start button
becomes "Resume audio", and the diagnostics keep reporting.

*Verified.* Suspended: "suspended by the browser: press Resume audio";
Resume enabled; Pluck and Strike disabled; keys and a press on Pluck sent
0 messages; on resuming nothing played (energy 2 × 10⁻⁷ J and falling);
then `A` plucked normally.

### Defect 3: tapping a key cancels a latched button

*Reproduction.* Click "Mute string" (it stays down), then tap `M`. The
mute lifts and the button pops up.

*Cause.* Button and key drove one on/off state, so the key's release
switched off what the button had latched.

*Fix.* A finger is down while its button is latched **or** its key is
held. Each is remembered separately. Under each button the page now says
which is holding it: "down (latched: press the button again to lift)" or
"down (while the key is held)".

*Verified.* Latch, tap the key: still down and still latched, and nothing
further is sent to the engine. Hold the key, latch, release the key: still
down.

### Defect 4: the strength sliders were too narrow

*Reproduction.* At a phone's width (375 px) the three sliders were
squeezed between their name and their value to a few pixels. On a desktop,
once the level text of section 6 was added beside them, the two strength
sliders were 101 px wide for 75 and 35 steps.

*Fix.* Name, slider and value are stacked where there is no room beside
each other (always in the two half-width panels; everywhere below 600
px). On a touch screen buttons and lists are at least 44 px high (they
were 38).

*Verified.* 375 px wide: sliders 310 px, no sideways scrolling. Desktop:
strength sliders 409 px.

## 3. Latency

Each playing message now carries a number, and the lab's processor answers
with where the audio clock stood when it acted on it. Nothing in this path
touches the audio callback: the answer is posted from the message handler,
between blocks.

### What was measured directly

| stage | result | how |
|---|---|---|
| input event → the page's handler | mean 0.21 ms (0.1 to 0.4), 30 key presses | `event.timeStamp` against `performance.now()` in the handler. The keys were injected by the automation, not pressed on a keyboard: this is the browser's event delivery, not a keyboard's scan time |
| handler → message posted | mean 0.04 ms (0 to 0.1) | `performance.now()` either side |
| posted → acted on by the engine | mean 0.38 ms; readings 0 ms ×284, 1 ms ×84, 2 ms ×28, 3 ms ×4 (400 events) | `Date.now()` on both threads: each reading is good to about a millisecond, the mean is accurate |
| the block it takes effect from | always a block boundary (frame a multiple of 128), and **only blocks 0, 4, 8 and 12 of every 15** | the audio context's own frame counter, exact |

The last row is the important one. The browser does not ask for blocks one
at a time: it asks for a batch (here 4, 4, 4, 3 blocks, 1920 frames every
40 ms, so a batch every 10 ms) and runs them back to back. Messages are
handled between batches. **An action therefore takes effect at the start
of the next batch, up to 10 ms after it arrives, not at the next 2.67 ms
block.** The granularity of control is the device's callback period, which
the page does not set.

### What is the browser's estimate, not a measurement

| | value |
|---|---|
| input → that sample leaving the output device (from `getOutputTimestamp()`) | mean 47.9 ms, standard deviation 3.1 ms, 41.9 to 53.6 ms (400 events); 48.5 ms (42.6 to 53.8) for the 30 key presses |
| the browser's stated latencies | 10 ms (`baseLatency`) + 40 ms (`outputLatency`) |
| the same with other latency hints | `interactive`, `balanced` and `0`: 10 + 40 ms; `playback`: 20 + 48 ms. The page already asks for the lowest |

So about 48 ms from input to the device on this machine, of which 40 ms is
the output device as the browser reports it, with a spread of about 12 ms
(one batch plus one block) from where in a batch an action happens to
arrive.

**Not measured:** the device's real delay, the loudspeaker, the air, or a
keyboard's or touch screen's own delay. That needs a microphone and an
external reference, which I do not have. I make no claim about acoustic
latency.

### Should actions be scheduled at a sample offset?

Investigated; **not implemented**. The reasoning, from the measurements:

- Placing an action at an offset *inside* a block gains nothing: the
  delay is not to the next block but to the next batch.
- The spread could be removed only by delaying every action by a fixed
  amount of at least one batch (about 10 ms) and placing it at the right
  sample of a later block. That exchanges a 3 ms standard deviation for
  about 10 ms more latency, 48 to about 58 ms.
- It would need the audio thread to map wall-clock time to sample time
  with a millisecond clock, and to run control calls inside the audio
  callback rather than between blocks. Neither is narrow.

Whether a timing spread of this size or a latency of this size is
perceptible is a listening question, and is on the checklist (section
10). If you find the timing uneven when playing, this is the change to
make next, and its cost is known. If you find it merely late, nothing in
this page can help: the 40 ms is the device.

## 4. Control responsiveness

Driven through the page's own key and pointer handlers, every message
numbered. "Certain" and "possible" overruns are as defined in section 7.

| test | events sent / acted on | out of order | faults | worst solver iterations | certain / possible overruns | fingers left down |
|---|---|---|---|---|---|---|
| 250 plucks, about 31 a second | 250 / 250 | 0 | 0 | 3 | 0 / 1 | 0 |
| 250 gentle strikes, about 31 a second | 250 / 250 | 0 | 0 | 6 | 0 / 1 | 0 |
| pluck and strike in turn, 250 | 250 / 250 | 0 | 0 | 6 | 0 / 0 | 0 |
| pluck and strike in the same instant, 100 times | 200 / 200 | 0 | 0 | 6 | 0 / 0 | 0 |
| string mute down and up every 10 ms, 200 times, while plucking | 220 / 220 | 0 | 0 | 6 | 0 / 0 | 0 |
| bar finger down and up every 10 ms, 200 times, while striking | 220 / 220 | 0 | 0 | 6 | 0 / 0 | 0 |
| both fingers down together and up together, 200 times | 450 / 450 | 0 | 0 | 6 | 0 / 0 | 0 |
| switching instrument during decay with a finger held, 20 times | every new instrument: energy 0, no finger, no error | | | | | |
| stop and start, 15 times, a pluck after each | every time: stopped, running again, pluck heard by the engine, no error | | | | | |

(The timer asked for one event every 20 ms; the browser delivered about
one every 32 ms.)

**No event was dropped, duplicated or reordered**, here or in any other
run of this phase: about 7000 numbered events in all, every one answered
once and in order. No sample was ever other than a number. The only
problems of this kind found were the three in section 2, which were the
page not sending, or sending when it should not, and are fixed.

One property worth knowing rather than a defect: the processor holds eight
plucking forces at once, each lasting 0.2 s, so more than 40 plucks a
second would cut the oldest short. No hand does that.

## 5. Playing dynamics

Measured through the lab's own instrument and processor
(`npm run render:hybrid-lab`). Levels are LAFmax (A-weighted, 125 ms) of
the model's sound pressure 1 m in front of the board, dB re 20 µPa.

**Plucks** (hybrid, tied at 0.20):

| force at 0.8 of the string | peak | LAFmax | most energy the instrument held |
|---|---|---|---|
| 0.5 N | 0.047 Pa | 55.3 dB | 0.32 mJ |
| 1 N | 0.094 Pa | 61.3 dB | 1.27 mJ |
| 2 N | 0.187 Pa | 67.3 dB | 5.08 mJ |
| 4 N | 0.375 Pa | 73.3 dB | 20.3 mJ |
| 6 N | 0.562 Pa | 76.9 dB | 45.7 mJ |
| 8 N | 0.749 Pa | 79.4 dB | 81.3 mJ |

At 2 N the other pluck places give 66.0 dB (0.5), 62.9 (0.65), 69.2
(0.75), 65.5 (0.85) and 69.1 (0.9): within −4.4 and +1.9 dB of the usual
place. Tied at 0.18 everything is within 0.8 dB of this. The approved
string instrument is 6.2 dB quieter at every force (61.1 dB at 2 N).

**Strokes** (5 g striker, at the bar's middle):

| speed | peak | LAFmax | striker's energy | of which given to the instrument | momentum |
|---|---|---|---|---|---|
| 0.25 m/s | 0.38 Pa | 69.3 dB | 0.16 mJ | 0.10 mJ | 1.25 g·m/s |
| 0.35 m/s | 0.58 Pa | 72.5 dB | 0.31 mJ | 0.20 mJ | 1.75 |
| 0.5 m/s (gentle) | 0.87 Pa | 75.9 dB | 0.63 mJ | 0.41 mJ | 2.5 |
| 0.7 m/s | 1.29 Pa | 79.1 dB | 1.22 mJ | 0.83 mJ | 3.5 |
| 1 m/s (medium) | 1.90 Pa | 82.5 dB | 2.5 mJ | 1.73 mJ | 5 |
| 1.4 m/s | 2.79 Pa | 85.7 dB | 4.9 mJ | 3.45 mJ | 7 |
| 2 m/s (strong) | 4.12 Pa | 89.0 dB | 10 mJ | 7.18 mJ | 10 |

What this shows:

- **Why they differ.** A 4 N pluck puts 20 mJ into the instrument and
  reads 73.3 dB; a 0.5 m/s stroke puts in 0.41 mJ and reads 75.9 dB. The
  stroke makes about as much sound with a fiftieth of the energy. A pluck
  stores its energy in a slowly vibrating string, most of which the
  string's own losses and the plucking finger take back (Phase 3D.9); a
  stroke is a short blow whose energy is where the ear and the meter are
  most sensitive. This is physics, and the page does not correct it.
- **Where they overlap.** Plucks span 55.3 to 79.4 dB and strokes 69.3 to
  89.0 dB. Between **69 and 79 dB** both are available: a pluck of 2.5 N
  or more against a stroke of 0.7 m/s or less. A pluck of 4 to 8 N is a
  firm to hard pluck; a 5 g striker at 0.25 to 0.7 m/s is a light tap.
  Both are things a hand does. I take the forces to be plausible from
  general knowledge of plucked strings, not from a measurement of a
  player.
- **Above about 79 dB only strokes reach**; below 69 dB only plucks.
- A pluck is linear (12.04 dB per fourfold force, nothing else changes);
  a stroke rises 6.6 dB per doubling of speed.

**Did the controls expose the overlap? No.** The page started at 2 N and
1 m/s, which are 15 dB apart, with the three stroke keys at 76, 82.5 and
89 dB, all above the default pluck. A player would meet the imbalance
first and have to discover the overlap.

**Changed, as experimental interface defaults only:**

- the pluck slider starts at **4 N** and the strike slider at **0.5 m/s**
  (73.3 and 75.9 dB: 2.6 dB apart);
- beside each slider the page shows the model's level for that setting
  ("4.0 N · about 73 dB", "0.50 m/s · about 76 dB"), from the fits
  `67.3 + 20 log₁₀(F / 2)` and `82.5 + 21.8 log₁₀(v)`, which a test holds
  within 1 dB of the model;
- a sentence under the panels states the two ranges and where they
  overlap.

Not changed: the model, the references, the ranges of the sliders, the
three named strokes (0.5, 1, 2 m/s, Phase 3D.10's), or any gain. The
defaults live in the page's own constants and no measurement uses them.

## 6. The gestures, through the page's controls

A pluck and a medium stroke together; at 0.15 s a gesture; energies 50 ms
and 350 ms later, relative to the same playing left alone (bar 33.6 and
0.70 µJ, string 1200 and 374 µJ). Each row was run twice.

| gesture | bar, 50 / 350 ms after | string, 50 / 350 ms after | 660 Hz in the sound after |
|---|---|---|---|
| string muted | −0.4 / −9.1 dB | −33.1 / −37.5 dB | −3.5 dB |
| bar, middle, light | −8.9 / −8.1 dB | 0.0 / 0.0 dB | −6.1 dB |
| bar, middle, medium | −15.4 / −12.3 dB | 0.0 / 0.0 dB | −9.8 dB |
| bar, middle, firm | −17.0 / −12.2 dB | 0.0 / 0.0 dB | −11.0 dB |
| bar, middle, palm | −16.7 / −7.7 dB | 0.0 / 0.0 dB | −11.0 dB |
| bar, end by the string, light | −16.1 / −13.5 dB | 0.0 / −0.1 dB | −13.0 dB |
| bar, end by the string, medium | −19.6 / −15.5 dB | 0.0 / −0.1 dB | −16.9 dB |
| bar, end by the string, firm | −22.2 / −13.0 dB | 0.0 / −0.1 dB | −19.9 dB |
| bar, end by the string, palm | −16.8 / −5.3 dB | 0.0 / −0.2 dB | −21.3 dB |
| bar, by the tie, light | −0.9 / −2.2 dB | 0.0 / 0.0 dB | −1.3 dB |
| bar, by the tie, medium | −2.6 / −5.7 dB | 0.0 / −0.1 dB | −3.9 dB |
| bar, by the tie, firm | −8.7 / −11.5 dB | 0.0 / −0.1 dB | −10.9 dB |
| bar, by the tie, palm | −12.9 / −12.7 dB | 0.0 / −0.2 dB | −16.2 dB |
| both, in the same message | −22.1 / −26.2 dB | −35.9 / −37.6 dB | −40.8 dB |

In every row: identical samples on the second run, at most 3 solver
iterations, no fault.

- **Bar damping changes the bar as expected**, graded by pressure and
  different by place, as Phase 3D.11 found. (The bar's energy here is the
  whole bar's, bending and moving as a whole, which is why these figures
  are smaller than Phase 3D.11's for the bending mode alone: the string
  keeps moving the bar as a whole while it rings.)
- **String muting primarily affects the string**: −33 dB against −0.4 dB
  on the bar 50 ms later. The bar then loses what the string was feeding
  it (−9 dB at 350 ms).
- **Bar damping leaves the string alone**: 0.0 to −0.2 dB in every row.
- **Both operate together**, and stop both.
- **Too firm is less effective** at the middle and the end (the palm rows
  at 350 ms), as before: it pins rather than damps.
- **Release, repetition and passivity.** The energy accounting of Phases
  3D.11 and 3D.12 is unchanged and its tests pass: through nine
  overlapping moves the books balance to 10⁻⁹ and energy never rises once
  the fingers have settled. No new contact model was introduced.

## 7. Diagnostics

**What was added** to the lab's processor, all outside or at negligible
cost inside the audio callback:

| | where | cost in the callback |
|---|---|---|
| numbered answers to playing messages (section 3) | message handler, between blocks | none |
| samples that are not numbers, counted | the loop that already finds the block's peak | one comparison per sample |
| spread of the callbacks about an even delivery | uses the clock reading already taken | one subtraction per block |
| the audio frame count | kept by the processor | one addition per block |

None allocates, logs or posts from the callback. In the tests, a run with
every message numbered and answered produces the same samples as one
without.

**What the page now reports, and how sure each is:**

| reported | certainty |
|---|---|
| events sent, acted on, and whether in order | exact |
| engine faults; samples that were not numbers | exact |
| worst solver iterations; engine memory | exact |
| mean processing time per block | accurate (an average of many millisecond readings) |
| overruns "certainly" | certain: a reading of at least a block plus 1 ms |
| overruns "possibly" | uncertain by construction: readings the clock cannot place either side of the block length. Reported separately, never added to the certain ones |
| spread of callbacks | measured to a millisecond; normally about one batch (9 to 10 ms here); a stall of the audio thread shows as more |
| device underruns | only when the browser provides `playbackStats`; labelled as the browser's report |
| audio clock behind wall clock | an inference, labelled as one |
| input to device | the browser's estimate, labelled as one |

**Sub-millisecond timing is still not available** in this Chromium's
audio worklet (no `performance` there), so the conservative reporting of
Phase 3D.12 is kept. I did not add shared memory or a clock thread.

Two honest limits:

- At 96 kHz a block is 1.33 ms, so a reading of 1 ms is already
  "possible": 3302 of 7808 blocks were so marked in a run that had no
  certain overrun, no underrun and a mean of 0.42 ms. At that rate the
  millisecond clock says nothing about deadlines, and the page's figure
  should be read that way.
- The spread of callbacks reached 16.7 ms once in the 5-minute run
  (normally 9 to 10): the audio thread was called about 7 ms later than
  even delivery at some moment. No underrun was reported. This is the
  kind of thing the new figure is for; I cannot say what caused it.

## 8. Browser and device validation

**Environment actually tested:** the Claude desktop app's embedded
Chromium 156 on Windows 11, one output device, 48 kHz default. Nothing
else.

| | result | real or emulated |
|---|---|---|
| Chromium desktop: mouse, keyboard | every control exercised (sections 2 and 4) | real browser; input events injected by the automation, plus real clicks by it |
| Reload | a fresh page each time: stopped, no error; nothing persists | real |
| AudioContext suspend and resume | defect 2 found and fixed; verified | real context, suspended from the console |
| Sample rate 44.1 kHz (`?rate=44100`) | builds and plays: block 2.90 ms, mean 0.48 ms (16.5 %), 0 certain overruns, 0 faults, 144 / 144 events, 0 underruns | real |
| Sample rate 48 kHz | the default throughout | real |
| Sample rate 96 kHz (`?rate=96000`) | builds and plays: block 1.33 ms, mean 0.42 ms (**31.7 %**), 0 certain overruns, 0 faults, 144 / 144 events, 0 underruns | real |
| Phone-sized screen | defect 4 found and fixed; no sideways scrolling at 375 px | **emulated** viewport |
| Touch | two simultaneous touch pointers (pluck and strike) both played; touch toggled both fingers | **emulated**: synthetic touch pointer events in a desktop browser. Not a touch screen |
| Background tab | not controllable from here. Once, the browser pane was hidden while a 30 s run finished (`document.hidden` true at its end): audio went on, 423 / 423 events acted on, 0 underruns. An observation, not a test | real, uncontrolled |
| Output-device change | **not tested**: one device, and no way to switch it from here |
| Firefox, Safari, Chrome proper, any phone or tablet | **not tested** |

`?rate=` was added to the page for this: it asks the browser for a
context at that rate; without it the browser's own rate is used.

I do not claim cross-browser or touch-device compatibility. The page uses
standard pointer events, AudioWorklet and WebAssembly, which is a reason
to expect it to work elsewhere and not evidence that it does.

## 9. Stability and stress

**Chromium**, the page's own `bench`, a pluck and a stroke in turn every
100 ms with both fingers going down and up out of step:

| | 5 minutes, 2 N and 1 m/s | 30 s, 8 N and 2 m/s (the strongest) | 25 s |
|---|---|---|---|
| blocks | 112 632 | 11 403 | 9 499 |
| mean per block | 0.473 ms (17.8 % of a block) | 0.452 ms (16.9 %) | 0.484 ms |
| worst reading | 2 ms | 2 ms | 2 ms |
| certain / possible overruns | 0 / 8 | 0 / 2 | 0 / 2 |
| engine faults; samples not numbers | 0; 0 | 0; 0 | 0; 0 |
| worst solver iterations | 3 | 3 | 3 |
| events sent / acted on / out of order | 4212 / 4212 / 0 | 423 / 423 / 0 | 351 / 351 / 0 |
| posted → engine, mean (max reading) | 0.38 ms (3) | 0.28 ms (3) | 0.33 ms (2) |
| engine memory | 3 145 728 bytes | the same | the same |
| page's JavaScript heap, start → end | 14.83 → 14.82 MB | 14.84 → 14.83 MB | |
| output peak; blocks at the ceiling | 2.14 Pa; 0 | 4.72 Pa; 0 | |
| device underruns (browser's report) | 0 | 0 | 0 |
| audio clock behind wall clock | 7.2 ms | 1.9 ms | 3.5 ms |
| spread of callbacks | 16.7 ms | 10.3 ms | 10.3 ms |

Plus, from section 4: 20 instrument switches and 15 stop/start cycles,
all clean.

**Node**, five simulated minutes of the densest playing (an event every
8 ms: plucks to 8 N, strokes to 2 m/s, both fingers, the bar's finger
moved and pressed):

| | |
|---|---|
| cost | 17.9 % of one core |
| block time: median, 99.9th percentile, longest | 0.46 ms, 0.82 ms, 1.54 ms |
| peak pressure | 5.3 Pa (ceiling 8) |
| faults; samples not numbers | 0; 0 |
| worst solver iterations | 7 |
| instrument's energy: most; at the end of each minute | 87 mJ; 14.1, 5.7, 13.6, 5.8, 14.8 mJ (it does not grow) |
| three seconds after the last event | 0.0001 mJ |
| fingers left down; engine memory | 0; 3 145 728 bytes |

No persistent failure was found. Over 5 minutes in the browser there were
8 readings of 2 ms among 112 632 blocks and none of 3 ms or more; in Node,
with a microsecond clock, the longest block of the heavier five-minute run
was 1.54 ms. That is consistent with no deadline having been missed, and
it is not proof of it.

## 10. Listening checklist

On the page under "How to listen", after the procedure of Phase 3D.12
(which is unchanged apart from the new defaults). The approved string and
both hybrids remain selectable. Nobody has judged any of this.

- **String tone.** Is the hybrid's plucked string still a string you
  would want? How does it differ from the approved one, at each pluck
  position?
- **Metallic resonance.** Is the bar heard in a pluck? In a stroke, is
  its note clear, and does it sit well with the string's pitch?
- **Pluck and strike balance.** At 4 N and 0.5 m/s, and across each
  slider: over what range can the two be played together?
- **Damping response.** Does `D` stop the bar as a hand would? Which
  position and strength? Does `M` feel different from `D`?
- **Attachment.** Tied at 0.20 against 0.18: is there a difference worth
  having, in the pluck and in the stroke's tail?
- **Latency.** Does the sound follow the key or the tap closely enough to
  play in time? Is the timing even? (The diagnostics give the browser's
  estimate, about 48 ms here.)
- **Clicks or distortion.** Any click when a finger lands or lifts, when
  notes repeat fast, or when switching instruments? Any harshness that the
  "clipped" warning in the diagnostics explains, or does not?

The page selects nothing and ranks nothing.

## 11. Regression

- The four reference WAV hashes are unchanged.
- **Not modified:** `assembly/engine.ts`, `src/experimental/wasm/**` (the
  engine's processor included), `src/audio/**`, `src/App.tsx`,
  `src/builder/**`, `src/experimental/string/**`, the other pages,
  `vite.config.ts`, the engine fixture.
- **Modified:** `hybrid-lab.html`, `src/experimental/hybrid/lab.ts`,
  `instrument.ts` and `hybrid-processor.js` (the lab's own, from Phase
  3D.12); `tests/hybrid-lab.test.ts` (10 tests added, none changed);
  `package.json` (one script). **New:** `analysis/render-hybrid-lab.ts`,
  this document.
- **Phase 3D.12's configurations reproduce.** Its 12 tests pass unchanged:
  each hybrid through the lab is still identical, sample for sample, to
  its Phase 3D.11 reference, the approved string to itself, and the lab's
  processor to the engine's with one finger. The additions to the lab's
  processor change no sample.
- **No new energy.** The accounting tests pass unchanged; nothing in this
  phase touches a force, a spring or a damper.
- **No change in acoustic output** of anything. The only audible
  difference on the page is that it starts at a different pluck force and
  strike speed, which are positions of two sliders.
- The production build is byte-for-byte what it was (every file in
  `dist/assets` has the same hash with and without this phase's files).
- The suite is 440 tests in 29 files (430 + 10 new).

## 12. Decision gate

1. **Is the standalone instrument reliably playable?** Yes, in the
   environment tested: every control does what it says, the four defects
   found are fixed, and nothing failed in five minutes of continuous
   playing or under the stress runs.
2. **Are control events delivered consistently?** Yes: about 7000
   numbered events, each acted on once and in order.
3. **What latency is measured and what estimated?** *Measured:* input to
   handler 0.2 ms; posting 0.04 ms; posted to engine 0.4 ms; and that an
   action takes effect at the browser's next batch of blocks (every
   10 ms). *Estimated by the browser:* 48 ms on average from input to the
   output device (42 to 54), of which it attributes 40 ms to the device.
   *Not measured:* anything acoustic.
4. **Are simultaneous damping gestures stable?** Yes: 200 rounds of both
   fingers down and up together, and both out of step throughout the
   stress runs, with no fault, no finger left down, and the energy books
   intact.
5. **Are the existing dynamics usable, by measurement?** Yes, within a
   stated range: plucks and strokes overlap between 69 and 79 dB, and the
   page now starts there and shows both levels. Outside it the imbalance
   is real and is left alone.
6. **Were reproducible defects found and fixed?** Four (section 2), each
   with a reproduction, a cause, a fix and a verification; the three that
   are logic have tests.
7. **Is performance stable over longer sessions?** Over five minutes,
   yes: flat cost (17.8 % of a block), flat memory, no certain overrun, no
   underrun. Longer than that was not run.
8. **What browser and device limitations remain?**
   - Tested in one embedded Chromium on one Windows machine only.
   - Touch and phone layout are emulated, not tried on a device.
   - Output-device changes and true background-tab behaviour are untested.
   - About 48 ms of latency by the browser's estimate, mostly the device;
     a 10 ms granularity of control that the page cannot reduce without
     adding latency.
   - No sub-millisecond deadline measurement; at 96 kHz the millisecond
     clock is uninformative, and the instrument costs 32 % of a block
     there.
   - The mute stays at 0.8 of the string; the pluck is linear (earlier
     phases).
9. **Are the approved instruments and builder unchanged?** Yes: no file
   of theirs was edited and the production build is byte-identical.
10. **Is the hybrid technically ready for a controlled builder-integration
    design phase, subject to your listening approval?** Technically, yes.
    The model is validated (Phases 3D.9 to 3D.11), it plays reliably in
    real time with independent gestures, its cost and its limits are
    measured, and the one piece of infrastructure a builder would need
    that the engine's processor lacks (more than one finger) exists in a
    form that can be reviewed. What a design phase would have to decide,
    and I have not: whether to bring that into the engine's processor or
    keep an extension; how the builder would express a bar that is also a
    bridge; and what to do about latency and the pluck-to-stroke balance.
    None of that should start before you have listened.

## 13. Recommendation

Play it, with the checklist. If the instrument is worth keeping, the next
phase should be a *design* for integration, not integration itself. If
the timing feels uneven, ask for the scheduling of section 3 first. If it
feels late, the device is the place to look. I have not begun Phase 3D.14
or any builder integration.
