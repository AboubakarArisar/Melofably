# WebAssembly physics engine: implementation and browser validation (Phase 3A.1)

**Status: experiment.** Nothing here is used by the application. The four
approved instruments, their Faust sources and their reference audio are
unchanged. This document reports what was built and what was measured; it
makes no claim about how anything sounds. Listening files are listed in
section 9.

Background (the numerical method, units, the Phase 3A results):
[EXPERIMENTAL_ENGINE.md](EXPERIMENTAL_ENGINE.md).

Every figure below was measured on the development machine (Windows 11,
12 logical cores, Node 24.14, Chromium 156 inside the desktop app's browser
pane) unless it is marked as an estimate. Timings vary between runs by roughly
10 to 30 %; treat them as that precise and no more.

## 1. What was built

| Piece | Where | What it is |
| --- | --- | --- |
| Engine | `assembly/engine.ts` | The Phase 3A engine in AssemblyScript, compiled to `src/experimental/wasm/generated/engine.wasm` (26.5 kB) by `npm run engine` |
| JavaScript side | `src/experimental/wasm/engine.ts` | Types of the module's functions, `Design` (describes a system as a list of engine calls) |
| AudioWorklet | `src/experimental/wasm/processor.js`, `host.ts` | The processor that runs the engine on the audio thread, and the main-thread code that creates it |
| Systems | `src/experimental/wasm/layouts.ts` | One bar, two and three coupled bars, 25 bars, large resonators: built identically for both engines |
| Test page | `experimental.html`, `src/experimental/page/` | Separate page, development server only (it is not part of the production build) |
| Tests | `tests/wasm.test.ts` | 22 tests: parity, coupling, accuracy, live editing |
| Scripts | `analysis/bench-wasm.ts`, `analysis/render-wasm.ts` | Node benchmarks and listening renders |

The TypeScript engine of Phase 3A (`src/experimental/physics/`) is kept
unchanged as the reference.

## 2. Language: AssemblyScript

The machine has no Rust, C or C++ toolchain: `rustc`, `cargo`, `clang`,
`emcc`, `zig`, `wasm-ld`, `wasm-pack` and `wasm-opt` are all absent. Installing
Rust or Emscripten needs on the order of 1 to 2 GB, by default on drive C:,
which had 654 MB free when this phase started (an estimate of their size, not
a measurement). That ruled both out without touching anything outside the
project.

AssemblyScript installs from npm into the project folder on D: (101 MB,
development dependency only) and compiles the engine in about one second.
Beyond availability:

- **Maintainability.** Its syntax is TypeScript's, so the port is close to
  line-for-line from the reference, and the project keeps one language.
- **Precision.** `f64` throughout; only the output buffer is 32-bit.
- **No runtime.** Built with `--runtime stub`: no garbage collector, no
  imports (the module is instantiated with an empty import object), fixed
  arrays allocated once at start-up.
- **Cost of the choice.** Its optimiser (Binaryen) does not vectorise loops
  as LLVM can, and its community is smaller. The engine is written as flat
  arrays and plain loops, so moving it to Rust or C++ later would be
  mechanical. Nothing in the design depends on AssemblyScript.

## 3. What was ported, and how

The physics is unchanged: modal resonators with physical modal masses and
ports, the implicit midpoint rule with pole and mass prewarping, simultaneous
solution of all connection forces by Newton's method with step halving,
spring-dampers, the energy-conserving Hertz contact, and the three stiffness
change policies. The formulas are the reference's, in the same order where
that was practical.

Differences in arrangement, none in physics:

- **One flat memory.** All state lives in fixed arrays (capacity: 16 384
  modes, 128 resonators, 32 connections). Memory is 3 145 728 bytes from
  start-up and never grows. A system that does not fit is refused
  (`addResonator` returns -1).
- **Forces are accumulated per mode**, not per port. A connection reads and
  writes the modes of its two ends directly. This is what allows a
  connection to attach through a corrected mode shape (section 6).
- **`process(n)`** advances n samples into a buffer inside the module's
  memory: one call per audio block.
- **Additions** that the reference does not have: a mixed output of several
  ports, half-sine strike pulses and mallet launches timed inside the engine,
  live retuning (`tune`), connecting at the present length (`attach`),
  clearing of numbers too small to matter (below 1e-100, so that a long decay
  never reaches the slow subnormal range), and a guard that replaces a
  non-finite output by silence and counts it.

### What the tests found

Two real defects, both fixed:

