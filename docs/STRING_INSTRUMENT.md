# The string-and-body instrument in the builder (Phase 3C.3)

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

**A new pluck adds to the vibration already there; it does not reset it.**
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
