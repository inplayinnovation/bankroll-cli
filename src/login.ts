// `bankroll login` — a Bankroll account on this computer, for the commands
// that act on your account rather than on a project: approve once in a
// browser, and the session lives in the credential store until `logout`.
import { graphql } from './api';
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

export interface WhoamiData {
  session: { user: { username: string | null; walletAddress: string | null } | null };
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
  console.log(`\n  Logged in as ${await describeUser(options)}, kept in ${store.where}\n`);
}

export function logout(options: AccountOptions): void {
  const cleared = clearSession(sessionLocation(resolveEnvironment(options.env)));
  console.log(`\n  ${cleared ? 'Logged out.' : 'Not logged in.'}\n`);
}

export async function whoami(options: AccountOptions): Promise<void> {
  console.log(`\n  ${await describeUser(options)}\n`);
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

// "@name (wallet)", plus the environment's name when it is not production.
async function describeUser(options: AccountOptions): Promise<string> {
  const environment = resolveEnvironment(options.env);
  const data = await graphql<WhoamiData>(sessionLocation(environment), WHOAMI_QUERY);
  const user = data.session.user;
  if (!user) throw new Error('The api accepted the login but found no account behind it.');
  const name = user.username ? `@${user.username}` : 'an account without a username';
  const where = environment.name === PRODUCTION.name ? '' : ` on ${environment.name}`;
  return `${name} (${user.walletAddress ?? 'no wallet'})${where}`;
}