1. Retuning a mode to above half the sample rate produced NaN. A mode is now
   held at 0.49 x the sample rate at most.
2. The strike pulse's strength was scaled by the sample period twice, so
   pulse strikes were silent on the test page. Its area is now the impulse in
   newton-seconds, as documented.

## 4. Parity with the TypeScript reference

With the spring correction off, both engines compute the same thing.
Tolerances asserted by the tests: **1e-12** of the signal's peak for linear
systems, **1e-9** through a nonlinear contact. They are not zero because the
two engines sum the port contributions in a different order and use different
`sin`, `cos`, `exp` and `pow` implementations (AssemblyScript's own rather than
V8's), each accurate to about one unit in the last place.

| Quantity | Case | Largest difference measured |
| --- | --- | --- |
| Modal frequencies and decay rates | one bar, 3 strokes x 3 prewarp modes, 3 s: output | 0 (identical 32-bit samples) |
| | same: stored energy | 5.6e-15 |
| | same: energy dissipated | 1.7e-14 |
| Coupled frequencies, energy transfer | two 440 Hz oscillators, 2 s | 0 |
| | two eight-mode bars, spring and damper, 30 s | 7.8e-15 |
| | spring of 1e12 N/m (far too stiff for the step) | 0 |
| | spectral peaks of two coupled bars | same to 1e-9 |
| Momentum | two free masses on a spring, 1 s | conserved to 2.8e-14; matches reference to 1e-12 |
| Contact duration | wall at 192 kHz and bar at 48 kHz, 0.25 / 1 / 4 m/s | identical number of samples |
| Rebound, peak force, impulse | same six cases | 0 |
| Strike velocity dependence | contact time against v, WebAssembly alone | exponent -0.1997 (theory -0.2) |
| Extreme parameters | contact of 1e12 N/m^1.5 at 24 kHz, 4 m/s | 0; energy never rises |
| Determinism | two instances, 1 s with a mallet and a pulse | byte-identical |
| | `process()` against `step()` one sample at a time | within 1e-12 |

All 22 Phase 3A tests of the reference still pass. Their file changed in one
respect only: the eigenvalue helper moved to shared code so that both test
files use the same one.

## 5. More than two components

Three bars of different materials (aluminium, steel, a wood-like bar: densities
2700 / 7850 / 800 kg/m^3, loss factors 0.001 / 0.0005 / 0.01), two ports each,
24 modes in all.

| Check | Result |
| --- | --- |
| Chain A-B-C (two springs): 24 coupled frequencies against eigenvalue theory | worst error 0.0014 % (0.0042 % uncorrected) |
| Mesh (four springs, two of them between A and B) | worst error 0.0021 % (0.0089 % uncorrected) |
| Undamped mesh, 2 s: total energy | constant to 1.9e-12 |
| Three damped oscillators with spring-dampers against an independent Runge-Kutta solution (16x rate) | residual -64 to -70 dB |
| Three bars struck together against the sum of three separate renders | within 1e-6 (32-bit samples) |

"Eigenvalue theory" is the continuous-time generalised eigenproblem of the
joined system, solved by a Jacobi method in the test code: no time stepping,
so it is independent of the engine. Two of the 24 peaks may be missed where
two modes lie closer than the peak finder resolves; the figures are the worst
of the rest.

**Forces are solved together, not in sequence.** After every step, for every
one of the four connections of the mesh, the force the engine applied is
compared with the connection's own law evaluated on the motion that resulted
from *all* forces in that step. Largest mismatch over one second: 2.4e-12
(relative). A scheme that solved the connections one after another would not
satisfy this. Newton needed one iteration, as it should for a linear system.

## 6. High-frequency coupling accuracy

Phase 3A measured a 1.1 % error in a coupled mode near 8.8 kHz. This phase
investigated it at 44.1, 48, 96 and 192 kHz.

**Cause.** The midpoint rule compresses the frequency axis. The resonators
are prewarped, so each is exact on its own; a spring between them is not. At
the frequency of the motion, with theta the angle per sample, the spring acts
as only (theta/2) / tan(theta/2) of its stiffness. The error therefore grows
with frequency and with how much of the mode's stiffness comes from the
spring.

**Two remedies were measured.**

*Oversampling* (running the whole engine at 2x or 4x the rate) divides the
error by 4 or 16, and costs 2x or 4x the processing, plus a decimation filter
that was not built.

*A correction of the spring*, in two parts, both computed when the system is
built and costing nothing per sample:

1. The spring attaches through each mode's shape scaled by
   sqrt(tan(theta/2) / (theta/2)). This makes each mode respond to the spring
   correctly near its own resonance.
2. That scaling makes the modes too compliant to slow forces, by
   (theta / sin theta - 1) of each mode's true static compliance. The surplus,
   summed over both ends, is a compliance in series with the spring; the
   spring is stiffened by exactly enough to cancel it:
   k' = k / (1 - k x surplus).

Part 1 alone was tried first and rejected: it improved weakly coupled high
modes but made strongly shifted low modes worse (0.12 % became 0.28 % in the
two-bar case below). Both parts together improve every case measured. The
corrected spring is still a positive spring between positive mode shapes, so
the system stays passive; for springs so stiff that the surplus could not be
cancelled (k x surplus above 0.9, an effective weld) the stiffening is capped.

**Two identical oscillators at 8 kHz, spring raising the upper mode by 10 %
(the Phase 3A case). Error of that mode:**

| Sample rate | Uncorrected | Corrected | Uncorrected at 2x rate |
| --- | --- | --- | --- |
| 44.1 kHz | -1.31 % | +0.019 % | -0.33 % |
| 48 kHz | -1.11 % | +0.013 % | -0.28 % |
| 96 kHz | -0.28 % | +0.0007 % | -0.07 % |
| 192 kHz | -0.07 % | below 0.0001 % | -0.018 % |

At 48 kHz, other strengths and frequencies:

| Case | Uncorrected | Corrected | Uncorrected at 2x rate |
| --- | --- | --- | --- |
| 8 kHz, mode raised 1 % | -0.095 % | +0.0001 % | -0.024 % |
| 2 kHz, mode raised 10 % | -0.070 % | below 0.0001 % | -0.018 % |
| 8 kHz, mode raised 50 % | -7.5 % | +0.49 % | -2.1 % |
| 16 kHz, mode raised 10 % | -4.2 % | +0.39 % | -1.1 % |

**Two eight-mode bars, every mode up to 18.5 kHz, worst error:**

| Spring | 48 kHz uncorrected | 48 kHz corrected | 96 kHz uncorrected |
| --- | --- | --- | --- |
| 4e5 N/m | 0.0045 % | 0.0019 % | 0.0019 % |
| 4e6 N/m | 0.098 % | 0.0005 % | 0.024 % |
| 4e7 N/m (bars nearly welded) | 0.67 % | 0.028 % | 0.18 % |

(The 0.002 to 0.005 % figures are at the resolution of the spectral
measurement, not a property of the engine.)

**Decision.** The correction is used; oversampling is not. At 48 kHz the
corrected spring is more accurate than the uncorrected one at four times the
rate in every case measured, at no processing cost. Its remaining error is
largest where a very stiff spring acts on modes above about 10 kHz (0.4 to
0.5 % in the two extreme rows above).

**Dampers are not corrected.** The same analysis says a damper is already
right to first order. Measured decay rate given by a damper, relative to
theory, at 48 kHz:

| Frequency | Damper plain (used) | Damper corrected like a spring |
| --- | --- | --- |
| 2 kHz | 0.999 | 1.005 |
| 8 kHz | 0.994 | 1.096 |
| 16 kHz | 0.964 | 1.594 |

So a spring-damper is two connections internally: a corrected spring and a
plain damper. `Design.spring()` hides this and returns both indices.

**Contacts are not corrected.** A contact's stiffness changes during the
step, and the correction above assumes a constant one. Its accuracy is as
measured in Phase 3A.

## 7. Editing while it sounds

Nothing is recompiled or rebuilt for any edit: each is a function call that
writes parameters. Edits arrive as messages and take effect at the next
block boundary (2.7 ms at 48 kHz).

| Edit | How the transition is handled | Measured |
| --- | --- | --- |
| Connection stiffness | Three policies, as Phase 3A: at once; linear ramp over a given number of samples; at the spring's next pass through rest. The energy each change adds or removes is accounted. | Same output as the reference for all three (within 1e-12) |
| Connection damping | At once. A damper stores no energy, so the change is passive. | Same as the reference |
| Resonator frequency | The mode's displacement and velocity are rescaled so that its stored energy is unchanged; every spring's rest length is moved so that its stored energy is unchanged. | +20 % in one step: energy change 0, no jump (largest step across the edit 0.4x the largest before it); frequencies afterwards match theory for the retuned system to 0.004 % |
| | Glide: one small step per block | Up a fifth over 0.5 s: energy constant to 1.2e-12 |
| | Random retuning every 64 samples, 0.5x to 2x | Energy constant to 4.2e-13; output finite |
| Resonator damping | Same call (`tune` sets frequency and decay time). | Energy never rises; no jump (ratio below 1.2) |
| Topology: connect | The connection exists from the start with zero stiffness. `attach` makes its rest length its present length; stiffness is then set at once. | Total energy unchanged across the edit (to 1e-12); the third bar is silent before and sounds after |
| Topology: disconnect | Stiffness set to zero at the spring's next pass through rest (or ramped). | Energy never rises; afterwards the released bar keeps exactly the energy it had |
| All of the above together | 64 s of audio with strikes, mallets and every kind of edit | 0 non-finite samples, memory unchanged, 0 garbage collections |

Why energy is preserved on retuning: changing a spring's stiffness while it
is stretched changes its stored energy. Done repeatedly at the right moments,
that pumps energy in without limit. Rescaling the state removes the
possibility by construction.

**Limits.** Topology can only change among connections declared when the
system was built. Adding a resonator or a connection means building a new
system, which starts silent. The engine has room for 32 connections.

## 8. Real AudioWorklet

Test page: run `npm run dev` and open
`http://localhost:5173/experimental.html`. It has its own HTML file and
shares no interface code with the application.

How it runs: the main thread fetches the 26.5 kB module and passes its bytes
and the list of build calls to the processor's constructor, which compiles
and instantiates it on the audio thread and replies "ready" or an error.
`process()` calls the engine once and copies 128 samples out of its memory
through a view created in the constructor. Strikes and edits are messages.

Checks run by the page's "Run lifecycle checks" button, in the browser, all
passing:

| Requirement | Check | Result |
| --- | --- | --- |
| Initialisation, WebAssembly loading | Time from request to the processor reporting ready | 8 to 15 ms (57 ms the first time, which includes loading the worklet module) |
| AudioContext lifecycle | start, suspend, resume, stop | Running; suspend stops processing (block count frozen); resume continues; stop closes the context |
| Real-time output | Peak of the live output | 0 before any strike; 0.064 after a pulse strike; 0.095 after a mallet strike |
| No duplicate nodes | Two simultaneous starts; start while running | One node, one context |
| Cleanup | Stop, then three more start/stop cycles | Nodes created 4, disposed 4; contexts created 4, closed 4 |
| Error handling | Corrupt module | Rejected: "Physics engine: CompileError: ... expected version 01 00 00 00" |
| | Unknown engine call | Rejected: 'unknown engine call "notAnEngineFunction"' |
| | System too large | Refused; output silent and finite |
| | After the failures | Starts normally |
| Finite output | Non-finite samples counted by the engine | 0 |
| Memory | Engine memory | 3 145 728 bytes, unchanged |

**Rapid playing.** 40 events a second for 5 s on each system: strikes on
every bar, mallets, stiffness and damping changes, retuning, connecting and
disconnecting.

| System | Underruns while playing | Non-finite samples | Blocks of 2 ms or more | Share of one core |
| --- | --- | --- | --- | --- |
| One bar, two mallets | 0 | 0 | 0 of 3083 | 1.2 % |
| Two coupled bars | 0 | 0 | 0 of 3083 | 2.0 % |
| Three coupled bars | 0 | 0 | 0 of 3079 | 2.6 % |
| 25 bars | 0 | 0 | 0 of 3079 | 1.9 % |

Each run also recorded one underrun of 10 to 24 ms at the moment the
AudioContext started, before anything was played. STABILITY.md records the
same start-up underrun, of about 10 ms, for the approved instruments and for
a context with nothing loaded: it is the context starting, not the engine.

**What these figures can and cannot show.**

- The only clock in an AudioWorklet is `Date.now()`, with 1 ms resolution.
  "Share of one core" is the sum of its differences over thousands of blocks:
  a valid average, not a precise one. The worst single block cannot be
  measured below 1 ms in the browser; what was verified is that none took
  2 ms or more (the budget is 2.67 ms) and that the browser reported no
  underruns. Worst-case block times in Node are in section 10.
- **No allocation in `process()`** is established three ways, none of them a
  direct measurement inside the browser's audio thread: by construction
  (the method calls the engine and writes to existing arrays; timing is off
  unless requested); by a Node test that drives the same engine functions for
  64 s of audio with every kind of edit and observes zero garbage
  collections; and by the engine's memory staying at its initial size.
- Tested in one browser (Chromium 156) with its pane not in front. Firefox
  and Safari were not tested.

## 9. Listening files

`npm run render:wasm` writes 21 WAV files (48 kHz, 24-bit, mono) to
`renders/wasm-engine/`. All are rendered through `process()` in 128-sample
blocks, as the AudioWorklet runs it. Files in a group share one gain, chosen
so the loudest peaks at 0.5; `listening.json` records every gain and peak.

| Files | Content |
| --- | --- |
| `P1`, `P2`, `P3` | Two coupled bars struck by the hard then the soft mallet: TypeScript reference, WebAssembly, and their difference x 1,000,000. Largest sample difference 3.6e-15 (1e-14 of the peak). The mallets start a metre away: first sound at 0.67 s. |
| `M1` | One metal bar, three pulse strikes of increasing strength |
| `C1` to `C4` | Two bars: not connected; coupled, A struck; coupled, B struck; spring ten times stiffer |
| `T1`, `T2` | Three coupled bars: struck in turn; all at once |
| `H1`, `H2` | Soft and hard physical mallet at 0.5, 1, 2 and 4 m/s (separate gains: the hard mallet's peak is 3.3x the soft one's) |
| `L1` to `L3` | Connection stiffness x10 and back, twice: ramped over 10 ms; at once; at the zero crossing |
| `L4` | Connection damping raised at 1 s |
| `L5` | Third bar connected at 1.5 s, released at 3 s, connected again at 5.5 s |
| `L6` | Bar A glides up a fourth and back while ringing |
| `L7` | Bar damped at 1 s (decay times x 0.05), struck, released, struck |
| `X1` | A short phrase on the 25 bars |
| `X2` | A phrase on the three coupled bars, bar A played with the mallets |

## 10. Performance

`xN` means N times faster than real time on one thread. A 128-sample block at
48 kHz must finish in 2.667 ms.

**Node (`npm run bench:wasm`), median of three 10 s runs; worst single block
in brackets.**

| System | TypeScript | WebAssembly | Approved Faust bar |
| --- | --- | --- | --- |
| One bar, 8 modes | x114 (0.49 ms) | x700 (1.20 ms) | |
| Two coupled bars, spring and damper | x30 (0.21 ms) | x108 (0.26 ms) | |
| Three coupled bars, two springs | x18 (0.45 ms) | x53 (0.33 ms) | |
| Three coupled bars with two mallets | x13 (0.61 ms) | x35 (0.33 ms) | |
| 25 independent bars (200 modes), struck every 0.1 s | x11 (0.61 ms) | x51 (0.34 ms) | x34 |
| 25 bars, idle, never struck | x11 (0.63 ms) | x46 (0.25 ms) | x41 |
| 25 bars, idle after ringing down for a minute | x9 (0.56 ms) | x49 (0.29 ms) | x28 |
| One resonator, 200 modes | x24 (0.31 ms) | x38 (0.43 ms) | |
| One resonator, 500 modes | x9 (1.87 ms) | x15 (0.46 ms) | |

The Faust bar is rendered in one call from outside, so its per-block time
cannot be observed. Worst-block figures include whatever else the machine was
doing; the 1.2 ms outlier on the smallest system is of that kind.

**Browser, real AudioWorklet, rendered through an OfflineAudioContext
(20 s, median of three).**

| System | TypeScript | WebAssembly | Approved Faust bar |
| --- | --- | --- | --- |
| One bar | x91 | x482 | |
| Two coupled bars | x32 | x99 | |
| Three coupled bars | x18 | x39 | |
| Three coupled bars with two mallets | x13 | x34 | |
| 25 bars, all ringing | x10 | x49 | x24 |
| 25 bars, idle | x12 | x49 | x38 |
| One resonator, 200 modes | x22 | x30 | |
| One resonator, 500 modes | x8 | x14 | |

Live, through the speakers, 4 s of rapid playing each: 0 underruns for all
four WebAssembly systems, for the TypeScript engine with 25 bars, and for the
approved Faust bar.

**Other figures.**

| | WebAssembly engine | TypeScript engine | Approved Faust bar |
| --- | --- | --- | --- |
| Binary | 26.5 kB | (27 kB of source, bundled with the page) | 107 kB |
| Memory | 3.1 MB, fixed, any system | 17 kB of typed arrays for 25 bars (computed, not measured) | not measured |
| Start-up, Node | 0.02 ms to create the module (functions compile on first use) + 0.95 ms to instantiate and build 25 bars | 0.23 ms | 0.02 ms + 12.4 ms |
| Create a node, browser | 5 to 6 ms | 10 to 14 ms | 5 to 6 ms |

**Reading these.**

- WebAssembly was not assumed to be faster; it was measured. It is 3 to 6
  times faster than the TypeScript engine on bars and coupled systems, and
  about 1.6 times on a single large resonator, where the TypeScript engine's
  loop was already efficient.
- On the one like-for-like case, 25 bars of 8 modes, it is as fast as the
  approved Faust instrument or faster, while computing in 64-bit and able to
  couple the bars.
- **Idle costs the same as playing.** Nothing is skipped when a system is
  silent. The engine does clear vanishing values, which is why it does not
  slow down after a long decay; the Faust bar does (x41 never struck, x28
  after ringing down), which is consistent with subnormal arithmetic but was
  not investigated further.
- **Coupling is the expensive part.** Sixteen modes take 50 ns per sample
  unconnected and 125 ns joined by one spring; each further connection adds
  about 70 ns. The solve is a dense K x K system every sample, so cost grows
  faster than the number of connections. Three coupled bars with mallets
  (six connections) use about 3 % of a core.

## 11. Remaining limitations

1. **Experimental.** One browser tested. No listening evaluation has been
   made by anyone.
2. **Connections are costly and capped at 32.** A dense solve per sample.
   Linear connections could be solved once and reused until a parameter
   changes; connections that do not share a resonator could be solved
   separately. Neither was done.
3. **A mallet stays connected for ever.** Its contact is evaluated every
   sample even when it is a metre away. One mallet per bar on a 25-bar
   instrument would not fit in 32 connections; the 25-bar system uses force
   pulses instead.
4. **No sleeping.** Silent resonators cost as much as sounding ones.
5. **Edits land on block boundaries**, so a glide is a staircase of 2.7 ms
   steps. Each step is energy-neutral and makes no jump in the output, but
   the pitch is not continuous.
6. **Topology changes only among pre-declared connections.** Anything else
   needs a rebuild, which starts silent.
7. **Contacts are not corrected for high frequencies**, and a spring's
   correction leaves up to 0.5 % error for very stiff springs acting on
   modes above 10 kHz.
8. **Modes cannot be tuned above 0.49 x the sample rate**; they are held
   there. Callers should drop such modes.
9. **No vectorisation.** Each mode takes about 3 ns per sample. SIMD was not
   tried.
10. **Fixed capacity.** Larger systems need the constants at the top of
    `assembly/engine.ts` raised and a rebuild.
11. **The reference engine reads one output port**, the WebAssembly engine a
    mix of several, so in the benchmarks the reference does slightly less
    work on multi-output systems.
12. **Toolchain.** AssemblyScript is a 101 MB development dependency with a
    smaller community than Rust or C++.

## 12. Recommendation on Phase 3B

**Phase 3B can begin, with the engine in WebAssembly, if its scope is kept
within what was measured.**

What this phase established:

- The physics survives the port exactly (section 4).
- It runs in a real AudioWorklet with no underruns, no non-finite output and
  fixed memory under rapid playing and editing (section 8).
- Several components couple correctly, with forces solved together
  (section 5).
- The one accuracy problem Phase 3A left open is resolved without
  oversampling (section 6).
- Parameters, tuning, damping and connections can change while sounding
  without recompilation and without adding energy (section 7).
- It is as fast as the approved Faust instrument where they can be compared
  (section 10).

What it did not establish, and Phase 3B should treat as open:

- **Whether it sounds right.** Only the listening files can answer that.
- **Strings and other waveguides.** Only modal resonators and free masses
  exist. The resonator interface was designed to admit a waveguide, but none
  was written.
- **Scale.** Systems of a few connections are comfortable. An instrument of
  dozens of coupled parts with a mallet each is not, until items 2 to 4 of
  section 11 are addressed.
- **Building systems live.** Adding a part currently means rebuilding
  silently. An editor that adds parts while sound continues needs either
  spare pre-declared capacity or a state hand-over; neither exists.
- **Other browsers.**

A reasonable first step for Phase 3B would be a builder limited to modal
parts joined by springs and struck by pulses or a small number of mallets,
with a rebuild on each structural change, leaving the approved instruments
on Faust as they are.

## 13. Observation taps (Phase 3D.4)

The engine can now report the velocity of up to 32 ports for every sample of a block, besides its one mixed output: `addTap(r, port)` and `tapPointer()`. Taps are read-only, cost nothing when there are none, and leave the first output bit for bit as it was. Memory layout, cost and verification: section 1 of [RADIATOR.md](RADIATOR.md).
