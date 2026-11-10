// `bankroll username` — your Bankroll username: shown with no name, set with
// one. An account made by logging in on the web starts without one.
import { graphql, type SessionOptions } from './api';
import { resolveEnvironment } from './environments';
import { type AccountOptions, PICK_A_USERNAME, WHOAMI_QUERY, type WhoamiData } from './login';
import { sessionLocation, type SessionLocation } from './session';

export const SET_USERNAME_MUTATION = `mutation SetUsername($username: String!) { setUsername(username: $username) { username } }`;
const HANDLE_PREFIX = '@';

/** The name as the api takes it: a person may type it the way it is shown, "@name". */
export function bareUsername(typed: string): string {
  const trimmed = typed.trim();
  return trimmed.startsWith(HANDLE_PREFIX) ? trimmed.slice(HANDLE_PREFIX.length) : trimmed;
}

/** The line the command prints: the username it set, the one the account has, or how to pick one. */
export async function usernameLine(
  location: SessionLocation,
  name: string | undefined,
  options: SessionOptions = {},
): Promise<string> {
  if (name === undefined) {
    const who = await graphql<WhoamiData>(location, WHOAMI_QUERY, {}, options);
    const current = who.session.user?.username;
    return current ? `${HANDLE_PREFIX}${current}` : PICK_A_USERNAME;
  }
  const set = await graphql<{ setUsername: { username: string } }>(
    location,
    SET_USERNAME_MUTATION,
    { username: bareUsername(name) },
    options,
  );
  return `Your username is now ${HANDLE_PREFIX}${set.setUsername.username}`;
}

export async function username(name: string | undefined, options: AccountOptions): Promise<void> {
  const location = sessionLocation(resolveEnvironment(options.env));
  console.log(`\n  ${await usernameLine(location, name)}\n`);
}
