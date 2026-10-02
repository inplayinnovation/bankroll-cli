// The theme: light, dark, or unset to follow the system.
//
// Kept apart from lib/settings.ts because the root layout reads it on the
// server, and that file is the browser's.

export type Theme = "light" | "dark";

export const THEME_KEY = "simulator-theme";

/**
 * Sets the stored theme on <html> before the page is drawn. The page is static
 * files, so nothing but a script in the head can know the choice in time; left
 * to React it would flash the system's theme first.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
