# Physical soundboard: investigation and prototype (Phase 3C.2)

**Status: an isolated experiment.** Nothing here is used by the application
or by the instrument builder. The four approved Faust instruments, the
builder and the WebAssembly physics engine are unchanged. Strings are not in
the builder.

**What this is not.** A flat rectangular plate is not a guitar body. It has
no bracing, no air cavity, no back or sides and no sound hole, and its edges
are held in the one way that has an exact formula rather than the way a real
top is held. It is the simplest soundboard whose every number can be checked.

| Piece | Where |
| --- | --- |
| Plate model, radiation, plate theory | `src/experimental/string/soundboard.ts` |
| Strings + bridges + body as engine calls | `src/experimental/string/instrument.ts` |
| Scenarios | `analysis/soundboard.ts` |
| Tests (12) | `tests/soundboard.test.ts` |
| Listening renders, Node performance | `analysis/render-soundboard.ts` (`npm run render:soundboard`) |
| Browser performance | `experimental.html`, "Run string + soundboard benchmark" |
| Resonance control (Phase 3C.2.3, section 10) | `src/experimental/string/bodyResponse.ts`, `tests/body-response.test.ts` (5), `analysis/render-soundboard-damped.ts` |
| Diagnosis and air cavity (Phase 3C.2.2, section 9) | `src/experimental/string/airCavity.ts`, `tests/air-cavity.test.ts` (7), `analysis/render-soundboard-enclosed.ts` |
| Refinements (Phase 3C.2.1, section 8) | `src/experimental/string/soundboardRefined.ts`, `tests/soundboard-refined.test.ts` (9), `analysis/render-soundboard-refined.ts` |

Measured on the development machine (Node 24.14; Chromium 156). Timings vary
by 10 to 30 % between runs. No claim is made about how anything sounds.

## 1. Physical model and assumptions

The soundboard is a thin, flat, uniform rectangular plate of wood, grain
along its length, bending under thin-plate (Kirchhoff) theory, with all four
edges simply supported (held in place, free to rotate).

**Derived from physics, given the inputs:**

