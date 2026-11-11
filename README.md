# SonicMatter

Browser-based physical-modeling synthesizer and virtual instrument studio.
Sound will be computed by Faust DSP compiled to WebAssembly and run in an
AudioWorklet; the UI is React.

**Status:** project setup only. No synthesis is implemented yet.

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)

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
| `npm test` | Run the Vitest suite once |
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
docs/               architecture and roadmap
```
