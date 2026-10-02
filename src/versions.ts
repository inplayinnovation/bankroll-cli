// What the simulator's sidebar says about versions: which SDK the app in the
// phone runs, which CLI serves the simulator, and three things worth saying of
// either.
//
//   behind   a later release is published
//   stale    node_modules does not hold what the project asks for: what a
//            `git pull` with no install after it leaves behind
//   local    a build of someone's own, not a published one, as
//            `npm run dogfood` arranges
//
// The page knows little of this by itself. The app tells it which SDK it runs
// (init() says so, from SDK 0.33.0), and it asks here for the rest: this
// command runs in the app's folder, so it can read what is installed there,
// and it can ask the registry what is published.
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isNewer, latestVersion } from './update';

const SDK = '@joinbankroll/sdk';
const CLI = '@joinbankroll/cli';
// What `npm run dogfood` leaves in the SDK build it copies into an app
// (scripts/dogfood.mjs).
const DOGFOOD_MARKER = '.dogfood';
// The registry is asked once in a while, not at every glance: the page asks
// here each time its window comes back to the front.
const LATEST_KEPT_MS = 10 * 60_000;

/** One package, as the sidebar shows it. */
export interface PackageReport {
  /** The version to show. For the SDK: what the app says it runs, or else what is installed. */
  version?: string;
  /** The latest published release, when the registry could be asked. */
  latest?: string;
  /** A later release than `version` is published. Never said of a local build. */
  behind: boolean;
  /** A build of someone's own, not a published one. */
  local: boolean;
}

export interface SdkReport extends PackageReport {
  /** What node_modules holds, in the folder of the app this command runs. */
  installed?: string;
  /** What that app's package.json asks for. */
  wanted?: string;
  /** What its lockfile settles on. */
  locked?: string;
  /** What is installed is not what the project asks for. */
  stale: boolean;
}

export interface VersionReport {
  cli: PackageReport;
  /** Absent when no app is open: there is no SDK to speak of. */
  sdk?: SdkReport;
}

type Folder = Pick<SdkReport, 'installed' | 'wanted' | 'locked' | 'local'>;

function readJson(file: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

const entry = (record: unknown, key: string): unknown => (typeof record === 'object' && record !== null ? (record as Record<string, unknown>)[key] : undefined);

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/** What a project's folder holds of the SDK: what it asks for, what its lockfile settles on, and what is installed. */
export function sdkIn(dir: string): Folder {
  const manifest = readJson(join(dir, 'package.json'));
  const wanted = text(entry(manifest?.dependencies, SDK)) ?? text(entry(manifest?.devDependencies, SDK));
  const locked = text(entry(entry(readJson(join(dir, 'package-lock.json'))?.packages, `node_modules/${SDK}`), 'version'));
  const home = join(dir, 'node_modules', SDK);
  const installed = text(readJson(join(home, 'package.json'))?.version);
  return {
    ...(installed ? { installed } : {}),
    ...(wanted ? { wanted } : {}),
    ...(locked ? { locked } : {}),
    // Linked in from a checkout, or copied in from one by dogfood.
    local: isLink(home) || existsSync(join(home, 'dist', DOGFOOD_MARKER)),
  };
}

const numbers = (version: string) => version.split('-')[0]!.split('.').map(Number);

/**
 * Whether a version is one a range asks for, for the ranges npm writes by
 * itself: an exact version, `^` and `~`. Undefined for anything else (a tag, a
 * path, a URL), which is not judged.
 */
export function satisfies(version: string, range: string): boolean | undefined {
  const match = /^([\^~]?)(\d+\.\d+\.\d+)/.exec(range.trim());
  if (!match) return undefined;
  const [have, want] = [numbers(version), numbers(match[2]!)];
  if (have.length !== 3 || [...have, ...want].some(Number.isNaN)) return undefined;
  const [major, minor, patch] = have as [number, number, number];
  const [wantMajor, wantMinor, wantPatch] = want as [number, number, number];
  const atLeast = major !== wantMajor ? major > wantMajor : minor !== wantMinor ? minor > wantMinor : patch >= wantPatch;
  if (match[1] === '') return major === wantMajor && minor === wantMinor && patch === wantPatch;
  if (match[1] === '~') return atLeast && major === wantMajor && minor === wantMinor;
  // A caret keeps the first part that is not zero: before 1.0 that is the minor.
  if (wantMajor > 0) return atLeast && major === wantMajor;
  if (wantMinor > 0) return atLeast && major === 0 && minor === wantMinor;
  return major === 0 && minor === 0 && patch === wantPatch;
}

/** What is installed is not what the project asks for. A local build is there on purpose, and is never stale. */
function isStale({ installed, wanted, locked, local }: Folder): boolean {
  if (local || (!wanted && !locked)) return false;
  if (!installed) return true;
  if (locked) return installed !== locked;
  return wanted ? satisfies(installed, wanted) === false : false;
}

/** True when this CLI runs from a checkout of its repo: the published package has no source beside its build. */
export function cliIsLocal(): boolean {
  return existsSync(join(dirname(dirname(fileURLToPath(import.meta.url))), 'src', 'index.ts'));
}

/** The registry, asked once in a while: an answer is kept, a silence is not. */
export function remembering(lookup: (name: string) => Promise<string | undefined>, keptMs = LATEST_KEPT_MS): (name: string) => Promise<string | undefined> {
  const kept = new Map<string, { at: number; version: string }>();
  return async (name) => {
    const known = kept.get(name);
    if (known && Date.now() - known.at < keptMs) return known.version;
    const version = await lookup(name);
    if (version) kept.set(name, { at: Date.now(), version });
    return version;
  };
}

export interface About {
  /** This CLI's version. */
  cli: string;
  /** The folder of the app this command runs. */
  dir: string;
  /** Whether this CLI runs from a checkout. Worked out when not given. */
  local?: boolean;
  /** The latest published release of a package, or undefined when it cannot be asked. */
  latest?: (name: string) => Promise<string | undefined>;
}

export interface Asked {
  /** An app is open in the phone. */
  open: boolean;
  /** It is the app this command runs, so its folder is the one to read. */
  own: boolean;
  /** The SDK version the app says it runs. */
  reported?: string;
}

const latestRelease = remembering((name) => latestVersion(name));

function packageReport(version: string | undefined, latest: string | undefined, local: boolean): PackageReport {
  return {
    ...(version ? { version } : {}),
    ...(latest ? { latest } : {}),
    behind: !local && version !== undefined && latest !== undefined && isNewer(latest, version),
    local,
  };
}

/** What the sidebar shows: this CLI, and the SDK of the app in the phone. Never rejects. */
export async function versionReport(about: About, asked: Asked): Promise<VersionReport> {
  const latest = about.latest ?? latestRelease;
  const [cliLatest, sdkLatest] = await Promise.all([latest(CLI), asked.open ? latest(SDK) : undefined]);
  const cli = packageReport(about.cli, cliLatest, about.local ?? cliIsLocal());
  if (!asked.open) return { cli };

  // An app opened by its address alone is known only by what it says of itself.
  const folder: Folder = asked.own ? sdkIn(about.dir) : { local: false };
  return {
    cli,
    sdk: {
      ...packageReport(asked.reported ?? folder.installed, sdkLatest, folder.local),
      ...(folder.installed ? { installed: folder.installed } : {}),
      ...(folder.wanted ? { wanted: folder.wanted } : {}),
      ...(folder.locked ? { locked: folder.locked } : {}),
      stale: isStale(folder),
    },
  };
}
