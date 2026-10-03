// `bankroll apps clone` — an app's repo on this computer, and the git
// credential helper that keeps it reachable. The api mints a token for the
// one repo, good for an hour; git asks the helper for one on every fetch and
// push, so nothing is written to disk and the hour never bites.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { graphql } from './api';
import { resolveEnvironment } from './environments';
import type { AccountOptions } from './login';
import { sessionLocation } from './session';
import { SKILL_HINT } from './skill';

const REPO_TOKEN_MUTATION = `mutation RepoToken($id: ID!) { builderRepoToken(id: $id) { repo token expiresAt } }`;
const GITHUB = 'https://github.com';
// The remote's name: `git push bankroll main` is the command.
export const REMOTE = 'bankroll';
// What GitHub expects as the user name for an installation token.
const TOKEN_USER = 'x-access-token';
// The helper subcommand; git runs it as `<command> get`.
export const CREDENTIAL_COMMAND = 'git-credential';
// Where an app says what it is, at the root of its repo. Bankroll signs what
// this file declares in the commit it builds, starting with the name.
export const DECLARATION_FILE = 'bankroll-app.json';

interface RepoTokenData {
  builderRepoToken: { repo: string; token: string; expiresAt: string };
}

export const repoUrl = (repo: string) => `${GITHUB}/${repo}.git`;

/** The helper command git stores for the repo: this tool, same environment, same app. */
export function helperCommand(appId: string, env: string | undefined): string {
  const environment = env === undefined ? '' : ` -e ${env}`;
  return `!bankroll${environment} ${CREDENTIAL_COMMAND} ${appId}`;
}

/**
 * `git clone` arguments: the remote named bankroll, and the helper wired in
 * before the first fetch. Git tries every helper it is configured with, in
 * order, so a global one for github.com (gh, the keychain) would answer
 * first with the person's own account, which cannot push to the app's repo.
 * The empty value resets that list for this repo's URL, and useHttpPath is
 * what makes git match a URL that names the repo, not only the host.
 */
export function cloneArgs(repo: string, directory: string, helper: string): string[] {
  const context = `credential.${repoUrl(repo)}`;
  return [
    'clone',
    '-o',
    REMOTE,
    '-c',
    'credential.useHttpPath=true',
    '-c',
    `${context}.helper=`,
    '-c',
    `${context}.helper=${helper}`,
    repoUrl(repo),
    directory,
  ];
}

/** What git reads back from the helper on `get`. */
export function credentialReply(token: string): string {
  return `username=${TOKEN_USER}\npassword=${token}\n`;
}

/**
 * The directory a named app is cloned into: "Free Throw Duel" lands in
 * free-throw-duel. Undefined when nothing of the name can be a path, and the
 * repo's own name stands in.
 */
export function directoryFor(name: string): string | undefined {
  const directory = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return directory === '' ? undefined : directory;
}

/** The declaration with the name in it, beside whatever else the app declares. */
export function withName(declaration: string, name: string): string {
  const declared: unknown = JSON.parse(declaration);
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    throw new Error(`${DECLARATION_FILE} does not hold a JSON object`);
  }
  return `${JSON.stringify({ ...declared, name }, null, 2)}\n`;
}

/** `git commit` arguments for the name: that one file, whatever else has changed. */
export function nameCommitArgs(target: string, name: string): string[] {
  return ['-C', target, 'commit', '--quiet', '-m', `Name the app ${name}`, '--', DECLARATION_FILE];
}

const locationFor = (options: AccountOptions) => sessionLocation(resolveEnvironment(options.env));

async function repoToken(appId: string, options: AccountOptions): Promise<RepoTokenData['builderRepoToken']> {
  const data = await graphql<RepoTokenData>(locationFor(options), REPO_TOKEN_MUTATION, { id: appId });
  return data.builderRepoToken;
}

export async function clone(appId: string, directory: string | undefined, options: AccountOptions): Promise<void> {
  const { name } = await cloneRepo(appId, directory, options);
  console.log(`  cd ${name} && npm install\n`);
}

/**
 * The clone itself: the app's repo on disk, with the remote named bankroll.
 * Returns the directory it made, so a caller can say what comes next.
 * `apps create` calls this too, which is why the closing advice is the
 * caller's and not this function's.
 */
/** What runs a command in a directory and reports how it went: spawnSync, or a test's stand-in. */
export type Runner = (command: string, args: string[], options: { cwd: string }) => { error?: Error; status: number | null };

const npmRunner: Runner = (command, args, { cwd }) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  return { ...(result.error ? { error: result.error } : {}), status: result.status };
};

/**
 * `npm install` in a fresh clone, with npm's own output showing, so a new app
 * is ready to run the moment `create` is done. Throws with the command to run
 * by hand when it fails: the clone is there either way.
 */
export function installDependencies(target: string, run: Runner = npmRunner): void {
  console.log(`\n  Installing dependencies in ${basename(target)}...\n`);
  const result = run('npm', ['install'], { cwd: target });
  if (result.error) throw new Error(`npm could not be run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`npm install exited with ${result.status}`);
}

export async function cloneRepo(
  appId: string,
  directory: string | undefined,
  options: AccountOptions,
): Promise<{ name: string; target: string; repo: string }> {
  const { repo } = await repoToken(appId, options);
  const name = directory ?? basename(repo);
  const target = resolve(name);
  const result = spawnSync('git', cloneArgs(repo, target, helperCommand(appId, options.env)), { stdio: 'inherit' });
  if (result.error) throw new Error(`git could not be run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`git clone exited with ${result.status}`);
  console.log(`\n  Cloned ${repo} into ${target}.`);
  console.log(`  The remote is named ${REMOTE}: \`git push ${REMOTE} main\` saves your changes to the app's repo.`);
  console.log(`  ${SKILL_HINT}`);
  return { name, target, repo };
}

/**
 * A name given to `apps create`, put where the app declares it and committed,
 * so the first push carries it. False when git would not commit: the file
 * names the app all the same, and the caller says to commit it.
 */
export function declareName(target: string, name: string): boolean {
  const path = join(target, DECLARATION_FILE);
  writeFileSync(path, withName(existsSync(path) ? readFileSync(path, 'utf8') : '{}', name));
  return spawnSync('git', nameCommitArgs(target, name), { stdio: 'inherit' }).status === 0;
}

/**
 * The git credential helper. Git writes the request on stdin and expects the
 * reply on stdout; anything else printed there would corrupt it. `store` and
 * `erase` are acknowledged and ignored: there is nothing kept.
 */
export async function gitCredential(appId: string, action: string, options: AccountOptions): Promise<void> {
  if (action !== 'get') return;
  const { token } = await repoToken(appId, options);
  process.stdout.write(credentialReply(token));
}
