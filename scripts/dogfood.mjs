#!/usr/bin/env node
// One command for working on the CLI, the SDK, the simulator and an app at the
// same time, with every one of them picking up a change on save.
//
//   npm run dogfood -- ../my-app
//   npm run dogfood -- ../my-app --no-open     leave the browser alone
//
// It starts four things and keeps them running until Ctrl-C:
//
//   sdk   the SDK's build, on every save. Each build is copied into the app's
//         node_modules, and the app reloads with it.
//   cli   this CLI's build, on every save. The app is restarted with it.
//   sim   the simulator's own dev server, hot reloading, on port 4100.
//   app   the app, through this repo's `bankroll dev --simulator`.
//
// The SDK is copied into the app, not linked. Next will not read a linked
// package that lives outside the app's own directory unless the app's config
// is changed, and a local path in the app's package.json is one push away
// from breaking its deploy. A copy changes nothing the app's repo tracks.
//
// The SDK is looked for beside this repo, in ../bankroll-sdk. BANKROLL_SDK
// names another place. Without one, the app runs on the SDK it has installed.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const simulator = join(root, 'simulator');
// 4100 and 4101, unless told otherwise on a machine where those are taken.
const SIMULATOR_PORT = Number(process.env.BANKROLL_SIMULATOR_PORT ?? 4100);
const API_PORT = Number(process.env.BANKROLL_SIMULATOR_API_PORT ?? SIMULATOR_PORT + 1);
// Where the app is tried first. It keeps one port across restarts, so the
// simulator's tab goes on pointing at it.
const APP_PORT = 3000;
// Left in the copied build, so a copy that something replaced can be told apart.
const MARKER = '.dogfood';
const MARKER_CHECK_MS = 2_000;
// tsup reports its JavaScript and its type declarations separately, a second
// or so apart: the copy waits for the build to go quiet.
const SETTLE_MS = 1_500;
const BUILT = /Build success/;
// A build tool lists every file it writes. What matters is that it built, or why not.
const buildNews = (line) => (/Build success|rror|failed/.test(line) ? line : null);

// The simulator's dev server hands /api to the CLI, which is only there while
// the app is up. A page left open asks in the gap, at the start and whenever
// the CLI is rebuilt, and each refusal is forty lines of stack. One line says it.
function apiGap() {
  let inside = false;
  let said = 0;
  return (line) => {
    if (/Failed to proxy|^AggregateError/.test(line.trim())) {
      inside = true;
      if (Date.now() - said < 10_000) return null;
      said = Date.now();
      return 'A page asked for /api before the app was up. Reload it if an icon or a name is missing.';
    }
    if (inside && /^\s|^[}\]]/.test(line)) return null;
    inside = false;
    return line;
  };
}

const flags = process.argv.slice(2).filter((argument) => argument.startsWith('--'));
const [given] = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
if (!given) fail('Name the app to run: npm run dogfood -- ../my-app');
const app = resolve(given);
if (!existsSync(join(app, 'package.json'))) fail(`${app} has no package.json: it does not look like an app.`);
const sdk = resolve(process.env.BANKROLL_SDK ?? join(root, '..', 'bankroll-sdk'));
const installedSdk = join(app, 'node_modules', '@joinbankroll', 'sdk');

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

const colors = { sdk: 35, cli: 36, sim: 33, app: 32, dogfood: 90 };
// npm announces every script it runs, which is nothing anyone needs to read.
const NOISE = /^npm notice/;
// `reading` turns a child's line into what is printed for it, or null for nothing.
const say = (who, text, reading = (line) => line) => {
  const label = process.stdout.isTTY ? `\x1b[${colors[who]}m${who.padEnd(7)}\x1b[0m` : who.padEnd(7);
  for (const raw of String(text).split('\n')) {
    const line = raw.trim() === '' || NOISE.test(raw.trim()) ? null : reading(raw);
    if (line !== null) console.log(`${label} ${line}`);
  }
};

const running = new Map();

