import { describe, expect, it } from 'vitest';

import { KeychainStore, SERVICE, SecretToolStore, credentialStore, type RunResult, type Runner } from '../src/sessionStore';

interface Call {
  command: string;
  args: string[];
  input: string | undefined;
}

const scripted = (results: Partial<RunResult>[]) => {
  const calls: Call[] = [];
  const runner: Runner = (command, args, input) => {
    calls.push({ command, args, input });
    const next = results.shift();
    if (!next) throw new Error('no scripted result left');
    return { status: 0, stdout: '', stderr: '', missing: false, ...next };
  };
  return { calls, runner };
};

describe('KeychainStore', () => {
  it('reads the item, or null when macOS says it is not there', () => {
    const { calls, runner } = scripted([{ stdout: '{"a":1}\n' }, { status: 44, stderr: 'not found' }]);
    const store = new KeychainStore('stag', runner);
    expect(store.read()).toBe('{"a":1}');
    expect(store.read()).toBeNull();
    expect(calls[0]).toEqual({
      command: 'security',
      args: ['find-generic-password', '-s', SERVICE, '-a', 'stag', '-w'],
      input: undefined,
    });
  });

  it('decodes the hex that security prints for a value with a newline', () => {
    const { runner } = scripted([{ stdout: `${Buffer.from('{\n"a":1}').toString('hex')}\n` }]);
    expect(new KeychainStore('stag', runner).read()).toBe('{\n"a":1}');
  });

  it('writes as an update and surfaces a refusal', () => {
    const { calls, runner } = scripted([{}, { status: 1, stderr: 'User interaction is not allowed.' }]);
    const store = new KeychainStore('stag', runner);
    store.write('secret');
    expect(calls[0]?.args).toEqual(['add-generic-password', '-s', SERVICE, '-a', 'stag', '-U', '-w', 'secret']);
    expect(() => store.write('secret')).toThrow('User interaction is not allowed');
  });

  it('clears, and says whether there was an item', () => {
    const { runner } = scripted([{}, { status: 44 }]);
    const store = new KeychainStore('stag', runner);
    expect(store.clear()).toBe(true);
    expect(store.clear()).toBe(false);
  });
});

describe('SecretToolStore', () => {
  it('hands the secret over stdin and looks it up by service and account', () => {
    const { calls, runner } = scripted([{}, { stdout: '{"a":1}' }, { status: 1 }]);
    const store = new SecretToolStore('stag', runner);
    store.write('{"a":1}');
    expect(calls[0]).toEqual({
      command: 'secret-tool',
      args: ['store', '--label=Bankroll CLI', 'service', SERVICE, 'account', 'stag'],
      input: '{"a":1}',
    });
    expect(store.read()).toBe('{"a":1}');
    expect(store.read()).toBeNull();
  });
});

describe('credentialStore', () => {
  it('is the keychain on macOS', () => {
    const { runner } = scripted([{}]);
    expect(credentialStore('stag', 'darwin', runner).store).toBeInstanceOf(KeychainStore);
  });

  it('is the keyring on Linux, or says what is missing', () => {
    expect(credentialStore('stag', 'linux', scripted([{}]).runner).store).toBeInstanceOf(SecretToolStore);
    const choice = credentialStore('stag', 'linux', scripted([{ missing: true }]).runner);
    expect(choice.store).toBeNull();
    expect(choice.reason).toContain('secret-tool');
  });

  it('has nothing yet for other platforms, and says so', () => {
    const choice = credentialStore('stag', 'win32', scripted([]).runner);
    expect(choice.store).toBeNull();
    expect(choice.reason).toContain('win32');
  });
});
