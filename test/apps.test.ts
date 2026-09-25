import { describe, expect, it } from 'vitest';

import { describeApp, filterApps, formatApps, type AppRow } from '../src/apps';

const app: AppRow = {
  id: '53',
  name: 'Stackline',
  url: 'https://br-53-vzzo4b.vercel.app',
  status: 'live',
  archivedAt: null,
  publishedAt: '2026-09-23T14:00:00.000Z',
  createdAt: '2026-09-23T12:34:56.000Z',
  latestRun: { status: 'live', startedAt: '2026-09-24T08:00:00.000Z' },
};

describe('formatApps', () => {
  it('says so when there are none', () => {
    expect(formatApps([])).toBe('No apps yet. Build one in the Bankroll app.');
  });

  it('lays the apps out in columns, ids and addresses whole', () => {
    const draft: AppRow = {
      ...app,
      id: '7',
      name: 'A much longer app name',
      status: 'ready',
      publishedAt: null,
      latestRun: null,
      archivedAt: '2026-09-24T09:00:00.000Z',
    };
    const lines = formatApps([app, draft]).split('\n');
    expect(lines[0]).toBe('ID  NAME                    STATUS    PUBLISHED  LAST RUN         CREATED     URL');
    expect(lines[1]).toBe('53  Stackline               live      yes        live 2026-09-24  2026-09-23  https://br-53-vzzo4b.vercel.app');
    expect(lines[2]).toBe('7   A much longer app name  archived  no         -                2026-09-23  https://br-53-vzzo4b.vercel.app');
  });
});

describe('describeApp', () => {
  it('names the app, its state, and where it is', () => {
    expect(describeApp(app)).toBe('Stackline (53): live, published, https://br-53-vzzo4b.vercel.app');
    expect(describeApp({ ...app, archivedAt: '2026-09-24T09:00:00.000Z', publishedAt: null })).toBe(
      'Stackline (53): archived, not published, https://br-53-vzzo4b.vercel.app',
    );
  });
});

describe('filterApps', () => {
  const live = app;
  const draft: AppRow = { ...app, id: '60', publishedAt: null };
  const archived: AppRow = { ...app, id: '61', archivedAt: '2026-09-24T09:00:00.000Z' };
  const all = [live, draft, archived];

  it('leaves archived apps out by default, and counts them', () => {
    expect(filterApps(all, {})).toEqual({ shown: [live, draft], archivedHidden: 1 });
  });

  it('shows only archived apps, or everything', () => {
    expect(filterApps(all, { archived: true }).shown).toEqual([archived]);
    expect(filterApps(all, { all: true })).toEqual({ shown: all, archivedHidden: 0 });
  });

  it('narrows by publication, within the archive rule', () => {
    expect(filterApps(all, { published: true }).shown).toEqual([live]);
    expect(filterApps(all, { unpublished: true }).shown).toEqual([draft]);
    expect(filterApps(all, { published: true, all: true }).shown).toEqual([live, archived]);
  });

  it('refuses published and unpublished together', () => {
    expect(() => filterApps(all, { published: true, unpublished: true })).toThrow('cannot both');
  });
});
