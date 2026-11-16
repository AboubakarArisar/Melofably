// Melofably's front door. Everything it says the product does, the product
// does: the preview is the builder's own canvas drawing one of its examples.
import { ArrowRight, AudioWaveform, Cable, SlidersHorizontal } from 'lucide-react'
import { Canvas } from '../builder/Canvas.tsx'
import { RADIATION_EXAMPLES } from '../builder/examples.ts'

const STUDIO = '/studio.html'
const preview = RADIATION_EXAMPLES[0]
const previewGraph = preview.make()
const nothing = () => {}

const STEPS = [
  { icon: Cable, title: 'Build', text: 'Connect physical components.', more: 'Strings, metal and wooden bars, springs, mallets and a soundboard, joined the way they would be on a workbench.' },
  { icon: SlidersHorizontal, title: 'Shape', text: 'Tune materials, tension, and resonance.', more: 'Every control is a physical quantity with a unit: newtons, metres, kilograms per cubic metre.' },
  { icon: AudioWaveform, title: 'Play', text: 'Hear what you\u2019ve created.', more: 'The sound is computed from the physics as you play. Nothing is sampled.' },
]

type Kind = 'string' | 'bar' | 'glass' | 'wood' | 'hybrid' | 'builder'
const INSTRUMENTS: { kind: Kind; href: string; name: string; text: string; cta: string; experimental?: boolean }[] = [
  { kind: 'string', href: `${STUDIO}#string`, name: 'String', text: 'A plucked string. Tension, density and length set its pitch.', cta: 'Play' },
  { kind: 'bar', href: `${STUDIO}#bar`, name: 'Metal Bar', text: 'Struck bars with the overtones of a free metal beam.', cta: 'Play' },
  { kind: 'glass', href: `${STUDIO}#glass`, name: 'Glass Vessel', text: 'Struck glass. Its shape decides which overtones ring.', cta: 'Play' },
  { kind: 'wood', href: `${STUDIO}#wood`, name: 'Wooden Bar', text: 'Wood damps high overtones quickly. Resonator tubes can be added.', cta: 'Play' },
  { kind: 'hybrid', href: '/hybrid-lab.html', name: 'String on a bar bridge', text: 'A string whose bridge is a metal bar. Pluck one, strike the other, damp either with a finger.', cta: 'Open Hybrid', experimental: true },
  { kind: 'builder', href: '/builder.html', name: 'Your own assembly', text: 'Join bars, strings and springs on the canvas, or reshape the hybrid template.', cta: 'Open Builder', experimental: true },
]

