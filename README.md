# SonicMatter

Browser-based physical-modeling synthesizer and virtual instrument studio.
Sound will be computed by Faust DSP compiled to WebAssembly and run in an
AudioWorklet; the UI is React.

**Status:** Phase 1. A playable plucked string, synthesized by a digital
waveguide whose pitch follows f = √(T/μ) / 2L.

- [Architecture](docs/ARCHITECTURE.md)
- [String model and its approximations](docs/STRING_MODEL.md)
- [Roadmap](docs/ROADMAP.md)

## Playing it

1. Run `npm run dev` and open http://localhost:5173.
2. Press **Start Audio** (browsers only allow audio after a click).
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
| `npm run dsp` | Compile the Faust model to WebAssembly (runs automatically before dev, test and build) |
| `npm test` | Run the Vitest suite once |
| `npm run compare` | Render before/after WAV files and metrics into `renders/` |
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
tests/              Vitest tests
analysis/           signal measurements, frozen Phase 1 model, compare script
docs/               architecture, string model, roadmap
```
