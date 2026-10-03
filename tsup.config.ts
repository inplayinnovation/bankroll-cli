import { readFileSync } from 'node:fs'

import { defineConfig } from 'tsup'

// Baked in at build time. The alternative — reading npm_package_version at
// runtime — is only set by `npm run`, so under npx it fell back to a literal
// and reported a version the CLI had not been for three releases.
const { version } = JSON.parse(readFileSync('./package.json', 'utf8'))

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  // dist also holds the built simulator, which this must not remove on every
  // rebuild in watch mode. scripts/build.mjs empties dist before a full build.
  clean: false,
  target: 'node22',
  define: { __VERSION__: JSON.stringify(version) },
  // A CLI is executed, not imported, so one file beats a dozen chunks.
  banner: { js: '#!/usr/bin/env node' },
})
