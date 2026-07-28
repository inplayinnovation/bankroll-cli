import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { addAppToken, readAppTokens } from '../src/appTokens';

// The file is read and written relative to cwd, which is what makes it a
// well-known location in a project rather than a configured path.
const original = process.cwd();
beforeEach(() => process.chdir(mkdtempSync(join(tmpdir(), 'bankroll-tokens-'))));
afterEach(() => process.chdir(original));

describe('readAppTokens', () => {
  it('is empty when the file does not exist', () => {
    expect(readAppTokens()).toEqual({});
  });

  it('reads what is there', () => {
    writeFileSync('app-tokens.json', JSON.stringify({ M1nt: { name: 'Acme' } }));
    expect(readAppTokens()).toEqual({ M1nt: { name: 'Acme' } });
  });

  it('refuses a file that is not an object', () => {
    writeFileSync('app-tokens.json', '[]');
    expect(() => readAppTokens()).toThrow('must be an object keyed by mint address');
  });

  it('refuses a file that is not JSON', () => {
    writeFileSync('app-tokens.json', '{nope');
    expect(() => readAppTokens()).toThrow('is not valid JSON');
  });
});

describe('addAppToken', () => {
  it('creates the file with one entry', () => {
    addAppToken('M1nt', { name: 'Acme', description: 'Promo credit.' });
    expect(readAppTokens()).toEqual({ M1nt: { name: 'Acme', description: 'Promo credit.' } });
  });

  // An app may issue several — the manifest claim is keyed by mint.
  it('keeps existing entries', () => {
    addAppToken('First', { name: 'One' });
    addAppToken('Second', { name: 'Two' });
    expect(Object.keys(readAppTokens())).toEqual(['First', 'Second']);
  });

  it('refuses to redefine a token', () => {
    addAppToken('M1nt', { name: 'One' });
    expect(() => addAppToken('M1nt', { name: 'Two' })).toThrow('already has an entry');
  });

  // Both fields are optional to the host, and an empty string is invalid — so
  // omit rather than write one.
  it('omits fields that were not given', () => {
    addAppToken('M1nt', { name: 'Acme' });
    expect(readAppTokens().M1nt).toEqual({ name: 'Acme' });
  });

  it('writes the shape the manifest claim takes, formatted for a human', () => {
    addAppToken('M1nt', { name: 'Acme' });
    const raw = readFileSync('app-tokens.json', 'utf8');
    expect(raw).toBe('{\n  "M1nt": {\n    "name": "Acme"\n  }\n}\n');
  });
});
