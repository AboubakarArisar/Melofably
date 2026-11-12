// The package ships this script without typings. It compiles a .dsp file to
// dsp-module.wasm and dsp-meta.json in `outputDir`.
declare module '@grame/faustwasm/src/faust2wasmFiles.js' {
  export default function faust2wasmFiles(inputFile: string, outputDir: string, argv?: string[], poly?: boolean): Promise<unknown>
}
