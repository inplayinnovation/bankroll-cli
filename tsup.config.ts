import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  target: 'node20',
  // A CLI is executed, not imported, so one file beats a dozen chunks.
  banner: { js: '#!/usr/bin/env node' },
})
