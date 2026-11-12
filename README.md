# SonicMatter

Browser-based physical-modeling synthesizer and virtual instrument studio.
Sound will be computed by Faust DSP compiled to WebAssembly and run in an
AudioWorklet; the UI is React.

**Status:** Phase 2C. Four playable instruments:

- **String:** a plucked string synthesized by a digital waveguide whose pitch
  follows f = √(T/μ) / 2L.
- **Metal Bar:** a set of struck free-free metal bars synthesized from their
  bending modes (Euler-Bernoulli beam theory).
- **Glass Vessel:** a set of struck thin-walled cylindrical glass vessels
  synthesized from their wall modes (inextensional shell approximation).
- **Wooden Bar:** a set of struck wooden bars over tube resonators, with
  wood's material, damping law and mallet contact.

Documentation:

- [Architecture](docs/ARCHITECTURE.md)
- [String model and its approximations](docs/STRING_MODEL.md)
- [Metal bar model and its assumptions](docs/BAR_MODEL.md)
- [Glass vessel model, its sources and assumptions](docs/GLASS_MODEL.md)
- [Wooden bar model and the limits of treating wood as a beam](docs/WOOD_MODEL.md)
- [Stability, loading and performance](docs/STABILITY.md)
- [Instrument builder: architecture design (not yet built)](docs/BUILDER_ARCHITECTURE.md)
- [Experimental physics engine: proof of concept and results](docs/EXPERIMENTAL_ENGINE.md)
- [Roadmap](docs/ROADMAP.md)

## Playing it

1. Run `npm run dev` and open http://localhost:5173.
2. Choose **String**, **Metal Bar**, **Glass Vessel** or **Wooden Bar**, then press **Start Audio** (browsers
   only allow audio after a click). The instrument can be changed while
   audio is running.
3. Click the keys, or use the computer keyboard: the Z row is the first
   octave, the Q row the second.
4. Move the sliders. Length, tension and density change the pitch; the
   calculated fundamental is shown and marked on the spectrum. Tone
   brightness, attack softness and body resonance change the character
   without changing the pitch.

## Requirements

- Node.js 20.19+ or 22.12+ (developed on 24)
- npm

## Setup

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run dsp` | Compile the Faust models that changed to WebAssembly (runs automatically before dev, test and build; `-- --force` recompiles all) |
| `npm test` | Run the Vitest suite once |
| `npm run baseline` | Write the approved-audio baselines in `tests/baseline/` (refuses to overwrite without `-- --update`) |
| `npm run compare` | Render before/after string WAV files and metrics into `renders/` |
| `npm run render:bar` | Render metal bar WAV files and metrics into `renders/metal-bar/` |
| `npm run render:glass` | Render glass vessel WAV files and metrics into `renders/glass-vessel/` |
| `npm run render:wood` | Render wooden bar WAV files, a wood-versus-metal comparison and metrics into `renders/wooden-bar/` |
| `npm run render:experimental` | Render the experimental engine's comparison WAV files and performance figures into `renders/experimental/` |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | Lint with oxlint |

## Structure

```
src/
  audio/
    engine/         AudioContext, node graph, engine API
    models/         Faust .dsp physical models
    worklet/        WebAssembly + AudioWorklet integration
  components/
    controls/       instrument controls
    visualization/  audio visualization
  types/            shared types
tests/              Vitest tests; tests/baseline/ holds the approved audio
analysis/           signal measurements, frozen Phase 1 model, render scripts
scripts/            build-dsp.mjs: compiles the Faust models
docs/               architecture, string model, roadmap
```
