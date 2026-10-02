// Saying when this CLI is out of date. It has to be said somewhere: the
// simulator ships inside the package, so a developer's simulator is exactly as
// old as their CLI, and an app pins its own copy, which never moves by itself.
//
// One request to the registry, with a short patience, while the dev server
// starts. No answer is no notice: being offline is not something to report.
const REGISTRY = 'https://registry.npmjs.org';
const CLI = '@joinbankroll/cli';
const PATIENCE_MS = 1_500;

const numbers = (version: string) => version.split('-')[0]!.split('.').map(Number);

/** True when `latest` is a later release than `current`. Anything unreadable is not newer. */
export function isNewer(latest: string, current: string): boolean {
  const [a, b] = [numbers(latest), numbers(current)];
  if (a.length !== 3 || b.length !== 3 || [...a, ...b].some(Number.isNaN)) return false;
  for (let part = 0; part < 3; part++) {
    if (a[part]! !== b[part]!) return a[part]! > b[part]!;
  }
  return false;
}

/** The latest published release of a package, or undefined when the registry cannot say. Never rejects. */
export async function latestVersion(name: string, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const response = await fetchImpl(`${REGISTRY}/${name}/latest`, { signal: AbortSignal.timeout(PATIENCE_MS) });
    if (!response.ok) return undefined;
    const { version } = (await response.json()) as { version?: unknown };
    return typeof version === 'string' ? version : undefined;
  } catch {
    return undefined;
  }
}

/** What to tell someone on an older CLI, or null when there is nothing to say. Never rejects. */
export async function updateNotice(current: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const version = await latestVersion(CLI, fetchImpl);
  if (!version || !isNewer(version, current)) return null;
  return [
    `bankroll ${version} is out; this is ${current}.`,
    '  in an app:         npm i -D @joinbankroll/cli@latest',
    '  on this computer:  npm i -g @joinbankroll/cli@latest',
  ].join('\n');
}
