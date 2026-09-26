// `bankroll apps clone` — an app's repo on this computer, and the git
// credential helper that keeps it reachable. The api mints a token for the
// one repo, good for an hour; git asks the helper for one on every fetch and
// push, so nothing is written to disk and the hour never bites.
import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';

import { graphql } from './api';
import { SKILL_HINT } from './apps';
import { resolveEnvironment } from './environments';
import type { AccountOptions } from './login';
import { sessionLocation } from './session';

const REPO_TOKEN_MUTATION = `mutation RepoToken($id: ID!) { builderRepoToken(id: $id) { repo token expiresAt } }`;
const GITHUB = 'https://github.com';
// The remote's name: `git push bankroll main` is the command.
export const REMOTE = 'bankroll';
// What GitHub expects as the user name for an installation token.
const TOKEN_USER = 'x-access-token';
// The helper subcommand; git runs it as `<command> get`.
export const CREDENTIAL_COMMAND = 'git-credential';

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

const locationFor = (options: AccountOptions) => sessionLocation(resolveEnvironment(options.env));

async function repoToken(appId: string, options: AccountOptions): Promise<RepoTokenData['builderRepoToken']> {
  const data = await graphql<RepoTokenData>(locationFor(options), REPO_TOKEN_MUTATION, { id: appId });
  return data.builderRepoToken;
}

export async function clone(appId: string, directory: string | undefined, options: AccountOptions): Promise<void> {
  const { repo } = await repoToken(appId, options);
  const target = resolve(directory ?? basename(repo));
  const result = spawnSync('git', cloneArgs(repo, target, helperCommand(appId, options.env)), { stdio: 'inherit' });
  if (result.error) throw new Error(`git could not be run: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`git clone exited with ${result.status}`);
  console.log(`\n  Cloned ${repo} into ${target}.`);
  console.log(`  The remote is named ${REMOTE}: \`git push ${REMOTE} main\` saves your changes to the app's repo.`);
  console.log(`  ${SKILL_HINT}\n`);
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
