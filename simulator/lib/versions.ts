"use client";

import { useEffect, useSyncExternalStore } from "react";
import { originOf } from "./apps";

// Which SDK the open app runs and which CLI serves this page, and what is
// worth saying of either: a later release is out, the install is stale, it is
// a local build. The shapes are the CLI's (src/versions.ts there).
//
// This page knows one thing by itself: the SDK version the app says it runs,
// which the app's init() tells it. The rest is read where this page cannot
// reach, in the app's folder and at the registry, so it asks whoever serves it,
// at /api/versions, which is the CLI.

/** One package, as the sidebar shows it. */
export interface PackageReport {
  /** The version to show. For the SDK: what the app says it runs, or else what is installed. */
  version?: string;
  /** The latest published release, when the registry could be asked. */
  latest?: string;
  /** A later release than `version` is published. Never said of a local build. */
  behind: boolean;
  /** A build of someone's own, not a published one. */
  local: boolean;
}

export interface SdkReport extends PackageReport {
  /** What node_modules holds, in the folder of the app the CLI runs. */
  installed?: string;
  /** What that app's package.json asks for. */
  wanted?: string;
  /** What its lockfile settles on. */
  locked?: string;
  /** What is installed is not what the project asks for. */
  stale: boolean;
}

export interface VersionReport {
  cli: PackageReport;
  /** Absent when no app is open. */
  sdk?: SdkReport;
}

// The last answer to each question asked: which app, saying which SDK.
const known = new Map<string, VersionReport>();
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

const isReport = (value: unknown): value is VersionReport => typeof value === "object" && value !== null && typeof (value as VersionReport).cli === "object";

const question = (url: string | null, reported: string | undefined) => `${new URLSearchParams({ ...(url ? { app: originOf(url) } : {}), ...(reported ? { sdk: reported } : {}) })}`;

/** Asks, and keeps the answer. No answer leaves the last one standing: a server that is not the CLI has none to give. */
async function ask(asked: string) {
  const answer: unknown = await fetch(`/api/versions?${asked}`)
    .then((response) => (response.ok ? response.json() : undefined))
    .catch(() => undefined);
  if (!isReport(answer)) return;
  known.set(asked, answer);
  listeners.forEach((listener) => listener());
}

/**
 * The versions to show for the app on the screen (null on the home screen),
 * given the SDK it says it runs. Asked again whenever the window comes back to
 * the front: an install or an upgrade happens in a terminal, while this page
 * stays open. Undefined until there is an answer, and always on the server.
 */
export function useVersionReport(url: string | null, reported: string | undefined): VersionReport | undefined {
  const asked = question(url, reported);

  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible") void ask(asked);
    };
    again();
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [asked]);

  return useSyncExternalStore(
    subscribe,
    () => known.get(asked),
    () => undefined,
  );
}
