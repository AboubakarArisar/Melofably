// EXPERIMENTAL (Phase 3D.12). Used only by the hybrid lab page.
//
// The engine's AudioWorklet processor (../wasm/processor.js) registers its
// class and keeps no other name for it. The hybrid lab's processor
// (hybrid-processor.js) extends that class without touching that file, so
// this module, added to the worklet first, notes each class as it is
// registered. Registration itself is passed on unchanged.

/* global registerProcessor */

const register = registerProcessor
globalThis.__sonicmatterProcessors = {}
globalThis.registerProcessor = (name, processor) => {
  globalThis.__sonicmatterProcessors[name] = processor
  return register.call(globalThis, name, processor)
}
