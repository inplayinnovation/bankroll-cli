// The login session: Privy's tokens for one api. Kept in the platform's
// credential store, or in a file next to the signing key when the person
// has agreed to that. Reads look in the store first, then the file, so a
// session saved either way is found.
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Environment } from './environments';
import { PRODUCTION } from './environments';
import { FileStore, credentialStore, type Runner, type SessionStore, run } from './sessionStore';

export const CONFIG_DIR = join(homedir(), '.config', 'bankroll');
const SESSION_FILE = 'session.json';
const LOCK_SUFFIX = '.lock';
// A token this close to its end is refreshed before use, so a request never
// carries one that expires in flight.
export const REFRESH_MARGIN_MS = 60_000;

export interface Session {
  apiUrl: string;
  privyAppId: string;
  accessToken: string;
  refreshToken: string;
  // Unix time in milliseconds.
  expiresAt: number;
}

export interface SessionLocation {
  keychain: SessionStore | null;
  // Why there is no keychain, when there is none.
  reason: string | null;
  file: FileStore;
  // Serializes refreshes between commands running at once.
  lockPath: string;
}

export function sessionLocation(
  environment: Environment,
  dir = CONFIG_DIR,
  platform: NodeJS.Platform = process.platform,
  runner: Runner = run,
): SessionLocation {
  const fileName =
    environment.name === PRODUCTION.name ? SESSION_FILE : SESSION_FILE.replace('.json', `.${environment.name}.json`);
  const path = join(dir, fileName);
  const { store, reason } = credentialStore(environment.name, platform, runner);
  return { keychain: store, reason, file: new FileStore(path), lockPath: `${path}${LOCK_SUFFIX}` };
}

export interface StoredSession {
  session: Session;
  // Where it was found, so a refresh writes back to the same place.
  store: SessionStore;
}

export function readSession(location: SessionLocation): StoredSession | null {
  for (const store of [location.keychain, location.file]) {
    if (!store) continue;
    const raw = store.read();
    if (raw === null) continue;
    const parsed: unknown = JSON.parse(raw);
    if (!isSession(parsed)) {
      throw new Error(`What ${store.where} holds is not a login session; run \`bankroll login\` again`);
    }
    return { session: parsed, store };
  }
  return null;
}

// One line: a credential store may print a value with newlines as hex.
export function writeSession(session: Session, store: SessionStore): void {
  store.write(JSON.stringify(session));
}

/** Forgets the session wherever it is; whether there was one. */
export function clearSession(location: SessionLocation): boolean {
  const cleared = [location.keychain, location.file].map((store) => store?.clear() ?? false);
  return cleared.some(Boolean);
}

export function needsRefresh(session: Session, now = Date.now()): boolean {
  return session.expiresAt - now <= REFRESH_MARGIN_MS;
}

function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.apiUrl === 'string' &&
    typeof record.privyAppId === 'string' &&
    typeof record.accessToken === 'string' &&
    typeof record.refreshToken === 'string' &&
    typeof record.expiresAt === 'number'
  );
}
