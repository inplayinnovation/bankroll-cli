import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PICK_A_USERNAME, WHOAMI_QUERY } from '../src/login';
import type { Fetch } from '../src/privyDevice';
import { writeSession, type Session, type SessionLocation } from '../src/session';
import { FileStore } from '../src/sessionStore';
import { SET_USERNAME_MUTATION, bareUsername, usernameLine } from '../src/username';

const NOW = 1_800_000_000_000;
const MINUTE_MS = 60_000;
const session: Session = {
  apiUrl: 'https://api.example.test',
  privyAppId: 'app_1',
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: NOW + 10 * MINUTE_MS,
};

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

const account = (username: string | null) => ({ data: { session: { user: { username, walletAddress: 'Wallet111' } } } });

describe('bareUsername', () => {
  it('takes the name with or without the @ it is shown with', () => {
    expect(bareUsername('ada')).toBe('ada');
    expect(bareUsername('@ada')).toBe('ada');
    expect(bareUsername('  @ada ')).toBe('ada');
  });
});

describe('usernameLine', () => {
  it('shows the username the account has', async () => {
    const { location, sent, options } = loggedIn([account('ada')]);

    expect(await usernameLine(location, undefined, options)).toBe('@ada');
    expect(sent).toEqual([{ query: WHOAMI_QUERY, variables: {} }]);
  });

  it('says how to pick one when the account has none', async () => {
    const { location, options } = loggedIn([account(null)]);

    expect(await usernameLine(location, undefined, options)).toBe(PICK_A_USERNAME);
  });

  it('sets the username, and answers with the one the api stored', async () => {
    const { location, sent, options } = loggedIn([{ data: { setUsername: { username: 'Ada' } } }]);

    expect(await usernameLine(location, '@Ada', options)).toBe('Your username is now @Ada');
    expect(sent).toEqual([{ query: SET_USERNAME_MUTATION, variables: { username: 'Ada' } }]);
  });

  it("fails with the api's own words when the name is taken or malformed", async () => {
    const { location, options } = loggedIn([{ errors: [{ message: 'Username already taken.' }] }]);

    await expect(usernameLine(location, 'ada', options)).rejects.toThrow('Username already taken.');
  });
});
