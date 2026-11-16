// The builder page's two halves: the classic builder (bars, the string on its box) and the hybrid builder.
import { useState } from 'react'
import type { Graph } from '../experimental/graph2/model.ts'
import Builder from './Builder.tsx'
import { HYBRID_STORAGE_KEY, hybridTemplate, MODE_STORAGE_KEY, openText } from './hybrid.ts'
import HybridBuilder from './HybridBuilder.tsx'
import { Shell } from '../ui/Shell.tsx'

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null // storage is unavailable: the builder works without it
  }
}
const remember = (mode: 'classic' | 'hybrid') => {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode)
  } catch {
    // a convenience only
  }
}

type Mode = { kind: 'classic' } | { kind: 'hybrid'; graph: Graph; notice: string }

/** The hybrid a choice names: a template, or the one saved in this browser (or the template, with the reason, if that cannot be used). */
function hybrid(choice: string): Mode {
  if (choice !== 'saved') return { kind: 'hybrid', graph: hybridTemplate(choice === '0.18' ? 0.18 : 0.2), notice: `Loaded the hybrid with the string tied at ${choice} of the bar.` }
  const saved = openText(read(HYBRID_STORAGE_KEY))
  if (saved.graph) return { kind: 'hybrid', graph: saved.graph, notice: `Opened your saved instrument "${saved.graph.meta.name}".` }
  return { kind: 'hybrid', graph: hybridTemplate(), notice: saved.problem ? `The hybrid saved in this browser could not be used, so the reference was loaded instead. It was left as it is. ${saved.problem}` : 'Nothing has been saved yet, so the reference hybrid was loaded.' }
}

/** The classic builder (bars, the string on its box) or the hybrid builder: one at a time, each with its own audio. */
export default function Root() {
  // After a reload the page comes back to what was open: the hybrid, as last saved, or the classic builder.
  const [mode, setMode] = useState<Mode>(() => (read(MODE_STORAGE_KEY) === 'hybrid' ? hybrid('saved') : { kind: 'classic' }))
  const go = (next: Mode) => {
    remember(next.kind)
    setMode(next)
  }
  return <Shell current="builder">{mode.kind === 'hybrid' ? <HybridBuilder key={mode.notice} initial={mode.graph} initialNotice={mode.notice} onClassic={() => go({ kind: 'classic' })} /> : <Builder onOpenHybrid={(choice) => go(hybrid(choice))} />}</Shell>
}
