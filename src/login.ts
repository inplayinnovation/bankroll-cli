// `bankroll login` — a Bankroll account on this computer, for the commands
// that act on your account rather than on a project: approve once in a
// browser, and the session lives in the credential store until `logout`.
import { CAN_CREATE_APPS, graphql, joinBuilder } from './api';
import { openBrowser } from './browser';
import { PRODUCTION, resolveEnvironment } from './environments';
import { pollForTokens, requestDeviceCode } from './privyDevice';
import { ask } from './prompt';
import { clearSession, sessionLocation, writeSession, type SessionLocation } from './session';
import type { SessionStore } from './sessionStore';

const MS_PER_SECOND = 1000;
const FILE_FLAG = '--allow-file-session';
const YES = new Set(['y', 'yes']);

export const WHOAMI_QUERY = `query Whoami { session { user { username walletAddress } } }`;
export const PICK_A_USERNAME = 'Pick a username: `bankroll username <name>`';

export interface Account {
  username: string | null;
  walletAddress: string | null;
}

export interface WhoamiData {
  session: { user: Account | null };
}

export interface AccountOptions {
  // From `-e`; production when absent.
  env?: string;
}

export interface LoginOptions extends AccountOptions {
  // Permission, given up front, to keep the session in a plain file when
  // the credential store cannot be used. For a shell nobody is watching.
  allowFileSession?: boolean;
}

export async function login(options: LoginOptions): Promise<void> {
  const environment = resolveEnvironment(options.env);
  const location = sessionLocation(environment);
  const code = await requestDeviceCode(environment.privyAppId);
  console.log(`\n  Open:  ${code.verificationUrl}`);
  console.log(`  Code:  ${code.userCode}`);
  if (process.stdout.isTTY) {
    openBrowser(code.verificationUrl);
    console.log('\n  Opening it in your browser. Approve it there…');
  } else {
    console.log('\n  Waiting for you to approve it in the browser…');
  }
  const tokens = await pollForTokens(environment.privyAppId, code);
  const session = {
    apiUrl: environment.apiUrl,
    privyAppId: environment.privyAppId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresInSeconds * MS_PER_SECOND,
  };
  const store = await storeFor(location, options);
  writeSession(session, store);
  // A file left from an earlier login must not shadow the keychain.
  if (store !== location.file) location.file.clear();
  // Joining comes first: the api gives an account made on the web its wallet
  // when it joins, and the first line names that wallet.
  await joinBuilder(location);
  const account = await currentAccount(options);
  console.log(`\n  ${loggedInLines(account, environment.name, store.where).join('\n  ')}\n`);
}

/** What `bankroll login` prints once the account is in. */
export function loggedInLines(account: Account, environmentName: string, where: string): string[] {
  return [
    `Logged in as ${describeAccount(account, environmentName)}, kept in ${where}`,
    CAN_CREATE_APPS,
    ...(account.username ? [] : [PICK_A_USERNAME]),
  ];
}

export function logout(options: AccountOptions): void {
  const cleared = clearSession(sessionLocation(resolveEnvironment(options.env)));
  console.log(`\n  ${cleared ? 'Logged out.' : 'Not logged in.'}\n`);
}

export async function whoami(options: AccountOptions): Promise<void> {
  const environment = resolveEnvironment(options.env);
  console.log(`\n  ${describeAccount(await currentAccount(options), environment.name)}\n`);
}

// The credential store, or the file once the person has agreed to it.
async function storeFor(location: SessionLocation, options: LoginOptions): Promise<SessionStore> {
  if (location.keychain) {
    // Write a probe first: a store that is installed can still refuse, e.g.
    // a Linux keyring with no service running.
    try {
      location.keychain.write('{}');
      location.keychain.clear();
      return location.keychain;
    } catch (error) {
      return fileWithPermission(location, `${location.keychain.where} cannot be used: ${(error as Error).message}`, options);
    }
  }
  return fileWithPermission(location, `there is no credential store to use: ${location.reason}`, options);
}

async function fileWithPermission(location: SessionLocation, why: string, options: LoginOptions): Promise<SessionStore> {
  const { file } = location;
  console.log(`\n  ${capitalize(why)}.`);
  console.log(`  The login can be kept in ${file.where} instead, readable by your user only but not encrypted.`);
  if (options.allowFileSession) return file;
  if (!process.stdin.isTTY) {
    throw new Error(`${capitalize(why)}. Run again with ${FILE_FLAG} to keep the login in ${file.where}.`);
  }
  const answer = await ask(undefined, 'Keep the login in that file? (yes/no)', { required: true });
  if (!YES.has(answer!.toLowerCase())) throw new Error('Login cancelled; nothing was stored.');
  return file;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

async function currentAccount(options: AccountOptions): Promise<Account> {
  const data = await graphql<WhoamiData>(sessionLocation(resolveEnvironment(options.env)), WHOAMI_QUERY);
  if (!data.session.user) throw new Error('The api accepted the login but found no account behind it.');
  return data.session.user;
}

/** "@name (wallet)", plus the environment's name when it is not production. */
export function describeAccount(account: Account, environmentName: string): string {
  const name = account.username ? `@${account.username}` : 'an account without a username';
  const where = environmentName === PRODUCTION.name ? '' : ` on ${environmentName}`;
  return `${name} (${account.walletAddress ?? 'no wallet'})${where}`;
}
