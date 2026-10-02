import { describe, expect, it } from 'vitest';

import { isNewer, latestVersion, updateNotice } from '../src/update';

const registry = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('isNewer', () => {
  it('compares releases as numbers, part by part', () => {
    expect(isNewer('0.6.0', '0.5.0')).toBe(true);
    expect(isNewer('0.10.0', '0.9.9')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.5.1', '0.5.0')).toBe(true);
    expect(isNewer('0.5.0', '0.5.0')).toBe(false);
    expect(isNewer('0.4.9', '0.5.0')).toBe(false);
  });

  it('is never newer when either side cannot be read', () => {
    expect(isNewer('latest', '0.5.0')).toBe(false);
    expect(isNewer('0.6', '0.5.0')).toBe(false);
    expect(isNewer('0.6.0', '')).toBe(false);
  });
});

describe('latestVersion', () => {
  it('asks the registry for a package\'s latest release', async () => {
    const asked: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      asked.push(String(input));
      return new Response(JSON.stringify({ version: '0.33.0' }), { status: 200 });
    }) as typeof fetch;
    expect(await latestVersion('@joinbankroll/sdk', fetchImpl)).toBe('0.33.0');
    expect(asked).toEqual(['https://registry.npmjs.org/@joinbankroll/sdk/latest']);
  });

  it('is undefined when the registry cannot say', async () => {
    expect(await latestVersion('@joinbankroll/sdk', registry({}, 404))).toBeUndefined();
    expect(await latestVersion('@joinbankroll/sdk', registry({ version: 33 }))).toBeUndefined();
    const offline = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await latestVersion('@joinbankroll/sdk', offline)).toBeUndefined();
  });
});

describe('updateNotice', () => {
  it('says which release is out, and both ways to get it', async () => {
    const notice = await updateNotice('0.5.0', registry({ version: '0.6.0' }));
    expect(notice).toContain('bankroll 0.6.0 is out; this is 0.5.0.');
    expect(notice).toContain('npm i -D @joinbankroll/cli@latest');
    expect(notice).toContain('npm i -g @joinbankroll/cli@latest');
  });

  it('says nothing on the latest release, or ahead of it', async () => {
    expect(await updateNotice('0.6.0', registry({ version: '0.6.0' }))).toBeNull();
    expect(await updateNotice('0.7.0', registry({ version: '0.6.0' }))).toBeNull();
  });

  // Being offline is not something to report on every `dev`.
  it('says nothing when the registry cannot be asked', async () => {
    expect(await updateNotice('0.5.0', registry({}, 503))).toBeNull();
    expect(await updateNotice('0.5.0', registry({ name: 'no version here' }))).toBeNull();
    const offline = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await updateNotice('0.5.0', offline)).toBeNull();
  });
});
