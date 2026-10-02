// `bankroll dev --simulator` — the app in a phone on this computer's screen,
// in place of a phone.
//
// The simulator is a page: an iPhone frame around the app, and beside it every
// call the app makes to its host. It is built from simulator/ into
// dist/simulator as static files. This serves them, and answers the paths
// the page calls on its own origin:
//
//   /api/manifest?url=   what an app says about itself: its name, where it
//                        opens, its icon. The page cannot ask the app, which is
//                        another origin whose manifest carries no CORS header.
//   /api/apps            the app this command is running, for the home screen.
//   /api/versions        which CLI this is and which SDK the app has, and what
//                        is worth saying of either (src/versions.ts).
//
// It listens on this computer's loopback addresses and nowhere else: the
// manifest path fetches whatever origin it is given, which is nothing to offer
// a network.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { versionReport, type About } from './versions';

/** Where the simulator is served, unless something else already has the port. */
export const SIMULATOR_PORT = 4100;
// The simulator's own dev server takes 4100 when someone is working on it, and
// hands the /api paths to this one (simulator/next.config.ts).
const API_PORT = 4101;
// How many ports past the first are tried before giving up.
const PORT_ATTEMPTS = 20;

// A version as a package states one. What the page passes on is the app's word.
const VERSION = /^\d+\.\d+\.\d+[\w.+-]*$/;

const MANIFEST_PATH = '/.well-known/bankroll.jwt';
const ICON_PATH = '/.well-known/bankroll-icon.png';
// An app whose dev server is not running should not hold the home screen up.
const APP_TIMEOUT_MS = 3_000;

/** What the page learns about an app. The same shape as simulator/lib/apps.ts. */
export interface AppManifest {
  /** True when the origin serves a Bankroll manifest. */
  bankroll: boolean;
  name?: string;
  /** The path a Bankroll app opens at. */
  launch?: string;
  /** Where its icon is, when it has drawn one. */
  icon?: string;
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[^/:]+\.localhost)(:\d+)?(\/|$)/i;
// Names made of labels, or an IPv6 address: what a URL parser accepts is wider.
const HOSTNAME = /^(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)$/i;

/**
 * The origin of an app's address, or null when it is not a web address. A
 * local address typed without a scheme is http, any other https, as the page
 * reads them (simulator/lib/apps.ts).
 */
