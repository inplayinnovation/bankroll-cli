// `bankroll dev` — the app in Bankroll Desktop: a phone on this computer,
// shown to a pretend user who pays in fake dollars on a local chain, with
// every call the app makes listed beside it (src/desktop.ts). Bankroll
// Desktop runs the app's dev server itself; this command hands it the folder
// and says where the app came up. The dev signing key, which holds real
// money, stays out of it: the app's treasury there is a key made up for the
// purpose.
//
// `--phone` is the other way to look at the app, on a phone running Bankroll.
// A Built for Bankroll app only ever runs inside Bankroll, and Bankroll refuses
// any origin that is not public HTTPS — so localhost cannot be opened however
// reachable it is. A Cloudflare quick tunnel comes up alongside the dev server,
// and the QR opens the app through it, with real sessions and real money, paid
// to the dev signing key.
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

import { open, openLink, waitForProject } from './desktop';
import { playUrl, resolveEnvironment } from './environments';
import { loadSigner } from './keypair';
import { launchPath } from './manifest';
import { printQr } from './qr';
import { updateNotice } from './update';

const DEV_COMMAND = 'next';
const DEV_ARGS = ['dev'];
const TUNNEL_TIMEOUT_MS = 20_000;

// cloudflared logs its own control-plane host while requesting the tunnel, and
// the library matches any *.trycloudflare.com hostname — so this one arrives
// first and has to be skipped to reach the assigned subdomain.
const TUNNEL_API_ORIGIN = 'https://api.trycloudflare.com';

// The dev server reads this; it is never written to a file.
const TREASURY_KEY_ENV = 'BANKROLL_TREASURY_KEY';

export interface DevOptions {
  // From `-e`: the play link opens the app in that environment's Bankroll.
  env?: string;
  /** With --phone: the dev server's port. Bankroll Desktop picks its own. */
  port?: string;
  keypair?: string;
  /** The app on a phone, through a tunnel and a QR, in place of Bankroll Desktop. */
  phone?: boolean;
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

/**
 * The default: the folder this runs in, opened in Bankroll Desktop. The link
 * launches Bankroll Desktop or reaches the one running; the state file says
 * when the app's server is up and where. This command then ends: the server
 * is Bankroll Desktop's, with its log in the Server tab.
 */
async function openInDesktop(dir: string, options: DevOptions, notice: Promise<string | null>): Promise<void> {
  if (process.platform !== 'darwin')
    throw new Error('Bankroll Desktop runs on macOS for now. Here, `bankroll dev --phone` opens the app on your phone.');
  if (options.port)
    console.warn('\n  Bankroll Desktop picks the port: 3000 when it is free, the next ones up when it is not. --port is for --phone.');
  if (open(openLink(dir)) === 'missing') throw new Error('Bankroll Desktop is not installed.');
  console.log('\n  Opening the app in Bankroll Desktop…');
  const result = await waitForProject(dir);
  if ('problem' in result) throw new Error(result.problem);
  console.log(`\n  Your app is open in Bankroll Desktop, shown to a pretend user who pays fake dollars on a local chain.\n  ${result.url}\n`);
  const update = await notice;
  if (update) console.log(`  ${update.replace(/\n/g, '\n  ')}\n`);
}

export async function dev(options: DevOptions, version: string): Promise<void> {
  // Asked now, said at the end, beside the link.
  const notice = updateNotice(version);
  if (!options.phone) {
    await openInDesktop(process.cwd(), options, notice);
    return;
  }

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
  // The manifest is asked of localhost, not the tunnel: the answer is the same
  // either way, and going direct works on a machine that cannot resolve the
  // tunnel's hostname. By the time a tunnel has come up the dev server has
  // been ready for seconds, so this is a single request with no waiting.
  const target = `${origin}${await launchPath(`http://localhost:${port}`)}`;
  const link = `${playUrl(resolveEnvironment(options.env))}?url=${encodeURIComponent(target)}`;

  // The play link is printed in full under the QR, so it can be copied or
  // re-encoded verbatim.
  console.log('');
  printQr(link);
  console.log(`\n  Scan to open the app on your phone\n  ${target}\n  Play link: ${link}\n`);
  const update = await notice;
  if (update) console.log(`  ${update.replace(/\n/g, '\n  ')}\n`);
}
