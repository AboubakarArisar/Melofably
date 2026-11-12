# Physically coupled string: prototype and findings (Phase 3C.1)

**Status: an isolated experiment.** Nothing here is used by the application
or by the instrument builder. The four approved Faust instruments, their
audio engine, the builder and the WebAssembly physics engine are unchanged.

| Piece | Where |
| --- | --- |
| Modal string (mode data, loss law, pluck force, bridge compensation) | `src/experimental/string/modalString.ts` |
| Waveguide string as a resonator of the TypeScript engine | `src/experimental/string/waveguide.ts` |
| Scenarios, exact reference frequencies | `analysis/string-prototype.ts` |
| Tests (10) | `tests/coupled-string.test.ts` |
| Listening renders and performance | `analysis/render-string.ts` (`npm run render:string`) |

Measurements are from the development machine (Node 24.14); timings vary by
10 to 30 % between runs. This document makes no claim about how anything
sounds.

## 1. What was inspected

**The approved string** (`src/audio/models/string.dsp`) is an ideal flexible
string as a single delay loop: a delay line read with fourth-order Lagrange
interpolation, two three-tap loss filters, a loop gain, a pluck made of a
rounded impulse through a position comb and a leaky integrator. Its output
is the force at the bridge, fed through a fixed filter standing for a body.
Nothing returns from the body to the string: it is not coupled to anything,
and cannot be.

**The physics engine** takes resonators with ports and joins ports with
springs, dampers and contacts, solving all connection forces together. Its
WebAssembly version holds modal resonators only. Its TypeScript reference
defines the resonator as an interface (mobility, predict, commit), written
in Phase 3A with a waveguide in mind.

## 2. Two ways to make a string that can be joined to something

### As modes

A string with both ends fixed cannot be attached at the bridge: every mode
shape is zero there. The string is therefore described with its nut fixed
and its **bridge end free**:

    f_n = (n - 1/2) c / 2L,   shape sin((n - 1/2) pi x / L),   mass mu L / 2

and that free end is joined to the body by a stiff spring, the bridge.
Joined to something heavy, these modes combine into the familiar partials at
n c / 2L. This needs no change to the engine: it is modal data and one
spring.

Two details matter, both found by measurement:

- **The bridge spring must not use the Phase 3A.1 spring correction.** That
  correction is for springs that shift modes slightly. Here the spring
  rearranges every mode; with the correction the pitch was 2.5 cents flat,
  without it 0.3 cents sharp.
- **A residual compliance must be made up.** The kept modes give slightly
  less at the bridge than a whole string would (modes are missing), and each
  gives slightly more in the engine than in reality (the time step). The
  difference is added, as a plain compliance, in series with the bridge
  spring. It is computed when the string is built and costs nothing while
  playing.

| Modes kept (A2 string) | Pitch error, plain bridge spring: partial 1 / 10 | With the residual made up |
| --- | --- | --- |
| 25 (to 2.7 kHz) | 13.9 / 14.5 cents | 0.05 / 0.81 cents |
| 50 (to 5.4 kHz) | 6.8 / 6.8 cents | 0.05 / 0.09 cents |
| 100 (to 10.9 kHz) | 2.8 / 2.9 cents | 0.05 / 0.01 cents |
| 197 (all below 0.45 x the sample rate) | 0.46 / 0.38 cents | 0.05 / 0.00 cents |

### As a waveguide

The approved loop, with its bridge end made a port. With v_in the wave
arriving at the bridge and F a force on the string's end, the end moves at
u = 2 v_in + F / Z (Z = sqrt(T mu), the wave impedance) and the wave sent
back is u - v_in. The port's mobility is 1 / Z with no memory, which is
exactly the form the engine's solver needs. Held still, the end returns the
wave inverted and the loop is the approved string's. It was written for the
TypeScript engine only (about 130 lines); the WebAssembly engine was not touched.

## 3. Measurements

Both strings were put through the same tests, in the TypeScript reference
engine (whose modal arithmetic was shown in Phase 3A.1 to match the
WebAssembly engine to rounding). "Rigid bridge" means a spring of 1e6 N/m to
an immovable mass: 1/8800 of the string's own give.

### Pitch (rigid bridge, nine partials up to the 40th)

