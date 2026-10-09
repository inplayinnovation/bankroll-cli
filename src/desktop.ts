// Bankroll Desktop, from the command line. `bankroll dev` opens the app in it:
// it runs the app on this Mac the way the Bankroll app runs it on a phone, as
// a test user with test cash, with every call the app makes listed beside it.
// Bankroll Desktop runs the app's dev server itself, so its logs and its env
// are in one place; this command hands it the folder and says where the app
// came up, as `unity open` hands a project to the Editor.
//
// Two things join the two. The `bankroll://open?project=<folder>` link, which
// macOS delivers to the running Bankroll Desktop or launches it with. And the
// state file Bankroll Desktop writes while it runs (`src/shared/state.ts` in
// the bankroll monorepo's `desktop/`), which says what it is doing.
import { createHash } from 'node:crypto';
import { accessSync, constants, createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { run, type Runner } from './sessionStore';

export const BUNDLE_ID = 'com.joinbankroll.desktop';
/** Where a Mac keeps Bankroll Desktop's data, and so its state file. */
export const STATE_PATH = join(homedir(), 'Library', 'Application Support', 'Bankroll', 'state.json');
/** The feed an installed Bankroll Desktop updates from; `latest-mac.yml` there names the current build. */
export const FEED_URL = 'https://downloads.joinbankroll.com/stable';
/** The first Bankroll Desktop that answers links and writes the state file. */
export const FIRST_VERSION_WITH_LINKS = '0.1.6';

const POLL_MS = 250;
/** Bankroll Desktop gives a dev server 90 seconds to answer; this waits a little past that. */
const DEFAULT_TIMEOUT_MS = 100_000;

/** The project's dev server, as the state file reports it. */
export type ProjectState =
  | { state: 'idle' }
  | { state: 'starting'; dir: string; port: number }
  | { state: 'ready'; dir: string; port: number; url: string }
  | { state: 'stopped'; dir: string; reason: string };

/** The parts of the state file read here. */
export interface DesktopState {
  version: string;
  pid: number;
  project: ProjectState;
}

/** The link that opens a folder in Bankroll Desktop, as Open Project does. */
export function openLink(dir: string): string {
  return `bankroll://open?project=${encodeURIComponent(dir)}`;
}

/** Whether a process with this pid exists. A pid we may not signal still exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isState(value: unknown): value is DesktopState {
  if (!isRecord(value) || typeof value.version !== 'string' || typeof value.pid !== 'number') return false;
  const project = value.project;
  if (!isRecord(project) || typeof project.state !== 'string') return false;
  switch (project.state) {
    case 'idle':
      return true;
    case 'starting':
      return typeof project.dir === 'string' && typeof project.port === 'number';
    case 'ready':
      return typeof project.dir === 'string' && typeof project.port === 'number' && typeof project.url === 'string';
    case 'stopped':
      return typeof project.dir === 'string' && typeof project.reason === 'string';
    default:
      return false;
  }
}

/** What a running Bankroll Desktop is doing, or null: no file, one that cannot be read, or one a crash left behind. */
export function readState(path = STATE_PATH, alive: (pid: number) => boolean = isAlive): DesktopState | null {
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  return isState(parsed) && alive(parsed.pid) ? parsed : null;
}

export type Opened = 'opened' | 'missing';

/** The app's name on disk, and where macOS looks for apps: everyone's folder, then this user's. */
export const APP_NAME = 'Bankroll.app';
export const APPLICATIONS = ['/Applications', join(homedir(), 'Applications')];

/**
 * Hands the link to Bankroll Desktop through macOS: `opened`, or `missing`
 * when no Bankroll Desktop is installed. By its bundle id, which macOS
 * resolves to wherever the app is; or by path, for one just installed that
 * macOS has not met yet, which the launch introduces.
 */
export function open(href: string, options: { app?: string; runner?: Runner } = {}): Opened {
  const runner = options.runner ?? run;
  const result = runner('open', options.app ? ['-a', options.app, href] : ['-b', BUNDLE_ID, href]);
  if (result.status === 0) return 'opened';
  // The one failure that is ours to handle, in the words `open` has for it (macOS 26: the first; earlier: the second).
  if (/LSCopyApplicationURLsForBundleIdentifier\(\) failed|unable to find application/i.test(result.stderr)) return 'missing';
  throw new Error(`Bankroll Desktop could not be opened: ${result.stderr.trim() || `open exited with ${result.status}`}`);
}

export interface WaitOptions {
  path?: string;
  timeoutMs?: number;
  alive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Waits for Bankroll Desktop to have the folder's dev server up: the app's
 * address, or why there is none. A Bankroll Desktop that never writes the
 * state file is one from before links; the message says so.
 */
export async function waitForProject(dir: string, options: WaitOptions = {}): Promise<{ url: string } | { problem: string }> {
  const { path = STATE_PATH, timeoutMs = DEFAULT_TIMEOUT_MS, alive = isAlive, sleep = pause, now = Date.now } = options;
  const deadline = now() + timeoutMs;
  let answered = false;
  do {
    const state = readState(path, alive);
    if (state) {
      answered = true;
      const project = state.project;
      if (project.state === 'ready' && project.dir === dir) return { url: project.url };
      if (project.state === 'stopped' && project.dir === dir) return { problem: `Bankroll Desktop could not keep the app's server up: ${project.reason}. Its Server tab says more.` };
    }
    await sleep(POLL_MS);
  } while (now() < deadline);
  return {
    problem: answered
      ? `Bankroll Desktop has not got the app's server up in ${Math.round(timeoutMs / 1000)} seconds. Its Server tab says why.`
      : `Bankroll Desktop opened but did not answer. One older than ${FIRST_VERSION_WITH_LINKS} cannot take a link: in it, Bankroll ▸ Check for Updates…, then try again.`,
  };
}

/** The current build on the feed, for one kind of Mac. */
export interface Build {
  version: string;
  /** The zip's name on the feed. */
  file: string;
  /** Base64, as electron-builder writes it. */
  sha512: string;
  size: number;
}

/**
 * The feed's `latest-mac.yml`, as electron-builder writes it: a version, then
 * the files with their sizes and SHA-512s. Only those lines are read, so no
 * YAML library is needed for them.
 */
export function parseFeed(text: string, arch: string = process.arch): Build {
  let version: string | null = null;
  const files: { url?: string; sha512?: string; size?: number }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const versionMatch = /^version:\s*'?([^']+?)'?$/.exec(line);
    if (versionMatch && !raw.startsWith(' ')) version = versionMatch[1]!;
    else if (line.startsWith('- url:')) files.push({ url: line.slice('- url:'.length).trim() });
    else if (line.startsWith('sha512:') && files.length > 0 && raw.startsWith(' ')) files[files.length - 1]!.sha512 = line.slice('sha512:'.length).trim();
    else if (line.startsWith('size:') && files.length > 0) files[files.length - 1]!.size = Number(line.slice('size:'.length).trim());
  }
  if (!version) throw new Error('the feed names no version');
  const zip = files.find((file) => file.url?.endsWith(`-${arch}.zip`));
  if (!zip?.url || !zip.sha512 || !zip.size) throw new Error(`the feed has no build of Bankroll Desktop ${version} for ${arch}`);
  return { version, file: zip.url, sha512: zip.sha512, size: zip.size };
}

