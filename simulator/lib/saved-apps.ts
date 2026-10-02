"use client";

import { useSyncExternalStore } from "react";
import { parseAppUrl } from "./apps";

// The apps added by hand. They live in this browser and nowhere else.
const STORAGE_KEY = "simulator-apps";

const listeners = new Set<() => void>();
// useSyncExternalStore needs the same array back while nothing has changed.
let cached: { raw: string | null; apps: string[] } | undefined;

function read(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage can be switched off; the list is then empty and does not persist.
  }
  if (cached?.raw === raw) return cached.apps;
  let apps: string[] = [];
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (Array.isArray(parsed)) apps = parsed.flatMap((entry) => (typeof entry === "string" ? (parseAppUrl(entry) ?? []) : []));
  } catch {
    // Not a list this page wrote; start over.
  }
  cached = { raw, apps };
  return apps;
}

function write(apps: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(apps));
  } catch {
    cached = { raw: null, apps };
  }
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Fires for changes made in another tab.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The saved apps, oldest first; null on the server and until the browser's copy is read. */
export function useSavedApps(): string[] | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

export function addSavedApp(url: string) {
  const apps = read();
  if (!apps.includes(url)) write([...apps, url]);
}

export function removeSavedApp(url: string) {
  write(read().filter((app) => app !== url));
}
