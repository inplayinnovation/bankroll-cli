import { describe, expect, it } from 'vitest';

import { describeApp, filterApps, formatApps, type AppRow } from '../src/apps';

const COMMIT = '3f2a9c1e7d0b4c5a9e8f1b2c3d4e5f6a7b8c9d0e';
const NEWER = '9c0d2e4f6a8b1c3d5e7f9a0b2c4d6e8f0a1b3c5d';

const app: AppRow = {
  id: '53',
  name: 'Stackline',
  url: 'https://br-53-vzzo4b.vercel.app',
  status: 'live',
  archivedAt: null,
  createdAt: '2026-09-23T12:34:56.000Z',
  latestRun: { status: 'live', startedAt: '2026-09-24T08:00:00.000Z', error: null },
  test: { commit: NEWER },
  live: { commit: COMMIT },
};

describe('formatApps', () => {
  it('says so when there are none', () => {
    expect(formatApps([])).toBe('No apps yet. Build one in the Bankroll app.');
  });

  // A commit that is cut cannot be used anywhere else, so both columns carry
  // the whole hash, and a version that serves nothing yet shows a dash.
  it('lays the apps out in columns, ids, commits and addresses whole', () => {
    const draft: AppRow = {
      ...app,
      id: '7',
      name: 'A much longer app name',
      status: 'ready',
      latestRun: null,
      archivedAt: '2026-09-24T09:00:00.000Z',
      test: { commit: null },
      live: { commit: null },
    };
    const lines = formatApps([app, draft]).split('\n');
    expect(lines[0]).toBe(
      `ID  NAME                    STATUS    ${'TEST'.padEnd(COMMIT.length)}  ${'LIVE'.padEnd(COMMIT.length)}  LAST RUN         CREATED     URL`,
    );
    expect(lines[1]).toBe(
      `53  Stackline               live      ${NEWER}  ${COMMIT}  live 2026-09-24  2026-09-23  https://br-53-vzzo4b.vercel.app`,
    );
    expect(lines[2]).toBe(
      `7   A much longer app name  archived  ${'-'.padEnd(COMMIT.length)}  ${'-'.padEnd(COMMIT.length)}  -                2026-09-23  https://br-53-vzzo4b.vercel.app`,
    );
  });

  // The address is in its own column, so it is not also the name.
  it('says an app has no name yet, beside its address', () => {
    const fresh: AppRow = {
      ...app,
      id: '17',
      name: null,
      status: 'ready',
      latestRun: null,
      test: { commit: null },
      live: { commit: null },
    };
    const lines = formatApps([fresh]).split('\n');
    expect(lines[1]).toBe('17  Unnamed app  ready   -     -     -         2026-09-23  https://br-53-vzzo4b.vercel.app');
  });

  it("puts a failed run's reason under the table, every line of it", () => {
    const failed: AppRow = {
      ...app,
      id: '4',
      name: 'Stacker',
      status: 'error',
      latestRun: {
        status: 'error',
        startedAt: '2026-09-25T21:36:00.000Z',
        error: 'Bankroll could not describe the app.\nThe operation was aborted due to timeout',
      },
    };
    const lines = formatApps([app, failed]).split('\n');
    expect(lines[3]).toBe('');
    expect(lines[4]).toBe('4  Stacker: last run failed: Bankroll could not describe the app.');
    expect(lines[5]).toBe(`${' '.repeat('4  Stacker: last run failed: '.length)}The operation was aborted due to timeout`);
    expect(formatApps([app])).not.toContain('last run failed');
  });
});

describe('describeApp', () => {
  it('names the app, its state, and where it is', () => {
    expect(describeApp(app)).toBe('Stackline (53): live, https://br-53-vzzo4b.vercel.app');
    expect(describeApp({ ...app, archivedAt: '2026-09-24T09:00:00.000Z' })).toBe(
      'Stackline (53): archived, https://br-53-vzzo4b.vercel.app',
    );
  });

  it('says so of an app that has no name yet, and gives its address once', () => {
    expect(describeApp({ ...app, name: null, status: 'ready' })).toBe(
      'Unnamed app (53): ready, https://br-53-vzzo4b.vercel.app',
    );
  });
});

describe('filterApps', () => {
  const live = app;
  const draft: AppRow = { ...app, id: '60', test: { commit: null }, live: { commit: null } };
  const archived: AppRow = { ...app, id: '61', archivedAt: '2026-09-24T09:00:00.000Z' };
  const all = [live, draft, archived];

  it('leaves archived apps out by default, and counts them', () => {
    expect(filterApps(all, {})).toEqual({ shown: [live, draft], archivedHidden: 1 });
  });

  it('shows only archived apps, or everything', () => {
    expect(filterApps(all, { archived: true }).shown).toEqual([archived]);
    expect(filterApps(all, { all: true })).toEqual({ shown: all, archivedHidden: 0 });
  });
});
