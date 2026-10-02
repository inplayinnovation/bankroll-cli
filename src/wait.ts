// `bankroll wait test|live` — watch the build a push started, then print
// where that version is. Git is the interface: `git push bankroll main`
// builds the test version and `git push bankroll main:live` publishes it.
// This command only observes.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { graphql } from './api';
import { playUrl, resolveEnvironment } from './environments';
import type { AccountOptions } from './login';
import { launchPath } from './manifest';
import { printQr } from './qr';
import { CREDENTIAL_COMMAND, DECLARATION_FILE, REMOTE } from './repo';
import { sessionLocation } from './session';

export type Target = 'test' | 'live';
export const TARGETS: readonly Target[] = ['test', 'live'];

const POLL_MS = 3_000;
// Bankroll's push webhook makes the run a few seconds after a push lands. A
// push that is still not a run after this long did not reach Bankroll.
const PICKUP_MS = 2 * 60 * 1000;
// A build must finish inside an hour; a run still going past that is dead,
// and nothing on the server ends it.
const MAX_WAIT_MS = 60 * 60 * 1000;
const MS_PER_SECOND = 1000;
const UNNAMED = 'Unnamed app';
// The branch each version builds from.
const BRANCHES: Record<Target, string> = { test: 'main', live: 'live' };
// A run's status, as the word a person reads while it goes.
const PROGRESS_WORDS: Record<string, string> = { pushed: 'building', running: 'running', starting: 'starting' };
const FINISHED = new Set(['done', 'error', 'live']);
const FAILED = 'error';
const BUILT = 'live';

const APP_QUERY = `query Wait($id: ID!) {
  builderApp(id: $id) {
    id name
    test { commit url latestRun { commit status error startedAt finishedAt } }
    live { commit url latestRun { commit status error startedAt finishedAt } }
  }
}`;

