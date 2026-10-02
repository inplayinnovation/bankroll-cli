// The manifest a Bankroll app serves, read for where the app boots.
export const MANIFEST_PATH = '/.well-known/bankroll.jwt';
const MANIFEST_TIMEOUT_MS = 5_000;

/**
 * The app's `launch` path, from the manifest served at `base`. Falls back to
 * the root: a link to the app's root still opens something, and refusing to
 * print one because a manifest was slow would not.
 */
export async function launchPath(base: string): Promise<string> {
  try {
    const response = await fetch(`${base}${MANIFEST_PATH}`, {
      signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
    });
    if (!response.ok) return '';
    const payload = (await response.text()).trim().split('.')[1];
    if (!payload) return '';
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const launch = (claims as { launch?: unknown })?.launch;
    return typeof launch === 'string' ? launch : '';
  } catch {
    return '';
  }
}
