import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    include: ['tests/**/*.test.ts'],
    // Rendering and analysing seconds of audio per case is slow on a busy machine. The slowest tests
    // (stability sweeps of the string prototypes) take about 30 s on an idle machine and were measured at
    // 65 to 75 s with the machine on battery and another program using most of the processor, so the old
    // limit of 60 s failed them for being slow, not for being wrong. A time limit is not a numerical
    // assertion: no expected value is changed. See docs/TESTING.md.
    testTimeout: 180_000,
    // At most three test files at once (the default is one per processor thread). Many of the files
    // render minutes of audio; running a dozen together makes each several times slower and makes the
    // timing-sensitive tests depend on what else is running.
    maxWorkers: 3,
    // The package's "main" is an IIFE build, which is what Node resolves.
    // Point tests at its ESM build (the browser bundle uses "module" already).
    // (Exact match only: deeper imports of the package are left alone.)
    alias: [{ find: /^@grame\/faustwasm$/, replacement: '@grame/faustwasm/dist/esm/index.js' }],
  },
})
