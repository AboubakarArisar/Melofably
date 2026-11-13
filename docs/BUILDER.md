# Instrument builder (Phases 3B and 3B.1)

**Status: experimental, development server only.** The builder is a separate
page (`builder.html`). It is not linked from the application, is not part of
the production build, and does not use or change the four approved Faust
instruments, their audio engine or their reference audio.

It supersedes the *design* in [BUILDER_ARCHITECTURE.md](BUILDER_ARCHITECTURE.md)
(Phase 2D), which assumed generated Faust code. What was built instead sits
on the WebAssembly physics engine validated in Phase 3A.1
([WASM_ENGINE.md](WASM_ENGINE.md)): the graph is data handed to a running
engine, with no code generation and no compilation.

Run `npm run dev` and open `http://localhost:5173/builder.html`.

This document reports what exists and what was measured. It makes no claim
about how anything sounds.

## 1. How it fits together

```
 canvas, palette, inspector          src/builder/Builder.tsx, Canvas.tsx, Inspector.tsx
            |  edits (pure functions)
            v
        the graph                    src/builder/graph.ts     data, validation, save/load, undo
            |
            v
   translate(graph, sampleRate)      src/builder/translate.ts graph -> engine calls
            |
            v
         Session                     src/builder/session.ts   live edit or rebuild; play
            |
            v
     BrowserBackend                  src/builder/audio.ts     AudioContext, one AudioWorklet node
            |
            v
 WebAssembly physics engine          assembly/engine.ts (Phase 3A.1, one change: section 6)
```

The first four layers are plain TypeScript with no browser APIs, and are
tested in Node against the same engine binary the browser loads. Only
`audio.ts` touches Web Audio.

**The graph is the physical system.** Every component in the graph that can
sound is one body in the engine; every spring or damper is one or two solver
connections between two bodies; every attached mallet is a free mass and a
contact. Nothing is drawn that is not simulated, and nothing is simulated
that is not drawn. The output is the sum of the bars' own velocities;
connected bars are heard together because they move each other, never
because two signals are added to imitate it. A test asserts the difference:
with the spring removed, the second bar's energy is exactly zero.

## 2. Components

