// Privy's OAuth device grant (RFC 8628), the login a terminal can do: ask for
// a code, have the person approve it in a browser, poll until they have.
// Endpoints and behavior verified against Privy on 2026-09-24.

const AUTH_ORIGIN = 'https://auth.privy.io';
const DEVICE_AUTHORIZATION_PATH = '/api/oauth/v2/device_authorization';
const TOKEN_PATH = '/api/oauth/v2/token';
// The RFC 8628 name. Privy rejects the short `device_code` its recipe shows.
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const REFRESH_GRANT = 'refresh_token';
const MS_PER_SECOND = 1000;
// RFC 8628: on slow_down, wait this much longer between polls.
const SLOW_DOWN_STEP_SECONDS = 5;
// Cloudflare in front of auth.privy.io refuses some default user agents.
const USER_AGENT = '@joinbankroll/cli';

export type Fetch = typeof fetch;

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

/** The person said no, the code ran out, or the refresh token is dead. */
export class LoginRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoginRefusedError';
  }
}

async function post(
  fetchImpl: Fetch,
  appId: string,
  path: string,
  body: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetchImpl(`${AUTH_ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'privy-app-id': appId,
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Privy answered ${response.status} with something that is not JSON: ${text}`);
  }
  return { status: response.status, body: parsed as Record<string, unknown> };
}

export async function requestDeviceCode(appId: string, fetchImpl: Fetch = fetch): Promise<DeviceCode> {
  const { status, body } = await post(fetchImpl, appId, DEVICE_AUTHORIZATION_PATH, {});
  if (status !== 200) {
    throw new Error(`Privy refused to start a login (${status}): ${JSON.stringify(body)}`);
  }
  return {
    deviceCode: body.device_code as string,
    userCode: body.user_code as string,
    verificationUrl: body.verification_uri_complete as string,
    expiresInSeconds: body.expires_in as number,
    intervalSeconds: body.interval as number,
  };
}

const toTokens = (body: Record<string, unknown>): Tokens => ({
  accessToken: body.access_token as string,
  refreshToken: body.refresh_token as string,
  expiresInSeconds: body.expires_in as number,
});

/**
 * Polls until the person approves or denies the code, or it expires.
 *
 * `sleep` is a parameter so a test does not wait real seconds.
 */
export async function pollForTokens(
  appId: string,
  code: DeviceCode,
  fetchImpl: Fetch = fetch,
  sleep: (ms: number) => Promise<void> = wait,
): Promise<Tokens> {
  let intervalSeconds = code.intervalSeconds;
  const deadline = Date.now() + code.expiresInSeconds * MS_PER_SECOND;
  while (Date.now() < deadline) {
    await sleep(intervalSeconds * MS_PER_SECOND);
    const { status, body } = await post(fetchImpl, appId, TOKEN_PATH, {
      grant_type: DEVICE_GRANT,
      device_code: code.deviceCode,
    });
    if (status === 200) return toTokens(body);
    switch (body.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        intervalSeconds += SLOW_DOWN_STEP_SECONDS;
        continue;
      case 'expired_token':
        throw new LoginRefusedError('The code expired before it was approved. Run `bankroll login` again.');
      case 'access_denied':
        throw new LoginRefusedError('The login was denied in the browser.');
      default:
        throw new Error(`Privy answered ${status} while waiting for approval: ${JSON.stringify(body)}`);
    }
  }
  throw new LoginRefusedError('The code expired before it was approved. Run `bankroll login` again.');
}

/**
 * Trades a refresh token for new tokens. The old refresh token dies at once,
 * so the caller must store what comes back before anything else runs.
 */
export async function refreshTokens(appId: string, refreshToken: string, fetchImpl: Fetch = fetch): Promise<Tokens> {
  const { status, body } = await post(fetchImpl, appId, TOKEN_PATH, {
    grant_type: REFRESH_GRANT,
    refresh_token: refreshToken,
  });
  if (status === 200) return toTokens(body);
  // 401 invalid_grant is what Privy sends for a used, expired or revoked
  // refresh token; access_denied is what its docs say.
  if (status === 401 || body.error === 'access_denied' || body.error === 'invalid_grant') {
    throw new LoginRefusedError('Your login has expired or was revoked. Run `bankroll login` again.');
  }
  throw new Error(`Privy answered ${status} on refresh: ${JSON.stringify(body)}`);
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
