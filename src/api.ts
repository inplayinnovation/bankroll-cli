// Talking to the Bankroll api as the logged-in person: the session's access
// token as a bearer, refreshed first when it is about to expire.
import { closeSync, existsSync, mkdirSync, openSync, rmSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import { GRAPHQL_PATH } from './environments';
import { LoginRefusedError, refreshTokens, type Fetch } from './privyDevice';
import { clearSession, needsRefresh, readSession, writeSession, type Session, type SessionLocation } from './session';

const MS_PER_SECOND = 1000;
// A refresh token dies the moment it is used, so two commands running at once
// (a coding agent does that) must not both refresh: the lock makes the second
// one wait and reuse what the first one stored.
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 100;
const LOCK_ATTEMPTS = 100;

export const NOT_LOGGED_IN = 'Not logged in. Run `bankroll login` first.';

export interface SessionOptions {
  fetchImpl?: Fetch;
  now?: () => number;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt++) {
    let fd: number;
    try {
      fd = openSync(lockPath, 'wx');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // A lock a crashed process left behind is taken over.
      if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
        rmSync(lockPath, { force: true });
        continue;
      }
      await wait(LOCK_RETRY_MS);
      continue;
    }
    try {
      return await fn();
    } finally {
      closeSync(fd);
      rmSync(lockPath, { force: true });
    }
  }
  throw new Error(`Another bankroll command is holding ${lockPath}. Remove it if none is running.`);
}

/** The session, with a fresh access token; a dead login is forgotten. */
export async function currentSession(location: SessionLocation, options: SessionOptions = {}): Promise<Session> {
  const now = options.now ?? Date.now;
  const stored = readSession(location);
  if (!stored) throw new Error(NOT_LOGGED_IN);
  if (!needsRefresh(stored.session, now())) return stored.session;
  return withLock(location.lockPath, async () => {
    // Another command may have refreshed while this one waited for the lock.
    const latest = readSession(location);
    if (!latest) throw new Error(NOT_LOGGED_IN);
    if (!needsRefresh(latest.session, now())) return latest.session;
    let tokens;
    try {
      tokens = await refreshTokens(latest.session.privyAppId, latest.session.refreshToken, options.fetchImpl);
    } catch (error) {
      if (error instanceof LoginRefusedError) clearSession(location);
      throw error;
    }
    const refreshed: Session = {
      ...latest.session,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: now() + tokens.expiresInSeconds * MS_PER_SECOND,
    };
    writeSession(refreshed, latest.store);
    return refreshed;
  });
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
}

/** One GraphQL operation, as the logged-in person, against the api they logged in to. */
export async function graphql<T>(
  location: SessionLocation,
  query: string,
  variables: Record<string, unknown> = {},
  options: SessionOptions = {},
): Promise<T> {
  const session = await currentSession(location, options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${session.apiUrl}${GRAPHQL_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  let parsed: GraphQLResponse<T>;
  try {
    parsed = JSON.parse(text) as GraphQLResponse<T>;
  } catch {
    throw new Error(`${session.apiUrl} answered ${response.status} with something that is not JSON: ${text}`);
  }
  if (parsed.errors?.length) {
    throw new Error(parsed.errors.map((error) => error.message).join('\n  '));
  }
  if (!response.ok || parsed.data === undefined) {
    throw new Error(`${session.apiUrl} answered ${response.status}: ${text}`);
  }
  return parsed.data;
}
