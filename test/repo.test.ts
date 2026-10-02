import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  cloneArgs,
  credentialReply,
  declareName,
  directoryFor,
  helperCommand,
  nameCommitArgs,
  repoUrl,
  withName,
} from '../src/repo';

const git = (directory: string, ...args: string[]) =>
  execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim();

// A clone as `apps create` leaves it: the starter's empty declaration,
// committed. The identity and the signing setting are the scratch repo's own,
// so the test does not depend on the machine's.
function scratchClone(): string {
  const directory = mkdtempSync(join(tmpdir(), 'bankroll-cli-'));
  git(directory, 'init', '--quiet');
  git(directory, 'config', 'user.name', 'Test');
  git(directory, 'config', 'user.email', 'test@example.com');
  git(directory, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(directory, 'bankroll-app.json'), '{}\n');
  writeFileSync(join(directory, 'README.md'), 'The starter.\n');
  git(directory, 'add', '.');
  git(directory, 'commit', '--quiet', '-m', 'The starter');
  return directory;
}

describe('helperCommand', () => {
  it('names this tool, the environment, and the app', () => {
    expect(helperCommand('53', undefined)).toBe('!bankroll git-credential 53');
    expect(helperCommand('53', 'stag')).toBe('!bankroll -e stag git-credential 53');
  });
});

describe('cloneArgs', () => {
  it('names the remote bankroll and makes this helper the only one for the repo', () => {
    expect(cloneArgs('bankroll-apps/br-53-vzzo4b', '/work/stackline', '!bankroll git-credential 53')).toEqual([
      'clone',
      '-o',
      'bankroll',
      '-c',
      'credential.useHttpPath=true',
      '-c',
      'credential.https://github.com/bankroll-apps/br-53-vzzo4b.git.helper=',
      '-c',
      'credential.https://github.com/bankroll-apps/br-53-vzzo4b.git.helper=!bankroll git-credential 53',
      'https://github.com/bankroll-apps/br-53-vzzo4b.git',
      '/work/stackline',
    ]);
    expect(repoUrl('bankroll-apps/br-53-vzzo4b')).toBe('https://github.com/bankroll-apps/br-53-vzzo4b.git');
  });
});

describe('credentialReply', () => {
  it("is the user name GitHub expects for an installation token, and the token", () => {
    expect(credentialReply('ghs_abc')).toBe('username=x-access-token\npassword=ghs_abc\n');
  });
});

describe('directoryFor', () => {
  it('is the name as a path: lower case, words joined by hyphens', () => {
    expect(directoryFor('Free Throw Duel')).toBe('free-throw-duel');
    expect(directoryFor('  Café Olé!  ')).toBe('cafe-ole');
    expect(directoryFor('21')).toBe('21');
  });

  // The name is typed by a person and becomes a path, so it never climbs.
  it('cannot leave the directory it is run in', () => {
    expect(directoryFor('../../etc/passwd')).toBe('etc-passwd');
    expect(directoryFor('/tmp/x')).toBe('tmp-x');
  });

  it('is nothing when no letter or digit survives, and the repo name stands in', () => {
    expect(directoryFor('日本語')).toBeUndefined();
    expect(directoryFor('!!!')).toBeUndefined();
  });
});

describe('withName', () => {
  it("puts the name in the starter's empty declaration", () => {
    expect(withName('{}\n', 'Free Throw Duel')).toBe('{\n  "name": "Free Throw Duel"\n}\n');
  });

  it('keeps what the app already declares, and replaces a name', () => {
    expect(JSON.parse(withName('{ "name": "Old", "supportUrl": "mailto:help@example.com" }', 'New'))).toEqual({
      name: 'New',
      supportUrl: 'mailto:help@example.com',
    });
  });

  it('refuses a declaration that is not an object, rather than write over it', () => {
    expect(() => withName('[]', 'New')).toThrow('does not hold a JSON object');
    expect(() => withName('not json', 'New')).toThrow();
  });
});

describe('nameCommitArgs', () => {
  it('commits the declaration and nothing else, in the clone', () => {
    expect(nameCommitArgs('/work/free-throw-duel', 'Free Throw Duel')).toEqual([
      '-C',
      '/work/free-throw-duel',
      'commit',
      '--quiet',
      '-m',
      'Name the app Free Throw Duel',
      '--',
      'bankroll-app.json',
    ]);
  });
});

describe('declareName', () => {
  it('writes the name and commits it, so the first push carries it', () => {
    const clone = scratchClone();
    expect(declareName(clone, 'Free Throw Duel')).toBe(true);
    expect(JSON.parse(readFileSync(join(clone, 'bankroll-app.json'), 'utf8'))).toEqual({ name: 'Free Throw Duel' });
    expect(git(clone, 'log', '-1', '--format=%s')).toBe('Name the app Free Throw Duel');
    expect(git(clone, 'show', '--name-only', '--format=', 'HEAD')).toBe('bankroll-app.json');
    expect(git(clone, 'status', '--porcelain')).toBe('');
  });

  // Someone's work in progress is theirs to commit.
  it('leaves other changes in the clone out of the commit', () => {
    const clone = scratchClone();
    writeFileSync(join(clone, 'README.md'), 'Mine now.\n');
    git(clone, 'add', 'README.md');
    expect(declareName(clone, 'Free Throw Duel')).toBe(true);
    expect(git(clone, 'show', '--name-only', '--format=', 'HEAD')).toBe('bankroll-app.json');
    expect(git(clone, 'status', '--porcelain')).toBe('M  README.md');
  });
});
