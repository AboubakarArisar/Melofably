# SonicMatter Roadmap

Each phase ends with something audible and tested. A phase is done when its
exit criteria pass, not when its features exist.

## Phase 0: Setup (done)

Vite + React + TypeScript, Tailwind, Vitest, folder structure, docs.

## Phase 1: Genuine plucked-string synthesis (implemented, awaiting review)

See [STRING_MODEL.md](STRING_MODEL.md) for the model and its measured accuracy.

Phase 1.1 (sound quality, awaiting listening feedback): note-independent
high-frequency loss, a rounder pluck, a modal body, click-free retrigger, a
soft limiter, and three character controls.

- Add the Faust toolchain and compile the first model to WebAssembly.
- Waveguide plucked string: delay-line string, loop damping filter, pluck
  excitation with position and brightness.
- AudioWorklet hosting, engine API (`noteOn`, `noteOff`, `setParam`).
- Minimal controls generated from the Faust parameter metadata.
- Oscilloscope and spectrum from the real output.

Exit: offline-render tests confirm correct pitch and decay across the playable
range; a note plays in the browser with no glitches.

## Phase 2: Metal, glass, and wood resonators

Phase 2A (approved): struck free-free metal bars by modal synthesis, with an
instrument selector. See [BAR_MODEL.md](BAR_MODEL.md).

Phase 2B (approved): struck thin-walled cylindrical glass vessels by modal
synthesis. See [GLASS_MODEL.md](GLASS_MODEL.md).

Phase 2C (approved): struck wooden bars over tube resonators by modal
synthesis. See [WOOD_MODEL.md](WOOD_MODEL.md).

Phase 2D (implemented, awaiting review): stability and architecture. Models
precompiled, warmed up and primed before use; click-free switching; shared
DSP library; approved-audio baselines; design for the instrument builder. See
[STABILITY.md](STABILITY.md) and
[BUILDER_ARCHITECTURE.md](BUILDER_ARCHITECTURE.md). No new instruments.

- Modal synthesis for bars, plates, bowls, and tubes.
- Material parameters (stiffness, density, damping) mapped to mode
  frequencies and decay times.
- Strike and bow excitation models.

Exit: each material has a tested model whose modes match the expected ratios
for its geometry.

## Phase 3: Custom instrument construction

Phase 3A (experiment, awaiting review): a proof of concept of a data-driven
physics engine with genuine two-way coupling and nonlinear contact, kept in
`src/experimental/` and not used by the application. Results and
recommendation: [EXPERIMENTAL_ENGINE.md](EXPERIMENTAL_ENGINE.md). No decision
to adopt it has been made.

Phase 3A.1 (experiment, awaiting review): the same engine ported to
WebAssembly (AssemblyScript), verified against the TypeScript reference, run
in a real AudioWorklet on a separate test page, extended to several coupled
components and to edits while sounding, and benchmarked against the reference
and the approved Faust bar. Results and recommendation:
[WASM_ENGINE.md](WASM_ENGINE.md). Still not used by the application.

Phase 3B (experiment, awaiting review): a first visual instrument builder on
that engine, as a separate development-only page. Mallets, impulse strikes,
metal and wooden bars, springs and dampers; graph validation, translation to
the engine, live edits where the engine allows and a rebuild otherwise; three
editable examples. See [BUILDER.md](BUILDER.md). The plan below (generated
Faust code) was not followed: the engine takes the design as data.

Phase 3B.1 (awaiting review): validation and refinement of the builder, with
no new components. The reported audio dropouts were traced to the output
device; interaction problems found by using it were fixed and given
regression tests. See section 10 of [BUILDER.md](BUILDER.md).

Phase 3C.1 (prototype, awaiting review): a vibrating string physically joined
to one resonator, isolated from the builder. A modal string and a waveguide
string were measured side by side against theory and against the approved
Faust string. See [STRING_PROTOTYPE.md](STRING_PROTOTYPE.md). Strings are not
in the builder.

Phase 3C.2 (prototype, awaiting review): a physically derived soundboard (a
thin rectangular wooden plate) for a modal string to sit on, with a simple
radiation model, checked against plate theory and timed in a real
AudioWorklet. See [SOUNDBOARD.md](SOUNDBOARD.md). Still isolated from the
builder.

Phase 3C.2.1 (refinement, awaiting review): the soundboard made thicker, its
bridge moved near an edge and its radiation given no baffle, so that notes
stay in tune and the low boom is gone; the low register is thin as a result.
See section 8 of [SOUNDBOARD.md](SOUNDBOARD.md).

Phase 3C.2.2 (investigation, awaiting review): the causes of the refined
board's slow attack on one note, weak fundamental and lower level, and a
first enclosed air cavity coupled to the plate. The cavity strengthens the
fundamentals without detuning anything but adds one booming resonance, so
it stays experimental. See section 9 of [SOUNDBOARD.md](SOUNDBOARD.md).

