import { describe, expect, it } from 'vitest';

import { aheadLine, appIdFromConfig, outcomeLine, progressWord, type RunRow, type VersionRow } from '../src/wait';

const COMMIT = '3f2a9c1e7d0b4c5a9e8f1b2c3d4e5f6a7b8c9d0e';
const OLDER = '9c0d2e4f6a8b1c3d5e7f9a0b2c4d6e8f0a1b3c5d';

describe('appIdFromConfig', () => {
  // What `apps clone` wires into the clone's git config, as `git config
  // --get-regexp` prints it; the environment flag may sit between.
  it('reads the app id off the credential helper, with or without an environment', () => {
    expect(appIdFromConfig('credential.https://github.com/org/br-53-x.git.helper !bankroll git-credential 53\n')).toBe('53');
    expect(appIdFromConfig('credential.https://github.com/org/br-7-y.git.helper !bankroll -e stag git-credential 7\n')).toBe('7');
  });

  it('answers null outside a clone', () => {
    expect(appIdFromConfig('')).toBeNull();
    expect(appIdFromConfig('credential.helper osxkeychain\n')).toBeNull();
  });
});

describe('progressWord', () => {
  it('reads a pushed run as building, and keeps the other words', () => {
    expect(progressWord('pushed')).toBe('building');
    expect(progressWord('running')).toBe('running');
    expect(progressWord('starting')).toBe('starting');
    expect(progressWord('something-new')).toBe('something-new');
  });
});

describe('outcomeLine', () => {
  const run: RunRow = {
    commit: COMMIT,
    status: 'live',
    error: null,
    startedAt: '2026-10-01T20:00:00.000Z',
    finishedAt: '2026-10-01T20:00:41.000Z',
  };

  it('times the build from its own clock: ready for test, live for live', () => {
    expect(outcomeLine('test', run, 999_999)).toBe('ready in 41 s.');
    expect(outcomeLine('live', run, 999_999)).toBe('live in 41 s.');
  });

  it('falls back to the wait when the run has no times, never under a second', () => {
    expect(outcomeLine('test', { ...run, finishedAt: null }, 84_400)).toBe('ready in 84 s.');
    expect(outcomeLine('test', { ...run, startedAt: null }, 10)).toBe('ready in 1 s.');
  });

  it('prints the failure, with its reason', () => {
    expect(outcomeLine('test', { ...run, status: 'error', error: 'The build failed.' }, 0)).toBe('failed: The build failed.');
    expect(outcomeLine('test', { ...run, status: 'error' }, 0)).toBe('failed: no reason was recorded');
  });
});

describe('aheadLine', () => {
  const test: VersionRow = { commit: COMMIT, url: 'https://br-53-x-test.vercel.app', latestRun: null };
  const live: VersionRow = { commit: OLDER, url: 'https://br-53-x.vercel.app', latestRun: null };

  it('says how to publish when nothing is live', () => {
    expect(aheadLine(test, { ...live, commit: null }, null)).toBe('Nothing is live yet. `git push bankroll main:live` publishes it.');
  });

  it('says when test and live are the same build', () => {
    expect(aheadLine(test, { ...live, commit: COMMIT }, null)).toBe('Test is what live serves.');
  });

  it('counts the commits ahead when the clone knows them', () => {
    expect(aheadLine(test, live, 2)).toBe('Test is 2 commits ahead of live.');
    expect(aheadLine(test, live, 1)).toBe('Test is 1 commit ahead of live.');
    expect(aheadLine(test, live, null)).toBe('Test is ahead of live.');
  });
});
