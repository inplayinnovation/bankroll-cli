// `bankroll apps` — the apps you built with Bankroll, as the api lists them
// for their creator: newest first, drafts and archives included.
import { existsSync } from 'node:fs';

import { graphql } from './api';
import { resolveEnvironment } from './environments';
import type { AccountOptions } from './login';
import { cloneRepo, declareName, DECLARATION_FILE, directoryFor, installDependencies } from './repo';
import { sessionLocation } from './session';
import { SKILL_HINT } from './skill';

const APPS_QUERY = `query Apps {
  builderApps {
    id name url status archivedAt createdAt
    latestRun { status startedAt error }
    test { commit }
    live { commit }
  }
}`;

/** One of the app's two versions: the commit its address serves, or none yet. */
export interface VersionRow {
  commit: string | null;
}

export interface AppRow {
  id: string;
  /** What the app's signed manifest calls it; null until its first build names it. */
  name: string | null;
  url: string;
  status: string;
  archivedAt: string | null;
  createdAt: string;
  latestRun: { status: string; startedAt: string; error: string | null } | null;
  test: VersionRow;
  live: VersionRow;
}

interface AppsData {
  builderApps: AppRow[];
}

// What a mutation answers with: enough to say the app's new state.
const APP_FIELDS = 'id name url status archivedAt';

const ARCHIVE_MUTATION = `mutation Archive($id: ID!) { builderArchiveApp(id: $id) { ${APP_FIELDS} } }`;
const UNARCHIVE_MUTATION = `mutation Unarchive($id: ID!) { builderUnarchiveApp(id: $id) { ${APP_FIELDS} } }`;

export type AppState = Pick<AppRow, 'id' | 'name' | 'url' | 'status' | 'archivedAt'>;

const CREATE_MUTATION = `mutation CreateApp { builderCreateApp { ${APP_FIELDS} } }`;

// TEST and LIVE are the commits each version serves, whole: a hash that is cut
// cannot be used anywhere else.
const COLUMNS = ['ID', 'NAME', 'STATUS', 'TEST', 'LIVE', 'LAST RUN', 'CREATED', 'URL'] as const;
const NONE = '-';
const GAP = '  ';
const NO_APPS = 'No apps yet. Build one in the Bankroll app.';
const RUN_FAILED = 'error';
// A failed run's reason, under the table: the same text the owner's phone got.
const FAILED_PREFIX = 'last run failed: ';
// How a fresh app gets a name of its own.
const NAME_HINT = `Name it in ${DECLARATION_FILE}: Bankroll signs that name into the manifest on the next push.`;
// An app is named by the manifest Bankroll signed for it, so an app that has
// not been built yet has no name, and is shown as having none. Its address
// has a place of its own on the line; said twice, it read as a name.
const UNNAMED = 'Unnamed app';

const day = (iso: string) => iso.slice(0, 'YYYY-MM-DD'.length);

const nameOf = (app: Pick<AppRow, 'name'>) => app.name ?? UNNAMED;

/** One line per app, columns as wide as their widest value; nothing cut. */
export function formatApps(apps: AppRow[]): string {
  if (apps.length === 0) return NO_APPS;
  const rows = apps.map((app) => [
    app.id,
    nameOf(app),
    app.archivedAt ? 'archived' : app.status,
    app.test.commit ?? NONE,
    app.live.commit ?? NONE,
    app.latestRun ? `${app.latestRun.status} ${day(app.latestRun.startedAt)}` : NONE,
    day(app.createdAt),
    app.url,
  ]);
  const widths = COLUMNS.map((column, i) => Math.max(column.length, ...rows.map((row) => row[i]!.length)));
  const line = (cells: readonly string[]) =>
    cells.map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i]!))).join(GAP);
  const failed = apps.flatMap((app) => {
    const run = app.latestRun;
    if (run?.status !== RUN_FAILED || !run.error) return [];
    const head = `${app.id}${GAP}${nameOf(app)}: ${FAILED_PREFIX}`;
    return [head + run.error.trim().replace(/\n/g, `\n${' '.repeat(head.length)}`)];
  });
  return [line(COLUMNS), ...rows.map(line), ...(failed.length > 0 ? ['', ...failed] : [])].join('\n');
}

export interface ListOptions {
  // Archived apps: hidden by default, only them with --archived, everything with --all.
  all?: boolean;
  archived?: boolean;
}

/** The apps a listing shows, and how many archived ones it left out. */
export function filterApps(apps: AppRow[], options: ListOptions): { shown: AppRow[]; archivedHidden: number } {
  if (options.all) return { shown: apps, archivedHidden: 0 };
  const archived = apps.filter((app) => app.archivedAt !== null);
  if (options.archived) return { shown: archived, archivedHidden: 0 };
  return { shown: apps.filter((app) => app.archivedAt === null), archivedHidden: archived.length };
}