/** A small drawing of what each instrument is. */
function Glyph({ kind }: { kind: Kind }) {
  const ink = { fill: 'none', stroke: '#365c43', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const soft = { ...ink, stroke: '#789575' }
  return (
    <svg viewBox="0 0 160 90" aria-hidden="true" className="h-full w-full">
      {kind === 'string' && (
        <>
          <path d="M20 45 Q80 12 140 45" {...ink} />
          <path d="M20 45 Q80 78 140 45" {...soft} strokeDasharray="3 6" />
          <circle cx="20" cy="45" r="4" fill="#fff" stroke="#365c43" strokeWidth="2" />
          <circle cx="140" cy="45" r="4" fill="#fff" stroke="#365c43" strokeWidth="2" />
        </>
      )}
      {(kind === 'bar' || kind === 'wood') && (
        <>
          <rect x="24" y="36" width="112" height="16" rx="4" fill={kind === 'wood' ? '#e5e8ce' : '#fff'} stroke="#365c43" strokeWidth="2" />
          {kind === 'wood' && <path d="M36 44h30M78 41h40M60 48h46" {...soft} strokeWidth="1.5" />}
          {kind === 'wood' && <rect x="68" y="58" width="24" height="24" rx="3" {...soft} />}
          <circle cx="49" cy="58" r="3" fill="#789575" />
          <circle cx="111" cy="58" r="3" fill="#789575" />
          <path d="M96 30 L118 10" {...soft} />
          <circle cx="94" cy="28" r="6" fill="#789575" />
        </>
      )}
      {kind === 'glass' && (
        <>
          <path d="M56 18 C56 52 64 70 80 70 C96 70 104 52 104 18" {...ink} />
          <ellipse cx="80" cy="18" rx="24" ry="5" {...ink} />
          <path d="M80 70v10M66 80h28" {...ink} />
          <path d="M116 30q8 14 0 28M128 24q12 20 0 40M44 30q-8 14 0 28" {...soft} />
        </>
      )}
      {kind === 'hybrid' && (
        <>
          <path d="M16 40 Q52 22 88 40" {...ink} />
          <rect x="80" y="33" width="64" height="14" rx="4" fill="#fff" stroke="#365c43" strokeWidth="2" />
          <circle cx="88" cy="40" r="4" fill="#365c43" />
          <circle cx="16" cy="40" r="4" fill="#fff" stroke="#365c43" strokeWidth="2" />
          <circle cx="96" cy="54" r="3" fill="#789575" />
          <circle cx="130" cy="54" r="3" fill="#789575" />
          <path d="M100 66q12 8 24 0M92 74q20 12 40 0" {...soft} />
        </>
      )}
      {kind === 'builder' && (
        <>
          <path d="M40 30 L80 60 L122 28" {...soft} strokeDasharray="4 5" />
          <rect x="22" y="20" width="36" height="20" rx="5" fill="#fff" stroke="#365c43" strokeWidth="2" />
          <rect x="62" y="52" width="36" height="20" rx="5" fill="#e5e8ce" stroke="#365c43" strokeWidth="2" />
          <circle cx="122" cy="28" r="12" fill="#fff" stroke="#365c43" strokeWidth="2" />
          <path d="M122 23v10M117 28h10" {...ink} />
        </>
      )}
    </svg>
  )
}

export function Landing() {
  return (
    <>
      <header className="m-bar">
        <a className="m-wordmark" href="/" aria-label="Melofably, home">
          <img src="/brand/logo.png" alt="" width="50" height="28" />
        </a>
        <nav className="m-nav" aria-label="Melofably">
          <a href="#product">How it works</a>
          <a href="#instruments">Instruments</a>
          <a href="#studio">Builder</a>
        </nav>
        <a className="m-btn m-btn-primary" href="/builder.html">
          Open Builder
        </a>
      </header>

      <main>
        <section className="bg-sage-ivory">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:py-24">
            <div>
              <p className="m-eyebrow mb-5">Physical modelling in the browser</p>
              <h1 className="text-[clamp(2.5rem,5.4vw,4.25rem)] font-extrabold leading-[1.04] tracking-[-0.04em] text-neutral-100">
                Don&rsquo;t just play instruments. <span className="text-sky-500">Invent them.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-neutral-400">Design physical instruments, explore resonance, and create entirely new sounds in your browser.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a className="m-btn m-btn-primary m-btn-lg" href="/builder.html">
                  Open Builder <ArrowRight aria-hidden="true" size={18} />
                </a>
                <a className="m-btn m-btn-lg" href={STUDIO}>
                  Try Instruments
                </a>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold text-neutral-400">
                {['Runs in your browser', 'Nothing is sampled', 'Four validated instruments'].map((x) => (
                  <li key={x} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-sage" />
                    {x}
                  </li>
                ))}
              </ul>
            </div>
            <picture className="mx-auto block w-full max-w-[508px] overflow-hidden rounded-[28px]">
              <source srcSet="/brand/hero-still.png" media="(prefers-reduced-motion: reduce)" />
              <img src="/brand/hero.gif" width="508" height="508" alt="A string vibrating between two fixed points, with rings of sound spreading from it" className="block aspect-square h-auto w-full object-contain" />
            </picture>
          </div>
        </section>

        <section id="product" className="scroll-mt-20">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
            <p className="m-eyebrow">How it works</p>
            <h2 className="mt-2 max-w-2xl text-3xl font-extrabold tracking-[-0.035em] sm:text-4xl">From parts on a bench to a sound nobody has made before.</h2>
            <ol className="mt-10 grid gap-5 md:grid-cols-3">
              {STEPS.map((step, n) => (
                <li key={step.title} className="m-card m-card-hover p-7">
                  <div className="flex items-center justify-between">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-sage-ivory text-sky-500">
                      <step.icon aria-hidden="true" size={20} />
                    </span>
                    <span className="text-sm font-bold tabular-nums text-sage">0{n + 1}</span>
                  </div>
                  <h3 className="mt-5 text-xl font-bold">{step.title}</h3>
                  <p className="mt-1 font-bold text-neutral-200">{step.text}</p>
                  <p className="mt-2 text-sm leading-relaxed text-neutral-400">{step.more}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="studio" className="scroll-mt-20 border-y border-neutral-700 bg-neutral-900">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
            <div className="grid items-end gap-6 lg:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <p className="m-eyebrow">Builder</p>
                <h2 className="mt-2 max-w-2xl text-3xl font-extrabold tracking-[-0.035em] sm:text-4xl">A workbench, not a preset browser.</h2>
                <p className="mt-3 max-w-2xl text-neutral-400">Put components on the canvas, join them, and set what each is made of. Below is the builder&rsquo;s own canvas showing one of its examples.</p>
              </div>
              <a className="m-btn" href="/builder.html">
                Open the Builder <ArrowRight aria-hidden="true" size={16} />
              </a>
            </div>
            <figure className="mt-8 overflow-hidden rounded-2xl border border-neutral-700 bg-neutral-950">
              <div className="flex items-center gap-2 border-b border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm text-neutral-400">
                <span className="m-chip m-chip-solid">Builder</span>
                <span className="truncate">{preview.label}</span>
              </div>
              <div className="p-3 sm:p-5" inert>
                <Canvas graph={previewGraph} selection={null} flagged={new Set()} struck={{ ids: [], n: 0 }} ringing={0} onSelect={nothing} onMove={nothing} onConnect={nothing} onRemoveComponent={nothing} onStrike={nothing} onPlayAt={nothing} onPull={() => null} onLetGo={nothing} />
              </div>
              <figcaption className="sr-only">The builder canvas showing the example: {preview.label}</figcaption>
            </figure>
          </div>
        </section>

        <section id="instruments" className="scroll-mt-20">
          <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8">
            <p className="m-eyebrow">Instruments</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-[-0.035em] sm:text-4xl">Start from one that is proven. Then break the rules.</h2>
            <p className="mt-3 max-w-2xl text-neutral-400">Four models are validated against the equations they are built on. The experimental ones are working physical models that have not been through the same checks.</p>
            <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {INSTRUMENTS.map((x) => (
                <li key={x.name}>
                  <a href={x.href} className="group m-card m-card-hover flex h-full flex-col overflow-hidden no-underline">
                    <span className={`block aspect-[16/7] p-4 ${x.experimental ? 'bg-neutral-800' : 'bg-sage-ivory'}`}>
                      <Glyph kind={x.kind} />
                    </span>
                    <span className="flex flex-1 flex-col p-5">
                      <span className="flex items-center justify-between gap-3">
                        <span className="text-lg font-bold">{x.name}</span>
                        <span className={`m-chip ${x.experimental ? '' : 'm-chip-solid'}`}>{x.experimental ? 'Experimental' : 'Validated'}</span>
                      </span>
                      <span className="mt-1.5 flex-1 text-sm leading-relaxed text-neutral-400">{x.text}</span>
                      <span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-sky-500">
                        {x.cta} <ArrowRight aria-hidden="true" size={15} className="transition-transform group-hover:translate-x-1" />
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="px-5 pb-20 sm:px-8">
          <div className="mx-auto max-w-7xl rounded-3xl bg-sage-ivory px-6 py-16 text-center sm:py-20">
            <h2 className="mx-auto max-w-3xl text-[clamp(1.9rem,4.2vw,3rem)] font-extrabold leading-tight tracking-[-0.04em]">Your next instrument doesn&rsquo;t exist yet.</h2>
            <a className="m-btn m-btn-primary m-btn-lg mt-8" href="/builder.html">
              Start Creating <ArrowRight aria-hidden="true" size={18} />
            </a>
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-700 bg-neutral-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 text-sm text-neutral-400 sm:px-8">
          <span className="m-wordmark text-base">Melofably</span>
          <span className="mr-auto">Physical modelling in your browser. No samples.</span>
          <a className="font-bold text-neutral-300 hover:text-sky-500" href={STUDIO}>Instruments</a>
          <a className="font-bold text-neutral-300 hover:text-sky-500" href="/builder.html">Builder</a>
          <a className="font-bold text-neutral-300 hover:text-sky-500" href="/hybrid-lab.html">Hybrid</a>
        </div>
      </footer>
    </>
  )
}
