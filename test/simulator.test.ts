import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { appOrigin, listenLocally, manifestClaims, readManifest, serveSimulator, simulatorHandler, staticFile } from '../src/simulator';

const jwt = (claims: unknown) => `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;

const APP = 'http://localhost:3000';

// An app's server, as fetch sees it: a manifest, and perhaps an icon.
function appServer(routes: Record<string, { status?: number; body?: string; type?: string }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    const route = routes[path];
    if (!route) return new Response('<html>not here</html>', { status: 404, headers: { 'content-type': 'text/html' } });
    return new Response(route.body ?? '', { status: route.status ?? 200, headers: { 'content-type': route.type ?? 'text/plain' } });
  }) as typeof fetch;
}

// A built simulator, as far as serving it goes.
function site(): string {
  const root = mkdtempSync(join(tmpdir(), 'bankroll-cli-'));
  mkdirSync(join(root, 'site', '_next', 'static'), { recursive: true });
  mkdirSync(join(root, 'site', 'devices'));
  writeFileSync(join(root, 'site', 'index.html'), '<html>simulator</html>');
  writeFileSync(join(root, 'site', '404.html'), '<html>nothing here</html>');
  writeFileSync(join(root, 'site', 'about.html'), '<html>about</html>');
  writeFileSync(join(root, 'site', 'devices', 'index.html'), '<html>devices</html>');
  writeFileSync(join(root, 'site', '_next', 'static', 'app.js'), 'console.log(1)');
  writeFileSync(join(root, 'secret.txt'), 'outside the root');
  return join(root, 'site');
}

const closing: (() => void)[] = [];
afterEach(() => {
  while (closing.length) closing.pop()!();
});

async function serving(options: Parameters<typeof simulatorHandler>[0]): Promise<string> {
  const server = await listenLocally(simulatorHandler(options), 0);
  closing.push(server.close);
  return `http://127.0.0.1:${server.port}`;
}

