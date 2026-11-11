# audio/engine

Main-thread audio engine: owns the single `AudioContext`, builds the node graph
(instrument node -> analyser -> destination), and exposes note/parameter calls
to React. Pure helpers (e.g. `pitch.ts`) live here too. No DSP runs in this layer.
