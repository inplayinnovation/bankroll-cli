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
  severalLinesHelp,
  versionWords,
  versionsFor,
  withoutFinalLineBreak,
} from '../src/env';
import type { Fetch } from '../src/privyDevice';
import { NO_KEYS, type SecretKeys, typedSecret } from '../src/prompt';
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

// What a terminal sends around a paste when it is asked to mark pastes.
const PASTE_START = '\u001b[200~';
const PASTE_END = '\u001b[201~';
const PEM = ['-----BEGIN PRIVATE KEY-----', 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC', '-----END PRIVATE KEY-----'];

// The keys as they arrive, one piece after another, the way the terminal hands them over.
const typed = (...pieces: string[]): SecretKeys => pieces.reduce((keys, piece) => typedSecret(piece, keys), NO_KEYS);
const entered = (value: string): SecretKeys => ({ value, done: 'entered', paste: null, held: '' });
const SEVERAL_LINES: SecretKeys = { value: '', done: 'several-lines', paste: null, held: '' };

describe('typedSecret', () => {
  it('ends at Enter, and keeps what was typed before it', () => {
    expect(typed('sk-123\r')).toEqual(entered('sk-123'));
    expect(typed('sk', '-123\n')).toEqual(entered('sk-123'));
    expect(typed('sk-123\u0004')).toEqual(entered('sk-123'));
  });

  it('goes on while no line has ended, and takes a pasted run of keys at once', () => {
    expect(typed('sk-')).toEqual({ value: 'sk-', done: null, paste: null, held: '' });
    expect(typed('sk-', '123')).toEqual({ value: 'sk-123', done: null, paste: null, held: '' });
  });

  it('takes back a key on backspace, a whole character at a time, and gives up the value on Ctrl-C', () => {
    expect(typed('skx\u007f-1\r')).toEqual(entered('sk-1'));
    expect(typed('\u007f\u007fa\r')).toEqual(entered('a'));
    expect(typed('sk-😀\u007f1\r')).toEqual(entered('sk-1'));
    expect(typed('sk-123\u0003')).toEqual({ value: '', done: 'cancelled', paste: null, held: '' });
    expect(typed('sk-123\u0003', 'more\r')).toEqual({ value: '', done: 'cancelled', paste: null, held: '' });
  });

  it('never takes the first line of a pasted value of several lines for the value', () => {
    // A terminal that marks no pastes sends the lines as typing: at once, or in pieces.
    expect(typed(`${PEM.join('\r')}\r`)).toEqual(SEVERAL_LINES);
    expect(typed(`${PEM[0]}\r`, `${PEM[1]}\r`, `${PEM[2]}\r`)).toEqual(SEVERAL_LINES);
    expect(typed(`${PEM.join('\n')}\n`)).toEqual(SEVERAL_LINES);
    // A terminal that marks pastes: the same answer, known at the end mark.
    expect(typed(`${PASTE_START}${PEM.join('\r')}\r${PASTE_END}`)).toEqual(SEVERAL_LINES);
    expect(typed(`${PASTE_START}${PEM[0]}\r`, `${PEM[1]}\r${PEM[2]}${PASTE_END}`)).toEqual(SEVERAL_LINES);
    // Typed after Enter, before the prompt let go: still more than one line.
    expect(typed('sk-123\r', 'x')).toEqual(SEVERAL_LINES);
  });

  it('takes a line break after the line has ended for nothing: Enter twice, or a line that ends in two', () => {
    expect(typed('sk-123\r\r')).toEqual(entered('sk-123'));
    expect(typed('sk-123\r\n')).toEqual(entered('sk-123'));
    expect(typed('sk-123\r', '\n', '\r')).toEqual(entered('sk-123'));
  });

  it('takes one pasted line that the terminal marked, entered by its own line break or by Enter', () => {
    expect(typed(`${PASTE_START}sk-123\r${PASTE_END}`)).toEqual(entered('sk-123'));
    expect(typed(`${PASTE_START}sk-123\r\n${PASTE_END}`)).toEqual(entered('sk-123'));
    expect(typed(`${PASTE_START}sk-123${PASTE_END}`)).toEqual({ value: 'sk-123', done: null, paste: null, held: '' });
    expect(typed(`${PASTE_START}sk-123${PASTE_END}`, '\r')).toEqual(entered('sk-123'));
    expect(typed('sk-', `${PASTE_START}123${PASTE_END}`, '4\r')).toEqual(entered('sk-1234'));
  });

  it('knows a paste mark that arrives in pieces, and holds the value until the mark is whole', () => {
    expect(typed('\u001b[20')).toEqual({ value: '', done: null, paste: null, held: '\u001b[20' });
    expect(typed('\u001b[20', '0~sk-123\u001b[2')).toEqual({ value: '', done: null, paste: 'sk-123', held: '\u001b[2' });
    expect(typed('\u001b[20', '0~sk-123\u001b[2', '01~', '\r')).toEqual(entered('sk-123'));
    expect(typed('\u001b', '[200~sk-123\u001b', '[201~\r')).toEqual(entered('sk-123'));
  });

  it('adds nothing to the value for a key that prints nothing', () => {
    // Left arrow, Home on a keypad, F5, and a left arrow that arrives in two pieces.
    expect(typed('sk-\u001b[D1\r')).toEqual(entered('sk-1'));
    expect(typed('sk-\u001bOH1\r')).toEqual(entered('sk-1'));
    expect(typed('sk-\u001b[15~1\r')).toEqual(entered('sk-1'));
    expect(typed('sk-\u001b[', 'D1\r')).toEqual(entered('sk-1'));
    // The Escape key alone, then an ordinary key: the key counts.
    expect(typed('\u001b', 'sk-1\r')).toEqual(entered('sk-1'));
    expect(typed('sk-\u001b\r')).toEqual(entered('sk-'));
  });
});

describe('severalLinesHelp', () => {
  it('says nothing was set and names the two ways that take several lines, with the name filled in', () => {
    const help = severalLinesHelp('KALSHI_PRIVATE_KEY');

    expect(help).toContain('Nothing was set.');
    expect(help).toContain('bankroll env set KALSHI_PRIVATE_KEY --from-file <file>');
    expect(help).toContain('pbpaste | bankroll env set KALSHI_PRIVATE_KEY');
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