/** Where Bankroll Desktop is already on disk, if macOS has just not met it: the first application folder holding it. */
export function installedApp(folders: string[] = APPLICATIONS): string | null {
  return folders.map((folder) => join(folder, APP_NAME)).find((path) => existsSync(path)) ?? null;
}

/** The first application folder this user can write to; everyone's when they may, their own otherwise. */
export function applicationFolder(folders: string[] = APPLICATIONS): string {
  for (const folder of folders) {
    try {
      if (!existsSync(folder)) mkdirSync(folder, { recursive: true });
      accessSync(folder, constants.W_OK);
      return folder;
    } catch {
      // The next one.
    }
  }
  throw new Error(`none of ${folders.join(', ')} can be written to`);
}

export interface FetchOptions {
  feedUrl?: string;
  arch?: string;
  fetchImpl?: typeof fetch;
  runner?: Runner;
  /** Where the app goes: the first writable application folder unless given. */
  into?: string;
  /** Told the download's progress, as a fraction, the whole size in bytes, and the version coming. */
  progress?: (fraction: number, bytes: number, version: string) => void;
}

/**
 * Fetches the current Bankroll Desktop from the feed, checks it against the
 * SHA-512 the feed states, and unpacks it into an application folder, as the
 * installed app's own updater would. Resolves with the app's path and
 * version. A download that does not match is thrown away. The zip is
 * electron-builder's, with the app at its root; `ditto` unpacks it as macOS
 * does, keeping the signature whole.
 */
