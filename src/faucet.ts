// `bankroll faucet` — test cash for your account: the money a test version
// takes. Bankroll mints it on request, and it is worth nothing anywhere.
import { graphql } from './api';
import { resolveEnvironment } from './environments';
import { type AccountOptions, WHOAMI_QUERY, type WhoamiData } from './login';
import { sessionLocation } from './session';

const FAUCET_MUTATION = `mutation Faucet { mintTestCash { amountCents } }`;
const CENTS_PER_DOLLAR = 100;

/** "$100" for a whole amount, "$12.50" otherwise. */
export function dollars(cents: number): string {
  const whole = cents % CENTS_PER_DOLLAR === 0;
  return `$${whole ? cents / CENTS_PER_DOLLAR : (cents / CENTS_PER_DOLLAR).toFixed(2)}`;
}

export async function faucet(options: AccountOptions): Promise<void> {
  const location = sessionLocation(resolveEnvironment(options.env));
  const who = await graphql<WhoamiData>(location, WHOAMI_QUERY);
  const grant = await graphql<{ mintTestCash: { amountCents: number } }>(location, FAUCET_MUTATION);
  const user = who.session.user;
  const name = user?.username ? `@${user.username}` : (user?.walletAddress ?? 'you');
  console.log(`\n  Sent ${dollars(grant.mintTestCash.amountCents)} of test cash to ${name}.\n`);
}
