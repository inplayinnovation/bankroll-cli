import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BUNDLE_ID, open, openLink, readState, waitForProject, type DesktopState } from '../src/desktop';
import type { Runner } from '../src/sessionStore';

const DIR = '/Users/sam/Projects/free-throw-duel';
const ready: DesktopState = { version: '0.1.6', pid: 4242, project: { state: 'ready', dir: DIR, port: 3000, url: 'http://localhost:3000/app' } };
const alive = () => true;
const dead = () => false;

const scratch: string[] = [];
const stateFile = (content: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'bankroll-cli-'));
  scratch.push(dir);
  const path = join(dir, 'state.json');
  writeFileSync(path, content);
  return path;
};
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('openLink', () => {
  it('carries the folder, encoded', () => {
    expect(openLink('/Users/sam/My Apps/duel')).toBe('bankroll://open?project=%2FUsers%2Fsam%2FMy%20Apps%2Fduel');
  });
});

describe('readState', () => {
  it('reads what a running Bankroll Desktop wrote', () => {
    expect(readState(stateFile(JSON.stringify(ready)), alive)).toEqual(ready);
  });

  it('is null with no file, a file that is not the state, or one a crash left behind', () => {
    expect(readState('/nowhere/state.json', alive)).toBeNull();
    expect(readState(stateFile('{not json'), alive)).toBeNull();
    expect(readState(stateFile(JSON.stringify({ version: '0.1.6' })), alive)).toBeNull();
    expect(readState(stateFile(JSON.stringify({ ...ready, project: { state: 'ready', dir: DIR } })), alive)).toBeNull();
    expect(readState(stateFile(JSON.stringify(ready)), dead)).toBeNull();
  });
});

describe('open', () => {
  const scripted = (result: { status: number; stderr?: string }) => {
    const calls: { command: string; args: string[] }[] = [];
    const runner: Runner = (command, args) => {
      calls.push({ command, args });
      return { status: result.status, stdout: '', stderr: result.stderr ?? '', missing: false };
    };
    return { calls, runner };
  };

  it('hands the link to Bankroll Desktop by its bundle id', () => {
    const { calls, runner } = scripted({ status: 0 });
    expect(open('bankroll://open?project=%2Fx', runner)).toBe('opened');
    expect(calls).toEqual([{ command: 'open', args: ['-b', BUNDLE_ID, 'bankroll://open?project=%2Fx'] }]);
  });

  it('says when no Bankroll Desktop is installed, and throws on anything else', () => {
    expect(open('bankroll://open', scripted({ status: 1, stderr: `LSCopyApplicationURLsForBundleIdentifier() failed while trying to determine the application with bundle identifier ${BUNDLE_ID}.` }).runner)).toBe('missing');
    expect(open('bankroll://open', scripted({ status: 1, stderr: `Unable to find application with bundle identifier '${BUNDLE_ID}'` }).runner)).toBe('missing');
    expect(() => open('bankroll://open', scripted({ status: 1, stderr: 'LSOpenURLsWithRole() failed' }).runner)).toThrow('LSOpenURLsWithRole() failed');
  });
});

describe('waitForProject', () => {
  // Time is a counter the fake sleep moves, so the wait runs in no time at all.
  const clock = () => {
    let at = 0;
    return { now: () => at, sleep: async (ms: number) => void (at += ms) };
  };

  it("gives the app's address once the folder's server is up", async () => {
    expect(await waitForProject(DIR, { path: stateFile(JSON.stringify(ready)), alive, ...clock() })).toEqual({ url: 'http://localhost:3000/app' });
  });

  it("says why when the folder's server stopped", async () => {
    const stopped = { ...ready, project: { state: 'stopped', dir: DIR, reason: 'exited with code 1' } };
    const result = await waitForProject(DIR, { path: stateFile(JSON.stringify(stopped)), alive, ...clock() });
    expect(result).toEqual({ problem: expect.stringContaining('exited with code 1') });
  });

  it('keeps waiting while another folder, or nothing, is open, then gives up', async () => {
    const other = { ...ready, project: { ...ready.project, dir: '/elsewhere' } };
    const result = await waitForProject(DIR, { path: stateFile(JSON.stringify(other)), alive, timeoutMs: 1_000, ...clock() });
    expect(result).toEqual({ problem: expect.stringContaining('has not got the app') });
  });

  it('tells an older Bankroll Desktop, which writes no state file, from a slow one', async () => {
    const result = await waitForProject(DIR, { path: '/nowhere/state.json', alive, timeoutMs: 1_000, ...clock() });
    expect(result).toEqual({ problem: expect.stringContaining('Check for Updates') });
  });
});