| String | Modal: fundamental / worst / spread | Waveguide: fundamental / worst / spread |
| --- | --- | --- |
| A2, the approved string, 109.9 Hz (197 modes) | -0.15 / -0.21 / 0.06 cents | -0.15 / -0.21 / 0.06 cents |
| The same fretted an octave up (98 modes) | -0.36 / -0.44 / 0.08 | -0.36 / -0.55 / 0.19 |
| Heavier, lower: 82.4 Hz (262 modes) | -0.19 / -0.20 / 0.01 | -0.19 / -0.20 / 0.01 |
| Light, high: 329.6 Hz (66 modes) | -0.19 / -0.25 / 0.05 | -0.19 / -0.96 / 0.77 |

The common offset is the bridge spring itself, which lowers an ideal string
by T / (k L) (0.2 cents for A2 at 1e6 N/m): physics, not error. "Spread" is
how far the partials are from each other, that is, from being harmonic. The
waveguide's grows on short loops: its interpolated delay line is slightly
dispersive towards high frequencies, as the approved string's is.

### Decay (approved loss law, default settings)

| Partial | Law, 1/s | Modal | Waveguide |
| --- | --- | --- | --- |
| 1 (110 Hz) | 1.845 | 1.845 | 1.844 |
| 5 (550 Hz) | 1.985 | 1.985 | 1.985 |
| 10 (1.1 kHz) | 2.424 | 2.424 | 2.423 |
| 20 (2.2 kHz) | 4.178 | 4.181 | 4.174 |
| 30 (3.3 kHz) | 7.103 | 7.109 | 7.083 |

Not measured above 3.3 kHz. The modal string can be given any decay per
partial exactly; the waveguide's filters follow the law only where their
loss is small.

### Against the approved Faust string (body off, same pluck)

| | Fundamental | Partial 9 | T60 of partial 1 | T60 of partial 6 | Partials 2, 3, 4, 6, 8, 12 relative to the first, dB |
| --- | --- | --- | --- | --- | --- |
| Approved Faust string | 109.917 Hz | +0.05 cents | 3.74 s | 3.37 s | -1.8 -5.4 -12.2 -16.2 -15.1 -20.3 |
| Modal prototype | 109.900 Hz | -0.21 cents | 3.74 s | 3.37 s | -1.8 -5.4 -12.3 -16.2 -15.1 -20.3 |
| Waveguide prototype | 109.901 Hz | -0.20 cents | 3.75 s | 3.37 s | -1.8 -5.4 -12.2 -16.2 -15.1 -20.2 |

The 0.017 Hz difference in the fundamental is the prototypes' finite bridge
stiffness. Pitch, decay and the balance of partials agree to within the
measurement; whether they sound the same is for listening (section 5).

### Joined to a bar: coupled frequencies

Reference: the roots of the exact characteristic equation of string, bridge
spring and bar (the string's end receptance in closed form, so no modal
truncation and no time stepping).

| System | Modes below 4 kHz | Of which the bar moved by more than 3 cents | Worst error, modal | Worst error, waveguide |
| --- | --- | --- | --- | --- |
| A2 string on an aluminium bar, bridge 0.2 along | 38 | 24 | 0.05 cents | 0.05 cents |
| String on a light bar, its second partial tuned to the bar's first mode | 51 | 51 | 0.07 cents | 0.07 cents |

With partial 2 tuned 4 Hz below the light bar's first mode (170.46 and
174.46 Hz apart), theory puts the joined pair at 163.91 and 180.91 Hz. Both
strings: 163.91 and 180.91 Hz. The string feels the body.

### Energy passes both ways

Light aluminium bar (3 mm x 20 mm, 49 g), string's second partial at its
first mode, no losses, so that only transfer can change who holds the energy.

| | Modal | Waveguide |
| --- | --- | --- |
| String plucked: most of the system's energy the bar ever held | 44.2 % | 44.2 % |
| Bar struck, string untouched: most the string ever held | 53.1 % | 53.1 % |
| String + bar at that moment, of the total | 100.0 % | 100.0 % |
| The same with the bridge removed | 0 and 0 | 0 and 0 |

On the ordinary aluminium bar (324 g, 140 times the string), a strike on the
bar puts over 30 % of the energy into the string when a partial is tuned to
the bar; a pluck puts 0.2 % into the bar (see section 6).

### Energy behaviour

