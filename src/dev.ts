// `bankroll dev` — your dev server, plus a way onto a phone.
//
// A Built for Bankroll app only ever runs inside Bankroll, and Bankroll refuses
// any origin that is not public HTTPS — so localhost cannot be opened however
// reachable it is. A Cloudflare quick tunnel comes up alongside the dev server,
// and the QR opens the app through it.
//
// Quick tunnels need no Cloudflare account, and because the phone reaches the
// app over the public internet rather than the local network, this also works
// on networks that isolate clients from each other (most hotel, venue, and
// in-flight Wi-Fi).
//
// `--simulator` is the other way to look at the app: no phone and no tunnel,
// the app in a phone frame in this computer's browser, as a pretend user
// (src/simulator.ts).
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { delimiter, join } from 'node:path';

import { bin, install, Tunnel } from 'cloudflared';

import { openBrowser } from './browser';
import { loadSigner } from './keypair';
import { qrLines, qrTextLines } from './qr';
import { serveSimulator } from './simulator';
import { updateNotice } from './update';

const DEV_COMMAND = 'next';
const DEV_ARGS = ['dev'];
const TUNNEL_TIMEOUT_MS = 20_000;
// How long a dev server gets to answer its first request, and how often it is asked.
const SERVER_TIMEOUT_MS = 60_000;
const SERVER_POLL_MS = 250;

// cloudflared logs its own control-plane host while requesting the tunnel, and
// the library matches any *.trycloudflare.com hostname — so this one arrives
// first and has to be skipped to reach the assigned subdomain.
const TUNNEL_API_ORIGIN = 'https://api.trycloudflare.com';

const PLAY_LINK = 'https://joinbankroll.com/play?url=';
const MANIFEST_PATH = '/.well-known/bankroll.jwt';
const MANIFEST_TIMEOUT_MS = 5_000;

// The dev server reads this; it is never written to a file.
const TREASURY_KEY_ENV = 'BANKROLL_TREASURY_KEY';
// What makes the app's server accept the SDK's stand-in host, and its page
// carry one: the pretend user the simulator shows the app to.
const MOCK_ENV = 'BANKROLL_MOCK';

export interface DevOptions {
  port?: string;
  keypair?: string;
  /** The app in the simulator on this computer, in place of the tunnel and the QR. */
  simulator?: boolean;
  /** False to print the simulator's link and leave the browser alone, for a shell with nobody at it. */
  open?: boolean;
}

/**
 * A port nobody is using.
 *
 * Which one does not matter: the app is reached through the tunnel, and the
 * only requirement is that the tunnel and the dev server agree. Asking the OS
 * beats defaulting to 3000 and colliding with whatever else is running — and
 * beats letting the dev server pick, because then the tunnel points at a port
 * it never chose.
 */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('could not find a free port'));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}

/**
 * Where the app boots, from the manifest it is serving.
 *
 * Asked of localhost, not the tunnel: the answer is the same either way, and
 * going direct means this works on a machine that cannot resolve the tunnel's
 * hostname. By the time a tunnel has finished coming up the dev server has been
 * ready for seconds, so this is a single request with no waiting.
 *
 * Falls back to the origin. A QR pointing at the app's root still opens
 * something; refusing to print one because a manifest was slow would not.
 */
async function launchPath(port: string): Promise<string> {
  try {
    const response = await fetch(`http://localhost:${port}${MANIFEST_PATH}`, {
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
    });
    if (!response.ok) return '';
    const payload = (await response.text()).trim().split('.')[1];
    if (!payload) return '';
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const launch = (claims as { launch?: unknown })?.launch;
    return typeof launch === 'string' ? launch : '';
  } catch {
    return '';
  }
}

// The tunnel is a convenience, not a prerequisite — without one the dev server
// still serves localhost fine. A failure degrades to no QR rather than blocking
// development entirely.
async function openTunnel(port: string): Promise<{ origin: string | null; stop: () => void }> {
  // cloudflared exports the path it expects its binary at; install() puts it
  // there. Checked first so a present binary skips a network round trip.
  // npm 11 blocks a dependency's install script unless the person allows it,
  // so on most machines the download happens here, on the first run. A long
  // silence looks like a hang, so say what is happening.
  if (!existsSync(bin)) {
    console.log('\n  Downloading the tunnel, once. This may take a minute…\n');
    await install(bin);
  }
  const tunnel = Tunnel.quick(`http://localhost:${port}`);

  const origin = await new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => settle(null), TUNNEL_TIMEOUT_MS);
    const onUrl = (url: string) => {
      // Keep listening past the control-plane host rather than taking the first
      // URL, which is a race the wrong answer sometimes wins.
      if (url !== TUNNEL_API_ORIGIN) settle(url);
    };
    function settle(value: string | null) {
      clearTimeout(timer);
      tunnel.off('url', onUrl);
      resolve(value);
    }
    tunnel.on('url', onUrl);
    tunnel.once('error', () => settle(null));
  });

  return { origin, stop: () => tunnel.stop() };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** True once the dev server answers anything at all; false if it never does. */
