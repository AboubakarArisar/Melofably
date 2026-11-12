# SonicMatter Architecture

SonicMatter is a browser-based physical-modeling synthesizer. All sound is
computed sample by sample from physical models. There are no samples,
wavetables, or stand-in engines anywhere in the signal path.

Status: four models exist. The plucked string (waveguide) is described in
[STRING_MODEL.md](STRING_MODEL.md), the struck metal bar (modal synthesis) in
[BAR_MODEL.md](BAR_MODEL.md), the struck glass vessel (modal synthesis) in
[GLASS_MODEL.md](GLASS_MODEL.md), and the struck wooden bar (modal synthesis)
in [WOOD_MODEL.md](WOOD_MODEL.md). `src/audio/models/modal.lib` holds the
resonator and limiter shared by new modal models; the bar and glass models
predate it and keep their own copies. Each model is its own Faust program and its own
WebAssembly module; the engine hosts one at a time and swaps the worklet node
when the instrument changes.

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

The integration library is `@grame/faustwasm` 0.20 (GRAME's official package).
How it is used today, checked against its installed typings and sources:

- **Build.** `npm run dsp` runs its `faust2wasm-ts` CLI, which compiles each
  `src/audio/models/<name>.dsp` to
  `src/audio/models/generated/<name>/dsp-module.wasm` and `dsp-meta.json`. The
  folder is git-ignored and rebuilt before `dev`, `build` and `test`.
- **Browser.** `src/audio/worklet/instruments.ts` lists the models, imports
  each one's JSON, fetches and compiles its `.wasm`, and calls
  `new FaustMonoDspGenerator().createNode(ctx, name, { module, json, soundfiles })`.
  faustwasm registers its `AudioWorkletProcessor` from a Blob URL and
  instantiates the module on the audio thread, returning a
  `FaustMonoAudioWorkletNode`. Parameters are set with
  `node.setParamValue(path, value)`.
- **Tests.** `createOfflineProcessor(sampleRate, 128, factory)` runs the same
  `.wasm` in Node with no `AudioContext`; `render()` returns the samples.
- **Bundle note.** The package's ESM build has a Node-only branch that imports
  `fs` and `url`. Vite externalizes them and prints a warning at build time;
  the branch never runs in a browser.

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
- **DSP correctness** (`tests/string.test.ts`, `tests/bar.test.ts`,
  `tests/glass.test.ts`, `tests/wood.test.ts`): render the
  compiled WASM offline, with no `AudioContext`, and assert on the signal
  itself: measured pitch or modal frequencies, decay, spectral content,
  stability, reproducibility.
- **Engine lifecycle** (`tests/engine.test.ts`): Web Audio objects replaced by
  counters, to show that notes create no nodes, that switching instrument
  swaps exactly one node, and that dispose releases everything.
- **Development hook.** In development builds only, the live engine is exposed
  as `window.sonicmatter` so its analyser can be read from the console.
- **Browser integration**: manual; there are no automated browser tests yet.

## Out of scope for now

Backend, database, authentication, and payments (Phase 6). Nothing in the
audio architecture depends on them.
