import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  REMOVE_SECRET_MUTATION,
  SECRETS_QUERY,
  SET_SECRET_MUTATION,
  checkNames,
  laterLine,
  listSecrets,
  removeSecrets,
  secretLines,
  setSecrets,
  versionWords,
  versionsFor,
  withoutFinalLineBreak,
} from '../src/env';
import type { Fetch } from '../src/privyDevice';
import { typedSecret } from '../src/prompt';
import { writeSession, type Session, type SessionLocation } from '../src/session';
import { FileStore } from '../src/sessionStore';

const NOW = 1_800_000_000_000;
const MINUTE_MS = 60_000;
const session: Session = {
  apiUrl: 'https://api.example.test',
  privyAppId: 'app_1',
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: NOW + 10 * MINUTE_MS,
};
const VALUE = 'sk-live-0123456789';

// A logged-in computer, and an api that answers each request with the next body.
const loggedIn = (bodies: unknown[]) => {
  const path = join(mkdtempSync(join(tmpdir(), 'bankroll-cli-')), 'session.json');
  const location: SessionLocation = { keychain: null, reason: 'no store in tests', file: new FileStore(path), lockPath: `${path}.lock` };
  writeSession(session, location.file);
  const sent: { query: string; variables: Record<string, unknown> }[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify(bodies.shift()), { status: 200 });
  }) as unknown as Fetch;
  return { location, sent, options: { fetchImpl, now: () => NOW } };
};

const changed = (field: string, rebuilding: string[]) => ({
  data: { [field]: { rebuilding, app: { id: '3', name: 'Tip Jar', url: 'https://br-3-ab12cd.vercel.app' } } },
});

describe('versionsFor', () => {
  it('is both versions unless one is named', () => {
    expect(versionsFor({})).toEqual(['test', 'live']);
    expect(versionsFor({ test: true })).toEqual(['test']);
    expect(versionsFor({ live: true })).toEqual(['live']);
    expect(versionsFor({ test: true, live: true })).toEqual(['test', 'live']);
  });

  it('reads as words', () => {
    expect(versionWords(['test'])).toBe('test');
    expect(versionWords(['test', 'live'])).toBe('test and live');
  });
});

describe('checkNames', () => {
  it('accepts names in the shape Bankroll takes', () => {
    expect(() => checkNames(['KALSHI_API_KEY', 'DATABASE_URL', 'S3_BUCKET_2'])).not.toThrow();
  });

  it('refuses no name, a name in another shape, and a name given twice, before any value is typed', () => {
    expect(() => checkNames([])).toThrow(/Name the secret/);
    expect(() => checkNames(['kalshi_api_key'])).toThrow(/"kalshi_api_key" is not a name/);
    expect(() => checkNames(['A-B'])).toThrow(/not a name/);
    expect(() => checkNames(['A=sk-live-123'])).toThrow(/not a name/);
    expect(() => checkNames(['A', 'A'])).toThrow(/twice/);
  });
});

describe('withoutFinalLineBreak', () => {
  it('drops the one line break a file or an echo ends with, and keeps the rest', () => {
    expect(withoutFinalLineBreak('abc\n')).toBe('abc');
    expect(withoutFinalLineBreak('abc\r\n')).toBe('abc');
    expect(withoutFinalLineBreak('abc')).toBe('abc');
    expect(withoutFinalLineBreak('-----BEGIN KEY-----\nMIIE\n-----END KEY-----\n')).toBe('-----BEGIN KEY-----\nMIIE\n-----END KEY-----');
    expect(withoutFinalLineBreak('abc\n\n')).toBe('abc\n');
  });
});

describe('typedSecret', () => {
  it('ends at Enter, and keeps what was typed before it', () => {
    expect(typedSecret('sk-123\r')).toEqual({ value: 'sk-123', done: 'entered' });
    expect(typedSecret('-123\n', 'sk')).toEqual({ value: 'sk-123', done: 'entered' });
  });

  it('goes on while no line has ended, and takes a pasted run of keys at once', () => {
    expect(typedSecret('sk-')).toEqual({ value: 'sk-', done: null });
    expect(typedSecret('123', 'sk-')).toEqual({ value: 'sk-123', done: null });
  });

  it('takes back a key on backspace, and gives up the value on Ctrl-C', () => {
    expect(typedSecret('skx\u007f-1\r')).toEqual({ value: 'sk-1', done: 'entered' });
    expect(typedSecret('\u007f\u007fa\r')).toEqual({ value: 'a', done: 'entered' });
    expect(typedSecret('sk-123\u0003')).toEqual({ value: '', done: 'cancelled' });
  });
});

describe('secretLines', () => {
  it('says how to set one when the app has none', () => {
    expect(secretLines([])).toEqual(['No secrets. `bankroll env set NAME` gives the app one.']);
  });

  it('lists one line per name, in name order, with the versions that have a value and the day each was set', () => {
    const lines = secretLines([
      { name: 'KALSHI_API_KEY', environment: 'live', setAt: '2026-11-17T04:10:00.000Z' },
      { name: 'KALSHI_API_KEY', environment: 'test', setAt: '2026-11-16T20:00:00.000Z' },
      { name: 'DB_URL', environment: 'test', setAt: '2026-11-15T09:30:00.000Z' },
    ]);

    expect(lines).toEqual([
      'DB_URL          test (set 2026-11-15)',
      'KALSHI_API_KEY  test (set 2026-11-16), live (set 2026-11-17)',
    ]);
  });
});

