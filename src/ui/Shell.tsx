// Melofably's frame around every React page: the brand bar with its
// navigation, and the one place notifications appear.
import type { ReactNode } from 'react'
import { Toaster } from 'react-hot-toast'

const PAGES = [
  { id: 'instruments', label: 'Instruments', href: '/studio.html' },
  { id: 'builder', label: 'Builder', href: '/builder.html' },
  { id: 'lab', label: 'Hybrid', href: '/hybrid-lab.html' },
] as const

export type PageId = (typeof PAGES)[number]['id']

/** The wordmark is text until the final logo is supplied: the link is where it will go. */
export function BrandBar({ current }: { current: PageId }) {
  return (
    <header className="m-bar">
      <a className="m-wordmark" href="/" aria-label="Melofably, home">
        Melofably
      </a>
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
          style: { background: '#ffffff', color: '#26382c', border: '1px solid #d5ddce', borderRadius: '12px', boxShadow: '0 10px 28px rgb(38 56 44 / 14%)', fontSize: '0.875rem', fontWeight: 500, maxWidth: 'min(26rem, calc(100vw - 2rem))' },
          success: { iconTheme: { primary: '#365c43', secondary: '#ffffff' } },
          error: { duration: 6000, iconTheme: { primary: '#a8322b', secondary: '#ffffff' } },
        }}
      />
    </>
  )
}