| | Modal | Waveguide |
| --- | --- | --- |
| No losses, string + bar, 3 s | total constant to 7.9e-12 | not conservative: see below |
| With losses | energy rose on 0 of 144 000 steps | |
| Broadband impulse, no losses | | 66 % left after 3 s |
| Rounded pluck, no losses | | 100.1 % after 3 s; largest single-step rise 3e-4 of the total |

The waveguide's delay line is read by interpolation, which removes
high-frequency energy; and its stored energy can only be estimated from the
line's contents, so small apparent rises are the estimate, not necessarily
the string. It is stable in every case tried, but it cannot be *shown* to be
passive the way the modal string can.

### Stability

Bridge stiffness 1e2 to 1e12 N/m, damping 0 and 100 N s/m, three bodies
(light bar, heavy bar, wooden bar), both strings, plucked and struck hard:
72 runs, all finite, energy lower at the end than after the excitation in
all; for the modal string, no step on which energy rose.

## 4. Performance

`xN`: N times faster than real time on one thread. A block must finish in
2.667 ms.

| System | Engine | Speed | Share of one core | Worst block |
| --- | --- | --- | --- | --- |
| Modal A2 string on a wooden bar (197 + 8 modes) | WebAssembly | x16 | 6.1 % | 1.1 ms |
| Modal E2 string on a wooden bar (262 + 8 modes) | WebAssembly | x12 | 8.0 % | 1.4 ms |
| Six modal guitar strings on one bar (868 + 8 modes) | WebAssembly | x3 | 28.7 % | **3.0 ms** |
| The same, at most 60 modes a string (360 + 8 modes) | WebAssembly | x8 | 13.3 % | 2.5 ms |
| Modal A2 string on a wooden bar | TypeScript | x3 | 31.8 % | 3.2 ms |
| Waveguide A2 string on a wooden bar | TypeScript | x35 | 2.9 % | 0.4 ms |
| Six waveguide strings on one bar | TypeScript | x11 | 9.2 % | 1.6 ms |
| Approved Faust string, one string with its body | WebAssembly (Faust) | x185 | 0.5 % | not observable |
| Retuning all 197 modes of a string (one pitch-bend step) | WebAssembly | 0.031 ms | | |

- A modal string costs in proportion to its modes, and low strings have the
  most. One or two are comfortable; six at full bandwidth are not (a block
  over budget was measured).
- A joined modal string costs about 2.3 times an unjoined resonator of the
  same size, because the engine passes over every mode four times a sample
  for a joined resonator and once for a free one. That is an engine matter
  and could be improved.
- The waveguide's cost does not depend on pitch. It was measured in
  TypeScript only. The WebAssembly engine ran modal systems 3 to 6 times
  faster than the TypeScript one in Phase 3A.1; if that held for a
  waveguide, a string would cost under 1 % of a core. **That is an estimate,
  not a measurement.**

## 5. Listening files

`npm run render:string` writes 18 WAV files (48 kHz, 24-bit, mono) to
`renders/coupled-string/`, with every gain recorded in `listening.json`.
Files are normalised singly or in groups as noted there: forces and
velocities are different quantities and cannot share a scale.

| Files | Content |
| --- | --- |
| `S1`, `S2`, `S3` | The string alone, force at the bridge: approved Faust string (body off); modal prototype; waveguide prototype |
| `S4` | The three in a row |
| `S5` | The approved string with its body, for reference |
| `P1`, `P2` | A ten-note phrase: approved Faust string (body off); modal prototype on a rigid bridge |
| `P3` | The same phrase, string on a wooden bar, the bar heard |
| `C1`, `C2`, `C3` | String on a bar, the bar heard: wooden bar with the modal string; with the waveguide string; aluminium bar |
| `C4`, `C5` | Force at the bridge on the wooden and the aluminium bar |
| `C6`, `C7` | String tuned to a light bar (strong exchange): the bar heard; force at the bridge |
| `C8`, `C9` | Only the bar struck: with the string on it; without |
| `C10` | Only the bar struck: what the string does (force at the bridge) |

Two things to know when listening. In the phrase, each prototype note starts
from rest (the prototype has no re-plucking of a sounding string), whereas
the approved string carries on from the previous note. And the bar heard
under a string is very quiet before normalisation (gains of 78 to 183): see
the next section.

## 6. Architectural limitations found