async function serverReady(port: string): Promise<boolean> {
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://localhost:${port}${MANIFEST_PATH}`, { signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS) });
      return true;
    } catch {
      await wait(SERVER_POLL_MS);
    }
  }
  return false;
}

/**
 * The simulator's half of `dev`: the page that shows the app, served from this
 * computer and opened in the browser, on the app's launch path.
 *
 * There is no tunnel to wait for here, so the dev server may not be up yet:
 * the browser is opened once it answers, not on a page that refuses to load.
 */
async function simulate(port: string, child: ChildProcess, notice: Promise<string | null>, open: boolean): Promise<void> {
  let stop = () => {};
  const shutdown = () => {
    stop();
    child.kill();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Before the wait below, so a dev server that dies at once ends this too.
  child.on('exit', (code) => {
    stop();
    process.exit(code ?? 0);
  });

  if (!(await serverReady(port))) {
    console.warn(`\n  The dev server has not answered on port ${port}, so the simulator was not opened.\n`);
    return;
  }
  const simulator = await serveSimulator(`http://localhost:${port}${await launchPath(port)}`).catch((error: unknown) => {
    // No simulator is a failure of the whole command: the dev server goes with it.
    child.kill();
    throw error;
  });
  stop = simulator.stop;

  const update = await notice;
  console.log(`\n  Your app is open in the simulator, as a pretend user: no money moves.\n  ${simulator.url}\n`);
  if (update) console.log(`  ${update.replace(/\n/g, '\n  ')}\n`);
  if (open) openBrowser(simulator.url);
}

export async function dev(options: DevOptions, version: string): Promise<void> {
  // An explicit choice wins; otherwise take whatever is free.
  const port = options.port ?? process.env.PORT ?? String(await freePort());
  const signer = loadSigner(options.keypair);
  // Asked now, said at the end, beside the link.
  const notice = updateNotice(version);

  if (signer.created) {
    console.log(`
  Created a signing key

    address   ${signer.address}
    file      ${signer.path}

  This key receives payments, signs payouts, and becomes your token's mint
  authority. Back it up. It is never written into your project.
`);
  }

  // The dev server first, then the tunnel. Nothing in the app's environment
  // depends on the tunnel, so starting it first means the manifest is already
  // being served by the time there is a URL to point at — which is what lets the
  // QR carry the app's real launch path instead of guessing.
  const child = spawn(DEV_COMMAND, [...DEV_ARGS, '-p', port], {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      // npm puts node_modules/.bin on PATH for a script, and npx does for a
      // local install — but a global install run inside a project does not, and
      // then `next` is not found. Prepending it makes every entry point behave
      // the same.
      PATH: `${join(process.cwd(), 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? ''}`,
      // Injected into this process only. The secret never reaches .env.local,
      // so it cannot be committed and does not survive the session.
      [TREASURY_KEY_ENV]: signer.secretKey,
      // The simulator has no host but the stand-in. Set here and not left to
      // the app's .env files, which an older app does not have.
      ...(options.simulator ? { [MOCK_ENV]: '1' } : {}),
    },
  });

  if (options.simulator) {
    await simulate(port, child, notice, options.open !== false);
    return;
  }

  const { origin, stop } = await openTunnel(port);

  const shutdown = () => {
    stop();
    child.kill();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  child.on('exit', (code) => {
    stop();
    process.exit(code ?? 0);
  });

  if (!origin) {
    console.warn('\n  No tunnel — opening the app on a phone needs one. Check your connection.\n');
    return;
  }

  // /play loads exactly the URL it is given, so the launch path has to be in
  // the link — pointing at the origin opens whatever the app serves at its
  // root, which for most apps is a landing page rather than the app.
  const target = `${origin}${await launchPath(port)}`;
  const link = `${PLAY_LINK}${encodeURIComponent(target)}`;

  // A TTY gets the colored QR. Anything else — piped or backgrounded, which is
  // how a coding agent runs this — gets bare glyphs: the colored QR's contrast
  // is entirely in its ANSI codes, which do not survive being re-printed into
  // a chat. NO_COLOR (any value) forces the same on a TTY. The play link is
  // printed in full either way, so it can be copied or re-encoded verbatim.
  const plain = !process.stdout.isTTY || process.env.NO_COLOR !== undefined;
  console.log('');
  for (const line of plain ? qrTextLines(link) : qrLines(link)) console.log('  ' + line);
  console.log(`\n  Scan to open the app on your phone\n  ${target}\n  Play link: ${link}\n`);
  const update = await notice;
  if (update) console.log(`  ${update.replace(/\n/g, '\n  ')}\n`);
}
