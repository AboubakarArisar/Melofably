// Workspace shell. No synthesis yet (see docs/ROADMAP.md, Phase 1).
// The checks below are real feature detection for what the engine will require.
const requirements = [
  { name: 'AudioWorklet', ok: typeof AudioWorkletNode !== 'undefined' },
  { name: 'WebAssembly', ok: typeof WebAssembly !== 'undefined' },
]

export default function App() {
  return (
    <main className="min-h-screen bg-neutral-950 p-6 font-mono text-sm text-neutral-200">
      <h1 className="text-lg font-semibold">SonicMatter</h1>
      <p className="mt-1 text-neutral-400">Audio engine: not implemented.</p>
      <ul className="mt-4 space-y-1">
        {requirements.map((r) => (
          <li key={r.name}>
            <span className={r.ok ? 'text-emerald-400' : 'text-red-400'}>
              {r.ok ? 'supported' : 'missing'}
            </span>{' '}
            {r.name}
          </li>
        ))}
      </ul>
    </main>
  )
}