export interface RunRow {
  commit: string | null;
  status: string;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface VersionRow {
  commit: string | null;
  url: string;
  latestRun: RunRow | null;
}

export interface WaitApp {
  id: string;
  name: string | null;
  test: VersionRow;
  live: VersionRow;
}

export interface WaitOptions extends AccountOptions {
  /** The app, by id, from outside a clone. */
  app?: string;
}

/** The app a clone belongs to, from the credential helper `apps clone` wired in. */
export function appIdFromConfig(gitConfig: string): string | null {
  const match = gitConfig.match(new RegExp(`${CREDENTIAL_COMMAND} (\\S+)\\s*$`, 'm'));
  return match ? match[1]! : null;
}

export function progressWord(status: string): string {
  return PROGRESS_WORDS[status] ?? status;
}

/** The line that ends the wait: how the build came out, and how long it took. */
export function outcomeLine(target: Target, run: RunRow, elapsedMs: number): string {
  if (run.status === FAILED) return `failed: ${run.error ?? 'no reason was recorded'}`;
  const started = run.startedAt ? Date.parse(run.startedAt) : NaN;
  const finished = run.finishedAt ? Date.parse(run.finishedAt) : NaN;
  const ms = Number.isNaN(started) || Number.isNaN(finished) ? elapsedMs : finished - started;
  const seconds = Math.max(1, Math.round(ms / MS_PER_SECOND));
  const outcome = run.status === BUILT ? (target === 'test' ? 'ready' : 'live') : run.status;
  return `${outcome} in ${seconds} s.`;
}

/** What test holds that live does not. */
export function aheadLine(test: VersionRow, live: VersionRow, ahead: number | null): string {
  if (!live.commit) return `Nothing is live yet. \`git push ${REMOTE} main:live\` publishes it.`;
  if (test.commit === live.commit) return 'Test is what live serves.';
  if (ahead === null) return 'Test is ahead of live.';
  return `Test is ${ahead} ${ahead === 1 ? 'commit' : 'commits'} ahead of live.`;
}

// Read-only git, in the clone this runs in. Nothing here pushes or rewires.
const git = (args: string[]): string | null => {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : null;
};

/** The name the clone declares, for an app whose first build has not signed one yet. */
const declaredNameHere = (): string | null => {
  try {
    const declared: unknown = JSON.parse(readFileSync(DECLARATION_FILE, 'utf8'));
    const name = (declared as { name?: unknown })?.name;
    return typeof name === 'string' && name.trim() !== '' ? name.trim() : null;
  } catch {
    return null;
  }
};

const appIdHere = (): string | null => {
  const config = git(['config', '--get-regexp', '^credential\\..*\\.helper$']);
  return config === null ? null : appIdFromConfig(config);
};

/** What this clone last pushed to the version's branch, when git knows it. */
const pushedCommit = (target: Target): string | null =>
  git(['rev-parse', '--verify', '--quiet', `refs/remotes/${REMOTE}/${BRANCHES[target]}`])?.trim() || null;

/** How many commits test is ahead of live, when this clone has both. */
const commitsAhead = (live: string, test: string): number | null => {
  const count = git(['rev-list', '--count', `${live}..${test}`])?.trim();
  return count ? Number(count) : null;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const nothingYet = (target: Target): string =>
  target === 'test'
    ? `nothing built yet. \`git push ${REMOTE} main\` builds it.`
    : `nothing live yet. \`git push ${REMOTE} main:live\` publishes the test version.`;

export async function wait(version: string, options: WaitOptions): Promise<void> {
  if (!TARGETS.includes(version as Target)) throw new Error(`"${version}" is not a version. Use test or live.`);
  const target = version as Target;
  const inClone = options.app === undefined;
  const id = options.app ?? appIdHere();
  if (!id) {
    throw new Error('Not an app clone. Run this inside a clone from `bankroll apps clone`, or pass --app <id>.');
  }
  const environment = resolveEnvironment(options.env);
  const location = sessionLocation(environment);
  // What this clone pushed. The run for it may not exist yet: the webhook
  // needs a few seconds, and the previous build must not pass for this one.
  const expected = inClone ? pushedCommit(target) : null;
  const declaredName = inClone ? declaredNameHere() : null;
  const startedWaiting = Date.now();
  let shown: 'nothing' | 'pickup' | 'run' = 'nothing';
  let lastWord = '';

  let app: WaitApp;
  let run: RunRow | null;
  for (;;) {
    const data = await graphql<{ builderApp: WaitApp | null }>(location, APP_QUERY, { id });
    if (!data.builderApp) throw new Error(`No app ${id}.`);
    app = data.builderApp;
    const row = app[target];
    run = row.latestRun;
    const label = `${app.name ?? declaredName ?? UNNAMED}, ${target}`;
    const elapsed = Date.now() - startedWaiting;

    if (expected !== null && run?.commit !== expected && row.commit !== expected) {
      if (elapsed > PICKUP_MS) {
        throw new Error(`No build for ${expected} after 2 min. Did the push reach the ${REMOTE} remote?`);
      }
      process.stdout.write(shown === 'pickup' ? '.' : `\n  ${label}: waiting for Bankroll to pick up ${expected}`);
      shown = 'pickup';
      await sleep(POLL_MS);
      continue;
    }
    if (!run) {
      console.log(`\n  ${label}: ${nothingYet(target)}\n`);
      return;
    }

    const finished = FINISHED.has(run.status);
    // The last result, when nothing was in progress, is one line: the outcome
    // names the commit itself.
    if (shown !== 'run') {
      const word = finished ? '' : ` ${progressWord(run.status)}`;
      process.stdout.write(`\n  ${label}:${word}${run.commit ? ` ${run.commit}` : ''}`);
      shown = 'run';
    } else if (finished) {
      // Nothing: the outcome follows.
    } else if (progressWord(run.status) !== lastWord) {
      process.stdout.write(` ${progressWord(run.status)}`);
    } else {
      process.stdout.write('.');
    }
    lastWord = progressWord(run.status);

    if (finished) {
      process.stdout.write(` ${outcomeLine(target, run, elapsed)}\n`);
      break;
    }
    if (elapsed > MAX_WAIT_MS) {
      throw new Error(`Still ${lastWord} after 60 min. The build is stuck; Bankroll has the run.`);
    }
    await sleep(POLL_MS);
  }

  if (run.status === FAILED) {
    process.exitCode = 1;
    console.log('');
    return;
  }
  if (target === 'test') {
    if (!app.test.commit) return;
    const ahead =
      inClone && app.live.commit && app.test.commit ? commitsAhead(app.live.commit, app.test.commit) : null;
    console.log(`  ${aheadLine(app.test, app.live, ahead)}`);
    console.log(`  Test it: ${app.test.url}\n`);
    const link = `${playUrl(environment)}?url=${encodeURIComponent(`${app.test.url}${await launchPath(app.test.url)}`)}`;
    printQr(link);
    console.log(`\n  Scan to open the test version on your phone\n  Play link: ${link}\n`);
  } else if (app.live.commit) {
    console.log(`  Live: ${app.live.url}\n`);
  }
}
