import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { APP_NAME, BUNDLE_ID, applicationFolder, fetchDesktop, installedApp, open, openLink, parseFeed, readState, waitForProject, type DesktopState } from '../src/desktop';
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

  it('hands the link to Bankroll Desktop by its bundle id, or by path for one macOS has not met', () => {
    const { calls, runner } = scripted({ status: 0 });
    expect(open('bankroll://open?project=%2Fx', { runner })).toBe('opened');
    expect(open('bankroll://open?project=%2Fx', { runner, app: '/Applications/Bankroll.app' })).toBe('opened');
    expect(calls).toEqual([
      { command: 'open', args: ['-b', BUNDLE_ID, 'bankroll://open?project=%2Fx'] },
      { command: 'open', args: ['-a', '/Applications/Bankroll.app', 'bankroll://open?project=%2Fx'] },
    ]);
  });

  it('says when no Bankroll Desktop is installed, and throws on anything else', () => {
    expect(open('bankroll://open', scripted({ status: 1, stderr: `LSCopyApplicationURLsForBundleIdentifier() failed while trying to determine the application with bundle identifier ${BUNDLE_ID}.` }))).toBe('missing');
    expect(open('bankroll://open', scripted({ status: 1, stderr: `Unable to find application with bundle identifier '${BUNDLE_ID}'` }))).toBe('missing');
    expect(() => open('bankroll://open', scripted({ status: 1, stderr: 'LSOpenURLsWithRole() failed' }))).toThrow('LSOpenURLsWithRole() failed');
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

const FEED = `version: 0.1.6
files:
  - url: Bankroll-0.1.6-x64.zip
    sha512: eVmVUhA/7PlYH0ijPuiMzM+mcH03aI4a2d3LYmgOmRUDpS0YEhQGE8rR5tVe0xRLW3m3iIB1W2Pd2VYRWfqmLA==
    size: 152770514
  - url: Bankroll-0.1.6-arm64.zip
    sha512: pFbSKDCSr3sRdYM/32J4lQxQfofZFYoOk3RV8VYmgCjYp0g7dS0BEAVrgI0FdlAn+b5NacEBeyGZ/LEU74uAmQ==
    size: 145863369
  - url: Bankroll-0.1.6-arm64.dmg
    sha512: NB3uZvCh0vNOUBlJGWs+r1vHtGe92em+gwL9tkqFn5032wMRR+gAx0j1xLFHwaRi0rRGZ1P2OGGvyP84JiTOZA==
    size: 146232071
path: Bankroll-0.1.6-x64.zip
sha512: eVmVUhA/7PlYH0ijPuiMzM+mcH03aI4a2d3LYmgOmRUDpS0YEhQGE8rR5tVe0xRLW3m3iIB1W2Pd2VYRWfqmLA==
releaseDate: '2026-10-08T20:37:09.362Z'
`;

describe('parseFeed', () => {
  it("picks the zip for this kind of Mac out of electron-builder's feed", () => {
    expect(parseFeed(FEED, 'arm64')).toEqual({
      version: '0.1.6',
      file: 'Bankroll-0.1.6-arm64.zip',
      sha512: 'pFbSKDCSr3sRdYM/32J4lQxQfofZFYoOk3RV8VYmgCjYp0g7dS0BEAVrgI0FdlAn+b5NacEBeyGZ/LEU74uAmQ==',
      size: 145863369,
    });
    expect(parseFeed(FEED, 'x64').file).toBe('Bankroll-0.1.6-x64.zip');
  });

  it('says when the feed has no build for this Mac, or no version', () => {
    expect(() => parseFeed(FEED, 'ppc')).toThrow('no build of Bankroll Desktop 0.1.6 for ppc');
    expect(() => parseFeed('files: []', 'arm64')).toThrow('names no version');
  });
});

describe('installedApp and applicationFolder', () => {
  it('finds the app in the first folder that has it, and a folder this user can write to', () => {
    const home = mkdtempSync(join(tmpdir(), 'bankroll-cli-'));
    scratch.push(home);
    const everyone = join(home, 'Applications');
    const mine = join(home, 'mine', 'Applications');
    expect(installedApp([everyone, mine])).toBeNull();
    mkdirSync(join(mine, APP_NAME), { recursive: true });
    expect(installedApp([everyone, mine])).toBe(join(mine, APP_NAME));
    expect(applicationFolder([everyone, mine])).toBe(everyone);
    expect(existsSync(everyone)).toBe(true);
  });
});

describe('fetchDesktop', () => {
  // A zip made as electron-builder makes one: the app at its root. The fake feed serves it and its true checksum.
  const packaged = (version: string) => {
    const home = mkdtempSync(join(tmpdir(), 'bankroll-cli-'));
    scratch.push(home);
    const source = join(home, 'source');
    mkdirSync(join(source, APP_NAME, 'Contents'), { recursive: true });
    writeFileSync(join(source, APP_NAME, 'Contents', 'Info.plist'), `<plist>${version}</plist>`);
    const file = `Bankroll-${version}-arm64.zip`;
    const zip = join(home, file);
    const made = spawnSync('ditto', ['-c', '-k', '--keepParent', join(source, APP_NAME), zip]);
    if (made.status !== 0) throw new Error(made.stderr.toString());
    const bytes = readFileSync(zip);
    const sha512 = createHash('sha512').update(bytes).digest('base64');
    const feed = `version: ${version}\nfiles:\n  - url: ${file}\n    sha512: ${sha512}\n    size: ${bytes.length}\n`;
    const into = join(home, 'Applications');
    mkdirSync(into);
    const serve = (feedText: string) =>
      (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/latest-mac.yml')) return new Response(feedText, { status: 200 });
        if (url.endsWith(`/${file}`)) return new Response(bytes, { status: 200 });
        return new Response('no', { status: 404 });
      }) as typeof fetch;
    return { feed, into, serve, sha512 };
  };

  it('fetches the current build, checks it, and unpacks the app into the folder', async () => {
    const { feed, into, serve } = packaged('0.1.6');
    const progress: number[] = [];
    const result = await fetchDesktop({ feedUrl: 'https://feed.test/stable', arch: 'arm64', fetchImpl: serve(feed), into, progress: (fraction: number) => progress.push(fraction) });
    expect(result).toEqual({ path: join(into, APP_NAME), version: '0.1.6' });
    expect(readFileSync(join(into, APP_NAME, 'Contents', 'Info.plist'), 'utf8')).toBe('<plist>0.1.6</plist>');
    expect(progress.at(-1)).toBe(1);
  });

  it('throws a download away when it does not match the feed, and installs nothing', async () => {
    const { feed, into, serve, sha512 } = packaged('0.1.6');
    const wrong = feed.replace(sha512, 'AAAA' + sha512.slice(4));
    await expect(fetchDesktop({ feedUrl: 'https://feed.test/stable', arch: 'arm64', fetchImpl: serve(wrong), into })).rejects.toThrow('did not match the checksum');
    expect(existsSync(join(into, APP_NAME))).toBe(false);
  });

  it('will not unpack over an app already in the folder', async () => {
    const { feed, into, serve } = packaged('0.1.6');
    mkdirSync(join(into, APP_NAME));
    await expect(fetchDesktop({ feedUrl: 'https://feed.test/stable', arch: 'arm64', fetchImpl: serve(feed), into })).rejects.toThrow('is already there');
  });
});
