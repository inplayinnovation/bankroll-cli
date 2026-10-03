// surfpool, the local chain's node: one pinned release, fetched once per
// computer and kept beside the keys.
//
// The chain is needed by one command on one kind of machine, a developer's,
// while the CLI is installed everywhere an app is built. So the node is not in
// the package: `bankroll apps create` fetches it after `npm install`, `bankroll
// dev` fetches it when it finds none, and either way it is fetched once and
// kept in ~/.config/bankroll/surfpool/<version>/. The release is pinned, with
// the SHA-256 of each build, so what runs is what was checked: the same
// guarantee npm gives a package, from a different shelf. A surfpool already on
// the PATH is used when the pinned one cannot be had.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { findSurfpool } from './chain';
import { SIMULATOR_DIR } from './people';

/** The release the simulator runs. Bumped with `npm run pin-surfpool -- <version>`, which rewrites the builds below. */
export const SURFPOOL_VERSION = '1.6.0';
const RELEASES = 'https://github.com/solana-foundation/surfpool/releases/download';

export interface SurfpoolBuild {
  asset: string;
  sha256: string;
}

// BUILDS START (written by scripts/pin-surfpool.mjs)
export const SURFPOOL_BUILDS: Record<string, SurfpoolBuild> = {
  'darwin-arm64': { asset: 'surfpool-darwin-arm64.tar.gz', sha256: 'a890db2b1a0c77340a4cf90c9cfb7b2d30fbeb538120ad20c707426852b18c2d' },
  'darwin-x64': { asset: 'surfpool-darwin-x64.tar.gz', sha256: '0861dd1c5be216d4ead2bb3a328eb5ea4d180385a9d10ba6c3cf289045d12b62' },
  'linux-x64': { asset: 'surfpool-linux-x64.tar.gz', sha256: 'cb471b00aa3b7d603338eb74ebfec1d23959ecba005b5f1be42ba8d174107fc2' },
  'win32-x64': { asset: 'surfpool-windows-x64.tar.gz', sha256: '1aef78d41d4d591ca8458a5ddea20070979236d317beda1fbd9a814713988dea' },
};
// BUILDS END

export const SURFPOOL_INSTALL = 'curl -sL https://run.surfpool.run/ | bash';

/** The build for a machine, or null when none is made for it. */
export function surfpoolBuild(platform: NodeJS.Platform = process.platform, arch: string = process.arch): SurfpoolBuild | null {
  return SURFPOOL_BUILDS[`${platform}-${arch}`] ?? null;
}

const binaryName = (platform: NodeJS.Platform) => (platform === 'win32' ? 'surfpool.exe' : 'surfpool');

/** Where the pinned node lives once fetched. */
export function surfpoolPath(dir = SIMULATOR_DIR, version = SURFPOOL_VERSION, platform: NodeJS.Platform = process.platform): string {
  return join(dir, 'surfpool', version, binaryName(platform));
}

/** The pinned node, when it is already here. */
export function cachedSurfpool(dir = SIMULATOR_DIR): string | null {
  const path = surfpoolPath(dir);
  return existsSync(path) ? path : null;
}

export interface FetchOptions {
  dir?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  fetchImpl?: typeof fetch;
  /** Where the asset comes from; the pinned release unless a test says otherwise. */
  from?: string;
  /** Told the download's progress, as a fraction, and the whole size in bytes. */
  progress?: (fraction: number, bytes: number) => void;
}

/**
 * Fetches the pinned node for this machine, checks it against its SHA-256,
 * unpacks it, and resolves with where it is. A download that does not match
 * is thrown away. The asset is a tar.gz with the one binary in it; the
 * system's tar unpacks it, on every platform the node is built for.
 */
