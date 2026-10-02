// The apps the simulator opens: web apps on their own origin, loaded by URL
// onto the phone's screen.

/** Which app is open, in the page's own URL: `/?app=http://localhost:3000/app` (see lib/open-app.ts). */
export const APP_PARAM = "app";

/** What the simulator learns about an app from its origin, asked through /api/manifest (see lib/manifests.ts). */
export interface AppManifest {
  /** True when the origin serves a Bankroll manifest. */
  bankroll: boolean;
  name?: string;
  /** The path a Bankroll app opens at. */
  launch?: string;
  /** Where its icon is, when it has drawn one. */
  icon?: string;
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|[^/:]+\.localhost)(:\d+)?(\/|$)/i;
// Names made of labels, or an IPv6 address. A browser's URL parser is more
// forgiving than this: Chrome turns "not a url" into the host "not%20a%20url".
const HOSTNAME = /^(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)$/i;

/**
 * A URL as a person types it, made whole: "localhost:3001" and
 * "my-app.vercel.app/app" both work. Null when it is not a web address.
 */
export function parseAppUrl(input: string): string | null {
  const text = input.trim();
  if (text === "" || /\s/.test(text)) return null;
  // A local address is plain http; anything else typed without a scheme gets https.
  const whole = HAS_SCHEME.test(text) ? text : `${LOCAL_HOST.test(text) ? "http" : "https"}://${text}`;
  let url: URL;
  try {
    url = new URL(whole);
  } catch {
    return null;
  }
  // Web pages only: a javascript: or data: URL in a frame would run as this page.
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!HOSTNAME.test(url.hostname)) return null;
  return url.href;
}

/** Where an app's manifest and icon are served from. */
export const originOf = (url: string) => new URL(url).origin;

/** What to call an app that has not said: its address, without the scheme. */
export const hostOf = (url: string) => new URL(url).host;

/** True of an address alone, "localhost:3001": it says which app, not which page. */
export function namesNoPage(url: string): boolean {
  const { pathname, search } = new URL(url);
  return pathname === "/" && search === "";
}

/** The page to load: the one the URL names, or the app's launch path when it names none. */
export function launchUrl(url: string, manifest: AppManifest | null): string {
  if (!namesNoPage(url) || !manifest?.launch) return url;
  return new URL(manifest.launch, originOf(url)).href;
}
