import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NOT_LOGGED_IN, currentSession, graphql } from '../src/api';
import type { Fetch } from '../src/privyDevice';
import { readSession, writeSession, type Session, type SessionLocation } from '../src/session';
import { FileStore } from '../src/sessionStore';

const scratch = (): SessionLocation => {
  const path = join(mkdtempSync(join(tmpdir(), 'bankroll-cli-')), 'session.json');
  return { keychain: null, reason: 'no store in tests', file: new FileStore(path), lockPath: `${path}.lock` };
};
const NOW = 1_800_000_000_000;
const MINUTE_MS = 60_000;

const fresh: Session = {
  apiUrl: 'https://api.example.test',
  privyAppId: 'app_1',
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: NOW + 10 * MINUTE_MS,
};

const scripted = (responses: { status: number; body: unknown }[]) => {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    const next = responses.shift();
    if (!next) throw new Error('no scripted response left');
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as Fetch;
  return { calls, fetchImpl };
};

describe('currentSession', () => {
  it('says how to log in when there is no session', async () => {
    await expect(currentSession(scratch())).rejects.toThrow(NOT_LOGGED_IN);
  });

  it('returns a fresh session as is, without touching Privy', async () => {
    const location = scratch();
    writeSession(fresh, location.file);
    const { calls, fetchImpl } = scripted([]);
    expect(await currentSession(location, { fetchImpl, now: () => NOW })).toEqual(fresh);
    expect(calls).toHaveLength(0);
  });

  it('refreshes a session that is about to expire and stores the rotated tokens', async () => {
    const location = scratch();
    writeSession({ ...fresh, expiresAt: NOW + 30_000 }, location.file);
    const { calls, fetchImpl } = scripted([
      { status: 200, body: { access_token: 'access2', refresh_token: 'refresh2', expires_in: 899 } },
    ]);
    const session = await currentSession(location, { fetchImpl, now: () => NOW });
    expect(session).toEqual({
      ...fresh,
      accessToken: 'access2',
      refreshToken: 'refresh2',
      expiresAt: NOW + 899_000,
    });
    expect(readSession(location)?.session).toEqual(session);
    expect(calls[0]?.url).toBe('https://auth.privy.io/api/oauth/v2/token');
  });

  it('forgets a login whose refresh token is dead', async () => {
    const location = scratch();
    writeSession({ ...fresh, expiresAt: NOW }, location.file);
    const { fetchImpl } = scripted([{ status: 401, body: { error: 'invalid_grant' } }]);
    await expect(currentSession(location, { fetchImpl, now: () => NOW })).rejects.toThrow('Run `bankroll login` again');
    expect(readSession(location)).toBeNull();
  });
});

describe('graphql', () => {
  it("posts to the session's api with the access token and returns the data", async () => {
    const location = scratch();
    writeSession(fresh, location.file);
    const { calls, fetchImpl } = scripted([
      { status: 200, body: { data: { session: { user: { username: 'greg' } } } } },
    ]);
    const data = await graphql<{ session: { user: { username: string } } }>(
      location,
      'query { session { user { username } } }',
      {},
      { fetchImpl, now: () => NOW },
    );
    expect(data.session.user.username).toBe('greg');
    expect(calls[0]?.url).toBe('https://api.example.test/api/graphql');
    expect(calls[0]?.headers.Authorization).toBe('Bearer access');
  });

  it('surfaces GraphQL errors as the message', async () => {
    const location = scratch();
    writeSession(fresh, location.file);
    const { fetchImpl } = scripted([
      { status: 200, body: { errors: [{ message: 'Invalid or expired token' }] } },
    ]);
    await expect(graphql(location, 'query { session { ip } }', {}, { fetchImpl, now: () => NOW })).rejects.toThrow(
      'Invalid or expired token',
    );
  });
});