Phase 3C.2.3 (investigation, awaiting review): that resonance traced to the
plate's lowest mode on the air spring, and removed by a screen over a wider
hole and a bridge on a nodal line. No note booms; about half of the bass
gain is given back. See section 10 of [SOUNDBOARD.md](SOUNDBOARD.md).

Phase 3C.3 (awaiting review): the first playable string instrument in the
builder: one modal string on that damped box, joined by a bridge, plucked,
and heard as radiated sound pressure. The engine is unchanged; the builder's
instrument matches the prototype sample for sample. One string only. See
[STRING_INSTRUMENT.md](STRING_INSTRUMENT.md).

Phase 3D.1 (awaiting review): playing that instrument. A finger that is a
damper on the string, so that a note can be retriggered, damped or muted;
the string pulled aside on the canvas and released; pluck softness. The
approved sound is unchanged when none of it is used. See section 9 of
[STRING_INSTRUMENT.md](STRING_INSTRUMENT.md).

Phase 3D.2 (awaiting review): the first hybrid. One string tied by a spring
to one metal bar, in one engine system, each ringing the other; heard as the
bar's velocity. Only that pair is allowed in the builder. See
[HYBRID.md](HYBRID.md).

Phase 3D.3 (research, awaiting review): how every instrument makes its
output, and a prototype of the sound pressure a bar radiates (a line of
dipoles), checked three ways. Nothing is integrated and no sound changed;
the finding is that a shared pressure output needs the engine to have
several outputs. See [RADIATION.md](RADIATION.md).

Phase 3D.4 (experimental, awaiting review): the engine given read-only
observation points (taps), the 16-point bar radiator run in the AudioWorklet
on them, and one builder example heard through it: the hybrid with a
listener a metre away. Every earlier instrument plays the samples it played
on the previous engine. See [RADIATOR.md](RADIATOR.md).

Phase 3D.5 (research, awaiting review): why that example's pluck is 42 dB
below its mallet stroke (the string keeps its energy, and what reaches the
bar is in a mode that hardly radiates), and two candidates that are the same
instrument with the string tied at the bar's end and the bar retuned. Nothing
is in the builder. See [HYBRID_PLAYABILITY.md](HYBRID_PLAYABILITY.md).

Phase 3D.5.1 (experimental, awaiting review): the tuned candidate added to
the builder as a second radiated example, exactly as validated; nothing else
changed. Its sound has not had listening approval. See section 12 of
[HYBRID_PLAYABILITY.md](HYBRID_PLAYABILITY.md).

Phase 3D.6 (feasibility, awaiting review): a string and a small metal bar
both standing on the damped enclosed body, as one coupled system, isolated
from the builder. It is physically coherent, the string keeps its pitch and
its fundamental, and a well-mounted bar rings through the board; the two
exchange little energy and a stroke is far louder than a pluck. See
[THREE_BODY.md](THREE_BODY.md).

Phase 3D.7 (research, awaiting review): why. A stroke's knock is the
mallet's push reaching the board; the string keeps 98.7 % of its energy and
the damped board absorbs most of the rest. A softer mount gives a quieter,
longer stroke but cuts the bar off from the string, and moving the bridge
brings back a resonance the approved body removed. Still isolated. See
[THREE_BODY_MOUNTING.md](THREE_BODY_MOUNTING.md).

Phase 3D.8 (research, awaiting review): a more realistic pad under the bar
(a standard linear solid, soft when moved slowly and stiffer when moved
fast), built from the engine's own parts and validated. It lowers the knock
by one to three decibels at equal bar note, for a third more processor time:
not worth adopting. The useful middle between the earlier mounts comes from
the pad's stiffness, which a plain pad gives too. See
[THREE_BODY_PADS.md](THREE_BODY_PADS.md).

Phase 3D.9 (feasibility, awaiting review): another arrangement of the same
three parts. With the string tied to the bar and the bar standing on the
board where the bridge stood, the bar's bending takes about twenty times
more of a pluck and the string thirteen times more of a stroke, the string
keeps its pitch and fundamental, and the bar's note is heard in every
pluck's attack. Still isolated; not heard. See
[THREE_BODY_ARCHITECTURE.md](THREE_BODY_ARCHITECTURE.md).

- Combine exciters, resonators, and bodies into user-defined instruments.
- Generate Faust code from the design and compile it in the browser.
- Save and load instrument definitions locally.

Exit: an instrument built in the UI compiles and plays without a page reload.

## Phase 4: MIDI, polyphony, and audio export

- Web MIDI input, velocity, pitch bend, sustain.
- Polyphonic voice allocation and stealing.
- Offline render to WAV.

Exit: a MIDI keyboard plays chords; exported audio matches the live output.

## Phase 5: Professional interface and 3D visualization

- Full studio layout, presets, keyboard shortcuts, accessibility.
- 3D view of the vibrating instrument driven by model state.

Exit: usable for a full session without touching developer tools.

## Phase 6: SaaS features

- Accounts, cloud storage for instruments and presets, sharing.
- Billing.

Exit: defined when this phase is scheduled. No backend work happens before it.