describe('appOrigin', () => {
  it('is the origin of a web address, however it was typed', () => {
    expect(appOrigin('http://localhost:3000/app')).toBe('http://localhost:3000');
    expect(appOrigin('localhost:3000')).toBe('http://localhost:3000');
    expect(appOrigin('  127.0.0.1:8080/x  ')).toBe('http://127.0.0.1:8080');
    expect(appOrigin('br-17-a18mds.vercel.app/app')).toBe('https://br-17-a18mds.vercel.app');
    expect(appOrigin('https://example.com/a?b=c')).toBe('https://example.com');
  });

  // The path fetches whatever it is given, so it is given only the web.
  it('refuses anything else', () => {
    for (const input of [null, '', 'not a url', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.com', 'http://', 'https://exa mple.com']) {
      expect(appOrigin(input)).toBeNull();
    }
  });
});

describe('manifestClaims', () => {
  it('reads the claims out of a manifest', () => {
    expect(manifestClaims(jwt({ name: 'Stackline', launch: '/app' }))).toEqual({ name: 'Stackline', launch: '/app' });
  });

  it('is null for anything that is not one', () => {
    expect(manifestClaims('<html>not found</html>')).toBeNull();
    expect(manifestClaims('')).toBeNull();
    expect(manifestClaims(jwt(['a', 'list']))).toBeNull();
  });
});

describe('readManifest', () => {
  const manifest = { body: jwt({ sub: APP, name: ' Stackline ', launch: '/app' }) };

  it("is a Bankroll app's name, where it opens, and its icon", async () => {
    const fetchImpl = appServer({ '/.well-known/bankroll.jwt': manifest, '/.well-known/bankroll-icon.png': { type: 'image/png' } });
    expect(await readManifest(APP, fetchImpl)).toEqual({
      bankroll: true,
      name: 'Stackline',
      launch: '/app',
      icon: `${APP}/.well-known/bankroll-icon.png`,
    });
  });

  // A missing icon answers with the app's not-found page, which is not an image.
  it('has no icon until the app has drawn one', async () => {
    expect(await readManifest(APP, appServer({ '/.well-known/bankroll.jwt': manifest }))).toEqual({ bankroll: true, name: 'Stackline', launch: '/app' });
    const page = appServer({ '/.well-known/bankroll.jwt': manifest, '/.well-known/bankroll-icon.png': { type: 'text/html' } });
    expect(await readManifest(APP, page)).not.toHaveProperty('icon');
  });

  it('leaves out a name or a launch path that is not usable', async () => {
    const fetchImpl = appServer({ '/.well-known/bankroll.jwt': { body: jwt({ name: '  ', launch: 'app' }) } });
    expect(await readManifest(APP, fetchImpl)).toEqual({ bankroll: true });
  });

  it('is not a Bankroll app without a manifest, or without a server', async () => {
    expect(await readManifest(APP, appServer({}))).toEqual({ bankroll: false });
    expect(await readManifest(APP, appServer({ '/.well-known/bankroll.jwt': { body: 'hello' } }))).toEqual({ bankroll: false });
    const down = (async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    expect(await readManifest(APP, down)).toEqual({ bankroll: false });
  });
});

describe('staticFile', () => {
  it('finds a page the way a static site names it', () => {
    const root = site();
    expect(staticFile(root, '/')).toBe(join(root, 'index.html'));
    expect(staticFile(root, '/about')).toBe(join(root, 'about.html'));
    expect(staticFile(root, '/devices')).toBe(join(root, 'devices', 'index.html'));
    expect(staticFile(root, '/_next/static/app.js')).toBe(join(root, '_next', 'static', 'app.js'));
    expect(staticFile(root, '/missing')).toBeNull();
  });

  it('never leaves the root', () => {
    const root = site();
    for (const path of ['/../secret.txt', '/%2e%2e/secret.txt', '/devices/../../secret.txt', '/..%2fsecret.txt', '/%00', '/%E0%A4%A']) {
      expect(staticFile(root, path)).toBeNull();
    }
  });
});

describe('the simulator, served', () => {
  it('serves the page fresh and its hashed files for good', async () => {
    const at = await serving({ root: site(), app: `${APP}/app` });

    const page = await fetch(`${at}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect(await page.text()).toBe('<html>simulator</html>');

    const hashed = await fetch(`${at}/_next/static/app.js`);
    expect(hashed.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(hashed.headers.get('cache-control')).toContain('immutable');

    const missing = await fetch(`${at}/nowhere`);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe('<html>nothing here</html>');
  });

  it('names the app it was started for', async () => {
    const at = await serving({ root: site(), app: `${APP}/app` });
    expect(await (await fetch(`${at}/api/apps`)).json()).toEqual({ apps: [`${APP}/app`] });
  });

  it("answers for an app's manifest, and refuses what is not a web address", async () => {
    const fetchImpl = appServer({ '/.well-known/bankroll.jwt': { body: jwt({ name: 'Stackline', launch: '/app' }) } });
    const at = await serving({ root: site(), app: `${APP}/app`, fetchImpl });

    const answer = await fetch(`${at}/api/manifest?${new URLSearchParams({ url: `${APP}/app` })}`);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(await answer.json()).toEqual({ bankroll: true, name: 'Stackline', launch: '/app' });

    expect((await fetch(`${at}/api/manifest?url=javascript:alert(1)`)).status).toBe(400);
    expect((await fetch(`${at}/api/manifest`)).status).toBe(400);
  });

  it('says which CLI this is, and which SDK the open app has, when it is told about them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bankroll-cli-app-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { '@joinbankroll/sdk': '^0.32.0' } }));
    mkdirSync(join(dir, 'node_modules', '@joinbankroll', 'sdk'), { recursive: true });
    writeFileSync(join(dir, 'node_modules', '@joinbankroll', 'sdk', 'package.json'), JSON.stringify({ version: '0.19.1' }));
    const latest = async (name: string) => (name === '@joinbankroll/sdk' ? '0.32.0' : '0.5.0');
    const at = await serving({ root: site(), app: `${APP}/app`, about: { cli: '0.5.0', dir, local: false, latest } });
    const cli = { version: '0.5.0', latest: '0.5.0', behind: false, local: false };

    // On the home screen there is no SDK to speak of.
    expect(await (await fetch(`${at}/api/versions`)).json()).toEqual({ cli });

    // The running app: its folder is read, and what it says it runs is believed.
    const own = await (await fetch(`${at}/api/versions?${new URLSearchParams({ app: `${APP}/app`, sdk: '0.19.1' })}`)).json();
    expect(own).toEqual({ cli, sdk: { version: '0.19.1', latest: '0.32.0', behind: true, local: false, installed: '0.19.1', wanted: '^0.32.0', stale: true } });

    // Another app, and a version that is not one.
    const other = await (await fetch(`${at}/api/versions?${new URLSearchParams({ app: 'https://elsewhere.example/app', sdk: '<script>' })}`)).json();
    expect(other).toEqual({ cli, sdk: { latest: '0.32.0', behind: false, local: false, stale: false } });
  });

  it('does not answer for versions when nobody told it about them', async () => {
    const at = await serving({ root: site(), app: APP });
    expect((await fetch(`${at}/api/versions`)).status).toBe(404);
  });

  it('only reads', async () => {
    const at = await serving({ root: site(), app: APP });
    expect((await fetch(`${at}/api/apps`, { method: 'POST' })).status).toBe(405);
  });

  // The simulator's own dev server serves the page then, and sends /api here.
  it('answers /api alone when the page is served elsewhere', async () => {
    const at = await serving({ root: null, app: APP });
    expect((await fetch(`${at}/api/apps`)).status).toBe(200);
    expect((await fetch(`${at}/`)).status).toBe(404);
  });
});

describe('listenLocally', () => {
  const everywhere = (server: Server) =>
    new Promise<number>((resolve) => server.listen(0, () => resolve((server.address() as AddressInfo).port)));

  // A loopback address binds on top of a server that listens on every address,
  // and then answers in its place. That server is usually someone's dev server.
  it('does not sit in front of a server that listens on every address', async () => {
    const other = createServer((_request, response) => response.end('the other server'));
    const port = await everywhere(other);
    closing.push(() => other.close());

    const mine = await listenLocally((_request, response) => response.end('mine'), port);
    closing.push(mine.close);
    expect(mine.port).not.toBe(port);
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('the other server');
    expect(await (await fetch(`http://127.0.0.1:${mine.port}/`)).text()).toBe('mine');

    await expect(listenLocally((_request, response) => response.end('mine'), port, 1)).rejects.toThrow(`Port ${port} is taken`);
  });
});

describe('serveSimulator', () => {
  it('says so when the simulator was never built', async () => {
    // Under test this file is in src, with no built simulator beside it.
    await expect(serveSimulator(APP, {})).rejects.toThrow('The simulator is not in this build');
  });

  it("opens the simulator's own dev server on the app when one is named", async () => {
    const free = await listenLocally(() => {}, 0);
    free.close();
    const simulator = await serveSimulator(`${APP}/app`, {
      BANKROLL_SIMULATOR_URL: 'http://localhost:4100/',
      BANKROLL_SIMULATOR_API: `http://localhost:${free.port}`,
    });
    closing.push(simulator.stop);
    expect(simulator.url).toBe('http://localhost:4100/?app=http%3A%2F%2Flocalhost%3A3000%2Fapp');
    expect(await (await fetch(`http://127.0.0.1:${free.port}/api/apps`)).json()).toEqual({ apps: [`${APP}/app`] });
  });
});
