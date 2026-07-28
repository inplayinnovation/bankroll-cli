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
import { delimiter, join } from 'node:path';

import { bin, install, Tunnel } from 'cloudflared';

import { loadSigner } from './keypair';
import { qrLines } from './qr';

const DEFAULT_PORT = '3000';
const DEV_COMMAND = 'next';
const DEV_ARGS = ['dev'];
const TUNNEL_TIMEOUT_MS = 20_000;

// cloudflared logs its own control-plane host while requesting the tunnel, and
// the library matches any *.trycloudflare.com hostname — so this one arrives
// first and has to be skipped to reach the assigned subdomain.
const TUNNEL_API_ORIGIN = 'https://api.trycloudflare.com';

const PLAY_LINK = 'https://joinbankroll.com/play?url=';

// The dev server reads these; neither is ever written to a file.
const TREASURY_KEY_ENV = 'BANKROLL_TREASURY_KEY';
const TUNNEL_ORIGIN_ENV = 'BANKROLL_DEV_TUNNEL_ORIGIN';

export interface DevOptions {
  port?: string;
  keypair?: string;
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
  const port = options.port ?? process.env.PORT ?? DEFAULT_PORT;
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

  const { origin, stop } = await openTunnel(port);

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
      ...(origin ? { [TUNNEL_ORIGIN_ENV]: origin } : {}),
    },
  });

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

  // The origin, not a path inside the app. /play loads exactly the URL it is
  // given, so this opens whatever the app serves at its root — which is the
  // app's own decision, not this tool's to second-guess.
  const link = `${PLAY_LINK}${encodeURIComponent(origin)}`;

  console.log('');
  for (const line of qrLines(link)) console.log('  ' + line);
  console.log(`\n  Scan to open the app on your phone\n  ${origin}\n`);
}
