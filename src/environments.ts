// Which Bankroll api the account commands talk to, and which Privy app logs
// a person in there. Production is built in. Any other environment comes from
// a file on this machine, chosen with `-e <name>`, so nothing but production
// is named in this package.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Environment {
  name: string;
  apiUrl: string;
  privyAppId: string;
}

export const PRODUCTION: Environment = {
  name: 'production',
  apiUrl: 'https://api.joinbankroll.com',
  privyAppId: 'cm9agredy01c5jl0mzvxbmn65',
};

export const GRAPHQL_PATH = '/api/graphql';

const CONFIG_DIR = join(homedir(), '.config', 'bankroll');
export const ENVIRONMENTS_PATH = join(CONFIG_DIR, 'environments.json');

const EXAMPLE = JSON.stringify(
  { name: { apiUrl: 'https://api.example.com', privyAppId: 'privy app id' } },
  null,
  2,
);

/** The environment `-e` names; production when there is none. */
export function resolveEnvironment(name: string | undefined, path = ENVIRONMENTS_PATH): Environment {
  if (name === undefined || name === PRODUCTION.name) return PRODUCTION;
  if (!existsSync(path)) {
    throw new Error(`No environments are defined. Describe "${name}" in ${path}:\n${EXAMPLE}`);
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const entry = isRecord(parsed) ? parsed[name] : undefined;
  if (!isRecord(entry) || typeof entry.apiUrl !== 'string' || typeof entry.privyAppId !== 'string') {
    throw new Error(`"${name}" is not defined in ${path}. Each entry looks like:\n${EXAMPLE}`);
  }
  return { name, apiUrl: new URL(entry.apiUrl).origin, privyAppId: entry.privyAppId };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
