import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PRODUCTION, resolveEnvironment } from '../src/environments';

const scratch = () => join(mkdtempSync(join(tmpdir(), 'bankroll-cli-')), 'environments.json');

describe('resolveEnvironment', () => {
  it('is production when no name is given, with no file needed', () => {
    expect(resolveEnvironment(undefined, scratch())).toBe(PRODUCTION);
    expect(resolveEnvironment('production', scratch())).toBe(PRODUCTION);
  });

  it('reads a named environment from the file, as an origin', () => {
    const path = scratch();
    writeFileSync(path, JSON.stringify({ other: { apiUrl: 'https://api.example.test/', privyAppId: 'app_9' } }));
    expect(resolveEnvironment('other', path)).toEqual({
      name: 'other',
      apiUrl: 'https://api.example.test',
      privyAppId: 'app_9',
    });
  });

  it('explains the file when it is missing or lacks the name', () => {
    const path = scratch();
    expect(() => resolveEnvironment('other', path)).toThrow('No environments are defined');
    writeFileSync(path, JSON.stringify({ another: { apiUrl: 'https://a.test', privyAppId: 'x' } }));
    expect(() => resolveEnvironment('other', path)).toThrow('"other" is not defined');
    writeFileSync(path, JSON.stringify({ other: { apiUrl: 'https://a.test' } }));
    expect(() => resolveEnvironment('other', path)).toThrow('"other" is not defined');
  });
});
