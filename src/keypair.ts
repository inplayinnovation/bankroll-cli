// The signing key.
//
// Kept in this tool's own directory rather than the Solana CLI's. Reusing
// ~/.config/solana/id.json would be worse than untidy: that is the Solana CLI
// default and therefore, on many machines, the developer's actual wallet, and
// this tool puts the key it loads into a dev server's environment where any
// dependency in the tree can read it. Our own file bounds the blast radius, and
// deleting it is a complete cleanup.
//
// Writing beside id.json would avoid that but squat in another tool's config
// directory for no gain — `solana balance --keypair ~/.config/bankroll/…` works
// just as well, since the path is only ever an argument.
//
// The file itself is the same JSON byte array `solana-keygen` writes, so the
// Solana CLI reads it and a developer backs it up the way they already know.
import { generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import bs58 from 'bs58';

/** Where this tool keeps its key, unless `--keypair` says otherwise. */
export const DEFAULT_KEYPAIR_PATH = join(homedir(), '.config', 'bankroll', 'keypair.json');

// A Solana secret key is the 32-byte ed25519 seed followed by the 32-byte
// public key. RFC 8410 fixes ed25519's DER encodings at 48 bytes (PKCS#8) and
// 44 (SPKI), each ending in the raw 32-byte key, so the tail is all we need —
// which keeps key generation on node's own crypto.
const KEY_BYTES = 32;
const SECRET_KEY_BYTES = 64;
// Readable and writable by the owner only. A secret key in a world-readable
// file is the kind of thing nobody notices until it matters.
const SECRET_FILE_MODE = 0o600;

export interface Signer {
  /** Base58 public key — the address. */
  address: string;
  /** Base58 secret key, the format @joinbankroll/sdk's keypairSigner takes. */
  secretKey: string;
  /** Where it came from, for printing. */
  path: string;
  /** True when this call created it. */
  created: boolean;
}

function toSigner(secret: Uint8Array, path: string, created: boolean): Signer {
  if (secret.length !== SECRET_KEY_BYTES) {
    throw new Error(
      `${path} is not a Solana keypair: expected ${SECRET_KEY_BYTES} bytes, found ${secret.length}`,
    );
  }
  return {
    address: bs58.encode(secret.subarray(KEY_BYTES)),
    secretKey: bs58.encode(secret),
    path,
    created,
  };
}

function generate(): Uint8Array {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const address = publicKey.export({ format: 'der', type: 'spki' }).subarray(-KEY_BYTES);
  const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-KEY_BYTES);
  return Uint8Array.from(Buffer.concat([seed, address]));
}

function read(path: string): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(`${path} is not readable as a JSON keypair file`, { cause });
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${path} is not a Solana keypair: expected a JSON array of bytes`);
  }
  return Uint8Array.from(parsed as number[]);
}

/**
 * Load the signing key, creating the default one on first use.
 *
 * An explicit `--keypair` path is never created — if a developer names a file,
 * a typo should fail rather than silently mint a new key and leave them
 * wondering where their funds went. Only the default path is created, and only
 * when absent: this never overwrites, the same rule `solana-keygen new`
 * enforces without `--force`.
 */
export function loadSigner(keypairPath?: string): Signer {
  if (keypairPath) {
    if (!existsSync(keypairPath)) {
      throw new Error(`No keypair at ${keypairPath}`);
    }
    return toSigner(read(keypairPath), keypairPath, false);
  }

  const path = DEFAULT_KEYPAIR_PATH;
  if (existsSync(path)) return toSigner(read(path), path, false);

  const secret = generate();
  mkdirSync(dirname(path), { recursive: true });
  // wx: fail if it appeared between the check and the write, rather than
  // clobbering a key that another process just created.
  writeFileSync(path, JSON.stringify(Array.from(secret)), { flag: 'wx', mode: SECRET_FILE_MODE });
  chmodSync(path, SECRET_FILE_MODE);
  return toSigner(secret, path, true);
}
