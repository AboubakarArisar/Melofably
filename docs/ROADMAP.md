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

Phase 2B (implemented, awaiting listening evaluation): struck thin-walled
cylindrical glass vessels by modal synthesis. See
[GLASS_MODEL.md](GLASS_MODEL.md).

Wood is not started.

- Modal synthesis for bars, plates, bowls, and tubes.
- Material parameters (stiffness, density, damping) mapped to mode
  frequencies and decay times.
- Strike and bow excitation models.

Exit: each material has a tested model whose modes match the expected ratios
for its geometry.

## Phase 3: Custom instrument construction

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
