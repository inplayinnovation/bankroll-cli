import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PRODUCTION } from '../src/environments';
import {
  REFRESH_MARGIN_MS,
  clearSession,
  needsRefresh,
  readSession,
  sessionLocation,
  writeSession,
  type Session,
  type SessionLocation,
} from '../src/session';
import { FileStore, type SessionStore } from '../src/sessionStore';

const scratch = () => mkdtempSync(join(tmpdir(), 'bankroll-cli-'));

const session: Session = {
  apiUrl: 'https://api.joinbankroll.com',
  privyAppId: 'app_1',
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: 1_800_000_000_000,
};

// A credential store that lives in memory.
class FakeStore implements SessionStore {
  readonly where = 'the fake store';
  private secret: string | null = null;
  read() {
    return this.secret;
  }
  write(secret: string) {
    this.secret = secret;
  }
  clear() {
    const had = this.secret !== null;
    this.secret = null;
    return had;
  }
}

const fileOnly = (dir: string): SessionLocation => ({
  keychain: null,
  reason: 'no store in tests',
  file: new FileStore(join(dir, 'session.json')),
  lockPath: join(dir, 'session.json.lock'),
});

describe('sessionLocation', () => {
  const missing = () => ({ status: null, stdout: '', stderr: '', missing: true });

  it('names the file after the environment, production plain', () => {
    const dir = '/home/x/.config/bankroll';
    expect(sessionLocation(PRODUCTION, dir, 'linux', missing).file.path).toBe(`${dir}/session.json`);
    const other = { name: 'other', apiUrl: 'https://a.test', privyAppId: 'x' };
    const location = sessionLocation(other, dir, 'linux', missing);
    expect(location.file.path).toBe(`${dir}/session.other.json`);
    expect(location.lockPath).toBe(`${dir}/session.other.json.lock`);
  });

  it('says why there is no credential store', () => {
    const location = sessionLocation(PRODUCTION, '/home/x/.config/bankroll', 'linux', missing);
    expect(location.keychain).toBeNull();
    expect(location.reason).toContain('secret-tool');
  });
});

describe('session in a file', () => {
  it('is null before a login', () => {
    expect(readSession(fileOnly(scratch()))).toBeNull();
  });

  it('round-trips, readable by this user only', () => {
    const location = fileOnly(scratch());
    writeSession(session, location.file);
    expect(readSession(location)).toEqual({ session, store: location.file });
    expect(statSync(location.file.path).mode & 0o777).toBe(0o600);
  });

  it('refuses content that is not a session', () => {
    const location = fileOnly(scratch());
    location.file.write(JSON.stringify({ accessToken: 'only' }));
    expect(() => readSession(location)).toThrow('not a login session');
  });
});

describe('session in a credential store', () => {
  it('is read before the file, and a refresh writes back to where it was found', () => {
    const location = { ...fileOnly(scratch()), keychain: new FakeStore(), reason: null };
    writeSession({ ...session, accessToken: 'stale-file' }, location.file);
    writeSession(session, location.keychain);
    const stored = readSession(location);
    expect(stored?.session.accessToken).toBe('access');
    expect(stored?.store).toBe(location.keychain);
  });

  it('clears everywhere, and says whether there was anything', () => {
    const location = { ...fileOnly(scratch()), keychain: new FakeStore(), reason: null };
    expect(clearSession(location)).toBe(false);
    writeSession(session, location.keychain);
    writeSession(session, location.file);
    expect(clearSession(location)).toBe(true);
    expect(readSession(location)).toBeNull();
  });
});

describe('needsRefresh', () => {
  it('is false while the token has more than the margin left', () => {
    expect(needsRefresh(session, session.expiresAt - REFRESH_MARGIN_MS - 1)).toBe(false);
  });

  it('is true inside the margin and after expiry', () => {
    expect(needsRefresh(session, session.expiresAt - REFRESH_MARGIN_MS)).toBe(true);
    expect(needsRefresh(session, session.expiresAt + 1)).toBe(true);
  });
});
