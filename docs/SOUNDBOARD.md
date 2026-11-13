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

Nothing beyond this refinement has been started.