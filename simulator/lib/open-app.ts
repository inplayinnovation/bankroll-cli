"use client";

import { useSyncExternalStore } from "react";
import { APP_PARAM, parseAppUrl } from "./apps";

// Which app is on the phone's screen is in the page's own URL, so a reload
// reopens it, Back leaves it, and whoever starts the simulator can open it on
// an app: /?app=http://localhost:3000/app
//
// The URL is read here, in the browser, and not through the router: the page
// is static files, and its HTML was written before there was a URL to read.

const CHANGED = "simulator:url";

const go = (method: "pushState" | "replaceState", search: string) => {
  window.history[method](null, "", search || window.location.pathname);
  // History changes made from script fire no event of their own.
  window.dispatchEvent(new Event(CHANGED));
};

const naming = (url: string) => `?${new URLSearchParams({ [APP_PARAM]: url })}`;

/** Puts an app on the screen. The history entry is real: Back returns to the home screen. */
export const openApp = (url: string) => go("pushState", naming(url));

/** Names the open app's page more exactly, in the same history entry. */
export const settleApp = (url: string) => go("replaceState", naming(url));

/** Back to the home screen. */
export const goHome = () => go("pushState", "");

function subscribe(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

/**
 * The open app's URL, or null on the home screen. Undefined on the server and
 * until the browser's URL is read, when it is not yet known which.
 */
export function useOpenApp(): string | null | undefined {
  const named = useSyncExternalStore(
    subscribe,
    () => new URLSearchParams(window.location.search).get(APP_PARAM),
    () => undefined,
  );
  return named === undefined ? undefined : parseAppUrl(named ?? "");
}
