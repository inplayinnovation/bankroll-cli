import { describe, expect, it } from 'vitest';

import { cloneArgs, credentialReply, helperCommand, repoUrl } from '../src/repo';

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
