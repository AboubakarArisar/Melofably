# Stability, loading and performance (Phase 2D)

What was measured, what was changed, and what remains. All browser figures
come from Chrome's `AudioContext.playbackStats` in the development build on
one Windows machine; they are measurements of that setup, not guarantees.

## 1. Baseline (tag `phase-2c-approved`)

- Working tree clean; 74 tests passed; lint and production build clean.
- All four instruments played at their expected frequencies in the browser.
- `npm test` took 36 s, of which about 20 s was recompiling the four Faust
  models every time.

Browser audio before any change:

| Event | Underruns recorded |
| --- | --- |
| Starting audio (3 cold starts) | 1, 2, 2 (10 to 20 ms) |
| First switch to each other instrument, first session | bar 2, glass 0, wood 1 |
| First switches, two further sessions | 0 of 6 |
| Warm switches (about 40) | 0 |
| Playing, idle | 0 |

## 2. Investigating the underruns

### How the counter behaves

`playbackStats` is refreshed about **once per second** (the first reading after
creating a context arrived at 1051 ms). Anything measured over a shorter
window can be attributed to the wrong step. Early measurements in this
project used windows of a few hundred milliseconds and are unreliable in that
respect; everything below uses windows of at least 1.3 s, mostly 2.3 s.

### Timing each operation

On a fresh AudioContext, one step at a time, three times over:

| Step | Time | Underruns (3 runs) |
| --- | --- | --- |
| Context created, first second | | 1, 1, 1 |
| Idle second (control) | | 0, 0, 0 |
| Fetch and compile a model's WebAssembly (main thread) | 5 to 9 ms | 0, 0, 0 |
| `addModule` of a trivial processor | 4 to 12 ms | 0, 0, 0 |
| First Faust node: register processor, create node, instantiate WASM | 4 to 11 ms | 1, 1, 1 |
| Connect node to output | under 1 ms | 0, 0, 0 |
| Destroy node | under 1 ms | 0, 0, 0 |
| Second node of the same model | under 1 ms | 0, 0, 0 |
| Five more nodes in a row | 1 to 2 ms | 0, 0, 0 |
| First node of a second model, context running | 3 to 5 ms | 0, 0, 0 |
| `suspend()` | under 1 ms | 0, 0, 0 |
| First node of a third model, context suspended | 4 to 5 ms | 0, 0, 0 |
| `resume()` | 14 to 22 ms | 1, 1, 1 |
| Main thread busy for 300 ms | | 0, 0, 1 |

### Causes

1. **Starting the output stream.** Creating an AudioContext, or resuming one,
   records one underrun of about 10 ms (occasionally two) with nothing loaded
   at all. This is the browser opening the audio device. It happens before
   any sound and the application cannot prevent it. **Confirmed, 6 of 6.**
2. **The first Faust worklet node in a context that is already running.**
   Registering the processor and instantiating its WebAssembly on the audio
   thread costs one underrun. **Confirmed, 3 of 3.** Later nodes do not.
3. **First use of each model's code.** Underruns on the first switch to an
   instrument were intermittent (3 of 3 in one session, 0 of 6 in two others),
   which fits work the browser does the first time a WebAssembly module runs
   hot (it is compiled quickly at first and optimised once it is busy), not
   something that happens on every switch. **Suspected, not isolated.** The
   evidence is indirect: the rate fell as each measure below was added.

Ruled out as causes: compiling WebAssembly on the main thread, `addModule`
itself, connecting and destroying nodes, creating further nodes of a model
already used, and main-thread scheduling (one 6 ms underrun in three 300 ms
stalls).

No extra AudioContext was ever created: one per start, closed on stop.

## 3. Loading strategy now in place

| When | What | Why |
| --- | --- | --- |
| Page load | Compile every model's WebAssembly once and cache it (`compileInstrument`). | No compilation ever coincides with running audio; modules are reused for every node and across stop/start. |
| Page load | Run each model for half a second in an `OfflineAudioContext` with a note sounding (`preloadInstruments`). | Exercises the compiled code off the real-time thread, so first-run optimisation happens before live audio. |
| Start Audio | Create the selected instrument's node immediately, while the stream is still opening. | Cause 2 lands inside the unavoidable startup gap. |
| Start Audio | Create and discard one node of every other instrument before reporting "running" (`prime`). | Each model's processor is registered and instantiated once while the engine is silent. |
| Switching | Fade the output to zero over 15 ms, swap the single node, restore the gain. | No cut mid-wave, no overlap of two instruments. |

