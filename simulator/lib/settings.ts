// Shell settings (device, orientation, theme) live in cookies so the server can
// render the right thing on the first paint.
//
// Cookies are shared by every port on localhost, so the names are specific to this app.
export const DEVICE_COOKIE = "console-device";
export const ORIENTATION_COOKIE = "console-orientation";
export const THEME_COOKIE = "console-theme";

export type Theme = "light" | "dark";

/** A stored theme override, or undefined to follow the system setting. */
export function parseTheme(value: string | undefined): Theme | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}

const ONE_YEAR = 60 * 60 * 24 * 365;

export function writeSettingCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
}

export function clearSettingCookie(name: string) {
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}
