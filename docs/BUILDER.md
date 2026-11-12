# Instrument builder (Phase 3B)

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

**Limits are documented and enforced, not silently clamped.** A value outside
its range is rejected with a message naming the property and the range; the
instrument is then silent until it is corrected. The one exception is in the
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
  slider is one step.
- **Keyboard**: components are focusable; Enter selects, arrow keys move,
  Delete removes, Space plays.
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

The whole suite is 171 tests (139 before this phase); all pass. The four
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

**Dropouts.** During the first part of the session (start, play, add, drag,
connect, edit: about a minute) the browser's dropout count stayed at 1, the
start-up one recorded in STABILITY.md. Later in the session the count rose
continuously, about 15 to 25 a second, even with nothing playing. The
Phase 3A.1 test page, which had run with no dropouts while playing, was
re-run at that moment and showed the same (14 a second, idle, with the
engine using 0.03 % of a core). Other applications were then using 33 to
47 % of the machine's processors. So the dropouts were present with and
without the builder; their cause was not identified beyond that, and the
builder has not been observed over a long session on a quiet machine.

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