// Every child leads a process group of its own, so its own children end with it.
function start(who, command, args, options = {}) {
  const child = spawn(command, args, { cwd: options.cwd ?? root, env: { ...process.env, ...options.env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  running.set(who, child);
  const heard = (chunk) => {
    say(who, chunk, options.reading);
    options.onOutput?.(String(chunk));
  };
  child.stdout.on('data', heard);
  child.stderr.on('data', heard);
  child.on('exit', (code) => {
    if (running.get(who) === child) running.delete(who);
    if (!stopping && !options.restarts) say('dogfood', `${who} stopped${code === null ? '' : ` with code ${code}`}.`);
  });
  return child;
}

function stop(who) {
  const child = running.get(who);
  if (!child) return;
  running.delete(who);
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true;
    for (const who of [...running.keys()]) stop(who);
    process.exit(0);
  });
}

const portFree = (port) =>
  new Promise((done) => {
    const probe = createServer();
    probe.once('error', () => done(false));
    probe.listen(port, () => probe.close(() => done(true)));
  });

async function firstFree(from) {
  for (let port = from; port < from + 50; port++) if (await portFree(port)) return port;
  fail(`No free port from ${from}.`);
}

// --- the SDK: built on save, copied into the app ---------------------------

function copySdk(news) {
  const built = join(sdk, 'dist');
  if (!existsSync(built) || !existsSync(installedSdk)) return;
  const target = join(installedSdk, 'dist');
  const incoming = `${target}.incoming`;
  const outgoing = `${target}.outgoing`;
  rmSync(incoming, { recursive: true, force: true });
  cpSync(built, incoming, { recursive: true });
  writeFileSync(join(incoming, MARKER), `${sdk}\n${new Date().toISOString()}\n`);
  // Swapped in whole: the app's dev server never finds half a build.
  rmSync(outgoing, { recursive: true, force: true });
  if (existsSync(target)) renameSync(target, outgoing);
  renameSync(incoming, target);
  rmSync(outgoing, { recursive: true, force: true });
  say('dogfood', news);
}

function watchSdk() {
  if (!existsSync(join(sdk, 'package.json'))) {
    say('dogfood', `No SDK at ${sdk}: the app runs on the one it has installed. BANKROLL_SDK names another place.`);
    return;
  }
  if (!existsSync(installedSdk)) {
    say('dogfood', `${app} has no @joinbankroll/sdk installed, so there is nowhere to copy the SDK to. Run npm install there.`);
    return;
  }
  // What is built already goes in now, so the app starts on it.
  copySdk(`The app runs the SDK in ${sdk} from here on.`);
  let settle;
  // Its source alone: a watch on the whole folder would see its own output.
  start('sdk', 'npx', ['tsup', '--watch', 'src'], {
    cwd: sdk,
    reading: buildNews,
    onOutput: (text) => {
      if (!BUILT.test(text)) return;
      clearTimeout(settle);
      settle = setTimeout(() => copySdk('SDK rebuilt, and copied into the app.'), SETTLE_MS);
    },
  });
  // npm ci, or a deleted node_modules, puts the published SDK back.
  setInterval(() => {
    if (existsSync(installedSdk) && !existsSync(join(installedSdk, 'dist', MARKER))) copySdk('Something replaced the SDK in the app. Copied it back.');
  }, MARKER_CHECK_MS).unref();
}

// --- the app, through this CLI, restarted when the CLI is rebuilt ----------

let appPort;
let opened = flags.includes('--no-open');

function runApp() {
  stop('app');
  const args = [join(root, 'dist', 'index.js'), 'dev', '--simulator', '-p', String(appPort)];
  // The browser is opened once. After that the tab is already there.
  if (opened) args.push('--no-open');
  opened = true;
  start('app', 'node', args, {
    cwd: app,
    restarts: true,
    env: { BANKROLL_SIMULATOR_URL: `http://localhost:${SIMULATOR_PORT}`, BANKROLL_SIMULATOR_API: `http://localhost:${API_PORT}` },
  });
}

function watchCli() {
  let settle;
  // src alone: the simulator's dev server writes into this repo all day.
  start('cli', 'npx', ['tsup', '--watch', 'src'], {
    reading: buildNews,
    onOutput: (text) => {
      if (!BUILT.test(text)) return;
      clearTimeout(settle);
      settle = setTimeout(() => {
        say('dogfood', running.has('app') ? 'CLI rebuilt: restarting the app with it.' : 'CLI built: starting the app.');
        runApp();
      }, 300);
    },
  });
}

// --- the simulator's own dev server -----------------------------------------

async function runSimulator() {
  if (!(await portFree(SIMULATOR_PORT))) fail(`Port ${SIMULATOR_PORT} is taken, and the simulator's dev server needs it. Stop whatever is running there first.`);
  if (!(await portFree(API_PORT))) fail(`Port ${API_PORT} is taken, and the CLI answers the simulator there. Stop whatever is running there first.`);
  if (!existsSync(join(simulator, 'node_modules'))) {
    say('dogfood', 'Installing the simulator’s dependencies, once.');
    await new Promise((done) => start('sim', 'npm', ['ci'], { cwd: simulator, restarts: true }).on('exit', done));
  }
  start('sim', 'npx', ['next', 'dev', '-p', String(SIMULATOR_PORT)], {
    cwd: simulator,
    reading: apiGap(),
    env: { BANKROLL_SIMULATOR_API: `http://localhost:${API_PORT}` },
  });
}

const name = JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')).name ?? app;
say('dogfood', `Running ${name} from ${app}. Ctrl-C stops everything.`);
await runSimulator();
appPort = await firstFree(APP_PORT);
watchSdk();
watchCli();
