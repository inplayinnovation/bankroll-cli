import { describe, expect, it } from 'vitest';

import {
  LoginRefusedError,
  pollForTokens,
  refreshTokens,
  requestDeviceCode,
  type DeviceCode,
  type Fetch,
} from '../src/privyDevice';

const APP_ID = 'app_1';

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, string>;
}

// Answers each request with the next scripted response and records the call.
const scripted = (responses: { status: number; body: unknown }[]) => {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, string>,
    });
    const next = responses.shift();
    if (!next) throw new Error('no scripted response left');
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as Fetch;
  return { calls, fetchImpl };
};

const tokens = { access_token: 'access', refresh_token: 'refresh', expires_in: 899 };

const code: DeviceCode = {
  deviceCode: 'device',
  userCode: 'ABCDE-FGHJK',
  verificationUrl: 'https://api-s.joinbankroll.com/authorize?user_code=ABCDE-FGHJK',
  expiresInSeconds: 600,
  intervalSeconds: 5,
};

describe('requestDeviceCode', () => {
  it('asks Privy for a code and returns the link and the timings', async () => {
    const { calls, fetchImpl } = scripted([
      {
        status: 200,
        body: {
          device_code: 'device',
          user_code: 'ABCDE-FGHJK',
          verification_uri: 'https://api-s.joinbankroll.com/authorize',
          verification_uri_complete: code.verificationUrl,
          expires_in: 600,
          interval: 5,
        },
      },
    ]);
    expect(await requestDeviceCode(APP_ID, fetchImpl)).toEqual(code);
    expect(calls[0]?.url).toBe('https://auth.privy.io/api/oauth/v2/device_authorization');
    expect(calls[0]?.headers['privy-app-id']).toBe(APP_ID);
  });

  it('fails plainly when the app has no device login', async () => {
    const { fetchImpl } = scripted([
      { status: 403, body: { error: 'Device authorization is not enabled for this app' } },
    ]);
    await expect(requestDeviceCode(APP_ID, fetchImpl)).rejects.toThrow('refused to start a login (403)');
  });
});

describe('pollForTokens', () => {
  const noWait = async () => {};

  it('waits through pending, backs off on slow_down, and returns the tokens', async () => {
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    const { calls, fetchImpl } = scripted([
      { status: 400, body: { error: 'authorization_pending' } },
      { status: 400, body: { error: 'slow_down' } },
      { status: 200, body: tokens },
    ]);
    expect(await pollForTokens(APP_ID, code, fetchImpl, sleep)).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresInSeconds: 899,
    });
    expect(waits).toEqual([5000, 5000, 10000]);
    expect(calls[0]?.body).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: 'device',
    });
  });

  it('stops when the code expires', async () => {
    const { fetchImpl } = scripted([{ status: 400, body: { error: 'expired_token' } }]);
    await expect(pollForTokens(APP_ID, code, fetchImpl, noWait)).rejects.toBeInstanceOf(LoginRefusedError);
  });

  it('stops when the person denies it', async () => {
    const { fetchImpl } = scripted([{ status: 400, body: { error: 'access_denied' } }]);
    await expect(pollForTokens(APP_ID, code, fetchImpl, noWait)).rejects.toThrow('denied');
  });
});

describe('refreshTokens', () => {
  it('returns the rotated tokens', async () => {
    const { calls, fetchImpl } = scripted([{ status: 200, body: tokens }]);
    expect(await refreshTokens(APP_ID, 'old', fetchImpl)).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresInSeconds: 899,
    });
    expect(calls[0]?.body).toEqual({ grant_type: 'refresh_token', refresh_token: 'old' });
  });

  it('treats a dead refresh token as a lost login', async () => {
    const { fetchImpl } = scripted([{ status: 401, body: { error: 'invalid_grant' } }]);
    await expect(refreshTokens(APP_ID, 'old', fetchImpl)).rejects.toBeInstanceOf(LoginRefusedError);
  });
});
