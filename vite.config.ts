import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    include: ['tests/**/*.test.ts'],
    // Rendering and analysing seconds of audio per case is slow on a busy machine.
    testTimeout: 60_000,
    // The package's "main" is an IIFE build, which is what Node resolves.
    // Point tests at its ESM build (the browser bundle uses "module" already).
    // (Exact match only: deeper imports of the package are left alone.)
    alias: [{ find: /^@grame\/faustwasm$/, replacement: '@grame/faustwasm/dist/esm/index.js' }],
  },
})