Effect on first-time switches, cold start each time:

| Configuration | First-time switches with an underrun | Startup underruns per run |
| --- | --- | --- |
| Baseline | 3 of 9 | 1, 2, 2 |
| Precompile at page load | 2 of 9 | 2, 2, 3 |
| Plus priming at start | 1 of 9 | 1, 1, 5 |
| Plus offline warm-up | **0 of 18** | 1, 1, 1, 1, 2, 1 |

Startup takes 35 to 140 ms from the click to "running" (it was 60 to 150 ms
before; priming adds three short node creations, the cached modules remove a
compile).

### A stable 62-second session with the final code

| Phase | Underruns |
| --- | --- |
| Startup | 1 (9.5 ms) |
| Three first-time switches, a note after each | 0 |
| 150 notes at 25 per second on each of the four instruments (600 notes) | 0 |
| 40 warm switches, a note after each | 0 |
| 12 switches fired with no pause | 0 |
| Suspend for 1 s, resume, play | 0 |
| Idle 5 s | 0 |

### Switching while a note rings

String at zero damping, switched to the bar mid-note: the largest
sample-to-sample jump during the switch was 0.0257, the same as the ringing
waveform's own largest step. The level reached zero within the first 29 ms
sampled and stayed there until the new instrument was played.

### What cannot be claimed

- **Underruns are not eliminated.** The startup one is inherent and remains.
- **Interruptions during playback are not ruled out.** During the six
  cold-start runs, two warm-switch windows recorded bursts (23 and 4 events).
  They coincided with the development server process being stopped by the
  host application, and the first also showed a 242 ms stall of the page's
  main thread, so a system-level cause is likely, but that was not verified.
  About 100 other warm switches recorded none.
- The priming and warm-up steps are justified by a falling rate over small
  samples (9, 9 and 18 switches), not by isolating each mechanism.
- Only one browser on one machine was measured, with the page not in the
  foreground. Other browsers do not expose `playbackStats`.

## 4. DSP architecture review

| Finding | Action |
| --- | --- |
| The resonator, polynomial `cos`/`e^-x`, half-sine striker, clamp and soft limiter existed in up to four copies (bar, glass, wood via `modal.lib`, string). | `bar.dsp`, `glass.dsp` and `string.dsp` now import `modal.lib`. One copy of each. |
| `npm run dsp` was a hand-maintained chain of four compiler invocations and recompiled everything on every test run. | `scripts/build-dsp.mjs` compiles every `.dsp` in the models folder and skips those whose output is newer than the source and the libraries. Adding a model needs no change to it. `npm test` fell from 36 s to 21 s. |
| `App.tsx` held the per-instrument control tables, readouts and value defaults inline (300 lines). | Moved to `src/instrumentUI.ts`, with `defaultValues` and `withValue`, so parameter persistence is testable without rendering. |
| A model's WebAssembly was fetched and compiled on every switch. | Compiled once and cached (section 3). |
| A failed model fetch produced an opaque `compileStreaming` error. | The error now names the model and the HTTP status, and is not cached. |
| The engine could report the same status twice. | Reports only on change. |

Left alone, deliberately:

- **Model equations, constants and defaults.** Nothing in any model's physics
  was touched.
- **The mode-shape code duplicated between `bar.dsp` and `wood.dsp`**, and the
  two models' normalisation. Sharing them would mean parameterising the mode
  count across a library boundary for two users; the saving is about 15 lines
  and the risk to approved sound is not zero.
- **The three near-identical render scripts and three test files** for the
  struck instruments. They are read far more often than changed, and each
  documents its own instrument's checks.

## 5. Audio regression

Baselines were written from the approved models **before** the refactor:
`tests/baseline/{string,bar,glass,wood}.wav` (32-bit float, 1.2 s each: three
notes at the defaults, a change of several controls, three more notes).

After the refactor:

| Check | Result |
| --- | --- |
| Each instrument against its baseline, 57 600 samples | 0 differing samples, all four (bit-identical) |
| All 60 listening WAVs in `renders/`, regenerated and hashed | byte-identical to the pre-refactor files |
| Model re-rendered after the other three have run | identical |