describe('laterLine', () => {
  it('says nothing when every version is being built again', () => {
    expect(laterLine(['test', 'live'], ['test', 'live'], true)).toBeNull();
  });

  it('names the versions that read the change at their next build', () => {
    expect(laterLine(['test', 'live'], ['test'], true)).toBe('The live version reads the change at its next build.');
    expect(laterLine(['test', 'live'], [], true)).toBe('The test and live versions read the change at their next build.');
  });

  it('says so when no build was asked for', () => {
    expect(laterLine(['test'], [], false)).toBe('The test version is not built again now: the change is read at the next build.');
  });
});

describe('setSecrets', () => {
  it('sends the value once, to the versions named, and answers the builds that started', async () => {
    const { location, sent, options } = loggedIn([changed('builderSetAppSecret', ['test'])]);

    const rebuilding = await setSecrets(
      location,
      { id: '3', values: [{ name: 'KALSHI_API_KEY', value: VALUE }], versions: ['test', 'live'], rebuild: true },
      options,
    );

    expect(rebuilding).toEqual(['test']);
    expect(sent).toEqual([
      {
        query: SET_SECRET_MUTATION,
        variables: { id: '3', name: 'KALSHI_API_KEY', value: VALUE, environments: ['test', 'live'], rebuild: true },
      },
    ]);
  });

  it('asks for one build, after the last of several secrets', async () => {
    const { location, sent, options } = loggedIn([
      changed('builderSetAppSecret', []),
      changed('builderSetAppSecret', ['test', 'live']),
    ]);

    const rebuilding = await setSecrets(
      location,
      {
        id: '3',
        values: [
          { name: 'DB_URL', value: 'postgres://x' },
          { name: 'DB_KEY', value: VALUE },
        ],
        versions: ['test', 'live'],
        rebuild: true,
      },
      options,
    );

    expect(sent.map((request) => [request.variables.name, request.variables.rebuild])).toEqual([
      ['DB_URL', false],
      ['DB_KEY', true],
    ]);
    expect(rebuilding).toEqual(['test', 'live']);
  });

  it('asks for no build when told not to', async () => {
    const { location, sent, options } = loggedIn([changed('builderSetAppSecret', [])]);

    await setSecrets(location, { id: '3', values: [{ name: 'A', value: 'b' }], versions: ['live'], rebuild: false }, options);

    expect(sent[0]!.variables).toMatchObject({ environments: ['live'], rebuild: false });
  });

  it("fails with Bankroll's own words for a name it refuses", async () => {
    const { location, options } = loggedIn([{ errors: [{ message: 'BANKROLL_APP_KEY is a name that Bankroll or the host sets. Pick another name.' }] }]);

    await expect(
      setSecrets(location, { id: '3', values: [{ name: 'BANKROLL_APP_KEY', value: 'x' }], versions: ['test'], rebuild: true }, options),
    ).rejects.toThrow('BANKROLL_APP_KEY is a name that Bankroll or the host sets.');
  });
});

describe('removeSecrets', () => {
  it('removes each name from the versions named, with one build after the last', async () => {
    const { location, sent, options } = loggedIn([
      changed('builderRemoveAppSecret', []),
      changed('builderRemoveAppSecret', ['live']),
    ]);

    const rebuilding = await removeSecrets(location, { id: '3', names: ['A', 'B'], versions: ['live'], rebuild: true }, options);

    expect(rebuilding).toEqual(['live']);
    expect(sent).toEqual([
      { query: REMOVE_SECRET_MUTATION, variables: { id: '3', name: 'A', environments: ['live'], rebuild: false } },
      { query: REMOVE_SECRET_MUTATION, variables: { id: '3', name: 'B', environments: ['live'], rebuild: true } },
    ]);
  });
});

describe('listSecrets', () => {
  it("reads the names of the app's secrets, and nothing else of them", async () => {
    const secrets = [{ name: 'A', environment: 'test', setAt: '2026-11-16T20:00:00.000Z' }];
    const { location, sent, options } = loggedIn([{ data: { builderApp: { id: '3', name: 'Tip Jar', url: 'x', secrets } } }]);

    expect(await listSecrets(location, '3', options)).toEqual(secrets);
    expect(sent).toEqual([{ query: SECRETS_QUERY, variables: { id: '3' } }]);
    // No document of this command asks Bankroll for a value: there is no such field.
    for (const document of [SECRETS_QUERY, SET_SECRET_MUTATION, REMOVE_SECRET_MUTATION]) {
      expect(document.replace(/\$value|value: \$value/g, '')).not.toMatch(/value/);
    }
  });

  it('says so when there is no such app', async () => {
    const { location, options } = loggedIn([{ data: { builderApp: null } }]);

    await expect(listSecrets(location, '99', options)).rejects.toThrow('No app 99.');
  });
});
