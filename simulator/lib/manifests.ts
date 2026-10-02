"use client";

import { useSyncExternalStore } from "react";
import { originOf, type AppManifest } from "./apps";

// What each app said when last asked, by origin. An app's dev server comes and
// goes while the simulator stays open, so this is only ever a first guess: the
// home screen shows it at once and asks again, and opening an app always asks.
const known = new Map<string, AppManifest>();
const listeners = new Set<() => void>();

const NOT_BANKROLL: AppManifest = { bankroll: false };

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * Asks the app what it is. The page cannot ask the app itself: the app is
 * another origin, and its manifest carries no CORS header. It asks whoever
 * serves the simulator, at /api/manifest, which is the CLI (src/simulator.ts).
 * Never rejects: an app that cannot be reached is not a Bankroll app right now.
 */
export async function askManifest(url: string): Promise<AppManifest> {
  const answer = await fetch(`/api/manifest?${new URLSearchParams({ url })}`)
    .then((response) => (response.ok ? (response.json() as Promise<AppManifest>) : NOT_BANKROLL))
    .catch(() => NOT_BANKROLL);
  known.set(originOf(url), answer);
  listeners.forEach((listener) => listener());
  return answer;
}

/**
 * What the app said when last asked, kept current as it is asked again.
 * Undefined until it has answered once, and always on the server: what this
 * browser remembers is not something the server's HTML could have agreed with.
 */
export function useKnownManifest(url: string): AppManifest | undefined {
  const origin = originOf(url);
  return useSyncExternalStore(
    subscribe,
    () => known.get(origin),
    () => undefined,
  );
}