Because every sample is identical, fundamental and modal frequencies, harmonic
balance, attack, decay and level are unchanged by construction; they were not
measured separately.

The compiled binaries are not identical for the three refactored models (the
compiler arranges the same arithmetic differently; the bar's module shrank
from 123 kB to 107 kB), so speed was compared directly (section 6).

`tests/baseline.test.ts` now runs this comparison on every test run, with a
tolerance of 1e-6 (-120 dBFS) to allow for last-bit differences in the
JavaScript engine's `sin`, `cos`, `exp` and `pow` on other machines. To
replace a baseline after a deliberate, approved change in sound:
`npm run baseline -- --update`.

## 6. Performance

"x" is how many times faster than real time one thread renders; the share of
one core is 100 / x.

### Offline (Node, the same WebAssembly as the audio thread)

Approved and current builds, interleaved, median of five runs, all notes
ringing:

| Model | Approved | Current | Change |
| --- | --- | --- | --- |
| String | 179x | 173x | -3 % |
| Metal bar | 24x | 24x | -1 % |
| Glass vessel | 30x | 28x | -6 % |
| Wooden bar | 26x | 26x | 0 % (identical binary) |

Run-to-run variation on this machine is about 5 %, so these are not
distinguishable.

By activity (single runs, so noisier; before the refactor / after):

| Model | Idle | One note | All notes ringing | 25 notes per second |
| --- | --- | --- | --- | --- |
| String | 182x / 191x | 209x / 191x | 208x / 183x | 185x / 187x |
| Metal bar | 28x / 24x | 30x / 23x | 23x / 18x | 38x / 19x |
| Glass vessel | 37x / 23x | 28x / 26x | 27x / 21x | 27x / 23x |
| Wooden bar | 47x / 27x | 46x / 27x | 29x / 20x | 33x / 21x |

### In the browser

Rendering 20 s through the real AudioWorklet node in an
`OfflineAudioContext`:

| Model | Idle | One note |
| --- | --- | --- |
| String | 82x | 72x |
| Metal bar | 22x | 30x |
| Glass vessel | 34x | 34x |
| Wooden bar | 35x | 36x |

So the struck instruments cost roughly 3 to 5 % of one core in the browser and
the string a little over 1 %, whether or not anything is sounding. Switching
instruments costs 16 to 32 ms of wall time, most of it the 15 ms fade.

### Inactive resonators

Idle and busy cost the same because a Faust program computes its whole graph
on every sample: 25 bars x 8 modes run whether or not they were ever struck.
Options considered:

| Option | Saving | Why not now |
| --- | --- | --- |
| Skip silent bars | up to about 90 % when few notes ring | Faust has no conditional execution. It would need a different DSP host. |
| A pool of N voices retuned on demand, instead of 25 fixed bars | about (25 - N) / 25 | Changes behaviour: a stolen voice is cut off, and retuning a ringing resonator is a discontinuity. Not bit-identical to the approved sound. |
| Suspend the AudioContext after a period of silence | all of it while idle | Resuming records an underrun (section 2), so the first note after a pause would be at risk. |
| Fewer modes per bar | proportional | Changes the approved sound. |

None is safe within the constraint of leaving approved audio untouched, and
the cost being recovered is a few percent of one core. No change was made.
The data-driven modal engine sketched in BUILDER_ARCHITECTURE.md is where
voice allocation would properly belong.

### Allocation

Nothing is allocated per note: playing sets two parameters on the live node.
The models themselves allocate only when a node is created. Switching creates
one node and releases one.

## 7. Tests

95 tests, up from 74 (all 74 kept, 21 added):

| File | Tests | Covers |
| --- | --- | --- |
| `string.test.ts` | 18 | unchanged |
| `bar.test.ts` | 16 | unchanged |
| `glass.test.ts` | 16 | unchanged |
| `wood.test.ts` | 17 | unchanged |
| `engine.test.ts` | 15 (was 7) | switching lifecycle and fade order, rapid switching, no duplicate nodes, repeated initialisation, concurrent starts, cleanup, priming, loading failures at start and while switching, a model that cannot load not blocking another |
| `instruments.test.ts` | 8 (new) | every control exists in its compiled model, defaults come from the models, values persist per instrument, each model is compiled once, failed loads are named and retried |
| `baseline.test.ts` | 5 (new) | each instrument against its approved WAV; stable output after other instruments have run |
