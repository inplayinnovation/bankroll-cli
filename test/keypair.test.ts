import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_KEYPAIR_PATH, loadSigner } from '../src/keypair';

const scratch = () => mkdtempSync(join(tmpdir(), 'bankroll-cli-'));

describe('DEFAULT_KEYPAIR_PATH', () => {
  // Reusing id.json would make a developer's actual wallet the app's runtime
  // treasury and put it in the environment of a dev server. The Solana CLI's
  // directory is left alone entirely — its path is only ever an argument, so
  // co-locating would buy nothing.
  it('is in this tool\'s own directory, never the Solana CLI\'s', () => {
    expect(DEFAULT_KEYPAIR_PATH).toMatch(/\.config\/bankroll\/keypair\.json$/);
    expect(DEFAULT_KEYPAIR_PATH).not.toMatch(/\.config\/solana\//);
  });
});

describe('loadSigner', () => {
  it('reads a Solana CLI keypair file', () => {
    // A known 64-byte secret key: 32-byte seed followed by 32-byte public key.
    const secret = new Uint8Array(64);
    for (let i = 0; i < 64; i++) secret[i] = i;
    const path = join(scratch(), 'key.json');
    writeFileSync(path, JSON.stringify(Array.from(secret)));

    const signer = loadSigner(path);
    expect(signer.created).toBe(false);
    expect(signer.path).toBe(path);
    expect(bs58.decode(signer.secretKey)).toEqual(secret);
    // The address is the trailing 32 bytes, not the leading seed.
    expect(bs58.decode(signer.address)).toEqual(secret.subarray(32));
  });

  // A typo in --keypair should fail, not silently mint a new key and leave a
  // developer wondering where their funds went.
  it('never creates an explicitly named keypair', () => {
    const path = join(scratch(), 'does-not-exist.json');
    expect(() => loadSigner(path)).toThrow('No keypair at');
  });

  it('rejects a file that is not a keypair', () => {
    const path = join(scratch(), 'junk.json');
    writeFileSync(path, '"not an array"');
    expect(() => loadSigner(path)).toThrow('expected a JSON array of bytes');
  });

  it('rejects a keypair of the wrong length', () => {
    const path = join(scratch(), 'short.json');
    writeFileSync(path, JSON.stringify([1, 2, 3]));
    expect(() => loadSigner(path)).toThrow('expected 64 bytes, found 3');
  });

  it('rejects a file that is not JSON at all', () => {
    const path = join(scratch(), 'binary.json');
    writeFileSync(path, Buffer.from([0xff, 0xfe, 0x00]));
    expect(() => loadSigner(path)).toThrow('not readable as a JSON keypair file');
  });

});

// Creating the default key is the one path that writes to the home directory,
// so these run against a scratch HOME rather than the developer's real one —
// which would otherwise mint a key at their actual ~/.config/bankroll/.
describe('loadSigner: creating the default key', () => {
  async function inScratchHome() {
    const home = scratch();
    const saved = process.env.HOME;
    process.env.HOME = home;
    vi.resetModules();
    const module = await import('../src/keypair');
    return {
      module,
      home,
      restore: () => {
        if (saved === undefined) delete process.env.HOME;
        else process.env.HOME = saved;
      },
    };
  }

  it('creates it on first use and reuses it after', async () => {
    const { module, home, restore } = await inScratchHome();
    try {
      const expected = join(home, '.config', 'bankroll', 'keypair.json');
      expect(module.DEFAULT_KEYPAIR_PATH).toBe(expected);

      const first = module.loadSigner();
      expect(first.created).toBe(true);
      expect(first.path).toBe(expected);
      expect(bs58.decode(first.secretKey)).toHaveLength(64);

      // Never overwritten — the same address comes back, and it is not a new key.
      const second = module.loadSigner();
      expect(second.created).toBe(false);
      expect(second.address).toBe(first.address);
    } finally {
      restore();
    }
  });

  // The file holds a secret key. World-readable is the kind of thing nobody
  // notices until it matters.
  it('creates it readable only by its owner', async () => {
    const { module, restore } = await inScratchHome();
    try {
      const signer = module.loadSigner();
      expect(statSync(signer.path).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(signer.path, 'utf8'))).toHaveLength(64);
    } finally {
      restore();
    }
  });

  it('writes the format the Solana CLI reads', async () => {
    const { module, restore } = await inScratchHome();
    try {
      const signer = module.loadSigner();
      const bytes = JSON.parse(readFileSync(signer.path, 'utf8'));
      expect(Array.isArray(bytes)).toBe(true);
      expect(bytes.every((b: number) => Number.isInteger(b) && b >= 0 && b <= 255)).toBe(true);
      // Round-trips: the address is the trailing 32 bytes of what was written.
      expect(bs58.encode(Uint8Array.from(bytes).subarray(32))).toBe(signer.address);
    } finally {
      restore();
    }
  });
});
