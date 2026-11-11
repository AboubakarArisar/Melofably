# SonicMatter Architecture

SonicMatter is a browser-based physical-modeling synthesizer. All sound is
computed sample by sample from physical models. There are no samples,
wavetables, or stand-in engines anywhere in the signal path.

Status: project setup only. Nothing described below under "signal path" is
implemented yet; this document is the contract the implementation follows.

## The four pieces

| Piece | Role | Runs on |
| --- | --- | --- |
| **Faust** | Language the physical models are written in (`src/audio/models/*.dsp`) | compile time |
| **WebAssembly** | Compiled form of each Faust model; does all per-sample math | audio thread |
| **AudioWorklet** | Hosts the WASM module inside the Web Audio graph, real-time safe | audio thread |
| **React** | UI: controls, visualization, instrument editing | main thread |

## Signal and control flow

```
 MAIN THREAD                                   AUDIO THREAD
 ───────────                                   ────────────
 React components
   controls/ ──┐
               │ setParam / noteOn / noteOff
               ▼
 audio/engine  ───── AudioWorkletNode ───────► AudioWorkletProcessor
 (AudioContext,      (params + MessagePort)      └─ Faust WASM instance
  node graph)                                         compute(128 frames)
               ▲                                           │
               │ AnalyserNode (real output data)           ▼
   visualization/ ◄──────────────────────────────── audio output
```

1. **Authoring.** Each instrument is a Faust program built on Faust's physical
   modeling library (`physmodels.lib`: waveguides, modal resonators, etc.).
2. **Compilation.** Faust compiles a `.dsp` file to a `.wasm` module plus a
   JSON description of its parameters (address, range, default, step).
3. **Hosting.** `src/audio/worklet` instantiates that module inside an
   `AudioWorkletProcessor`. The processor's `process()` calls the module's
   `compute` for each 128-frame render quantum.
4. **Control.** `src/audio/engine` owns the one `AudioContext` and exposes a
   small API (`noteOn`, `noteOff`, `setParam`). React controls call it; values
   reach the audio thread through the worklet node.
5. **Feedback.** An `AnalyserNode` taps the real output. Visualization reads it
   in a `requestAnimationFrame` loop and draws to a canvas.

## Compilation strategy

Two ways to get from `.dsp` to WASM, used at different phases:

- **Build-time (Phases 1–2).** Models shipped with the app are compiled ahead
  of time and loaded as static `.wasm` + `.json` assets. Fast startup, no
  compiler in the bundle.
- **Runtime (Phase 3).** Custom instrument construction generates Faust code
  from the user's design and compiles it in the browser with the WASM build of
  the Faust compiler (`libfaust`), lazy-loaded only when the builder is opened.

The planned integration library is `@grame/faustwasm` (GRAME's official
package), which covers both paths and provides the AudioWorklet node wrapper,
polyphony, and MIDI handling. It is intentionally **not installed yet**: it is
added in Phase 1 with the first model, and its exact API is verified against
its current documentation at that point rather than assumed here.

## Rules that keep it real-time safe

- **No DSP on the main thread.** React and the engine layer only send control
  values. All per-sample work is in WASM on the audio thread.
- **No allocation or locking in `process()`.** Memory is allocated when the
  module is instantiated.
- **React never renders at audio rate.** Controls write to the engine directly;
  visualization draws to canvas outside React state.
- **The UI is derived from the DSP.** Control ranges and defaults come from the
  Faust-emitted JSON (`InstrumentParam` in `src/types`), so UI and DSP cannot
  drift apart.
- **`AudioContext` starts on a user gesture**, as browser autoplay policy
  requires.

## Module map

```
src/
  audio/
    engine/         AudioContext, node graph, public engine API, pure helpers
    models/         Faust .dsp sources (the only place sound is defined)
    worklet/        WASM loading + AudioWorklet node/processor glue
  components/
    controls/       knobs, sliders, keyboard (generated from param metadata)
    visualization/  scope, spectrum, later 3D (reads AnalyserNode)
  types/            shared types
tests/              Vitest
```

Dependencies point one way: `components -> audio/engine -> audio/worklet ->
compiled models`. Nothing under `audio/` imports React.

## Testing

- **Pure logic** (pitch math, parameter mapping): Vitest in Node.
- **DSP correctness** (from Phase 1): render the compiled WASM offline, with no
  `AudioContext`, and assert on the signal itself. For example, a plucked
  string at A4 must have its fundamental at 440 Hz and must decay.
- **Browser integration**: manual at first; automated browser tests when the
  UI is worth protecting.

## Out of scope for now

Backend, database, authentication, and payments (Phase 6). Nothing in the
audio architecture depends on them.
