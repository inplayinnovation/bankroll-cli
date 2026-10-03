// The app's treasury inside the simulator: a key made up for it.
//
// The dev signing key holds real money and never comes near the simulator.
// This one is kept so its address is the same from one run to the next, as an
// app's server may have written it down, and holds fake dollars on the local
// chain alone.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import bs58 from 'bs58';

import { newKeypair } from '../keypair';
import { SIMULATOR_DIR } from './people';

const TREASURY_FILE = 'treasury.json';
const SECRET_FILE_MODE = 0o600;
const KEY_BYTES = 32;

export interface TreasuryKey {
  address: string;
  /** Base58, as BANKROLL_TREASURY_KEY takes it. */
  secretKey: string;
}

/** The simulator's treasury key, made on first use. */
export function loadTreasury(path = join(SIMULATOR_DIR, TREASURY_FILE)): TreasuryKey {
  if (existsSync(path)) {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    const secretKey = typeof parsed === 'object' && parsed !== null ? (parsed as { secretKey?: unknown }).secretKey : undefined;
    if (typeof secretKey === 'string') {
      const bytes = bs58.decode(secretKey);
      if (bytes.length === KEY_BYTES * 2) return { address: bs58.encode(bytes.subarray(KEY_BYTES)), secretKey };
    }
    throw new Error(`${path} is not a keypair. Delete it; the simulator makes another, and nothing real was in it.`);
  }
  const key = newKeypair();
  mkdirSync(SIMULATOR_DIR, { recursive: true });
  writeFileSync(path, `${JSON.stringify({ secretKey: key.secretKey })}\n`, { flag: 'wx', mode: SECRET_FILE_MODE });
  chmodSync(path, SECRET_FILE_MODE);
  return key;
}
