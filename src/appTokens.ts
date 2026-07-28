// ./app-tokens.json — the tokens this app issues.
//
// The file IS the manifest's `appTokens` claim, byte for byte: an object keyed
// by mint address, each entry naming display strings. Nothing transforms it on
// the way out, so what you read here is what Bankroll sees.
//
//   {
//     "Fh2EUwnL52CbeHttBGdW8yHKshvCbVR7pTEa5JYLKxJm": {
//       "name": "Acme Credit",
//       "description": "Promo credit for Acme."
//     }
//   }
//
// A file rather than an environment variable because an app may issue several
// tokens and each carries metadata — neither of which a single env var can hold.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Both fields are optional to the host; a present one must be a non-empty string. */
export interface AppToken {
  name?: string;
  description?: string;
}

export type AppTokens = Record<string, AppToken>;

export const APP_TOKENS_FILE = 'app-tokens.json';

const INDENT = 2;

export const appTokensPath = (): string => resolve(process.cwd(), APP_TOKENS_FILE);

export function readAppTokens(): AppTokens {
  const path = appTokensPath();
  if (!existsSync(path)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(`${APP_TOKENS_FILE} is not valid JSON`, { cause });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${APP_TOKENS_FILE} must be an object keyed by mint address`);
  }
  return parsed as AppTokens;
}

/** Add a token, keeping the rest untouched. Refuses to redefine one. */
export function addAppToken(mint: string, token: AppToken): void {
  const tokens = readAppTokens();
  if (tokens[mint]) throw new Error(`${APP_TOKENS_FILE} already has an entry for ${mint}`);

  const entry: AppToken = {
    ...(token.name ? { name: token.name } : {}),
    ...(token.description ? { description: token.description } : {}),
  };
  writeFileSync(appTokensPath(), `${JSON.stringify({ ...tokens, [mint]: entry }, null, INDENT)}\n`);
}
