// EXPERIMENTAL (Phase 3B). Entry of the instrument builder page (builder.html).
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import Builder from './Builder.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Builder />
  </StrictMode>,
)
