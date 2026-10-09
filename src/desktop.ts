// Bankroll Desktop, from the command line. `bankroll dev` opens the app in it:
// a phone on this computer, shown to a pretend user who pays fake dollars on a
// local chain, with every call the app makes listed beside it. Bankroll
// Desktop runs the app's dev server itself, so its logs and its env are in
// one place; this command hands it the folder and says where the app came
// up, as `unity open` hands a project to the Editor.
//
// Two things join the two. The `bankroll://open?project=<folder>` link, which
// macOS delivers to the running Bankroll Desktop or launches it with. And the
// state file Bankroll Desktop writes while it runs (`src/shared/state.ts` in
// the bankroll monorepo's `desktop/`), which says what it is doing.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

/** Hands the link to Bankroll Desktop through macOS: `opened`, or `missing` when no Bankroll Desktop is installed. */
export function open(href: string, runner: Runner = run): Opened {
  const result = runner('open', ['-b', BUNDLE_ID, href]);
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
