// `bankroll env` — the secrets of an app that Bankroll hosts: an API key, a
// database password, a webhook secret. The app reads one as process.env.NAME.
// A value goes to Bankroll once and can never be read back, by anyone: this
// command lists names, sets values and removes them. The test version and the
// live version each have a value of their own.
import { readFileSync } from 'node:fs';

import { graphql, type SessionOptions } from './api';
import { resolveEnvironment } from './environments';
import type { AccountOptions } from './login';
import { askSecret, SeveralLinesError } from './prompt';
import { sessionLocation, type SessionLocation } from './session';
import { appIdHere, TARGETS, type Target, wait } from './wait';

export const SECRETS_QUERY = `query Secrets($id: ID!) {
  builderApp(id: $id) { id name url secrets { name environment setAt } }
}`;
export const SET_SECRET_MUTATION = `mutation SetSecret($id: ID!, $name: String!, $value: String!, $environments: [String!]!, $rebuild: Boolean) {
  builderSetAppSecret(id: $id, name: $name, value: $value, environments: $environments, rebuild: $rebuild) { rebuilding app { id name url } }
}`;
export const REMOVE_SECRET_MUTATION = `mutation RemoveSecret($id: ID!, $name: String!, $environments: [String!]!, $rebuild: Boolean) {
  builderRemoveAppSecret(id: $id, name: $name, environments: $environments, rebuild: $rebuild) { rebuilding app { id name url } }
}`;

// The shape Bankroll accepts, checked here so that a typo costs no typing of
// a value. Bankroll refuses its own names and the host's; it says which.
const NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const NAME_HELP = "A secret's name is capital letters, digits and underscores, and starts with a letter, such as KALSHI_API_KEY.";
const NO_APP = 'Not an app clone. Run this inside a clone from `bankroll apps clone`, or pass --app <id>.';
const DATE_LENGTH = 'YYYY-MM-DD'.length;

export interface SecretRow {
  name: string;
  environment: string;
  setAt: string;
}

export interface EnvOptions extends AccountOptions {
  /** The app, by id, from outside a clone. */
  app?: string;
  /** Only the test version. */
  test?: boolean;
  /** Only the live version. */
  live?: boolean;
}

export interface SetOptions extends EnvOptions {
  /** Read the value from this file: for a value of several lines, such as a PEM key. */
  fromFile?: string;
  /** False when the versions are not to be built again now. */
  rebuild?: boolean;
}

interface Change {
  rebuilding: string[];
}

/** The versions a command is for: both, unless one is named. */
export function versionsFor(options: { test?: boolean; live?: boolean }): Target[] {
  const named = TARGETS.filter((target) => options[target]);
  return named.length > 0 ? named : [...TARGETS];
}

/** "test", or "test and live". */
export function versionWords(versions: readonly string[]): string {
  return versions.join(' and ');
}

export function checkNames(names: string[]): void {
  if (names.length === 0) throw new Error(`Name the secret. ${NAME_HELP}`);
  for (const name of names) {
    if (!NAME_PATTERN.test(name)) throw new Error(`"${name}" is not a name a secret can have. ${NAME_HELP}`);
  }
  if (new Set(names).size !== names.length) throw new Error('A name is given twice.');
}

/** A value as a file or a pipe holds it: without the line break a text file ends with. */
export function withoutFinalLineBreak(text: string): string {
  return text.replace(/\r?\n$/, '');
}

/** The list a person reads: one line per name, the versions that have a value, and the day each was last set. */
export function secretLines(secrets: SecretRow[]): string[] {
  if (secrets.length === 0) return ['No secrets. `bankroll env set NAME` gives the app one.'];
  const names = [...new Set(secrets.map((secret) => secret.name))].sort();
  const width = Math.max(...names.map((name) => name.length));
  return names.map((name) => {
    const versions = TARGETS.flatMap((target) => {
      const row = secrets.find((secret) => secret.name === name && secret.environment === target);
      return row ? [`${target} (set ${row.setAt.slice(0, DATE_LENGTH)})`] : [];
    });
    return `${name.padEnd(width)}  ${versions.join(', ')}`;
  });
}

/** What a person is told about the versions that are not being built again. */
export function laterLine(versions: readonly string[], rebuilding: readonly string[], rebuildAsked: boolean): string | null {
  const later = versions.filter((version) => !rebuilding.includes(version));
  if (later.length === 0) return null;
  const which = `The ${versionWords(later)} version${later.length === 1 ? '' : 's'}`;
  return rebuildAsked
    ? `${which} ${later.length === 1 ? 'reads' : 'read'} the change at ${later.length === 1 ? 'its' : 'their'} next build.`
    : `${which} ${later.length === 1 ? 'is' : 'are'} not built again now: the change is read at the next build.`;
}

/** Sets each secret, and asks for one build after the last. Answers the versions being built again. */
export async function setSecrets(
  location: SessionLocation,
  params: { id: string; values: { name: string; value: string }[]; versions: string[]; rebuild: boolean },
  options: SessionOptions = {},
): Promise<string[]> {
  let rebuilding: string[] = [];
  for (const [index, { name, value }] of params.values.entries()) {
    const last = index === params.values.length - 1;
    const data = await graphql<{ builderSetAppSecret: Change }>(
      location,
      SET_SECRET_MUTATION,
      { id: params.id, name, value, environments: params.versions, rebuild: last && params.rebuild },
      options,
    );
    rebuilding = data.builderSetAppSecret.rebuilding;
  }
  return rebuilding;
}

