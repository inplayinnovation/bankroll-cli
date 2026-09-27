// `bankroll apps` — the apps you built with Bankroll, as the api lists them
// for their creator: newest first, drafts and archives included.
import { graphql } from './api';
import { resolveEnvironment } from './environments';
import type { AccountOptions } from './login';
import { cloneRepo } from './repo';
import { sessionLocation } from './session';
import { SKILL_HINT } from './skill';

const APPS_QUERY = `query Apps {
  builderApps {
    id name url status archivedAt publishedAt createdAt
    latestRun { status startedAt error }
  }
}`;

export interface AppRow {
  id: string;
  /** What the app's signed manifest calls it; null until its first build names it. */
  name: string | null;
  url: string;
  status: string;
  archivedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  latestRun: { status: string; startedAt: string; error: string | null } | null;
}

interface AppsData {
  builderApps: AppRow[];
}

// What a mutation answers with: enough to say the app's new state.
const APP_FIELDS = 'id name url status archivedAt publishedAt';

const ARCHIVE_MUTATION = `mutation Archive($id: ID!) { builderArchiveApp(id: $id) { ${APP_FIELDS} } }`;
const UNARCHIVE_MUTATION = `mutation Unarchive($id: ID!) { builderUnarchiveApp(id: $id) { ${APP_FIELDS} } }`;
const SET_PUBLISHED_MUTATION = `mutation SetPublished($id: ID!, $published: Boolean!) {
  builderSetPublished(id: $id, published: $published) { ${APP_FIELDS} }
}`;

export type AppState = Pick<AppRow, 'id' | 'name' | 'url' | 'status' | 'archivedAt' | 'publishedAt'>;

const CREATE_MUTATION = `mutation CreateApp { builderCreateApp { ${APP_FIELDS} } }`;

const COLUMNS = ['ID', 'NAME', 'STATUS', 'PUBLISHED', 'LAST RUN', 'CREATED', 'URL'] as const;
const GAP = '  ';
const NO_APPS = 'No apps yet. Build one in the Bankroll app.';
const RUN_FAILED = 'error';
// A failed run's reason, under the table: the same text the owner's phone got.
const FAILED_PREFIX = 'last run failed: ';
// What a fresh app answers to, and how it gets a name of its own.
const NAME_HINT = 'Name it in bankroll-app.json: Bankroll signs that name into the manifest on the next push.';

const day = (iso: string) => iso.slice(0, 'YYYY-MM-DD'.length);

// An app is named by the manifest Bankroll signed for it, so an app that has
// not been built yet has no name. Its address stands in until it does.
const nameOf = (app: Pick<AppRow, 'name' | 'url'>) => app.name ?? new URL(app.url).hostname;

/** One line per app, columns as wide as their widest value; nothing cut. */
export function formatApps(apps: AppRow[]): string {
  if (apps.length === 0) return NO_APPS;
  const rows = apps.map((app) => [
    app.id,
    nameOf(app),
    app.archivedAt ? 'archived' : app.status,
    app.publishedAt ? 'yes' : 'no',
    app.latestRun ? `${app.latestRun.status} ${day(app.latestRun.startedAt)}` : '-',
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
  published?: boolean;
  unpublished?: boolean;
}

/** The apps a listing shows, and how many archived ones it left out. */
export function filterApps(apps: AppRow[], options: ListOptions): { shown: AppRow[]; archivedHidden: number } {
  if (options.published && options.unpublished) {
    throw new Error('--published and --unpublished cannot both be given');
  }
  const byPublication = apps.filter((app) => {
    if (options.published) return app.publishedAt !== null;
    if (options.unpublished) return app.publishedAt === null;
    return true;
  });
  if (options.all) return { shown: byPublication, archivedHidden: 0 };
  const archived = byPublication.filter((app) => app.archivedAt !== null);
  if (options.archived) return { shown: archived, archivedHidden: 0 };
  return { shown: byPublication.filter((app) => app.archivedAt === null), archivedHidden: archived.length };
}

/** "Stackline (53): live, published, https://…" */
export function describeApp(app: AppState): string {
  const state = app.archivedAt ? 'archived' : app.status;
  const published = app.publishedAt ? 'published' : 'not published';
  return `${nameOf(app)} (${app.id}): ${state}, ${published}, ${app.url}`;
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
}

/**
 * An app with the starter's files and no agent run. The repo is the only
 * reason to make one from a computer, so it is cloned here unless the caller
 * says otherwise; the app exists either way, and `apps clone` can run later.
 * The app has no name yet: it takes the one in `bankroll-app.json` when its
 * first push is built.
 */
export async function create(options: AccountOptions & CreateOptions): Promise<void> {
  const data = await graphql<{ builderCreateApp: AppState }>(locationFor(options), CREATE_MUTATION);
  const app = data.builderCreateApp;
  console.log(`\n  ${describeApp(app)}`);
  console.log(`  ${NAME_HINT}`);
  if (options.noClone) {
    console.log(`  Clone it with \`bankroll apps clone ${app.id}\`; its first push builds and deploys it.`);
    console.log(`  ${SKILL_HINT}\n`);
    return;
  }
  try {
    const { name: directory } = await cloneRepo(app.id, undefined, options);
    console.log(`  cd ${directory} && npm install\n`);
  } catch (error) {
    console.log(`  The app is made, but its repo is not on this computer: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`  Try again with \`bankroll apps clone ${app.id}\`.\n`);
  }
}

export async function archive(id: string, options: AccountOptions): Promise<void> {
  const data = await graphql<{ builderArchiveApp: AppState }>(locationFor(options), ARCHIVE_MUTATION, { id });
  console.log(`\n  ${describeApp(data.builderArchiveApp)}\n`);
}

export async function unarchive(id: string, options: AccountOptions): Promise<void> {
  const data = await graphql<{ builderUnarchiveApp: AppState }>(locationFor(options), UNARCHIVE_MUTATION, { id });
  console.log(`\n  ${describeApp(data.builderUnarchiveApp)}\n`);
}

export async function setPublished(id: string, published: boolean, options: AccountOptions): Promise<void> {
  const data = await graphql<{ builderSetPublished: AppState }>(locationFor(options), SET_PUBLISHED_MUTATION, {
    id,
    published,
  });
  console.log(`\n  ${describeApp(data.builderSetPublished)}\n`);
}
