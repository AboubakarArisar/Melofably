# audio/worklet

AudioWorklet integration: loads compiled Faust WebAssembly + its JSON metadata
and instantiates it as an `AudioWorkletNode` on the audio thread. Everything
that crosses the main-thread/audio-thread boundary goes through this folder.
