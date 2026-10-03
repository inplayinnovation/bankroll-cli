#!/usr/bin/env node
// Pins the surfpool release the simulator runs.
//
//   npm run pin-surfpool -- 1.6.0
//
// It downloads the release's build for each machine the CLI supports, takes
// the SHA-256 of each, and rewrites the version and the table in
// src/host/surfpool.ts. Nothing is kept but the hashes; a developer's CLI
// fetches the one build it needs, checks it against them, and keeps that.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RELEASES = 'https://github.com/solana-foundation/surfpool/releases/download';
const BUILDS = {
  'darwin-arm64': 'surfpool-darwin-arm64.tar.gz',
  'darwin-x64': 'surfpool-darwin-x64.tar.gz',
  'linux-x64': 'surfpool-linux-x64.tar.gz',
  'win32-x64': 'surfpool-windows-x64.tar.gz',
};
const SOURCE = join(import.meta.dirname, '..', 'src', 'host', 'surfpool.ts');

const version = process.argv[2]?.replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  console.error('\n  Name the release: npm run pin-surfpool -- 1.6.0\n');
  process.exit(1);
}

const lines = [];
for (const [machine, asset] of Object.entries(BUILDS)) {
  const url = `${RELEASES}/v${version}/${asset}`;
  process.stdout.write(`  ${machine.padEnd(13)} ${asset} … `);
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`\n\n  ${url} answered ${response.status}. Is ${version} a release with that build?\n`);
    process.exit(1);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  console.log(`${(bytes.length / 1_048_576).toFixed(0)} MB  ${sha256}`);
  lines.push(`  '${machine}': { asset: '${asset}', sha256: '${sha256}' },`);
}

const source = readFileSync(SOURCE, 'utf8');
const table = `// BUILDS START (written by scripts/pin-surfpool.mjs)\nexport const SURFPOOL_BUILDS: Record<string, SurfpoolBuild> = {\n${lines.join('\n')}\n};\n// BUILDS END`;
const rewritten = source
  .replace(/\/\/ BUILDS START[\s\S]*?\/\/ BUILDS END/, table)
  .replace(/export const SURFPOOL_VERSION = '[^']*';/, `export const SURFPOOL_VERSION = '${version}';`);
writeFileSync(SOURCE, rewritten);
console.log(`\n  src/host/surfpool.ts pins surfpool ${version}.\n`);
