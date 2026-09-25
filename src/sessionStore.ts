// Where a login session is kept: the platform's credential store when there
// is one, through its own command-line tool, or a file the person has
// agreed to. One item per environment, the session JSON as the secret.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const SERVICE = '@joinbankroll/cli';
const KEYRING_LABEL = 'Bankroll CLI';
const SECRET_FILE_MODE = 0o600;
// What macOS `security` exits with for an item that is not there.
const SECURITY_NOT_FOUND = 44;
// What `secret-tool lookup` exits with when nothing matches.
const SECRET_TOOL_NOT_FOUND = 1;
const HEX = /^(?:[0-9a-f]{2})+$/i;

export interface SessionStore {
  /** For messages: "the macOS keychain", "the file …". */
  readonly where: string;
  read(): string | null;
  write(secret: string): void;
  clear(): boolean;
}

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  // The command itself is not installed.
  missing: boolean;
}

export type Runner = (command: string, args: string[], input?: string) => RunResult;

export const run: Runner = (command, args, input) => {
  const result = spawnSync(command, args, { input, encoding: 'utf8' });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    missing: (result.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT',
  };
};

export class FileStore implements SessionStore {
  readonly where: string;

  constructor(readonly path: string) {
    this.where = `the file ${path}`;
  }

  read(): string | null {
    return existsSync(this.path) ? readFileSync(this.path, 'utf8') : null;
  }

  write(secret: string): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, secret, { mode: SECRET_FILE_MODE });
    // writeFileSync applies the mode only to a new file.
    chmodSync(this.path, SECRET_FILE_MODE);
  }

  clear(): boolean {
    if (!existsSync(this.path)) return false;
    rmSync(this.path);
    return true;
  }
}

/** macOS: the login keychain, through `security`. */
export class KeychainStore implements SessionStore {
  readonly where = 'the macOS keychain';

  constructor(
    private readonly account: string,
    private readonly runner: Runner = run,
  ) {}

  read(): string | null {
    const result = this.runner('security', ['find-generic-password', '-s', SERVICE, '-a', this.account, '-w']);
    if (result.status === SECURITY_NOT_FOUND) return null;
    if (result.status !== 0) throw new Error(`The keychain could not be read: ${result.stderr.trim()}`);
    const printed = result.stdout.replace(/\n$/, '');
    // `security` prints a value that holds a newline or a non-printable byte
    // as hex. A JSON document never looks like plain hex.
    return HEX.test(printed) ? Buffer.from(printed, 'hex').toString('utf8') : printed;
  }

  write(secret: string): void {
    // -U updates an item that is already there.
    const result = this.runner('security', ['add-generic-password', '-s', SERVICE, '-a', this.account, '-U', '-w', secret]);
    if (result.status !== 0) throw new Error(`The keychain refused the login: ${result.stderr.trim()}`);
  }

  clear(): boolean {
    const result = this.runner('security', ['delete-generic-password', '-s', SERVICE, '-a', this.account]);
    if (result.status === SECURITY_NOT_FOUND) return false;
    if (result.status !== 0) throw new Error(`The keychain could not be cleared: ${result.stderr.trim()}`);
    return true;
  }
}

/** Linux: the Secret Service keyring, through libsecret's `secret-tool`. */
export class SecretToolStore implements SessionStore {
  readonly where = 'the system keyring';

  constructor(
    private readonly account: string,
    private readonly runner: Runner = run,
  ) {}

  private get selector(): string[] {
    return ['service', SERVICE, 'account', this.account];
  }

  read(): string | null {
    const result = this.runner('secret-tool', ['lookup', ...this.selector]);
    if (result.status === SECRET_TOOL_NOT_FOUND && !result.stderr.trim()) return null;
    if (result.status !== 0) throw new Error(`The keyring could not be read: ${result.stderr.trim()}`);
    return result.stdout;
  }

  write(secret: string): void {
    const result = this.runner('secret-tool', ['store', `--label=${KEYRING_LABEL}`, ...this.selector], secret);
    if (result.status !== 0) throw new Error(`The keyring refused the login: ${result.stderr.trim()}`);
  }

  clear(): boolean {
    const result = this.runner('secret-tool', ['clear', ...this.selector]);
    if (result.status !== 0) throw new Error(`The keyring could not be cleared: ${result.stderr.trim()}`);
    return true;
  }
}

export interface StoreChoice {
  store: SessionStore | null;
  // Why there is no store, in words a person can act on.
  reason: string | null;
}

/** The platform's credential store for one account, or why there is none. */
export function credentialStore(
  account: string,
  platform: NodeJS.Platform = process.platform,
  runner: Runner = run,
): StoreChoice {
  if (platform === 'darwin') {
    if (runner('security', ['help']).missing) {
      return { store: null, reason: 'the macOS `security` tool is not on PATH' };
    }
    return { store: new KeychainStore(account, runner), reason: null };
  }
  if (platform === 'linux') {
    if (runner('secret-tool', ['--help']).missing) {
      return { store: null, reason: 'libsecret\'s `secret-tool` is not installed (apt: libsecret-tools)' };
    }
    return { store: new SecretToolStore(account, runner), reason: null };
  }
  return { store: null, reason: `this tool has no credential store support for ${platform} yet` };
}