export function appOrigin(input: string | null): string | null {
  const text = input?.trim() ?? '';
  if (text === '' || /\s/.test(text)) return null;
  const whole = HAS_SCHEME.test(text) ? text : `${LOCAL_HOST.test(text) ? 'http' : 'https'}://${text}`;
  let url: URL;
  try {
    url = new URL(whole);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return HOSTNAME.test(url.hostname) ? url.origin : null;
}

/** The claims of a manifest, which is a JWT: header.claims.signature. Null when it is not one. */
export function manifestClaims(jwt: string): Record<string, unknown> | null {
  try {
    const claims: unknown = JSON.parse(Buffer.from(jwt.trim().split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof claims === 'object' && claims !== null && !Array.isArray(claims) ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const NOT_BANKROLL: AppManifest = { bankroll: false };

/**
 * What the app at an origin says about itself. The signature is not checked:
 * this names an icon on a home screen, it does not admit an app. An app that
 * is not running, or has no manifest, is an app all the same, just not a
 * Bankroll one.
 */
export async function readManifest(origin: string, fetchImpl: typeof fetch = fetch): Promise<AppManifest> {
  const ask = (path: string) => fetchImpl(`${origin}${path}`, { signal: AbortSignal.timeout(APP_TIMEOUT_MS) });
  try {
    const response = await ask(MANIFEST_PATH);
    const claims = response.ok ? manifestClaims(await response.text()) : null;
    if (!claims) return NOT_BANKROLL;
    const { name, launch } = claims;
    // An app has no icon until someone draws one, and a missing file answers
    // with a page, not an image.
    const icon = await ask(ICON_PATH)
      .then((found) => {
        void found.body?.cancel();
        return found.ok && (found.headers.get('content-type') ?? '').startsWith('image/');
      })
      .catch(() => false);
    return {
      bankroll: true,
      ...(typeof name === 'string' && name.trim() !== '' ? { name: name.trim() } : {}),
      ...(typeof launch === 'string' && launch.startsWith('/') ? { launch } : {}),
      ...(icon ? { icon: `${origin}${ICON_PATH}` } : {}),
    };
  } catch {
    return NOT_BANKROLL;
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
const BINARY = 'application/octet-stream';
// Next names these files after their contents, so one never changes.
const HASHED = '/_next/static/';
const NOT_FOUND = '404.html';

/**
 * The file a path names under the root, the way a static site is served:
 * `/` is index.html, `/page` is page.html. Null when there is none, and for
 * any path that would climb out of the root.
 */
export function staticFile(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const path = normalize(join(root, decoded));
  if (path !== root && !path.startsWith(`${root}${sep}`)) return null;
  for (const candidate of [path, `${path}.html`, join(path, 'index.html')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
}

function sendFile(request: IncomingMessage, response: ServerResponse, status: number, file: string, pathname: string): void {
  response.writeHead(status, {
    'content-type': CONTENT_TYPES[extname(file)] ?? BINARY,
    'content-length': statSync(file).size,
    // The page itself is asked for again every time, so a newer CLI is a newer
    // simulator at the next reload.
    'cache-control': pathname.startsWith(HASHED) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).pipe(response);
}

export interface SimulatorOptions {
  /** The built simulator's files, or null when its own dev server serves the page and this answers /api only. */
  root: string | null;
  /** The running app's address, as the page should open it. */
  app: string;
  /** This CLI and the running app's folder, which /api/versions reads. Without it that path is not answered. */
  about?: About;
  fetchImpl?: typeof fetch;
}

/** Answers one request: the /api paths, then the simulator's own files. */
export function simulatorHandler(options: SimulatorOptions): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    const { pathname, searchParams } = new URL(request.url ?? '/', 'http://localhost');

    if (pathname === '/api/apps') {
      sendJson(response, 200, { apps: [options.app] });
      return;
    }
    if (pathname === '/api/versions' && options.about) {
      // The page says which app is in the phone, and which SDK that app said
      // it runs. Only the running app's folder is this command's to read.
      const open = appOrigin(searchParams.get('app'));
      const reported = searchParams.get('sdk');
      const asked = { open: open !== null, own: open !== null && open === appOrigin(options.app), ...(reported && VERSION.test(reported) ? { reported } : {}) };
      void versionReport(options.about, asked).then((report) => sendJson(response, 200, report));
      return;
    }
    if (pathname === '/api/manifest') {
      const origin = appOrigin(searchParams.get('url'));
      if (!origin) {
        sendJson(response, 400, { error: 'url must be a web address' });
        return;
      }
      void readManifest(origin, options.fetchImpl).then((manifest) => sendJson(response, 200, manifest));
      return;
    }

    const file = options.root && staticFile(options.root, pathname);
    if (file) {
      sendFile(request, response, 200, file, pathname);
      return;
    }
    const missing = options.root && staticFile(options.root, NOT_FOUND);
    if (missing) sendFile(request, response, 404, missing, NOT_FOUND);
    else response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  };
}

const LOOPBACK_V4 = '127.0.0.1';
const LOOPBACK_V6 = '::1';

const IN_USE = 'EADDRINUSE';
const EVERY_V4 = '0.0.0.0';
const EVERY_V6 = '::';

/** Null once listening, or why not. */
function listen(server: Server | NetServer, port: number, host: string): Promise<string | null> {
  return new Promise((resolve) => {
    server.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'failed'));
    server.listen(port, host, () => resolve(null));
  });
}

const closed = (server: NetServer) => new Promise<void>((resolve) => server.close(() => resolve()));

/**
 * True when nobody is listening on the port on every address at once, which is
 * how a dev server listens. A loopback address can be bound on top of such a
 * listener without complaint, and then silently answers in its place: found by
 * taking a developer's own simulator off the air while testing this.
 */
async function unclaimed(port: number): Promise<boolean> {
  for (const host of [EVERY_V4, EVERY_V6]) {
    const probe = createNetServer();
    const refused = await listen(probe, port, host);
    if (refused === null) await closed(probe);
    else if (refused === IN_USE) return false;
    // Any other refusal is a machine without that address family: nothing to collide with.
  }
  return true;
}

/** A port the system says is free on every address. */
async function anyPort(): Promise<number> {
  const probe = createNetServer();
  await listen(probe, 0, EVERY_V4);
  const address = probe.address();
  await closed(probe);
  return typeof address === 'object' && address ? address.port : 0;
}

/**
 * Listens on this computer alone, at the first free port from the one asked
 * for; `attempts` of 1 takes that port or fails. Port 0 asks the system for any.
 *
 * "localhost" is 127.0.0.1 to some programs and ::1 to others, so the port has
 * to be free on both: a browser that prefers ::1 would otherwise reach whoever
 * else is listening there. A machine with no ::1 is served on 127.0.0.1 alone.
 */
export async function listenLocally(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  port: number,
  attempts = PORT_ATTEMPTS,
): Promise<{ port: number; close: () => void }> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const candidate = port === 0 ? await anyPort() : port + attempt;
    if (!(await unclaimed(candidate))) continue;
    const v4 = createServer(handler);
    if ((await listen(v4, candidate, LOOPBACK_V4)) !== null) continue;
    const v6 = createServer(handler);
    const refused = await listen(v6, candidate, LOOPBACK_V6);
    if (refused === IN_USE) {
      v4.close();
      continue;
    }
    return {
      port: candidate,
      close: () => {
        v4.close();
        if (refused === null) v6.close();
      },
    };
  }
  throw new Error(attempts === 1 ? `Port ${port} is taken on this computer.` : `No free port on this computer from ${port} to ${port + attempts - 1}.`);
}

/** The built simulator, beside this file in dist. */
export const builtSimulator = (): string => join(dirname(fileURLToPath(import.meta.url)), 'simulator');

const opened = (simulator: string, app: string) => `${simulator}/?${new URLSearchParams({ app })}`;

export interface Simulator {
  /** The page to open: the simulator, on the app. */
  url: string;
  stop: () => void;
}

/**
 * Serves the simulator for one app.
 *
 * With BANKROLL_SIMULATOR_URL set, the page is being served by its own dev
 * server at that address, for someone working on the simulator itself: only
 * the /api paths are answered here, where that dev server sends them.
 */
export async function serveSimulator(app: string, env: NodeJS.ProcessEnv = process.env, about?: About): Promise<Simulator> {
  const told = about ? { about } : {};
  const live = env.BANKROLL_SIMULATOR_URL?.replace(/\/+$/, '');
  if (live) {
    // That dev server sends /api to one address, so this port or none.
    const port = Number(new URL(env.BANKROLL_SIMULATOR_API ?? `http://localhost:${API_PORT}`).port);
    const api = await listenLocally(simulatorHandler({ root: null, app, ...told }), port, 1);
    return { url: opened(live, app), stop: api.close };
  }
  const root = builtSimulator();
  if (!existsSync(join(root, 'index.html'))) {
    throw new Error(`The simulator is not in this build of the CLI (${root} is missing). In the CLI's repo, \`npm run build\` builds it.`);
  }
  const server = await listenLocally(simulatorHandler({ root, app, ...told }), SIMULATOR_PORT);
  return { url: opened(`http://localhost:${server.port}`, app), stop: server.close };
}