/** "Stackline (53): live, https://…" */
export function describeApp(app: AppState): string {
  const state = app.archivedAt ? 'archived' : app.status;
  return `${nameOf(app)} (${app.id}): ${state}, ${app.url}`;
}

const locationFor = (options: AccountOptions) => sessionLocation(resolveEnvironment(options.env));

export async function list(options: AccountOptions & ListOptions): Promise<void> {
  const data = await graphql<AppsData>(locationFor(options), APPS_QUERY);
  const { shown, archivedHidden } = filterApps(data.builderApps, options);
  const lines = [formatApps(shown)];
  if (archivedHidden > 0) {
    lines.push('', `${archivedHidden} archived ${archivedHidden === 1 ? 'app' : 'apps'} hidden; --archived shows them, --all shows everything`);
  }
  console.log(`\n${lines.join('\n').replace(/^/gm, '  ')}\n`);
}

export interface CreateOptions {
  /** Leave the repo on Bankroll: for a script, or a phone-first app. */
  noClone?: boolean;
  /** Clone, but leave `npm install` to the caller. */
  noInstall?: boolean;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What became of a name given to `create`, once the clone is here. */
function declared(target: string, name: string): string {
  try {
    return declareName(target, name)
      ? `${DECLARATION_FILE} names it ${name}, and that is committed: Bankroll signs the name into the manifest on the next push.`
      : `${DECLARATION_FILE} names it ${name}, but git would not commit it. Commit it: Bankroll signs the name into the manifest once it is pushed.`;
  } catch (error) {
    return `The name did not reach ${DECLARATION_FILE}: ${reason(error)}. Put it there before you push.`;
  }
}

/**
 * An app with the starter's files and no agent run. The repo is the only
 * reason to make one from a computer, so it is cloned here and its
 * dependencies installed, unless the caller says otherwise; the app exists
 * either way, and `apps clone` can run later.
 *
 * The api takes no name: an app declares its own in `bankroll-app.json`, and
 * has it once a push is built. A name given here is the same declaration,
 * made for the person: written into the clone, committed, and lent to the
 * clone's directory. Without one the app has no name yet, and says so.
 */
export async function create(given: string | undefined, options: AccountOptions & CreateOptions): Promise<void> {
  const name = given?.trim();
  if (name === '') throw new Error('The name is empty. Leave it out to name the app later.');
  if (name !== undefined && options.noClone) {
    throw new Error(`A name is written into the clone, so it cannot go with --no-clone. Name the app in ${DECLARATION_FILE} once it is cloned.`);
  }
  // Refused before the app is made: an app whose clone fails still exists.
  const directory = name === undefined ? undefined : directoryFor(name);
  if (directory !== undefined && existsSync(directory)) {
    throw new Error(`${directory} is already here. Give the app another name, or run this somewhere else.`);
  }
  const data = await graphql<{ builderCreateApp: AppState }>(locationFor(options), CREATE_MUTATION);
  const app = data.builderCreateApp;
  console.log(`\n  ${describeApp(name === undefined ? app : { ...app, name })}`);
  if (name === undefined) console.log(`  ${NAME_HINT}`);
  if (options.noClone) {
    console.log(`  Clone it with \`bankroll apps clone ${app.id}\`; its first push builds its test version.`);
    console.log(`  ${SKILL_HINT}\n`);
    return;
  }
  const clone = await cloneRepo(app.id, directory, options).catch((error: unknown) => {
    const again = `bankroll apps clone ${app.id}${directory === undefined ? '' : ` ${directory}`}`;
    console.log(`  The app is made, but its repo is not on this computer: ${reason(error)}`);
    console.log(`  Try again with \`${again}\`${name === undefined ? '' : `, then name it in ${DECLARATION_FILE}`}.\n`);
  });
  if (!clone) return;
  if (name !== undefined) console.log(`  ${declared(clone.target, name)}`);
  if (options.noInstall) {
    console.log(`  cd ${clone.name} && npm install && npm run dev\n`);
    return;
  }
  try {
    installDependencies(clone.target);
  } catch (error) {
    console.log(`\n  The app is here, but its dependencies are not: ${reason(error)}`);
    console.log(`  cd ${clone.name} && npm install && npm run dev\n`);
    return;
  }
  console.log(`\n  Ready. \`cd ${clone.name} && npm run dev\` opens it in the simulator.\n`);
}

export async function archive(id: string, options: AccountOptions): Promise<void> {
  const data = await graphql<{ builderArchiveApp: AppState }>(locationFor(options), ARCHIVE_MUTATION, { id });
  console.log(`\n  ${describeApp(data.builderArchiveApp)}\n`);
}

export async function unarchive(id: string, options: AccountOptions): Promise<void> {
  const data = await graphql<{ builderUnarchiveApp: AppState }>(locationFor(options), UNARCHIVE_MUTATION, { id });
  console.log(`\n  ${describeApp(data.builderUnarchiveApp)}\n`);
}