1. **A bar is a poor soundboard.** A 324 g bar under a 2.3 g string takes
   0.2 % of the string's energy and moves at 2 mm/s. The physics is right;
   it is simply not how a string instrument is made loud. A string component
   needs a body-like resonator (a plate or soundboard, by modes) to sit on.
   The approved string's "body" is a filter and cannot serve.
2. **The engine has no pluck.** The prototype applies the plucking force
   sample by sample from outside. For real time the engine needs to generate
   it itself, as it does the strike pulse.
3. **No re-plucking or damping gesture.** A new pluck on a sounding string
   adds to it. The approved string stops the old vibration first. A finger
   is a damper for a moment; how to express that needs deciding.
4. **Changing length is structural.** A fretted string is shorter, so its
   modal mass and its bridge compensation change, and the engine can retune
   a mode's frequency and decay but not its mass. Fretting would rebuild the
   instrument (sound restarts). Changing *tension* is live: frequencies only.
5. **Modal strings are expensive in number** (section 4), and each uses one
   of the engine's 32 connections.
6. **A waveguide needs a new kind of resonator in the WebAssembly engine**,
   which today holds modal data only: its storage and its stepping loop
   would both change. It has one port (the bridge); a hammer on the string,
   a second bridge or a bow would need the line split at that point. It has
   no stiffness (inharmonicity) without further filters, and its energy
   cannot be accounted exactly.
7. **A modal string has none of those limits** (ports anywhere, any decay
   law, stiffness by changing the mode frequencies) **but none of that was
   built or tested here**: only the bridge port and a pluck port.
8. **The residual compliance depends on the sample rate and the number of
   modes**, so it must be recomputed whenever the string is rebuilt.
9. **Not run in a browser.** Everything here was measured in Node. The
   modal string is ordinary engine data, so the Phase 3A.1 AudioWorklet
   results should carry over, but that was not verified.
10. **Decay above 3.3 kHz and strings above 330 Hz were not measured.**

## 7. Comparison

| | Modal string | Waveguide string |
| --- | --- | --- |
| Pitch | within 0.05 cents with 50 or more modes; harmonic to 0.08 cents | exact at low pitch; partials spread up to 0.8 cents on short loops |
| Decay | any law, exactly | approved filters: within 0.3 % to 3.3 kHz |
| Partial balance against the approved string | within 0.1 dB | within 0.1 dB |
| Coupled frequencies | within 0.07 cents | within 0.07 cents |
| Two-way energy transfer | yes: 44 % and 53 % | yes: 44 % and 53 % |
| Energy | conserved to 8e-12; provably passive | stable in all tests; not exactly conservative; not provable |
| Cost | 6 to 8 % of a core per low string (WebAssembly) | 2.9 % in TypeScript; under 1 % in WebAssembly is an estimate |
| Engine work needed | a pluck generator; nothing else | a new resonator kind, plus the pluck |
| Ports | anywhere along the string | the bridge only |
| Inharmonicity | by data | needs added filters |
| Sound quality | for listening to decide: files `S1` to `S4`, `P1`, `P2` | |

## 8. Recommendation

**Is a waveguide necessary?** No. A modal string represents the ideal string
as accurately as the waveguide does on every measure taken, and more
accurately on some (harmonicity, energy). A waveguide is not needed for
correctness. It is the cheaper of the two, by a wide margin, and that is its
whole case.

**For integrating strings into the builder (Phase 3C.2), I recommend the
modal string first**, because it needs no new kind of resonator, keeps the
engine's exact energy behaviour, and lets a string be joined, struck or
damped at any point by the connections that already exist. Concretely:

1. One string component, modal, with the bridge compensation of section 2,
   limited to about 100 modes (to 10 kHz for A2; pitch still within 0.05
   cents), which roughly halves the cost measured here.
2. A pluck in the engine (a force that steps and relaxes, as the approved
   string's), triggered like the strike pulse.
3. At least one soundboard-like resonator for it to sit on; without one,
   strings in the builder will be faint (limitation 1). This is the larger
   piece of work and should be scoped before the string itself.
4. Tension as the live pitch control; length as a rebuilding one.
5. A stated limit of a few strings per instrument.

**Port the waveguide to the WebAssembly engine later, if** instruments with
many strings are wanted. The prototype shows it couples correctly and what
it costs; the work is in the engine, not in the method. Reducing the cost of
joined modal resonators (limitation 5) is a smaller change that would help
every instrument and could come first.

Phase 3C.2 has not been started.
