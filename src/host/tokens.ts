// A pretend person's session token: what the simulator hands an app in place
// of the token Bankroll signs.
//
// It has the shape of a real one, with a `mock: true` claim and no signature,
// which is exactly what the SDK's server half accepts with BANKROLL_MOCK=1
// outside production (`mockSession` in @joinbankroll/sdk/mock) and nothing
// else ever does. A production server verifies Bankroll's signature and
// refuses this at once.
import type { Person } from './people';

const ISSUER = 'bankroll-mock';
const TTL_SECONDS = 3600;

const base64url = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A session token for this person, scoped to the app at `audience` the way a real one is. */
export function sessionToken(person: Person, audience: string, now = Date.now()): string {
  const issued = Math.floor(now / 1000);
  const payload = {
    mock: true,
    iss: ISSUER,
    sub: person.wallet,
    username: person.username,
    kyc: person.age === null ? false : { age: person.age },
    aud: audience,
    iat: issued,
    exp: issued + TTL_SECONDS,
  };
  return `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url(payload)}.`;
}