/** Removes each secret, and asks for one build after the last. Answers the versions being built again. */
export async function removeSecrets(
  location: SessionLocation,
  params: { id: string; names: string[]; versions: string[]; rebuild: boolean },
  options: SessionOptions = {},
): Promise<string[]> {
  let rebuilding: string[] = [];
  for (const [index, name] of params.names.entries()) {
    const last = index === params.names.length - 1;
    const data = await graphql<{ builderRemoveAppSecret: Change }>(
      location,
      REMOVE_SECRET_MUTATION,
      { id: params.id, name, environments: params.versions, rebuild: last && params.rebuild },
      options,
    );
    rebuilding = data.builderRemoveAppSecret.rebuilding;
  }
  return rebuilding;
}

export async function listSecrets(location: SessionLocation, id: string, options: SessionOptions = {}): Promise<SecretRow[]> {
  const data = await graphql<{ builderApp: { secrets: SecretRow[] } | null }>(location, SECRETS_QUERY, { id }, options);
  if (!data.builderApp) throw new Error(`No app ${id}.`);
  return data.builderApp.secrets;
}

const appId = (options: EnvOptions): string => {
  const id = options.app ?? appIdHere();
  if (!id) throw new Error(NO_APP);
  return id;
};

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
};

/** What a person is told after pasting a value of several lines at the prompt, which takes one. */
export function severalLinesHelp(name: string): string {
  return [
    `Nothing was set. The value for ${name} has more than one line, and the prompt takes one line.`,
    `Put the value in a file and run \`bankroll env set ${name} --from-file <file>\`,`,
    `or send it through a pipe, such as \`pbpaste | bankroll env set ${name}\` on a Mac.`,
  ].join('\n  ');
}

// Where a value comes from, in this order: the file named, a pipe, the
// keyboard with nothing shown. Never an argument: an argument stays in the
// shell's history.
async function valueFor(name: string, names: string[], options: SetOptions): Promise<string> {
  if (options.fromFile !== undefined) {
    if (names.length > 1) throw new Error('--from-file holds one value, so it goes with one name.');
    return withoutFinalLineBreak(readFileSync(options.fromFile, 'utf8'));
  }
  if (!process.stdin.isTTY) {
    if (names.length > 1) throw new Error('A pipe holds one value, so it goes with one name.');
    return withoutFinalLineBreak(await readStdin());
  }
  try {
    return await askSecret(`Value for ${name} (not shown)`);
  } catch (error) {
    if (error instanceof SeveralLinesError) throw new Error(severalLinesHelp(name));
    throw error;
  }
}

// The builds a change started, watched the way `bankroll wait` watches a push.
async function watch(rebuilding: string[], options: EnvOptions): Promise<void> {
  const app = appId(options);
  for (const version of rebuilding) {
    await wait(version, options.env === undefined ? { app } : { env: options.env, app });
  }
}

export async function list(options: EnvOptions): Promise<void> {
  const location = sessionLocation(resolveEnvironment(options.env));
  const lines = secretLines(await listSecrets(location, appId(options)));
  console.log(`\n${lines.map((line) => `  ${line}`).join('\n')}\n`);
}

export async function set(names: string[], options: SetOptions): Promise<void> {
  checkNames(names);
  const id = appId(options);
  const versions = versionsFor(options);
  const values: { name: string; value: string }[] = [];
  for (const name of names) {
    const value = await valueFor(name, names, options);
    if (value === '') throw new Error(`No value for ${name}. Nothing was set.`);
    values.push({ name, value });
  }
  const rebuild = options.rebuild !== false;
  const location = sessionLocation(resolveEnvironment(options.env));
  const rebuilding = await setSecrets(location, { id, values, versions, rebuild });
  console.log(`\n  ${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} set for ${versionWords(versions)}. The app reads ${names.length === 1 ? 'it' : 'each'} as process.env.${names.length === 1 ? names[0] : 'NAME'}.`);
  const later = laterLine(versions, rebuilding, rebuild);
  if (later) console.log(`  ${later}`);
  await watch(rebuilding, options);
  if (rebuilding.length === 0) console.log('');
}

export async function remove(names: string[], options: SetOptions): Promise<void> {
  checkNames(names);
  const id = appId(options);
  const versions = versionsFor(options);
  const rebuild = options.rebuild !== false;
  const location = sessionLocation(resolveEnvironment(options.env));
  const rebuilding = await removeSecrets(location, { id, names, versions, rebuild });
  console.log(`\n  ${names.join(', ')} ${names.length === 1 ? 'is' : 'are'} no longer set for ${versionWords(versions)}.`);
  const later = laterLine(versions, rebuilding, rebuild);
  if (later) console.log(`  ${later}`);
  await watch(rebuilding, options);
  if (rebuilding.length === 0) console.log('');
}