| Component | What it is in the engine | Properties (range) |
| --- | --- | --- |
| **Mallet** | A free mass and a one-sided Hertz contact (force = K x compression^1.5) with the bar it strikes | Mass 0.002 to 0.5 kg ↻; hardness 0 to 1 ↻ (K = 10^(6 + 4 x hardness) N/m^1.5); strike velocity 0.1 to 5 m/s |
| **Impulse strike** | A half-sine force pulse, as the approved instruments use. Not a body: it does not feel the bar. | Strike velocity 0.05 to 1 (impulse = 0.05 N s x velocity); hardness 0 to 1 (contact time by the approved bar's law) |
| **Metal bar** | Eight bending modes of a uniform free-free beam | Material ↻ (aluminium, steel, brass, bronze); length 0.05 to 1.5 m ↻; width 10 to 200 mm ↻; thickness 2 to 40 mm ↻; damping x0.1 to x10; strike position 0 to 1 ↻; connection position 0 to 1 ↻ |
| **Wooden bar** | The same, with wood's decay law | Material ↻ (rosewood, padauk, maple, spruce); otherwise as the metal bar |
| **Spring** | One solver connection, with the Phase 3A.1 time-step correction | Stiffness 100 to 1e8 N/m |
| **Damper** | One solver connection, uncorrected (as Phase 3A.1 found right) | Damping 0 to 100 N s/m |
| **Spring and damper** | Both of the above between the same two points | Both |

↻ marks a property whose change rebuilds the instrument (section 4). The
interface shows the same mark.

**Where the modal data comes from.** Frequencies and mode shapes are
`barModeFrequencies` and `barModeShape`, the functions the approved bar
instruments are tested against. Decay times are the approved metal bar's law
(1/T60 = 1/6 + loss x f / 2.2) or the approved wooden bar's
(`woodDecayTime`); the Damping property divides every decay time. Each
mode's mass is the bar's mass, density x length x width x thickness, as in
Phase 3A. Modes at or above 0.45 x the sample rate are left out, as in the
approved instruments.

Material values are nominal handbook figures; the loss factors are
illustrative, chosen within the approved models' ranges, and are not
measurements of any particular piece of metal or wood.

**Ports.** A bar has two points: where it is struck and heard, and where
springs and dampers attach. An exciter has one. Everything attached to a bar
shares its connection position.

**Limits are documented and enforced, not silently clamped.** A typed value
outside its range is not applied: the box says what the range is and the
instrument keeps the last valid value. A saved instrument containing such a
value is refused on loading, with the reason. The one exception is in the
engine, from Phase 3A.1: a mode asked to sound above 0.49 x the sample rate
is held there. The builder cannot reach it, because it drops modes above
0.45 x first.

## 3. Graph-to-engine translation

`translate(graph, sampleRate)` returns either the list of engine calls with a
map from graph identifiers to engine indices, or every reason the graph
cannot be built.

- **Types and ports.** A strike goes from an exciter to a bar; a spring or
  damper joins two bars. Anything else is rejected (exciter to exciter,
  spring to an exciter, a component to itself, two connections between the
  same pair, an exciter striking two bars).
- **Parameters.** Every property must be a finite number within its range;
  unknown properties, unknown materials and unknown types are rejected.
- **Unsupported structures.** A bar whose lowest mode is above the playable
  limit is rejected with the frequency it would have and what to do about
  it. A bar with only some of its eight modes in range is built, with a note.
- **Capacity.** The engine solves at most 32 connections at once (a spring
  and damper count as two, a mallet as one) and holds 128 bodies. The limit
  is checked when connecting, in validation, and again against what was
  actually emitted.
- **Identifiers.** A component keeps its identifier for life; identifiers
  are never reused within an instrument, including after loading a saved
  one. Engine indices may change on a rebuild; the map is rebuilt with it.
- **Disconnected components.** An exciter attached to nothing is left out of
  the engine, with a note. A bar with nothing attached is built and can be
  tapped directly. An empty canvas is a valid, silent instrument.
- **No duplicate audio nodes.** There is one AudioContext and one
  AudioWorklet node from Start to Stop. A rebuild sends a new list of calls
  to the same node; it never creates another.

## 4. What changes while it sounds, and what rebuilds

| Change | How it is applied |
| --- | --- |
| Spring stiffness | Live: glides over 10 ms |
| Damper damping, bar damping | Live |
| Strike velocity; impulse hardness | Live: read at the next strike |
| Moving things on the canvas | No physical effect |
| Adding or removing a component or connection; connection kind | Rebuild |
| Material, length, width, thickness, strike and connection positions | Rebuild |
| Mallet mass and hardness | Rebuild |

**A rebuild restarts the sound.** The engine's system is replaced and starts
from rest, so whatever was ringing stops. This is the Phase 3A.1 limitation,
not hidden: the interface marks every such property with ↻, explains the
mark, and says "The instrument was rebuilt, so its sound restarted" when it
happens. The output is faded out over a few milliseconds before the swap and
back in after, so the cut does not click; that fade is the only thing done
to the signal.

Rebuilds wait 250 ms after the last structural edit, so dragging a slider
restarts the sound once, not on every step. Live edits are sent at once.

Whether an edit is live is decided by comparing a key made of everything
structural in the graph. A test checks that the properties declared live are
exactly those that leave the key unchanged, and another that a live-edited
engine produces the same samples as one built from the edited graph
(difference: 0).

## 5. Interface

- **Palette**: "Things that strike" and "Things that ring". Springs and
  dampers are not palette items: they are made by connecting two bars.
- **Canvas**: drag a component by its body; drag from its dot to another
  component to connect. While dragging a connection, components it may join
  are outlined and the rest dimmed. Click a connection to select it.
- **Inspector**: the selected item's properties, each with a slider, a box
  for an exact value, its unit and a one-line explanation in plain words;
  for a bar, its lowest note, weight and ring time; "Connect to" as an
  alternative to dragging.
- **Audio**: Start, Stop, Play instrument (every attached exciter; a tap on
  every bar if there are none), strike the selected bar or exciter, volume,
  level, engine load, dropouts, number of rebuilds.
- **Messages**: why a connection was refused; what stops the instrument
  being built (the offending item is outlined in red); notes about loose
  components; loudness and engine-fault warnings.
- **Undo and redo** for every graph edit (Ctrl+Z, Ctrl+Y); one drag of a
  slider is one step; the last 100 steps are kept.
- **Keyboard**: components are focusable; Enter selects, Space strikes,
  arrow keys move, Delete removes the focused one.
- **Striking**: double-click a bar or exciter, or use the buttons; the struck
  bar flashes.
- **Saving**: the instrument is stored in the browser as it is edited and
  restored on return. `serialize` / `deserialize` validate on load.
- **Layout**: three columns on a wide screen, one column on a narrow one;
  the canvas scales with the page.

## 6. Output protection

1. The engine's output is the bars' velocities x 0.25, leaving headroom up
   to 4 m/s.
2. In the browser it passes through a makeup gain, then a fast limiter, so
   that a very loud instrument is turned down rather than distorted. The
   interface shows when the limiter is working and by how much.
3. If the engine's own output reaches its ceiling, the interface says the
   instrument is far too loud and what to change.
4. **Faults are separate and are not masked.** The engine counts every
   output sample that is not a finite number, or is absurdly large; replaces
   it by silence; and clears its state. The interface shows that count as an
   error. The limiter cannot hide it, because a fault never reaches the
   limiter as signal.

One change was made to the engine for this: its fault guard previously
caught only non-finite values. A test showed that a huge but finite value
(1e300) passed the guard and became infinite when written as a 32-bit
sample. The guard now also treats anything of 1e30 m/s or more as a fault.
No other engine code changed, and all Phase 3A.1 tests pass unchanged.

## 7. Tests

`tests/builder.test.ts`, 32 tests, run in Node against the shipped engine
binary.

| Area | What is checked | Result |
| --- | --- | --- |
| Component creation and deletion | Identifiers stable, unique, never reused; deleting a component removes its connections only | pass |
| Connecting | Allowed pairs in either drag direction; each refusal with its reason; capacity | pass |
| Undo and redo | Steps, merging of a slider drag, redo discarded by a new edit | pass |
| Validation | Every property of every component below, above, NaN and infinite; unknown types, materials, properties; broken connections | pass |
| Serialization | All examples round-trip exactly and build identical engine calls; malformed input refused with the reason | pass |
| Translation | Exact calls for a bar and mallet; springs and dampers between the right ports with the right correction; loose components; unplayable bars | pass |
| Modal frequency accuracy | Five bars (three metals, two woods), 27 modes, against beam theory | worst error 0.006 % |
| Bidirectional coupling | Second bar's energy zero without the spring, non-zero with it, both ways; 16 coupled frequencies against eigenvalue theory | worst error 0.0007 % |
| Energy | A mallet strike on each example: energy starts at the mallet's kinetic energy and never rises | 0 rises in 48 000 steps each |
| Mallet stability | All eight corners of mass, hardness and velocity, struck every 50 ms | finite, 0 faults, energy never rises |
| Extreme values | Every property at its lowest and highest, connections at both ends, all three examples | 12 of 12 play, finite, 0 faults |
| Overflow | A force of 1e308 N | output stays finite, fault counted, engine recovers |
| Audio lifecycle | Three simultaneous starts give one engine; stop twice; four start/stop cycles; failed start retried | opens = closes |
| Parameter updates | Live against rebuild for each property; live-edited equals rebuilt | sample difference 0 |
| Invalid while running | Engine silenced, reason reported, recovers when fixed | pass |

The whole suite was 171 tests at the end of Phase 3B and is 180 after
Phase 3B.1 (section 10); all pass. The four
approved instruments' reference WAV files are byte-identical to their
recorded hashes.

## 8. Browser verification

Chromium 156 in the desktop app's browser pane, with real mouse and keyboard
input except where noted.

| Action | Observed |
| --- | --- |
| Click Start audio | Context running at 48 kHz; one node, one context |
| Click Play instrument | Peak bar velocity 0.31 m/s, decaying; no limiting; 0 faults |
| Click "Metal bar" in the palette | Bar added, selected, inspector shows it; rebuild notice; note that it stands alone |
| Drag the bar | Moved by the drag distance; no rebuild |
| Drag from one bar's dot to the other bar | Spring-and-damper created between them and selected; rebuild notice |
| Click the stiffness slider while ringing | "Changed while sounding"; rebuild count unchanged |
| Type 999999999999 as stiffness | Rejected: message with the range, connection outlined in red, Play disabled, instrument silent |
| Type 2000000 | Accepted; rebuilt |
| Click the spring on the canvas | Connection selected |
| Remove, Undo button, Redo button, Ctrl+Z | Connection removed, restored, removed, restored |
| Select a bar, press Delete | Bar and its connection removed |
| Load each example from the menu and play it | Peaks 0.28, 0.38, 0.19 m/s; 0 faults; still one node |
| Add an impulse strike | Note that it is not attached; no rebuild |
| Drag it to the mallet | Refused: "Two exciters cannot be connected: attach each one to a bar." |
| Drag it to the metal bar; "Strike now" | Attached; peak 0.19 m/s |
| Stop audio | Nodes created 1, disposed 1; contexts created 1, closed 1 |
| Clear | Empty-state text on the canvas; Play disabled |
| Reload the page | Instrument restored from the browser's storage |
| Phone-sized window (375 px) | One column, no sideways scrolling |
| 600 strikes, 40 a second, across the three examples (driven by script) | 0 faults; 1 block of 2 ms or more in about 5600; engine load 0.1 to 3.8 % of a core |

**Dropouts.** See section 10: the count the browser reports comes from the
audio output device, not from the builder.
## 9. Known limitations

1. **Structural edits restart the sound** (section 4).
2. **Two kinds of resonator, both bars.** No strings, plates, tubes or
   membranes. The wooden bar has no tube resonator and no lossy mallet,
   which the approved wooden instrument has; it is the bar alone.
3. **One connection point per bar.** All springs and dampers on a bar attach
   at the same place.
4. **At most 32 solver connections**, solved densely every sample. A
   spring-and-damper uses two, a mallet one. Large coupled instruments are
   out of reach until the Phase 3A.1 limitations are addressed.
5. **A mallet is one-shot per throw and has no gravity or handle.** Thrown
   again before it has left the bar, it is placed back at the surface.
6. **Heavy, soft mallets.** With the heaviest, softest mallet the contact
   solver used its full budget of 60 iterations on about 0.1 % of contact
   samples. Energy still never rose and the output stayed finite; the cost
   is processing time on those samples.
7. **Levels are physical.** A light slow mallet is about a thousand times
   quieter than a heavy fast one. The limiter protects against the loud end;
   nothing raises the quiet end.
8. **No pitch input.** An instrument is played by its exciters; there is no
   keyboard, MIDI, sequencing or recording.
9. **Saving is local to one browser.** There is no file export in the
   interface yet (the functions exist).
10. **The canvas is small on a phone.** It scales down with the page.
11. **Development server only**, one browser tested, and not evaluated by
    listening.
12. **Materials are nominal** (section 2).

## 10. Phase 3B.1: validation and refinement

No new components or features. The builder was used from an empty canvas,
the problems found were fixed, and each fix has a regression test.

### The audio dropouts

Phase 3B ended with the browser's dropout counter rising 15 to 25 times a
second. It was measured again under controlled conditions (machine idle at
about 6 % processor use; "Run dropout comparison" on `experimental.html`
repeats the measurement). Each case ran for about 7 s, twice.

| What was playing | Dropouts reported | Sound lost (context clock behind wall clock) | Engine blocks late |
| --- | --- | --- | --- |
| An AudioContext with nothing in it | 131, 139 | 0, 4 ms | |
| A native oscillator, no worklet | 97, 129 | 4, 3 ms | |
| Phase 3A.1 engine, idle | 119, 147 | -1, 8 ms | 0 |
| Phase 3A.1 engine, struck 10 times a second | 122, 141 | 4, -1 ms | 0 |
| Builder instrument, idle | 135, 155 | -9, 3 ms | 0 |
| Builder instrument, played 10 times a second | 139, 106 | 2, 2 ms | 0 |
| Approved Faust bar | 123, 137 | 3, 2 ms | |
| Empty context, larger buffer | 160, 123 | 1, 15 ms | |
| Builder instrument, played, larger buffer | 139, 111 | -4, 3 ms | 0 |

Further measurements on an empty context:

- The rate is the same at 44.1, 48 and 96 kHz and with buffers of 10, 100
  and 170 ms. Every reported dropout is 5.06 ms long.
- **With no output device attached** (`sinkId: { type: 'none' }`): 0, 0.
  With the default device, in the same minute: 51, 66.
- The builder's three examples played 40 times a second with no output
  device: 0 dropouts, every block processed (2704 of 2704, 2700 of 2700,
  2693 of 2693), 0 blocks of 2 ms or more, 1.1 to 3.0 % of a core.

**Conclusion.** The count is produced by the audio output path of the
machine as it was at the time, with or without anything playing, and is not
caused by the builder, the engine or the approved instruments. It is not a
late render thread either: a 170 ms buffer does not change it, the engine
finishes every block on time, and no audio time goes missing. A Bluetooth
headset was an active output device when these measurements were taken, and
was probably not during the earlier sessions that reported none; that it is
the cause is likely but was not verified, because the output device could
not be switched from the test page. Whether the reported dropouts are
audible on that device was not established.

**What changed in the builder.** The status line no longer shows a bare
dropout total. It shows whether the engine is on time (blocks that took
2 ms or more since audio started), and the output device's dropout rate over
the last two seconds, and explains the difference when the device reports
dropouts while the engine is on time.

### Problems found by using it, and their fixes

| Problem | Fix | Regression test |
| --- | --- | --- |
| The dot for starting a connection was a small target; a press slightly off it moved the bar instead. | A press within 18 units of the dot starts a connection (the dot is drawn larger too). | yes |
| Double-click did nothing. | A second press on the same component within 350 ms strikes it; the struck bar flashes. | browser |
| Typing a value applied every keystroke: "0.35" passed through "0", silencing the instrument, and an unloadable instrument could be saved. | A typed value is applied only when it is a number in range; otherwise the box explains and the last valid value stays. Leaving the box restores it. | yes |
| An unreadable saved instrument was silently replaced by the example. | The reason is shown; only instruments that can be loaded again are saved. | yes |
| A new component could land on top of an existing one after deletions. | Placement looks for free space; bars are staggered so connections stay readable. | yes |
| Delete on a focused component removed the *selected* item, which could be a different one. | It removes the focused component. Delete elsewhere acts only from the canvas or the page, never from a button or field. | browser |
| Every bar with nothing attached produced its own note. | One combined note. | yes |
| Strikes and spring/damper connections looked alike. | Strikes are amber dashed arrows labelled "strikes"; physical links are teal and labelled "spring", "damper" or "spring + damper"; a legend explains them; while dragging a connection, a label says what dropping here will do or why it cannot. | browser |
| The page jumped when the status text changed length. | The status line has its own row of fixed height. | browser |
| The selected component could be hidden under another. | It is drawn on top. | browser |

No graph-to-engine synchronisation fault was found. The test written to look
for one applies 400 random edits, undos and redos (three seeds) to a running
session and then compares its output, sample for sample, with a session
built fresh from the final graph: the difference is 0 in all three.

### Tests added (9; `tests/builder.test.ts` now has 41)

| Test | Result |
| --- | --- |
| Pressing near the dot connects, pressing the body moves | pass |
| New components never overlap existing ones, also after deletions | pass |
| Typed values: 14 unusable texts refused, 6 usable ones accepted, "0.35" key by key | pass |
| Unreadable saved instruments are reported | pass |
| One note for bars with nothing attached | pass |
| 400 random edits, undos and redos x 3 seeds: every state valid, saves and reloads exactly, engine identical to a fresh build | difference 0 |
| 60 edits undone one by one to every earlier state and redone to every later one | exact |
| 300 rebuilds with playing in between: one engine, memory fixed, no faults | 179 ms in all |
| A rebuild's cost on the audio thread | 0.009 ms (a block is 2.667 ms) |

### In the browser

| Check | Observed |
| --- | --- |
| Empty canvas, add a mallet and three bars with the Add buttons | Placed apart; one combined note |
| Three connections dragged from 5 px off each dot | All three made (strike, two spring-and-dampers); nothing moved |
| Double-click a bar | Struck: peak 0.18 m/s; flash shown; bar not moved |
| Type 0.45 as a length | Applied; no problem state at any keystroke; one rebuild |
| Type 7 (out of range), then leave the box | Box red with the range; instrument unchanged and still playable; box returns to the valid value; saved copy valid |
| Reload | Instrument restored |
| 100 structural edits 40 ms apart (a slider being dragged), playing throughout | 1 rebuild |
| 40 structural edits 0.57 s apart, played after each | 40 rebuilds; peak after each 0.22 m/s; 0 faults; one audio node; engine memory unchanged |
| The same run: engine blocks of 2 ms or more | 4 of 10 414 (measured with a 1 ms clock, while the output device was reporting dropouts) |
| Time from a structural edit to the page having redrawn, nine components | median 3.3 ms, worst 14 ms |
| Undo 100 times after those 140 edits | Stops at the 100-step limit, as designed |

### Listening files

`npm run render:builder` writes 14 WAV files to `renders/builder/`, made as
the page makes sound (the example graph, translated, played through the
engine in 128-sample blocks by the calls the Play button sends), without
the browser's volume and limiter. Each group shares one gain;
`listening.json` records peaks and gains.

| Files | Content |
| --- | --- |
| `1a` to `1d` | One metal bar: as loaded; soft mallet; hard mallet; heavier mallet |
| `1e` | Strike velocity 0.5, 1.5 and 4 m/s (a live property) |
| `2a` to `2d` | Two bars: as loaded; spring removed; spring ten times stiffer; spring and strong damper |
| `2e` | Stiffness raised tenfold and lowered again while ringing (live) |
| `3a` to `3d` | Wood and metal: as loaded; connection removed; spring ten times stiffer; wood damping x0.3 |

All 14 rendered with no engine fault; the contact solver needed at most 5
iterations. How they sound is for listening to decide.

### Still open after Phase 3B.1

- Everything in section 9 except where this section says otherwise.
- The cause of the output-device dropouts is inferred, not proven; and the
  builder has still not been run for a long session by a person.
- Four engine blocks in about ten thousand took 2 ms or more during the
  browser stress run. The clock available cannot say by how much, or
  whether the cause was the engine or the machine.
- Mouse and keyboard were tested; touch was not.

## 11. The string-and-body instrument (Phase 3C.3)

The builder can also hold one experimental instrument that is not made of bars: a string standing on a damped box body by a bridge. It has its own parts, its own example group and its own output (sound pressure, not bar velocity), and cannot yet share a canvas with bars. Everything in sections 1 to 10 about bars is unchanged, and the three bar examples are the same three. See [STRING_INSTRUMENT.md](STRING_INSTRUMENT.md).

