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
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { delimiter, join } from 'node:path';

import { bin, install, Tunnel } from 'cloudflared';

import { loadSigner } from './keypair';
import { qrLines } from './qr';

const DEV_COMMAND = 'next';
const DEV_ARGS = ['dev'];
const TUNNEL_TIMEOUT_MS = 20_000;

// cloudflared logs its own control-plane host while requesting the tunnel, and
// the library matches any *.trycloudflare.com hostname — so this one arrives
// first and has to be skipped to reach the assigned subdomain.
const TUNNEL_API_ORIGIN = 'https://api.trycloudflare.com';

const PLAY_LINK = 'https://joinbankroll.com/play?url=';
const MANIFEST_PATH = '/.well-known/bankroll.jwt';
const MANIFEST_TIMEOUT_MS = 5_000;

// The dev server reads this; it is never written to a file.
const TREASURY_KEY_ENV = 'BANKROLL_TREASURY_KEY';

export interface DevOptions {
  port?: string;
  keypair?: string;
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
  if (!existsSync(bin)) await install(bin);
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

export async function dev(options: DevOptions): Promise<void> {
  // An explicit choice wins; otherwise take whatever is free.
  const port = options.port ?? process.env.PORT ?? String(await freePort());
  const signer = loadSigner(options.keypair);

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
    },
  });

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

  console.log('');
  for (const line of qrLines(link)) console.log('  ' + line);
  console.log(`\n  Scan to open the app on your phone\n  ${target}\n`);
}
