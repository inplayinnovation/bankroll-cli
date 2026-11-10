import { describe, expect, it } from 'vitest';

import { CAN_CREATE_APPS } from '../src/api';
import { PRODUCTION } from '../src/environments';
import { PICK_A_USERNAME, describeAccount, loggedInLines } from '../src/login';

const named = { username: 'ada', walletAddress: 'Wallet111' };
// An account made by logging in on the web: no username yet.
const unnamed = { username: null, walletAddress: 'Wallet111' };
const KEYCHAIN = 'the macOS keychain';

describe('describeAccount', () => {
  it('names the account and its wallet, and the environment when it is not production', () => {
    expect(describeAccount(named, PRODUCTION.name)).toBe('@ada (Wallet111)');
    expect(describeAccount(named, 'staging')).toBe('@ada (Wallet111) on staging');
  });

  it('says so when the account has no username or no wallet', () => {
    expect(describeAccount({ username: null, walletAddress: null }, PRODUCTION.name)).toBe(
      'an account without a username (no wallet)',
    );
  });
});

describe('loggedInLines', () => {
  it('says who logged in, where the login is kept, and that the account can create apps', () => {
    expect(loggedInLines(named, PRODUCTION.name, KEYCHAIN)).toEqual([
      `Logged in as @ada (Wallet111), kept in ${KEYCHAIN}`,
      CAN_CREATE_APPS,
    ]);
  });

  it('adds how to pick a username when the account has none', () => {
    expect(loggedInLines(unnamed, PRODUCTION.name, KEYCHAIN)).toEqual([
      `Logged in as an account without a username (Wallet111), kept in ${KEYCHAIN}`,
      CAN_CREATE_APPS,
      PICK_A_USERNAME,
    ]);
  });
});