| Quantity | How |
| --- | --- |
| Bending rigidities | Dx = E_along h^3 / 12(1 - nu nu'), Dy likewise with E_across, mixed term H = nu' Dx + 2 G h^3 / 12 |
| Mode shapes | sin(m pi x / a) sin(n pi y / b): exact for these edges |
| Mode frequencies | w^2 = [Dx (m pi/a)^4 + 2 H (m pi/a)^2 (n pi/b)^2 + Dy (n pi/b)^4] / (rho h): exact for these edges |
| Modal masses | a quarter of the plate's mass, every mode |
| Coupling at the bridge | each mode's shape at the bridge point |
| Decay | T60 = 2.2 / (loss factor x frequency) |
| Radiated sound | section 3 |

**Assumed, to keep it simple and checkable:** simply supported edges; a flat
plate of uniform thickness; no bracing; no air cavity, back, sides or sound
hole; a loss factor that does not change with frequency; no reaction of the
air on the plate.

**Needing empirical calibration (not derived here):**

| Value | Used | Why it is a calibration |
| --- | --- | --- |
| Moduli, density, Poisson's ratio | 11 / 0.8 / 0.7 GPa, 420 kg/m^3, 0.37 | Nominal spruce. Real boards differ by tens of percent. |
| Loss factor | 0.012 | Depends on the piece, frequency and humidity; also stands for sound radiated, which is not modelled as a loss. |
| **Thickness** | **4 mm** | Guitar tops are nearer 2.5 to 3 mm but braced. A bare 3 mm plate yields so much that it pulls the test string 37 cents flat. The extra millimetre stands in for the bracing. |
| Size | 0.5 x 0.4 m | A convenient size, not a measured instrument. |
| Bridge position | 0.30, 0.44 of length and width | Off the nodal lines of the low modes. |
| Bridge stiffness and mass | 1e6 N/m, none | The bridge is a spring; a lumped bridge mass is optional. |
| Pluck force | 2 N | Of the order of a real pluck; sets every absolute level below. |

The prototype soundboard weighs 336 g. Its lowest modes are (1,1) 48.0 Hz,
(1,2) 89.5, (2,1) 158.7, (1,3) 165.6, (2,2) 192.0, (2,3) 257.4 Hz; it has 62
modes below 2 kHz, 158 below 5 kHz and 658 below 20 kHz.

## 2. Numerical accuracy

| Check | Reference | Result |
| --- | --- | --- |
| Plate frequencies, isotropic case | Textbook formula for a simply supported plate, five modes | equal to 10 digits (aluminium, 1 m square, 10 mm: 48.4 Hz) |
| Number of modes | Modal density of plate theory (Weyl's law), three thicknesses | 0.81 to 0.96 of it, rising with frequency as the edge effect fades |
| Mean bridge mobility | Infinite plate, Cremer and Heckl: density / (4 x mass) | 3 mm: 0.0435 to 0.0454 against 0.0455; 4 mm: 0.0213 to 0.0261 against 0.0256; 6 mm: 0.0111 to 0.0126 against 0.0114 m/(N s) |
| Plate in the engine: all 15 modes below 600 Hz | The formula | within 0.5 cents each |
| Decay of mode (1,1) in the engine | 2.2 / (loss factor x f) = 3.82 s | 3.82 s |
| Radiated pressure of a moving surface | Far field of a baffled piston | within 1 % |
| A bridge on the nodal line x = 1/2 | Cannot drive modes with m even | mode (2,1) at less than 1/1000 of mode (1,1); at the default bridge, more than 1/5 |
| String on the board: coupled resonances below 2 kHz | Exact characteristic equation of string, bridge and plate (72 roots) | 25 strongest peaks: worst 0.21 cents, median 0.009 |
| Energy, no losses, string + bridge + board | Constant | to 3.2e-12 over 2.7 s |
| With losses | Never rises once the pluck has let go | 0 rises |

## 3. Coupling behaviour

### What the string does on the board (A2 string, 109.9 Hz)

| | Pitch of partials 1, 2, 3, 6, 8 against n x f0 | T60 of partials 1, 2, 3, 6, 8 |
| --- | --- | --- |
| String alone (its own losses) | 0 | 3.74, 3.71, 3.65, 3.37, 3.12 s |
| On the prototype soundboard (4 mm) | -3.4, +0.5, -0.6, -5.3, -1.2 cents | 3.68, 3.48, 3.27, 0.76, 1.52 s |
| On a bare 3 mm plate | -37.1, +7.6, +2.5, -2.8, +0.5 cents | 3.09, 3.11, 2.72, 1.22, 2.10 s |
| On a 6 mm plate | +1.0, -5.7, 0.0, +0.2, -2.0 cents | 3.72, 3.32, 3.54, 3.07, 0.93 s |

The soundboard pulls a partial that lies near one of its resonances, up or
down, and takes that partial's energy faster. Which partials suffer depends
on where they fall among the plate's modes, so the effect is not a smooth
function of thickness. This is the mechanism behind "wolf notes"; on a bare
plate it is far stronger than on a braced instrument.

The decay agrees with first-order theory (a partial loses energy to the
bridge at 2 f0 Z Re(Y) per second, Z the string's impedance and Y the
plate's mobility at the bridge): estimated 3.62, 3.41, 3.20, 0.65, 1.55 s
against the measured 3.68, 3.48, 3.27, 0.76, 1.52 s on the prototype board.

### Energy transfer (no losses anywhere, so only transfer can move it)

| | |
| --- | --- |
| String plucked: most of the energy the soundboard ever held | 13.7 % |
| The same string on the Phase 3C.1 wooden bar | 0.41 % |
| Soundboard struck, string untouched: most the string ever held | 16.4 % |
| Either, with the bridge removed | exactly 0 |

### What is heard depends on what is measured

One pluck of 2 N on the prototype soundboard:

| Signal | Peak | Peak after 0.3 s | Power-weighted mean frequency |
| --- | --- | --- | --- |
| String displacement, 0.3 along | 3.1 mm | 1.4 mm | 128 Hz |
| Force at the bridge | 1.90 N | 0.98 N | 174 Hz |
| Bridge velocity | 73 mm/s | 30 mm/s | 53 Hz |
| Soundboard mean velocity | 26 mm/s | 15 mm/s | 52 Hz |
| Radiated pressure, on axis at 1 m | 0.51 Pa (85.2 dB SPL at the peak) | 0.23 Pa | 72 Hz |

**The radiation model.** For a flat radiator in a large rigid wall, heard
far away and straight in front, every part of the surface is the same
distance from the listener, and Rayleigh's integral reduces to

    p(t) = rho_air / (2 pi r) x d/dt [ area x mean surface velocity ].

The plate is given one extra port whose "displacement" is its displacement
averaged over the surface (4 / (pi^2 m n) for odd m and n, zero otherwise:
modes that move as much air one way as the other radiate nothing on the
axis). The engine reads that port's velocity; the time derivative and the
constant are applied afterwards. It is exact under its three assumptions
(infinite baffle, far field, on the axis) and says nothing about other
directions, a room, or an instrument with no baffle.

**The low boom.** The radiated sound is dominated by the plate's own lowest
modes, set ringing by the pluck's release: its power-weighted mean frequency
is 72 Hz, and its content above 1 kHz is 41 dB below the whole. That is what
this plate does. A guitar top's main resonance is roughly two octaves above this
plate's 48 Hz, and its air cavity changes the bass entirely.

### Bridge position, size, material (sound after 0.3 s, relative to the prototype)

| Variant | Lowest mode | Modes to 5 kHz | Partial 1 | T60 of partial 2 | Sound level | Share above 1 kHz |
| --- | --- | --- | --- | --- | --- | --- |
| Prototype: 4 mm, 0.5 x 0.4 m, bridge at (0.30, 0.44) | 48 Hz | 158 | -3.4 cents | 3.48 s | 0 dB | -40.9 dB |
| Bridge at the centre | | | 0.0 | 3.62 | +2.8 | -27.9 |
| Bridge near an end (0.12, 0.44) | | | -4.1 | 3.59 | -4.0 | -33.3 |
| Bridge near a side (0.30, 0.12) | | | -2.0 | 3.40 | -6.6 | -34.4 |
| Smaller plate, 0.35 x 0.28 m | 98 | 74 | +23.6 | 3.61 | +3.6 | -34.2 |
| Larger plate, 0.70 x 0.50 m | 26 | 283 | +13.8 | 2.85 | +1.9 | -47.9 |
| Thinner, 3 mm | 36 | 214 | -37.1 | 3.11 | +3.6 | -50.6 |
| Thicker, 6 mm | 72 | 105 | +1.0 | 3.32 | -2.8 | -26.5 |
| Denser, stiffer wood (maple-like) | 44 | 168 | -4.6 | 3.52 | -3.2 | -36.7 |
| More lossy wood (loss factor 0.03) | 48 | 158 | -3.4 | 3.11 | -5.0 | -38.4 |
| With a 25 g bridge | 48 | 158 | -4.2 | 3.54 | +0.6 | -48.1 |

As plate theory says: frequencies in proportion to thickness and to
1 / size^2; mean mobility as 1 / thickness^2 and independent of size; a
bridge near an edge, where the plate hardly moves, drives it less. The
smaller and larger plates put a resonance near the string's fundamental and
pull it by 14 to 24 cents.

### How many soundboard modes are needed

| Soundboard modes kept | Count | Partial 1 | Partial 3 | T60 of partial 8 | Sound above 1 kHz, against all modes to 10 kHz |
| --- | --- | --- | --- | --- | --- |
| Below 500 Hz | 13 | -2.52 cents | +0.47 | 3.12 s | +11.3 dB |
| Below 1 kHz | 28 | -2.93 | -0.08 | 1.47 s | +4.0 dB |
| Below 2 kHz | 62 | -3.25 | -0.41 | 1.51 s | +0.9 dB |
| Below 5 kHz | 158 | -3.40 | -0.56 | 1.52 s | 0.0 dB |
| Below 10 kHz | 324 | -3.46 | -0.62 | 1.52 s | reference |

Leaving out high modes does not dull the sound: it makes it too bright,
because the string's high partials then meet nothing that takes their
energy and ring on. The total level does not change (it is the low boom).
Modes to 2 kHz (62) give the pitch within 0.2 cents and the high-frequency
level within 1 dB of the converged result.

### Stability

Bridges of 1e3 to 1e12 N/m, plates of 1.5 and 8 mm, a bridge 2 mm from the
corner, a 200 g bridge, a bridge with a strong damper, three strings: all
ten finite, 0 faults, no step on which energy rose after the plucks.

## 4. Performance

`xN`: N times faster than real time on one thread. A block must finish in
2.667 ms.

**In a real AudioWorklet (Chromium), which is the figure that matters.**
Offline: how fast the worklet can render. Live: 6 s through the speakers and
6 s with no output device, plucked ten times a second.

| Instrument | Modes | Offline | Live: share of one core | Live: blocks of 2 ms or more (of about 2700 / 2300) |
| --- | --- | --- | --- | --- |
| One string (100 modes), soundboard to 2 kHz | 162 | x15 | 10.9 / 8.8 % | 0 / 0 |
| One string (100 modes), soundboard to 5 kHz | 258 | x10 | 14.9 / 13.9 % | 0 / 0 |
| Three strings (100 each), soundboard to 2 kHz | 362 | x5 | 17.5 / 21.3 % | 5 / 0 |
| Six strings (60 each), soundboard to 2 kHz | 422 | x4 | 27.6 / 25.7 % | 25 / 35 |
| Six strings (100 each), soundboard to 5 kHz | 711 | x3 | 45.8 / 42.4 % | 645 / 341 |

Every block was processed in every run (none dropped), no sample was
non-finite, and the output device reported no dropouts during these runs.
The live share is measured with the worklet's 1 ms clock and is an average,
not a precise figure.

**In Node** (median of three 10 s runs):

| Instrument | Modes | Speed | Share of one core |
| --- | --- | --- | --- |
| One string (100), soundboard to 1 kHz | 128 | x24 | 4.1 % |
| One string (100), soundboard to 2 kHz | 162 | x20 | 5.0 % |
| One string (100), soundboard to 5 kHz | 258 | x13 | 7.7 % |
| One string (100), soundboard to 10 kHz | 424 | x8 | 12.6 % |
| One string (all 197), soundboard to 5 kHz | 354 | x9 | 11.4 % |
| Three strings (100 each), soundboard to 2 kHz | 362 | x7 | 14.5 % |
| Three strings (100 each), soundboard to 5 kHz | 458 | x5 | 20.2 % |
| Six strings (60 each), soundboard to 2 kHz | 422 | x6 | 17.7 % |
| Six strings (100 each), soundboard to 2 kHz | 615 | x4 | 23.0 % |
| Six strings (100 each), soundboard to 5 kHz | 711 | x3 | 29.8 % |

Node's worst single blocks ranged from 1.7 to 62 ms with no relation to the
size of the instrument: they are the host machine, not the engine, and are
not reported as engine figures. The browser's count of late blocks is the
meaningful measure of reliability.

**Reading these.**

- The browser costs up to twice what Node suggests live. Node figures are
  not a substitute.
- **One string on a soundboard runs reliably in real time**: 9 to 15 % of a
  core with no late block.
- **Three strings are marginal**: no block was dropped, but 5 of 2741 ran
  late in one of the two runs.
- **Six strings are not reliable** at either size tried.
- Cost grows faster than the number of modes when strings are added,
  because every bridge makes the engine pass over all the soundboard's modes
  again each sample. That is how the engine handles joined resonators, not a
  property of the model.

## 5. Listening files

`npm run render:soundboard` writes 22 WAV files (48 kHz, 24-bit, mono) to
`renders/soundboard/`. `listening.json` there records, for every file, the
physical quantity, its peak and RMS in real units before any gain, the gain
applied, and its level relative to the first file of its group.

**Normalisation.** Files in a group share one gain, chosen so the loudest
peaks at 0.5; within a group, level differences are real. Files of
different quantities (a force, a velocity, a pressure) are each normalised
on their own, because they have no common scale.

| Files | Quantity | Content | Actual level |
| --- | --- | --- | --- |
| `A1`, `A2` | Faust output | Approved string with its body; with its body off | peaks 0.385, 0.447 |
| `B1` | N | Modal string alone: force at a rigid bridge (not sound) | peak 1.93 N |
| `C1` | m/s | Modal string on the Phase 3C.1 wooden bar: the bar's velocity | peak 4.5 mm/s (gain 112) |
| `D1` | m | String on the soundboard: string displacement | peak 3.1 mm |
| `D2` | m/s | Bridge velocity | peak 73 mm/s |
| `D3` | m/s | Mean velocity of the board | peak 26 mm/s |
| `D4` | Pa | Radiated pressure on axis at 1 m | peak 0.51 Pa, 85.2 dB SPL |
| `D5` | Pa | `D4` with everything below 80 Hz removed | peak 0.29 Pa, 80.2 dB SPL |
| `E1` to `E6` | Pa, one gain | Prototype; small; large; thin 3 mm; thick 6 mm; lossy wood | 0, +5.8, +1.2, +3.0, -1.6, -2.4 dB |
| `F1` to `F4` | Pa, one gain | Bridge at the prototype position; centre; near an end; near a side | 0, +3.4, -2.5, -5.8 dB |
| `G1`, `G2` | Pa, one gain | A phrase on six strings on the soundboard; the same with 60 modes a string and the board to 2 kHz | peak 1.31 Pa, 93.3 dB SPL; 0.0 dB apart |
| `G3` | Faust output | The same notes on the approved string with its body | peak 0.476 |

`D5` exists because much of `D4` lies below what small loudspeakers
reproduce. It is a listening aid: a high-pass filter is not part of the
model, and no other file is filtered. The phrase uses six open strings that
ring on; the approved string is one fretted string, so its notes end as the
next begins, and it cannot play the final chord.

## 6. Limitations

1. **Not an instrument body** (see the top of this document). In particular
   the low boom of section 3 and the strong pitch pulls come from the bare
   plate and would both be different with bracing and an air cavity.
2. **Pitch is pulled by the soundboard**, by several cents on the prototype
   and by tens on unlucky sizes. It is correct for the plate and matches the
   exact equation; it is not what a tuned instrument does.
3. **Thickness is a calibration**, as is the loss factor. Neither was fitted
   to a measurement.
4. **Radiation is on-axis, far-field, baffled**, with no room and no loss of
   energy to the air. Sound radiated is not taken from the plate.
5. **The derivative and the pressure constant are applied outside the
   engine.** The engine outputs the mean velocity; real-time use needs a
   differentiator at its output.
6. **The engine still has no pluck.** These renders apply the plucking force
   sample by sample from outside; the browser benchmark used the existing
   strike pulse instead.
7. **Multi-string cost** (section 4): one string is comfortable, three
   marginal, six not reliable, in the engine as it is.
8. **Truncation makes the sound brighter, not duller** (section 3). The
   board needs its modes to at least 2 kHz.
9. **One browser, one machine.** The browser figures are from Chromium on
   the development machine.
10. **No listening evaluation.** Every statement here is a measurement.
11. **Bars have no radiation model.** `C1` is a velocity, set beside the
    soundboard's pressure only because nothing better exists for a bar.

## 7. Recommendation

**A plate soundboard does what the bar could not.** It takes 13.7 % of a
plucked string's energy where the bar took 0.41 %, radiates a level of the
right order (85 dB SPL at 1 m for a 2 N pluck), and its behaviour matches
plate theory and the exact coupled equation. It uses the existing engine
unchanged: it is modal data and one extra port.

**For integrating a string and soundboard into the builder, I recommend:**

1. **One string on one soundboard first.** That configuration ran reliably
   in a real AudioWorklet. Offer more strings only after item 4.
2. **Fixed sizes for a first version:** string 100 modes, soundboard modes
   to 2 kHz (62 for the prototype). Pitch within 0.2 cents and
   high-frequency level within 1 dB of the converged model, at about 10 % of
   a core.
3. **Two small engine additions:** a pluck (a force that steps and
   relaxes), and a differentiator on the output so that radiated pressure,
   not velocity, is what is heard.
4. **Make joined resonators cheaper in the engine** before offering several
   strings. Today each bridge costs a pass over every soundboard mode; this
   is where three and six strings lose their real-time margin.
5. **Expose the plate honestly:** size, thickness, material and bridge
   position as structural properties, with the lowest mode and the pitch
   pull shown, since a soundboard that sits on a string's partial detunes
   it. Thickness should be labelled as standing in for bracing.
6. **Decide what "the sound" is.** The radiated pressure of a bare plate is
   bass-heavy. Whether to add a physically motivated air resonance, to
   choose a smaller default plate, or to accept the plate as it is should be
   settled by listening to `D4`, `D5`, `E1` to `E6` and `G1` before any
   interface is built.

Phase 3C.2.1 acted on item 6: see section 8.

## 8. Acoustic refinement (Phase 3C.2.1)

An analysis of the 22 recordings of section 5 found three faults in the
prototype's sound: the plate's lowest mode (48 Hz) was louder than the
string's fundamental; notes of a phrase were out of tune by up to 47 cents;
and the fundamentals of the six phrase notes differed in level by 28 dB. This
section changes the soundboard to remove them. `soundboard.ts`, the engine,
the builder and the approved instruments are unchanged; the Phase 3C.2 board
remains the default of `onSoundboard()`, and the 22 recordings are the
"before" of every comparison.

### What changed

| | Phase 3C.2 | Refined (`REFINED` in `analysis/soundboard.ts`) |
| --- | --- | --- |
| Thickness | 4 mm | **8 mm** |
| Bridge, as fractions of length and width | (0.30, 0.44) | **(0.08, 0.44)**: 4 cm from one end |
| Radiation | baffled, on axis | **no baffle**, on axis |
| Plate mass, lowest mode, modes below 5 kHz | 336 g, 48.3 Hz, 158 | 672 g, 96.6 Hz, 76 |
| Material, size, loss factor, bridge spring | | unchanged |

Why each one, physically:

1. **Thickness sets how hard the plate pushes back.** The plate's mean
   mobility falls as thickness squared (section 2), so an 8 mm plate yields a
   quarter as much to the string as a 4 mm one, and its modes are twice as
   far apart (every frequency doubles). Both reduce how far a string partial
   is pulled when it meets a plate mode. It also lifts the lowest mode from
   48 Hz to 97 Hz, above which nothing of the plate can boom. As before, the
   thickness stands in for bracing: 8 mm of bare spruce is not a guitar top,
   it is closer to a piano's soundboard.
2. **A bridge near an edge is on stiffer ground.** A simply supported plate
   does not move at its edges, so every low mode is small 4 cm from the end:
   mode (m, n) is felt there as sin(0.08 m pi), 0.25 for m = 1 against 0.81
   at the old position. A pull is in proportion to the square of that. This
   was the strongest single lever found.
3. **A plate in a wall is not a plate in the open.** The Phase 3C.2 radiation
   assumed an infinite baffle. Without one, air slips round the edge from
   front to back at low frequencies and the plate radiates as a dipole.
   `unbaffled()` models it as the far field of a rigid disc of the same area
   in free air against the same disc in a wall: 4ka/(3 pi) at low
   frequencies, 1 at high ones. That is a first-order high-pass with its
   corner at 3c/(8a) = 510 Hz for this plate (a = 0.252 m). It is applied to
   the pressure outside the engine, as the pressure constant already is.

### What was tried and how the configuration was chosen

Each candidate was run two ways: the six phrase notes (A2 D3 E3 G3 A3 B3)
with all six strings on the board, and every semitone from E2 to E4 with one
string. Radiated pressure at 1 m, 100 string modes, board modes to 5 kHz.

| Board | Phrase: worst pitch error | Phrase: spread of fundamental levels | E2 to E4: worst error | Notes off by more than 5 cents |
| --- | --- | --- | --- | --- |
| 4 mm, bridge (0.30, 0.44), baffled (Phase 3C.2) | 39.3 cents | 28.8 dB | 44.5 cents | 16 of 25 |
| 6 mm, same bridge, baffled (the 6 mm variant of section 3) | 10.9 | 8.7 | not run | |
| 7 mm, same bridge, unbaffled | 3.0 | 5.4 | 35.0 | 8 of 25 |
| 10 mm, same bridge (phrase measured baffled, semitones unbaffled) | 6.4 | 11.4 | 15.1 | 4 of 25 |
| 6 mm, bridge (0.12, 0.44), unbaffled | 6.9 | 11.1 | 10.5 | 1 of 25 |
| 6 mm, bridge (0.08, 0.44), unbaffled | 3.7 | 19.4 | 5.9 | 1 of 25 |
| 8 mm, bridge (0.12, 0.44), unbaffled | 1.2 | 5.4 | 7.1 | 3 of 25 |
| **8 mm, bridge (0.08, 0.44), unbaffled (chosen)** | **0.8** | **5.6** | **3.3** | **0 of 25** |
| 8 mm, bridge (0.08, 0.30), unbaffled | 1.1 | 5.7 | 2.5 | 0 of 25, but fundamentals from E2 to E4 differ by 41 dB against 20 |

Findings that shaped the choice:

- **The phrase alone is a misleading test.** 7 mm looked excellent on the six
  phrase notes (3 cents) and had a 35 cent error at E2. A plate has a
  resonance somewhere under every instrument's range; thickness moves the
  bad notes, it does not remove them. Only the chromatic run shows this.
- **Thickness does not improve steadily.** 7 mm was worse than both 6 and
  8 mm at the edge bridge. What matters is where the strongly driven modes
  fall against the notes, so the chosen board is good for this size and
  these notes, not in general.
- **Tried and not adopted** (all implemented in `soundboardRefined.ts` and
  tested, none part of `REFINED`):
  a bridge with mass (20 g made 6 mm worse: 26 cents);
  a bridge with length (`bridgeLength`, the force spread along a line: a
  small gain on the phrase, none on the chromatic run);
  losses that differ along and across the grain (`loss`: evenness worse at
  6 mm, no change at 7 mm);
  taking radiated energy from fast modes (`radiationLoss`: no measurable
  effect, air takes far less than the wood);
  a listener off the axis (`listener`, the far field of each mode at its own
  frequency: fundamental levels less even, 9 to 13 dB, and less treble);
  a higher loss factor (0.03: the worst pull about one cent smaller, sound
  3.5 dB quieter).

### Before and after

A2 string (2 N pluck) unless stated; "approved" is the Faust string, whose
output is not a pressure, so only its shape can be compared, not its level.

| | Phase 3C.2 board | Refined board | Approved Faust string |
| --- | --- | --- | --- |
| Phrase, ten notes: pitch errors | +46.8 to -18.1 cents | **-0.2 to -0.7 cents** | -0.8 to -1.6 cents |
| Phrase: fundamental level, loudest to quietest note | 28.3 dB | **4.1 dB** | 5.8 dB |
| E2 to E4, one string: worst pitch error | 44.5 cents | **3.3 cents** | not applicable (no body coupling) |
| Plate's lowest mode against the string's fundamental | 48 Hz, **+3.9 dB** | 96 Hz, **-11.1 dB** | none |
| Same for the B3 string | +20.9 dB | -15.5 dB | none |
| Share of energy below 80 Hz, single note | -1.4 dB (72 %) | below -100 dB | below -100 dB |
| Share below 80 Hz, phrase | -3.7 dB (43 %) | -46.7 dB | -31.8 dB |
| Share 80 to 300 Hz | -5.9 dB | **-10.9 dB** | -1.0 dB |
| Share 300 Hz to 1 kHz | -16.3 dB | -0.4 dB | -7.0 dB |
| Share 1 to 4 kHz | -38.8 dB | -18.6 dB | -24.6 dB |
| Harmonics 2, 3, 4, 6 against the fundamental, dB | -18, -13, -17, -65 | -7, **+9**, -28, 0 | 0, -5, -10, -18 |
| Decay time (T60) by band: 80-300, 300-1k, 1-4k Hz | 3.7, 3.2, 1.7 s | 3.7, 2.5, 1.8 s | 3.7, 3.6, 2.5 s |
| Time for the level to rise from 10 to 90 % of its peak | 7 ms | 92 ms (B3: 10 ms) | under 1 ms |
| Peak level at 1 m | 85.2 dB SPL | 73.6 dB SPL | not a pressure |
| Level, A2 / B3 / phrase, against the Phase 3C.2 board | 0 | **-10.7 / -13.2 / -12.8 dB** | |
| A pitch tracker (autocorrelation) follows the note | no: 0 of 56 frames | yes: 56 of 56, within 0.4 cents | yes |
| Largest step between samples, of the peak | 0.08 | 0.15 | 0.13 |
| String plucked: most of the energy the board held (no losses) | 13.7 % | 8.1 % | |
| Board struck: most the string held (no losses) | 16.4 % | 14.6 % | |
| Energy drift without losses, 0.3 to 2 s | 2.2e-12 | 2.5e-12 | |
| Non-finite samples, engine faults, energy rises with losses | none | none (six strings plucked at 10 N, board struck) | |

What the refinement did not fix, and what it made worse:

1. **The low register is now thin.** The fundamental of A2 is 9 dB below its
   third harmonic and 80 to 300 Hz holds 8 % of the energy, where the
   approved string has 79 %. This is the physics of the model, not a tuning
   mistake: a 0.5 x 0.4 m plate in the open cannot radiate 110 Hz (the
   no-baffle loss is 13 dB there), and the stiff edge that keeps the string
   in tune also takes less from it. A guitar gets its bass from the air in
   its body, which this model does not have.
2. **It is 11 to 13 dB quieter.** About 4 dB of that is the bridge
   position (files `L1` and `L2`), the rest the thickness and the missing
   baffle.
3. **A2 swells for a tenth of a second** instead of starting at full level.
   The measured rise is 92 ms; the cause was not investigated (the string's
   fundamental at 110 Hz and the plate's lowest mode at 96 Hz are 14 Hz
   apart, which would beat at that rate, but that is a conjecture).
4. **The plate's own lowest mode is still audible in the numbers**, 11 dB
   under the fundamental of A2 and 14 Hz below it.
5. **Tuning depends on the bridge staying where it is.** On the same refined
   plate, A2 is pulled 6.5 cents with the bridge at (0.30, 0.44) and 10.5
   at the centre, both about 4 to 5 dB louder and with far more 80-300 Hz
   (-0.7 dB). Loudness and fullness are bought with tuning error, and the
   other way round.
6. **The unbaffled correction is a rigid-disc formula** applied to a bending
   plate, on its axis. It has the right low-frequency slope and size for a
   plate moving as a whole; it is not a calculation of this plate's field.

### Performance

Same machine as section 4, but **on battery this time, and about twice as
slow as when section 4 was measured** (the Phase 3C.2 board, one string, to
5 kHz: 15.3 % of a core in Node now against 7.7 % then). Compare the rows of
this table with each other, not with section 4.

| | Modes | Node, % of one core | Chromium AudioWorklet, live, % of one core | Blocks of 2 ms or more (of about 2700) | Dropouts |
| --- | --- | --- | --- | --- | --- |
| Phase 3C.2 board, one string, board to 5 kHz | 258 | 15.3 | 18.1 (speakers), 18.6 (no device) | 19, 16 | 0 |
| **Refined board, one string, board to 5 kHz** | 176 | **10.3** | **12.5 (speakers), 14.0 (no device)** | 3, 10 | 0 |
| Phase 3C.2 board, six strings | 711 | 56.9 | 77.8, 82.6 | 2304, 2269 | 0 reported |
| Refined board, six strings | 629 | 47.0 | 72.6, 70.7 | 2146, 1950 | 0 reported |

The refined board costs about two thirds of the Phase 3C.2 board because it
has half the modes. The no-baffle filter ran in the browser as a native
first-order filter node after the worklet; its cost is not in the engine
figure and was too small to see in the offline render time. One string
processed every block it was asked for with no dropout while using an
eighth of a core on a throttled machine. Six strings are not real-time safe,
as before. The worklet's clock has a resolution of 1 ms, so the "2 ms or
more" counts are coarse.

### Listening files

`npm run render:soundboard-refined` writes 16 files to
`renders/soundboard-refined/` with `listening.json`. Files that share a
group share one gain, so loudness differences inside a group are real; each
"full-scale" file repeats a refined recording at its own gain so that tone
can be compared without the loudness difference. The Phase 3C.2 recordings
are in `renders/soundboard/` as before.

| Files | What | Gain |
| --- | --- | --- |
| `H1`, `H2` | A2 on the Phase 3C.2 board and on the refined board | both -0.3 dB (x 0.97) |
| `H3` | `H2` at full scale | +11.3 dB |
| `I1`, `I2` | B3, same pair | both +0.4 dB |
| `I3` | `I2` at full scale | +12.1 dB |
| `K1`, `K2` | A2 and B3 on the approved Faust string | both +2.3 dB |
| `L1` to `L4` | Refined plate, bridge at (0.08, 0.44), (0.30, 0.44), the centre, (0.30, 0.12) | all +3.2 dB |
| `G1`, `G2` | The phrase on the Phase 3C.2 board and on the refined board | both -8.4 dB |
| `G3` | `G2` at full scale | +3.8 dB |
| `G4` | The phrase on the approved Faust string | +0.4 dB |

### Recommendation

**The refined soundboard is ready to go into the builder as a string's
body, on the conditions below. It is not a finished instrument sound.**

For it: every note from E2 to E4 within 3.3 cents, phrase notes as even in
level as the approved string's, no boom, no instability, energy exchanged
both ways, a third cheaper than before, one string comfortable in a real
AudioWorklet.

Conditions:

1. **Listen to `H3`, `I3` and `G3` against `K1`, `K2` and `G4` first.** The
   measurements say the low notes will sound thin beside the approved
   string. Whether that is acceptable is a judgement no measurement here
   makes.
2. **Fix the bridge position in a first version**, or show the pitch pull
   when it is moved (item 5 above).
3. **One string**, as section 7 already said.
4. The engine additions of section 7 (a pluck, a differentiator) are still
   needed, plus the first-order no-baffle filter at the output.

If the thin low register is not acceptable, the physical next step is an
enclosed volume of air behind the plate: an air spring on the plate's mean
motion (stiffness about rho c^2 S^2 / V) and, with a sound hole, a Helmholtz
resonance near 100 Hz that radiates as a monopole. That is where a guitar's
bass comes from. It has not been built or measured, and the stiffness figure
is an estimate. Adding equalisation instead would hide the problem this
phase was asked not to hide.

Phase 3C.2.2 investigated the three open points and that air volume: see
section 9.

## 9. Diagnosis before integration (Phase 3C.2.2)

Section 8 left three things unexplained: the 92 ms attack of A2, its weak
fundamental, and a level 11 to 13 dB below the Phase 3C.2 board. This section
finds the cause of each by measurement, then tries the smallest enclosed
body. The refined board of section 8 is unchanged and is the "before" of
every comparison. The builder, the engine and the approved instruments are
untouched; the only change to existing experimental code is an optional
`air` field on the prototype instrument (absent: the engine calls are the
same as before) and an `output` signal in the scenario recorder.

### 9.1 The slow attack of A2

**Cause: the third harmonic of A2 (329.9 Hz) lies 7 cents from the plate's
mode (1,3) at 331.1 Hz, and that mode takes a tenth of a second to build
up.** It is not a beat between the 110 Hz fundamental and the 96 Hz plate
mode, as section 8 conjectured.

Where the delay appears along the chain (time for the level to go from 10 to
90 % of its largest; three window lengths, because the figure depends on the
window):

| Signal | 1 ms windows (the method of section 8) | One period of the string (9 ms) | 30 ms | Largest at |
| --- | --- | --- | --- | --- |
| String displacement | 2 ms | 0 | 0 | 2 to 4 ms |
| Force at the bridge | 1 | 0 | 0 | 1 ms |
| Bridge velocity | 30 | 17 | 5 | 21 to 39 ms |
| Board mean velocity | 26 | 21 | 9 | 18 to 32 ms |
| Pressure, baffled | 108 | 24 | 17 | 91 to 109 ms |
| Pressure, no baffle (the sound) | **92** | 75 | 63 | 101 to 148 ms |

The string and the force it puts on the bridge are immediate. The delay
appears in the board and grows towards the air. Taking the sound apart by
harmonic shows which part is late:

| Harmonic of the sound | Largest at | Level 20 ms after the pluck, against its largest |
| --- | --- | --- |
| 1 (110 Hz) | 32 ms | -1.4 dB |
| 2 | 4 ms | -2.9 dB |
| **3 (330 Hz), the strongest: 8 dB above the fundamental** | **136 ms** | **-8.0 dB** |
| 6 | 21 ms | -0.6 dB |

A resonator driven almost at its own frequency fills up at the rate at which
it would decay. Mode (1,3) has a T60 of 0.55 s (loss factor 0.012), a time
constant of 80 ms: what was measured. Each suspect in turn:

| Test | Rise (one-period windows), largest at | Verdict |
| --- | --- | --- |
| Refined board | 75 ms, 110 ms | |
| Plate 5 % thicker (mode (1,3) at 348 Hz, 90 cents from the harmonic) | 20 ms, 28 ms | **the cause: a soundboard resonance on a string harmonic** |
| Plate 5 % thinner (mode at 315 Hz) | 28 ms, 47 ms | same |
| Without the plate's modes below 150 Hz (no 96 Hz mode) | 63 ms, 120 ms | not a beat with the 96 Hz mode |
| With a baffle (no radiation filter) | 24 ms, 102 ms | the filter changes the figure, not the event: the sound is still largest at 100 ms. Without the filter the early fundamental is strong enough to pass 90 % sooner |
| Bridge at (0.12, 0.44) and (0.30, 0.44) | 75 and 63 ms | bridge placement is not the cause |
| Sharper pluck (8 kHz instead of 1.9 kHz) | 21 ms, 110 ms | the pluck is not the cause; a brighter first instant moves the 10 % point, not the peak |
| The measurement | 63 to 92 ms for the same recording | the "92 ms" depends on the window; "largest after 100 to 150 ms" does not |

So the slow attack belongs to this note on this plate. B3 on the same board
rises in 10 ms. A 5 % change of thickness removes it from A2 and gives it to
whichever note then has a harmonic on a mode; a resonant body always has
such notes. Files `D1` and `D2` are the refined plate and the 8.4 mm one.

### 9.2 The weak fundamental

Harmonic 3 of A2 is 10.3 dB above harmonic 1 in the sound (0.2 s onward).
Stage by stage, each harmonic relative to the fundamental at the same stage:

| Stage | Harmonic 3 against harmonic 1 | What the stage did |
| --- | --- | --- |
| Force of the string on the bridge | -13.5 dB | the string itself favours the fundamental |
| Bridge velocity | +5.3 dB | **+18.8 dB: the plate yields far more at 330 Hz (mode (1,3)) than at 110 Hz** |
| Board mean velocity | -7.4 dB | -12.8 dB: mode (1,1) moves more air per unit of bridge motion than (1,3) |
| Pressure, baffled | +2.1 dB | +9.5 dB: pressure goes as frequency times velocity |
| Pressure, no baffle | +10.3 dB | **+8.2 dB: the missing baffle takes 13.5 dB at 110 Hz and 5.3 dB at 330 Hz** |

And the fundamental's own level against the Phase 3C.2 board, one change at
a time: thickness **+2.6 dB**, bridge moved to the edge **-9.8 dB**, baffle
removed **-13.5 dB**: -20.7 dB in all.

- **Soundboard mobility:** not the cause of a weak fundamental (a stiffer
  plate gave +2.6 dB), but the cause of the strong third harmonic.
- **Bridge placement:** -9.8 dB. The price of the tuning accuracy.
- **Unbaffled radiation:** -13.5 dB, the largest single part.
- **Modal cancellation:** none. At 110 Hz the sum of all modes' contributions
  is within 0.1 dB of the sum of their sizes (0.4 dB at harmonic 3); the
  mean velocity at 110 Hz is mode (1,1) alone. Cancellation is large only at
  harmonic 4 (20 dB), which is weak for that reason.
- **String-to-plate coupling:** the string delivers 0.17 mJ to the refined
  board in 2.5 s against 0.43 mJ to the Phase 3C.2 board (-4.2 dB); the
  bridge position accounts for it.

Changes to the open plate that were tried for the fundamental of A2:

| Change | Fundamental | Pitch, worst from E2 to E4 | Outcome |
| --- | --- | --- | --- |
| Bridge at (0.12, 0.44) | +3.2 dB | 7.1 cents, 3 notes over 5 | fails on pitch |
| Plate 8.4 mm | +2.9 dB, harmonic 3 now 10 dB *below* it | 4.2 cents | works for A2; moves the coincidence to other notes |
| Larger plate, 0.7 x 0.5 m (lower no-baffle corner) | -7.8 dB | not run | fails: its lowest mode is back at 52 Hz, 2 dB under the fundamental |
| A closed box behind the plate (9.4) | +5.2 dB | 3.3 cents | the only one that helps every note |

### 9.3 The lower level

It is real. The figures are pascals at 1 m before any gain; normalisation is
applied only when a file is written, and is recorded. One change at a time:

| Board (A2, 2 N pluck) | Peak, dB SPL | Sound power against Phase 3C.2 | Above 80 Hz only | A-weighted | Energy the string gave the board |
| --- | --- | --- | --- | --- | --- |
| 4 mm, bridge 0.30, baffled (Phase 3C.2) | 85.2 | 0 dB | 0 | 0 | 0.43 mJ |
| 8 mm (thickness) | 87.9 | -2.1 | +3.4 | +1.5 | 0.46 mJ |
| and bridge at 0.08 | 80.3 | -7.5 | -2.0 | +4.0 | 0.17 mJ |
| and no baffle (refined) | 73.6 | **-14.0** | -8.5 | **-0.4** | 0.17 mJ |

- **Changed impedance (thickness): -2.1 dB**, and that only because the
  48 Hz boom went; above 80 Hz the thicker plate is 3.4 dB *louder*.
- **Reduced energy transfer (bridge at the edge): -5.4 dB.**
- **Radiation (no baffle): -6.5 dB.**
- **Normalisation: 0 dB.**

Most of what was lost is sound below about 300 Hz. With the ear's weighting
for moderate levels (A-weighting) the refined board is 0.4 dB below the
Phase 3C.2 board: the Phase 3C.2 level was mostly a 48 Hz resonance and bass
that the weighting discounts. (A-weighting is a standard approximation of
loudness, not a listening test.)

### 9.4 A minimal enclosed body

**On paper.** Close the back of the plate with a rigid box of volume V and
cut a round hole of radius r in it. Below the box's first standing wave
(c / 2L = 343 Hz for 0.5 m) the air inside has one pressure, set by how much
the plate (area S, mean displacement w) and the plug of air in the hole (area
s, displacement x) change the volume: energy (rho c^2 / 2V)(S w + s x)^2.
That is a spring of stiffness rho c^2 S^2 / V between the plate's radiation
port and a mass of air rho s (1.7 r) seen through the area ratio s / S. Two
consequences follow without any tuning: the plate's lowest mode is stiffened
and moves up, and a second resonance appears below it (in a guitar: the air
resonance and the top resonance). The box also ends the front-to-back
cancellation of 9.2: the sound is the total flow, plate plus hole, into open
air. Below the Helmholtz frequency the two flows oppose and cancel; above it
they add.

**In the engine** (`airCavity.ts`): one extra resonator with one mode (the
plug), one extra spring, one extra output. No engine change. Nothing is
synthesised: the hole's sound is the plug's motion, and the plug moves only
because the plate compresses the air. Three approximations:

1. *Radiation:* `enclosed()` replaces `unbaffled()`: half the pressure of a
   baffled source at low frequencies (sound spreads all round a small box),
   all of it at high ones, a first-order shelf centred where the wavelength
   equals the circumference of a disc of the plate's area (217 Hz).
2. *Radiation loss:* a small source sending flow q into open air radiates
   rho w^2 q^2 / (4 pi c) watts. That is taken from the system by a damper
   on the total flow (it is the air spring's own rate of stretch). The true
   damper grows as frequency squared; the engine's cannot, so it is fixed at
   the plate's lowest mode on the closed box (118 Hz: 6.1 N s/m). Above that
   it takes too little.
3. *Plug losses:* a quality factor of 15, an estimate. Values of 8 and 30
   changed no figure below by more than 0.1 dB.

The lumped air is wrong above about 340 Hz, where a real box has standing
waves; there the model's air only stiffens the plate's mean motion slightly.

**Checks** (tests): struck with nothing lossy, the box rings at the two
frequencies the exact eigenvalue equation of plate modes, air spring and
plug gives (within 2 cents); total energy drifts by less than 1e-6; below
the Helmholtz frequency the radiated sound is more than 40 dB under the body
resonance (the flows cancel); with a string, energy only falls and nothing
faults with six strings plucked at 10 N.

**Choosing a box.** Nine boxes on the refined plate, A2:

| Depth, hole radius | Helmholtz, rigid walls | The two body resonances | Fundamental of A2 against the open plate |
| --- | --- | --- | --- |
| 6 cm, 30 / 45 / 60 mm | 117 / 144 / 166 Hz | 64+173 / 73+189 / 78+204 Hz | -3.5 / -4.6 / -5.6 dB |
| 10 cm, 30 / 45 / 60 mm | 91 / 111 / 129 Hz | 60+144 / 70+154 / 75+164 Hz | +2.5 / +1.1 / 0.0 dB |
| 15 cm, 30 / 45 / 60 mm | 74 / 91 / 105 Hz | 56+127 / 65+133 / 72+140 Hz | +8.3 / +6.6 / **+5.2 dB** |
| 10 cm, no hole | | 127 Hz | +5.8 dB |

One note is a poor guide here too: A2 gains or loses according to where it
falls between the two resonances. Over every semitone, the 15 cm box with the
60 mm hole (`ENCLOSED`: 30 litres, air spring 188 kN/m, plug 1.4 g) had the
strongest mean fundamental and the least uneven one.

**Result, open plate against box** (same plate, same bridge, same strings):

| | Refined open plate | Enclosed box | Approved Faust string |
| --- | --- | --- | --- |
| E2 to E4: worst pitch error | 3.3 cents | **3.3 cents** (0 of 25 over 5) | |
| E2 to E4: mean level of the fundamental | 0 dB | **+9.0 dB** | |
| E2 to E4: loudest to quietest fundamental | 19.9 dB | 21.6 dB | |
| Fundamental of E2 / A2 / B3 | 32.3 / 39.2 / 36.1 dB SPL | 40.2 / 44.4 / 43.2 dB SPL (+7.9 / +5.2 / +7.1) | |
| **Fundamental of C#3 (138.6 Hz, on the 140 Hz body resonance)** | 34.5 dB SPL | **61.3 dB SPL (+26.8)** | |
| Level of the whole note, E2 / A2 / C#3 / B3 | 0 | +4.0 / +3.2 / **+17.5** / +1.8 dB | |
| A2: peak level | 73.6 dB SPL | 77.4 dB SPL | |
| A2: harmonic 3 against the fundamental | +9.3 dB | +8.9 dB | -5.2 dB |
| Share of energy 80 to 300 Hz, E2 / A2 / B3 | -10.0 / -10.9 / -11.0 dB | -3.3 / -9.3 / -6.3 dB | A2 -1.0, B3 -2.5 dB |
| A2: plate's own lowest mode in the sound | 96 Hz at -11 dB | none above -83 dB | none |
| A2: rise, 10 to 90 % (1 ms windows) | 92 ms | 84 ms | under 1 ms |
| C#3: rise | 2 ms | 73 ms | |
| Phrase: pitch errors | -0.2 to -0.7 cents | +0.2 to -0.8 cents | -0.8 to -1.6 |
| Phrase: loudest to quietest fundamental | 4.1 dB | **15.6 dB** (D3 is 14 dB above the rest) | 5.8 dB |
| Phrase: level | 0 | +3.7 dB | |
| Energy drift without losses | 2.5e-12 | below 1e-6 (test limit) | |

**What the box does:** every fundamental from E2 to E4 is stronger, by 5 to
8 dB away from the resonance, including the bottom note; the 96 Hz plate
mode is gone from the sound; pitch is untouched; the low register holds more
of the energy.

**What it does wrong:** the plate's lowest mode, moved to 140 Hz and now
radiating efficiently, stands 13 to 27 dB above its neighbours. C#3 and D3
boom. In the phrase the fundamentals are less even than on the open plate
(15.6 dB against 4.1). The radiation loss of approximation 2 lowers that
peak by only 2 to 3 dB; a wood loss factor of 0.03 by one more. The mode's
quality factor is about 80, where a guitar's top resonance is commonly
measured at a few tens, held down by bracing, by the back and sides and by
more radiation than a fixed damper gives. The slow attack and strong third
harmonic of A2 are unchanged, as 9.1 says they must be: the box does not
move mode (1,3).

### Performance

Mains power, one string of 100 modes, board modes to 5 kHz.

| | Node, % of one core | Chromium AudioWorklet, live, % of one core | Blocks of 2 ms or more | Dropouts |
| --- | --- | --- | --- | --- |
| Refined open plate | 9.9 | 9.6 (speakers), 8.9 (no device) | 3, 0 of about 2700 | 0 |
| Enclosed box | 12.1 | 11.8 (speakers), 9.7 (no device) | 2, 3 of about 2700 | 0 |

The box adds one spring that touches every plate mode: about a fifth more
work in Node; in the browser the difference is within the run-to-run
variation. Every block asked for was processed. Its output shelf ran as a native filter node after the worklet.

### Listening files

`npm run render:soundboard-enclosed` writes 15 files to
`renders/soundboard-enclosed/` with `listening.json`. Each pair has one gain.

| Files | What | Gain |
| --- | --- | --- |
| `E1`, `E2` | E2, the bottom note: open plate, box | both +9.0 dB |
| `H1`, `H2` | A2: open plate, box | both +7.5 dB |
| `C1`, `C2` | C#3, on the box's resonance (the worst case): open plate, box | both +5.9 dB |
| `I1`, `I2` | B3: open plate, box | both +9.6 dB |
| `D1`, `D2` | The attack of A2: refined plate, and the same 5 % thicker | both +9.2 dB |
| `G1`, `G2` | The phrase: open plate, box | both +3.0 dB |
| `K1`, `K2`, `G4` | The approved Faust string: A2, B3, phrase | +2.3, +2.3, +0.4 dB |

### Answers

1. **Root causes.** Slow attack: a plate mode 7 cents from A2's third
   harmonic, filling at its own decay rate; one note's property, and partly
   the fragility of a 10-to-90 % figure. Weak fundamental: radiation without
   a baffle (13.5 dB), the bridge at the edge (9.8 dB), and for A2 the same
   mode lifting the third harmonic (18.8 dB). Lower level: genuine, 14 dB of
   sound power (2.1 thickness, 5.4 bridge, 6.5 baffle), almost all of it
   below 300 Hz; 0.4 dB when A-weighted.
2. **Physically justified improvements.** An enclosed air volume, coupled
   through the plate's mean motion: +9 dB of fundamental on average with no
   new pitch error. Radiation loss on the box. Nothing else tried earns its
   place.
3. **What failed.** Moving the bridge inwards (pitch); a larger plate (the
   boom returns); a 5 % thickness change (moves the problem to another
   note); the box as it stands for evenness (a 140 Hz boom); the section 8
   conjecture about beating.
4. **Is a cavity necessary?** For a stronger fundamental and low register,
   yes: nothing else supplied it without costing pitch. It is not sufficient
   as built: its one sharp body resonance must be damped or broken up
   before it is an improvement overall.
5. **Ready for the builder?** The refined open plate: yes, as a plate in
   open air, with one string and a fixed bridge. Its three oddities are now
   explained and none is a fault of the model. The enclosed box: not yet.

Phase 3C.2.3 took up the box's resonance: see section 10.

## 10. Controlling the box's resonance (Phase 3C.2.3)

The box of section 9 (`ENCLOSED`) made C#3 boom. This section finds why,
tries the physical remedies, and arrives at `DAMPED_BOX`. The open refined
plate (`REFINED`) and `ENCLOSED` are unchanged and are the references. The
builder, the engine and the approved instruments are untouched. No
equaliser, notch or other filter was added anywhere: every change below is a
dimension, a position or a material property of the body.

Two tools. `bodyResponse.ts` works out, from the body's modes, what a force
at the bridge does at one frequency (how far the bridge yields; how much air
flows). It is theory, takes microseconds, and was used to search. The engine
then played every semitone from E2 to E4 on each finalist. The two agree:
fundamental levels within 1.5 dB and pitch within 1 cent away from sharp
resonances (test).

### 10.1 What the 140 Hz peak is

| Step | Resonance |
| --- | --- |
| The plate alone: its lowest mode (1,1), **bending** | 96.6 Hz |
| On the air of the box with the hole shut: the **air's compliance** adds stiffness (188 kN/m on the mean motion against the mode's own 62 kN/m) | 118 Hz |
| With the hole: the **air in the hole** (1.4 g) is a second mass. Two resonances: air-dominated below the Helmholtz frequency (105 Hz), plate-dominated above | 72 Hz and **140 Hz** |

So the 140 Hz peak is the plate's lowest bending mode, raised by the air
spring and pushed up further by the air in the hole. Why it is so loud:

- **Coupling.** Mode (1,1) is the mode the bridge drives best and the one
  that moves most air (mean shape 0.41 against 0.14 for the next).
- **The hole adds its flow.** Above the Helmholtz frequency the hole's flow
  is in step with the plate's; at 140 Hz the total is 2.3 times the plate's
  own (+7 dB).
- **Radiation efficiency.** A box radiates in all directions; the open plate
  cancelled front against back. At 140 Hz that is 7 dB.
- **Damping is not what sets it.** Removing the radiation damper raises the
  peak 3.5 dB, removing the plug's loss 3 dB, the wood's loss 1.2 dB. The
  peak's *skirt* is the problem: one lightly damped resonance with nothing
  else near it still lifts the notes a semitone either side by 10 to 14 dB
  and those two semitones away by 5 to 9 dB, whatever its top does.

Effect on notes (fundamental of each semitone, dB against the open plate's
mean, engine): C3 +16, **C#3 +24**, D3 +20, D#3 +15, where the notes around
are at +6 to +9.

The same measurement showed something sections 8 and 9 under-reported:
**E4 (329.6 Hz) sits on plate mode (1,3) (331 Hz) on the open plate and on
the box alike, 13 to 15 dB above its neighbours.** It is the mode behind
A2's slow attack (9.1). The phrase has no E4 and no G2, so its "4.1 dB" for
the open plate missed both of that plate's booms: over E2 to E4 the open
plate's fundamentals span 19.9 dB.

### 10.2 Remedies tried

By theory, every semitone E2 to E4. "Spread" is loudest minus quietest
fundamental; "step" the largest difference between neighbouring semitones.

| Remedy | Result | Verdict |
| --- | --- | --- |
| `ENCLOSED` as built | mean +9.0 dB, spread 23.9 | reference |
| **A screen over the hole** (flow resistance: cloth, mesh), 20 / 50 / 100 / 500 Pa s/m | the 140 Hz peak falls and broadens: spread below E4 23.9 to 18.7 / 15.9 / 15.8 / 24.2; mean +8.5 / +7.6 / +6.9 / +6.5 | **works, 50 to 100.** Too much and the hole is shut: the 118 Hz resonance returns |
| Wood loss factor 0.02 / 0.03 / 0.05 / 0.1 | spread 23.4 / 22.8 / 21.8 / 19.6 | fails: needs 0.1, eight times spruce |
| Box depth 5 to 40 cm, hole 30 to 100 mm | moves both resonances; best (15 cm, 100 mm) spread 23.1 | does not remove the peak; a wide hole helps a little |
| Radiation loss at the true frequency (140 not 118 Hz) | at most 1.5 dB off the peak | not pursued |
| Bridge nearer the centre, x = 0.12 / 0.20 / 0.30 | mean +12 / +17 / +20 dB, pitch pull 6 / 12 / 12 cents | fails on pitch |
| Bridge across the grain at y = 0.30 | spread 43 dB: an anti-resonance between modes (1,1) and (1,3) silences some notes | fails |
| **Bridge at y = 1/3**: the nodal line of every mode (m, 3) | mode (1,3) is not driven at all: the E4 peak (29 dB by theory) goes, and A2's slow attack with it | **works** |
| Plate 9 mm instead of 8 | mode (1,3) moves to 373 Hz, out of the E2 to E4 range | rejected: that only moves the boom to F#4, outside what is measured |
| More cavity modes | the box's first standing wave is at 343 Hz and couples to plate modes that do not radiate on the axis | not justified for a 140 Hz problem |

Frequency-dependent cavity loss is what the screen is: its force is
proportional to the air's speed through the hole, so it takes most where the
hole's flow is greatest, at and around the two box resonances, and little
elsewhere.

### 10.3 The damped box

`DAMPED_BOX`: the refined 8 mm plate; box 15 cm deep (30 litres) as before;
**bridge at (0.08, 1/3)** instead of (0.08, 0.44); **hole of 80 mm radius**
instead of 60; **a screen of 100 Pa s/m over it** (2.0 N s/m on a 3.3 g plug:
a quality factor near 1). In the engine: one more damper, from the plug to
a fixed point.

Every semitone from E2 to E4 in the engine, one string each:

| | Open plate | Box of 9.4 | Box of 9.4 + screen only | **Damped box** | Damped, bridge at x = 0.10 |
| --- | --- | --- | --- | --- | --- |
| Worst pitch error | 3.3 cents | 3.3 | 3.3 | **2.7** | 3.8 |
| Mean fundamental | 0 dB | +9.0 | +7.3 | **+3.7** | +5.6 |
| Median fundamental | 0 dB | +8 | | **+5** | |
| Fundamentals, loudest to quietest | 19.9 dB | 21.6 | 21.9 | **14.9** | 14.7 |
| Standard deviation | 5.3 dB | 5.7 | 4.4 | **4.1** | 4.0 |
| Largest step between semitones | 12.7 dB | 13.1 | 13.1 (E4) | **3.4** | 4.3 |
| Largest resonance amplification (a note above the mean of those 3 semitones either side) | 16.3 dB (G2) | 13.5 (C#3) | 4.2 | **2.8** | 3.7 |
| Whole-note level, mean | 57.0 dB SPL | 60.9 | 59.9 | **57.3** | 58.7 |
| Whole-note level, loudest to quietest | 17.4 dB | 15.2 | 15.2 | **16.5** | 16.0 |
| Attack: time to loudest, worst note | 122 ms | 111 | 111 | **77** | 77 |
| Notes taking over 60 ms to reach their loudest | 4 | 4 | 3 | **1** | 1 |
| Decay (T60) of the fundamental, shortest to longest | 2.0 to 4.9 s | 2.4 to 3.7 | 2.4 to 3.7 | **2.9 to 3.7** | 2.7 to 3.7 |

Fundamental of each semitone, dB against the open plate's mean:

```
note        E2  F  F# G  G# A  A# B  C3 C# D  D# E  F  F# G  G# A  A# B  C4 C# D  D# E4
open plate  -5  1  9  14 5  2  0  -2 -3 -3 -4 -4 -3 -4 -5 -4 -4 -3 -2 -1 -1 0  1  2  15
box of 9.4  3   3  3  4  5  7  9  11 16 24 20 15 12 9  7  6  6  6  6  6  6  6  7  7  20
damped box  -3  0  1  2  4  6  7  8  9  11 10 9  8  6  5  4  3  3  3  2  2  1  0  -4 -4
```

The damped box has no boom. What is left is one broad, gentle rise of 11 dB
centred on C#3, never more than 3.4 dB from one semitone to the next.

Single notes and the phrase (recordings; fundamental in dB SPL at 1 m):

| | Open plate | Box of 9.4 | **Damped box** | Approved Faust string |
| --- | --- | --- | --- | --- |
| Fundamental of E2 / A2 / C#3 / B3 / E4 | 32.3 / 39.2 / 34.5 / 36.0 / 50.9 | 40.2 / 44.4 / 61.3 / 43.2 / 56.7 | **34.2 / 43.1 / 48.1 / 39.9 / 33.1** | not a pressure |
| A2: third harmonic against the fundamental | +9.3 dB | +8.9 | **-15.5** | -5.2 |
| A2: share of energy 80 to 300 Hz | -10.9 dB | -9.3 | **-2.3** | -1.0 |
| A2: rise, 10 to 90 % | 92 ms | 84 | **19** | under 1 |
| C#3: rise | 2 ms | 73 | **11** | under 1 |
| Phrase: pitch errors | -0.2 to -0.7 c | +0.2 to -0.8 | **-0.2 to -0.8** | -0.8 to -1.6 |
| Phrase: fundamentals, loudest to quietest | 4.1 dB | 15.6 | **6.2** | 5.8 |
| Phrase: level | 64.2 dB SPL | 67.9 | **64.0** | |
| Largest step between samples, of the peak | 0.15 | 0.11 | 0.21 | 0.13 |

Energy and stability (tests): without losses the total energy of string, box
and air drifts by less than 1e-6; with losses it never rises, with one,
three and six strings plucked at 10 N and the plate struck; no engine fault,
no non-finite sample.

### 10.4 What it costs, and what is not solved

1. **Half the bass gain is given back.** The mean fundamental is +3.7 dB
   over the open plate, where the undamped box had +9.0. The screen takes
   energy at exactly the frequencies where the box helped most. In the
   lowest octave (E2 to B2) the damped box averages the same as the open
   plate; the difference is that the open plate's figure is one boom at G2
   and the damped box's is even. From C3 up it is 5.4 dB stronger.
2. **It is not louder.** Whole notes average 57.3 dB SPL against 57.0 for
   the open plate, and the phrase is 0.3 dB quieter. A2 is 5.6 dB quieter
   as a whole note, because the third harmonic that made most of its level
   on the open plate is no longer amplified. What changes is the balance:
   the fundamental now leads, as it does on the approved string.
3. **Two octaves are not flat.** 14.9 dB from the quietest fundamental (E4)
   to the loudest (C#3), against the phrase-based target of about 4 dB. The
   phrase's own notes span 6.2 dB.
4. **Whole-note levels still vary by 16 dB** from note to note, as on every
   body here. Higher harmonics meet higher plate modes; the bridge position
   and the screen do nothing about those.
5. **The nodal line is one line.** With several strings 10 mm apart across
   the grain only the middle one stands on it; the outer strings of six are
   25 mm away and drive mode (1,3) at about a quarter of what the old
   position did. One string is the tested case.
6. **The hole is large** (16 cm across in a 50 x 40 cm front), and the model
   takes no account of where on the box it is. The plug's mass uses the
   end correction for a small hole.
7. **The screen's 100 Pa s/m is a design value**, in the range of acoustic
   cloths, not a measured material.
8. The approximations of 9.4 remain: lumped air (wrong above about 340 Hz),
   a radiation damper fixed at one frequency, a first-order radiation shelf.

### 10.5 Performance

Mains power. 100 modes per string, board modes to 5 kHz. Three strings:
A2, D3, G3. The worklet's clock resolves 1 ms, and its report counts blocks
of 2 ms or more (the budget is 2.67 ms) rather than giving the longest one.

| | Node, % of one core | Node, longest block | Chromium AudioWorklet, live, % of one core | Blocks of 2 ms or more | Blocks processed / expected | Output-device dropouts |
| --- | --- | --- | --- | --- | --- | --- |
| Open plate, one string | 7.7 | 1.9 ms | 9.3 | 5 of 2712 | 2712 / 2712 | 0 |
| Box of 9.4, one string | 8.7 | 1.5 ms | 8.3 | 1 of 2733 | 2733 / 2733 | 0 |
| **Damped box, one string** | 9.4 | 2.6 ms | 11.5 | 6 of 2715 | 2715 / 2715 | 0 |
| Open plate, three strings | 18.2 | 4.3 ms | 20.6 | 9 of 2723 | 2723 / 2723 | 0 |
| **Damped box, three strings** | 20.8 | 5.7 ms | 22.5 | 23 of 2723 | 2723 / 2723 | 0 |

Through the speakers; with no output device the figures were within 3 points
and also without dropouts. **One string is comfortable**: an eighth of a core
and 6 slow blocks in 2715. **Three strings ran without a dropout but with
little margin**: 23 blocks in 2723 took 2 ms or more against a budget of
2.67 ms, and Node's longest block (5.7 ms, which includes its own
garbage collection) is over the budget. Average CPU alone would call both
safe; the slow-block count does not for three. Six strings on the open plate,
run for scale, had 246 slow blocks.

### 10.6 Listening files

`npm run render:soundboard-damped` writes 22 files to
`renders/soundboard-damped/` with `listening.json`, which records each
file's peak and RMS pressure in pascals and dB SPL before any gain. The
three bodies of a note share one gain; the Faust string is not a pressure
and has its own.

| Note | 1: open plate, 2: box of 9.4, 3: damped box (peak, dB SPL at 1 m) | Gain for the three | 4: approved Faust string |
| --- | --- | --- | --- |
| `E2-…` (bottom note) | 71.6 / 76.0 / 72.3 | +9.0 dB | not available (below its open string) |
| `A2-…` | 73.6 / 77.4 / 71.3 | +7.5 dB | +2.3 dB |
| `Cs3-…` (the problem note) | 68.1 / 79.0 / 69.2 | +5.9 dB | +2.3 dB |
| `B3-…` | 72.8 / 75.3 / 73.4 | +9.6 dB | +2.3 dB |
| `E4-…` (on plate mode (1,3)) | 77.8 / 80.5 / 76.9 | +4.5 dB | not rendered |
| `G1`, `G2`, `G3` phrase; `G4` Faust | 81.1 / 81.9 / 79.9 | +3.0 dB | +0.4 dB |

No listening was done: the model has no way to hear. Statements about the
sound above are measurements of these files.

### 10.7 Decision

**APPROVE the damped box for a first builder integration, as the body of
one string with fixed geometry.**

For: no note booms (largest semitone step 3.4 dB, was 13); pitch within
2.7 cents from E2 to E4, better than the open plate; no slow attacks but one;
decay even; the fundamental leads its harmonics and the low register holds
its share of the energy, close to the approved string's balance; phrase
fundamentals within 6.2 dB (approved string 5.8); conserves energy, stable,
and cheap enough for one string in a real AudioWorklet.

Against, and to be accepted knowingly: the bass gain is modest (+3.7 dB
mean, none in the lowest octave beyond evenness); it is not louder than the
open plate; fundamentals still differ by 15 dB across two octaves in one
smooth rise; it is a 30-litre box with a 16 cm screened hole, not a guitar.

If more bass is wanted later, the measured lever is the bridge: x = 0.10
gives +5.6 dB at 3.8 cents. A flexible back or bracing would be the next
physics, and neither is needed for a first integration.

Nothing beyond this investigation has been started.