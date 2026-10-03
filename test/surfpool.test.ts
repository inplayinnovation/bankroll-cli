import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { cachedSurfpool, fetchSurfpool, locateSurfpool, SURFPOOL_BUILDS, SURFPOOL_VERSION, surfpoolBuild, surfpoolPath, versionOf } from '../src/host/surfpool';

const scratch = () => mkdtempSync(join(tmpdir(), 'bankroll-surfpool-'));

/** A release's build, as the real one is: a tar.gz with the one binary in it. Here the binary is a shell script that says its version. */
function fakeRelease(platform: NodeJS.Platform = 'darwin', version = '9.9.9'): { archive: Buffer; sha256: string } {
  const dir = scratch();
  const name = platform === 'win32' ? 'surfpool.exe' : 'surfpool';
  writeFileSync(join(dir, name), `#!/bin/sh\necho "surfpool ${version}"\n`);
  chmodSync(join(dir, name), 0o755);
  execFileSync('tar', ['-czf', join(dir, 'build.tar.gz'), '-C', dir, name]);
  const archive = readFileSync(join(dir, 'build.tar.gz'));
  return { archive, sha256: createHash('sha256').update(archive).digest('hex') };
}

const servers: Server[] = [];
afterEach(() => {
  while (servers.length) servers.pop()!.close();
  vi.restoreAllMocks();
});

/** GitHub, as far as the fetch is concerned: the asset at its path, or 404. */
async function releaseServer(assets: Record<string, Buffer>): Promise<string> {
  const server = createServer((request, response) => {
    const body = assets[request.url?.split('/').pop() ?? ''];
    if (!body) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/gzip', 'content-length': body.length }).end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const machine = { platform: 'darwin' as const, arch: 'arm64' };

describe('surfpoolBuild', () => {
  it('names a build for each machine the CLI supports, with a checksum pinned', () => {
    for (const [key, build] of Object.entries(SURFPOOL_BUILDS)) {
      const [platform, arch] = key.split('-');
      expect(surfpoolBuild(platform as NodeJS.Platform, arch)).toBe(build);
      expect(build.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(build.asset).toContain('surfpool-');
    }
    expect(surfpoolBuild('linux', 'arm64')).toBeNull();
    expect(surfpoolBuild('freebsd', 'x64')).toBeNull();
  });

  it('keeps the node beside the keys, by version, named for the platform', () => {
    expect(surfpoolPath('/home/me/.config/bankroll/simulator', '1.6.0', 'darwin')).toBe('/home/me/.config/bankroll/simulator/surfpool/1.6.0/surfpool');
    expect(surfpoolPath('/home/me/.config/bankroll/simulator', '1.6.0', 'win32')).toBe('/home/me/.config/bankroll/simulator/surfpool/1.6.0/surfpool.exe');
  });
});

describe('fetchSurfpool', () => {
  it('fetches the build, checks it, unpacks it, and keeps it for next time', async () => {
    const release = fakeRelease();
    const build = surfpoolBuild(machine.platform, machine.arch)!;
    const pinned = vi.spyOn(SURFPOOL_BUILDS, 'darwin-arm64', 'get').mockReturnValue({ asset: build.asset, sha256: release.sha256 });
    const from = await releaseServer({ [build.asset]: release.archive });
    const dir = scratch();
    const seen: number[] = [];

    const path = await fetchSurfpool({ ...machine, dir, from, progress: (fraction) => seen.push(fraction) });
    expect(path).toBe(surfpoolPath(dir, SURFPOOL_VERSION, 'darwin'));
    expect(statSync(path).mode & 0o111).toBeTruthy();
    expect(versionOf(path)).toBe('9.9.9');
    expect(seen.at(-1)).toBe(1);
    // Nothing of the download is left but the binary.
    expect(readdirSync(join(dir, 'surfpool', SURFPOOL_VERSION))).toEqual(['surfpool']);
    expect(cachedSurfpool(dir)).toBe(path);

    // Already here: nothing is fetched again.
    servers.pop()!.close();
    expect(await fetchSurfpool({ ...machine, dir, from })).toBe(path);
    pinned.mockRestore();
  });

  it('throws away a build that does not match its checksum', async () => {
    const release = fakeRelease();
    const build = surfpoolBuild(machine.platform, machine.arch)!;
    const from = await releaseServer({ [build.asset]: release.archive });
    const dir = scratch();
    // The pinned checksum is the real release's, which this fake is not.
    await expect(fetchSurfpool({ ...machine, dir, from })).rejects.toThrow(/did not match its pinned checksum/);
    expect(cachedSurfpool(dir)).toBeNull();
    expect(readdirSync(join(dir, 'surfpool', SURFPOOL_VERSION))).toEqual([]);
  });

  it('says so when the release has no such build, or no such machine', async () => {
    const from = await releaseServer({});
    await expect(fetchSurfpool({ ...machine, dir: scratch(), from })).rejects.toThrow(/answered 404/);
    await expect(fetchSurfpool({ platform: 'linux', arch: 'arm64', dir: scratch(), from })).rejects.toThrow(/not built for linux-arm64/);
  });
});

describe('locateSurfpool', () => {
  it('takes the node already here before anything else', async () => {
    const dir = scratch();
    const path = surfpoolPath(dir, SURFPOOL_VERSION, 'darwin');
    mkdirSync(join(dir, 'surfpool', SURFPOOL_VERSION), { recursive: true });
    writeFileSync(path, '#!/bin/sh\necho "surfpool 1.6.0"\n');
    const fetchImpl = vi.fn();
    expect(await locateSurfpool({ ...machine, dir, fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ path, version: SURFPOOL_VERSION, from: 'cache' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches when none is here, and falls back to the machine\'s own when the fetch fails', async () => {
    const said: string[] = [];
    const from = await releaseServer({});
    // Nothing on the PATH either.
    expect(await locateSurfpool({ ...machine, dir: scratch(), from, env: { PATH: scratch() }, log: (line) => said.push(line) })).toBeNull();
    expect(said.join('\n')).toMatch(/could not be fetched/);

    // One on the PATH: used, and said to be.
    const bin = scratch();
    writeFileSync(join(bin, 'surfpool'), '#!/bin/sh\necho "surfpool 1.1.2"\n');
    chmodSync(join(bin, 'surfpool'), 0o755);
    const located = await locateSurfpool({ ...machine, dir: scratch(), from, env: { PATH: bin }, log: () => {} });
    expect(located).toEqual({ path: join(bin, 'surfpool'), version: '1.1.2', from: 'path' });
    expect(existsSync(join(bin, 'surfpool'))).toBe(true);
  });
});