export async function fetchDesktop(options: FetchOptions = {}): Promise<{ path: string; version: string }> {
  const feedUrl = options.feedUrl ?? FEED_URL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const feed = await fetchImpl(`${feedUrl}/latest-mac.yml`);
  if (!feed.ok) throw new Error(`${feedUrl}/latest-mac.yml answered ${feed.status}`);
  const build = parseFeed(await feed.text(), options.arch);
  const folder = options.into ?? applicationFolder();
  const destination = join(folder, APP_NAME);
  if (existsSync(destination)) throw new Error(`${destination} is already there`);

  const scratch = mkdtempSync(join(tmpdir(), 'bankroll-desktop-'));
  const archive = join(scratch, build.file);
  try {
    const response = await fetchImpl(`${feedUrl}/${build.file}`);
    if (!response.ok || !response.body) throw new Error(`${feedUrl}/${build.file} answered ${response.status}`);
    const hash = createHash('sha512');
    let seen = 0;
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      async function* (chunks) {
        for await (const chunk of chunks) {
          const bytes = chunk as Uint8Array;
          hash.update(bytes);
          seen += bytes.length;
          options.progress?.(Math.min(1, seen / build.size), build.size, build.version);
          yield bytes;
        }
      },
      createWriteStream(archive),
    );
    const digest = hash.digest('base64');
    if (digest !== build.sha512)
      throw new Error(`${build.file} did not match the checksum the feed states (${digest.slice(0, 12)}… instead of ${build.sha512.slice(0, 12)}…), so it was thrown away.`);
    const unpacked = (options.runner ?? run)('ditto', ['-x', '-k', archive, folder]);
    if (unpacked.missing) throw new Error('ditto, which unpacks the app, is not on this computer');
    if (unpacked.status !== 0) throw new Error(`the app could not be unpacked into ${folder}: ${unpacked.stderr.trim() || `ditto exited with ${unpacked.status}`}`);
    if (!existsSync(destination)) throw new Error(`${build.file} held no ${APP_NAME}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return { path: destination, version: build.version };
}

/** A progress line in the terminal: redrawn in place on a TTY, said at each quarter otherwise. */
export function fetchProgress(log: (line: string) => void): (fraction: number, bytes: number, version: string) => void {
  let last = -1;
  return (fraction, bytes, version) => {
    const percent = Math.floor(fraction * 100);
    const megabytes = (bytes / 1_048_576).toFixed(0);
    if (process.stdout.isTTY) {
      if (percent === last) return;
      last = percent;
      const filled = Math.round(fraction * 20);
      process.stdout.write(`\r  Getting Bankroll Desktop ${version} (${megabytes} MB) ${'█'.repeat(filled)}${'░'.repeat(20 - filled)} ${String(percent).padStart(3)}%${percent === 100 ? '\n' : ''}`);
    } else if (Math.floor(percent / 25) > Math.floor(last / 25) || last === -1) {
      last = percent;
      log(`Getting Bankroll Desktop ${version} (${megabytes} MB)… ${percent}%`);
    }
  };
}
