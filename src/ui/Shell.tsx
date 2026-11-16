// Melofably's frame around every React page: the brand bar with its
// navigation, and the one place notifications appear.
import type { ReactNode } from 'react'
import { Toaster } from 'react-hot-toast'

const PAGES = [
  { id: 'instruments', label: 'Instruments', href: '/' },
  { id: 'builder', label: 'Builder', href: '/builder.html' },
  { id: 'lab', label: 'Hybrid Lab', href: '/hybrid-lab.html' },
] as const

export type PageId = (typeof PAGES)[number]['id']

/** The wordmark is text until the final logo is supplied: the link is where it will go. */
export function BrandBar({ current }: { current: PageId }) {
  return (
    <header className="m-bar">
      <a className="m-wordmark" href="/" aria-label="Melofably, home">
        Melofably
      </a>
      <span className="m-tagline">Invent instruments. Shape sound.</span>
      <nav className="m-nav" aria-label="Melofably">
        {PAGES.map((page) => (
          <a key={page.id} href={page.href} aria-current={page.id === current ? 'page' : undefined}>
            {page.label}
          </a>
        ))}
      </nav>
    </header>
  )
}

export function Shell({ current, children }: { current: PageId; children: ReactNode }) {
  return (
    <>
      <BrandBar current={current} />
      {children}
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 3500,
          style: { background: '#fffaf3', color: '#281b1c', border: '1px solid #e6d9ce', borderRadius: '10px', boxShadow: '0 1px 2px rgb(40 27 28 / 6%), 0 8px 24px rgb(40 27 28 / 12%)', fontSize: '0.875rem', maxWidth: 'min(26rem, calc(100vw - 2rem))' },
          success: { iconTheme: { primary: '#32745b', secondary: '#fffaf3' } },
          error: { duration: 6000, iconTheme: { primary: '#b42332', secondary: '#fffaf3' } },
        }}
      />
    </>
  )
}