export async function fetchSurfpool(options: FetchOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform;
  const build = surfpoolBuild(platform, options.arch ?? process.arch);
  if (!build) throw new Error(`surfpool ${SURFPOOL_VERSION} is not built for ${platform}-${options.arch ?? process.arch}.`);
  if (!build.sha256) throw new Error(`surfpool ${SURFPOOL_VERSION} has no checksum pinned for ${platform}-${options.arch ?? process.arch}.`);
  const dir = options.dir ?? SIMULATOR_DIR;
  const home = join(dir, 'surfpool', SURFPOOL_VERSION);
  const binary = surfpoolPath(dir, SURFPOOL_VERSION, platform);
  if (existsSync(binary)) return binary;
  mkdirSync(home, { recursive: true });

  const url = `${options.from ?? `${RELEASES}/v${SURFPOOL_VERSION}`}/${build.asset}`;
  const archive = join(home, `${build.asset}.${process.pid}.part`);
  const response = await (options.fetchImpl ?? fetch)(url);
  if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`);
  const total = Number(response.headers.get('content-length') ?? 0);
  const hash = createHash('sha256');
  let seen = 0;
  try {
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      async function* (chunks) {
        for await (const chunk of chunks) {
          const bytes = chunk as Uint8Array;
          hash.update(bytes);
          seen += bytes.length;
          if (total > 0) options.progress?.(Math.min(1, seen / total), total);
          yield bytes;
        }
      },
      createWriteStream(archive),
    );
    const digest = hash.digest('hex');
    if (digest !== build.sha256) {
      throw new Error(`${build.asset} did not match its pinned checksum (${digest.slice(0, 12)}… instead of ${build.sha256.slice(0, 12)}…), so it was thrown away.`);
    }
    unpack(archive, home);
  } finally {
    rmSync(archive, { force: true });
  }
  // The archive holds the binary alone, named for the platform.
  const unpacked = readdirSync(home).find((name) => /^surfpool(\.exe)?$/.test(name));
  if (!unpacked) throw new Error(`${build.asset} held no surfpool binary.`);
  if (unpacked !== binaryName(platform)) renameSync(join(home, unpacked), binary);
  if (platform !== 'win32') chmodSync(binary, 0o755);
  return binary;
}

function unpack(archive: string, into: string): void {
  const result = spawnSync('tar', ['-xzf', archive, '-C', into], { stdio: 'pipe' });
  if (result.error) throw new Error(`tar could not be run to unpack the node: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`tar could not unpack the node: ${result.stderr?.toString().trim() || `exit ${result.status}`}`);
}

export interface Located {
  path: string;
  version: string;
  /** Where it came from: already fetched, fetched now, or the machine's own. */
  from: 'cache' | 'download' | 'path';
}

export interface LocateOptions extends FetchOptions {
  /** Where a word about the fetch goes: nowhere unless given. */
  log?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
}

/**
 * The node to run: the pinned one if it is here, fetched if it is not, and
 * failing that whatever surfpool the machine has. Null when there is none.
 */
export async function locateSurfpool(options: LocateOptions = {}): Promise<Located | null> {
  const cached = cachedSurfpool(options.dir);
  if (cached) return { path: cached, version: SURFPOOL_VERSION, from: 'cache' };
  const own = findSurfpool(options.env);
  try {
    const progress = options.progress ?? fetchProgress(options.log);
    const path = await fetchSurfpool({ ...options, ...(progress ? { progress } : {}) });
    return { path, version: SURFPOOL_VERSION, from: 'download' };
  } catch (error) {
    options.log?.(`The local chain could not be fetched: ${error instanceof Error ? error.message : String(error)}`);
    if (own) {
      options.log?.(`Using the surfpool on this computer instead.`);
      return { path: own, version: versionOf(own), from: 'path' };
    }
    return null;
  }
}

/** A progress line in the terminal: redrawn in place on a TTY, said at each quarter otherwise. */
export function fetchProgress(log?: (line: string) => void): ((fraction: number, bytes: number) => void) | undefined {
  if (!log) return undefined;
  let last = -1;
  return (fraction, bytes) => {
    const percent = Math.floor(fraction * 100);
    const megabytes = (bytes / 1_048_576).toFixed(0);
    if (process.stdout.isTTY) {
      if (percent === last) return;
      last = percent;
      const filled = Math.round(fraction * 20);
      process.stdout.write(`\r  Getting the local chain (surfpool ${SURFPOOL_VERSION}, ${megabytes} MB) ${'█'.repeat(filled)}${'░'.repeat(20 - filled)} ${String(percent).padStart(3)}%${percent === 100 ? '\n' : ''}`);
    } else if (Math.floor(percent / 25) > Math.floor(last / 25) || last === -1) {
      last = percent;
      log(`Getting the local chain (surfpool ${SURFPOOL_VERSION}, ${megabytes} MB)… ${percent}%`);
    }
  };
}

/** What a surfpool binary says it is, or "unknown" when it will not say. */
export function versionOf(binary: string): string {
  const result = spawnSync(binary, ['--version'], { stdio: 'pipe', timeout: 5_000 });
  const said = result.stdout?.toString().trim() ?? '';
  return /(\d+\.\d+\.\d+)/.exec(said)?.[1] ?? 'unknown';
}
