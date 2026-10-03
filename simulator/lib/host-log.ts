"use client";

import { useSyncExternalStore } from "react";
import type { Insets } from "./devices";
import { answerCall, forgetSheets } from "./host";

// What an app asks of its host, as the simulator hears it, and answers it.
//
// A Bankroll app talks to its host through one object, window.bankroll. On a
// phone the Bankroll app puts it on the page and answers. Here the SDK puts
// its bridge there, and each call crosses to this page as a window message,
// which is the only way one origin reaches another. This page relays the call
// to the host in the CLI, on its own origin, and sends the answer back. The
// messages are the SDK's (`SimulatorMessage` in @joinbankroll/sdk/mock):
//
//   app -> here   ready    a bridge is on the page, and which SDK
//   here -> app   hello    I am here, as this Bankroll app; with it, the phone's safe area
//   app -> here   call     a call, by the phone's name for it
//   here -> app   result   its answer, or the reason it was refused
//   app -> here   refused  a call the SDK refused before asking
//
// The safe area goes the other way, and for the same reason. On a phone a page
// reads how far the status bar and the home indicator reach into the screen
// from env(safe-area-inset-*). In a browser on a computer those are zero, and
// nothing outside the page can set them. So hello carries the safe area of the
// phone drawn around the app, and the bridge puts it on the page as CSS
// variables (--bankroll-safe-area-inset-top and the rest), which the app's CSS
// prefers to the phone's own.

const CHANNEL = "simulator";

/**
 * The calls an app makes to its host through the SDK, by the SDK's names and
 * in the order the sidebar lists them. init() comes first, as it does in an
 * app, and says which SDK the app runs. status() is not one: it reads the page
 * and asks the host nothing.
 */
export const SDK_CALLS = ["init", "session", "charge", "balances", "deposit", "haptics", "promptReview"] as const;

// What crosses the frame is the phone's name for a call, and the phone's name
// is not always the SDK's. charge() asks the host for `pay`: the SDK renamed
// its function and kept the name on the wire, for the Bankroll apps already on
// phones. A call is listed under the name an app's code calls it by.
//
// The host answers three more that the SDK has no function for (identity, the
// old name for session, and quote and requestAmount). They are not listed
// until an app makes one, by reaching past the SDK to window.bankroll.
const FEATURE_PREFIX = "bankroll:";
const SDK_NAME = new Map([["pay", "charge"]]);
export const methodOf = (feature: string): string => {
  const bare = feature.startsWith(FEATURE_PREFIX) ? feature.slice(FEATURE_PREFIX.length) : feature;
  return SDK_NAME.get(bare) ?? bare;
};

/** One call, from when it began to how it ended. */
export interface CallEntry {
  key: string;
  /** When the app made it, in milliseconds since the epoch. */
  at: number;
  input?: unknown;
  /** Undefined while the host has not answered. */
  ok?: boolean;
  value?: unknown;
  error?: string;
  ms?: number;
}

export interface CallSection {
  /** Every call since the app opened, or since the log was cleared. */
  count: number;
  /** How many of them failed. */
  failed: number;
  /** The most recent calls, newest first. */
  entries: CallEntry[];
}

export interface HostLog {
  /** True once the open app's bridge has been heard from. */
  connected: boolean;
  /** The SDK the open app runs, as its bridge said. Undefined until it has, and for an app on an SDK from before the bridge. */
  sdk?: string;
  /** The SDK's calls, then any other the app turns out to make. */
  methods: string[];
  sections: Record<string, CallSection>;
}

/** A call on its way to being answered: enough to send the answer back and write it down. */
export interface CallTarget {
  frame: HTMLIFrameElement;
  origin: string;
  run: number;
  id: number;
  feature: string;
}

// A balance read every two seconds would otherwise grow without end.
const ENTRIES_KEPT = 100;
const EMPTY_SECTION: CallSection = { count: 0, failed: 0, entries: [] };
// The Bankroll app this host imitates, until the CLI says: hs3's BANKROLL_CLIENT_VERSION.
const PRESUMED_HOST_VERSION = "5";

const emptyLog = (): HostLog => ({
  connected: false,
  methods: [...SDK_CALLS],
  sections: Object.fromEntries(SDK_CALLS.map((method) => [method, EMPTY_SECTION])),
});

let log = emptyLog();
let frame: HTMLIFrameElement | null = null;
// The safe area of the phone on screen, as last said: every hello carries it.
let safeArea: Insets | undefined;
let hostVersion = PRESUMED_HOST_VERSION;
const hello = () => ({ bankroll: CHANNEL, type: "hello", version: hostVersion, safeArea });
// An app's page numbers its calls from 1, and starts again when it reloads.
// The run tells one page load's calls from the next's.
let run = 0;
let lastId = 0;
// When each call began here, so its answer can say how long it took.
const began = new Map<string, number>();
const listeners = new Set<() => void>();

function publish(next: HostLog) {
  log = next;
  listeners.forEach((listener) => listener());
}

function withEntry(method: string, change: (section: CallSection) => CallSection) {
  const known = method in log.sections;
  publish({
    ...log,
    connected: true,
    methods: known ? log.methods : [...log.methods, method],
    sections: { ...log.sections, [method]: change(log.sections[method] ?? EMPTY_SECTION) },
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function hear(event: MessageEvent) {
  // Only the app on the phone's screen is listened to, whatever else posts here.
  if (!frame || event.source !== frame.contentWindow) return;
  const message: unknown = event.data;
  if (!isRecord(message) || message.bankroll !== CHANNEL) return;

  if (message.type === "ready") {
    frame.contentWindow?.postMessage(hello(), event.origin);
    publish({ ...log, connected: true, ...(typeof message.sdk === "string" && message.sdk !== "unknown" ? { sdk: message.sdk } : {}) });
    return;
  }
  if (message.type === "refused") {
    if (typeof message.feature !== "string") return;
    const at = typeof message.at === "number" ? message.at : Date.now();
    const entry: CallEntry = { key: `${run}:refused:${at}:${Math.random().toString(36).slice(2, 6)}`, at, ok: false, error: typeof message.reason === "string" ? message.reason : "refused", ms: 0 };
    withEntry(methodOf(message.feature), (section) => ({ ...section, count: section.count + 1, failed: section.failed + 1, entries: [entry, ...section.entries].slice(0, ENTRIES_KEPT) }));
    return;
  }
  if (message.type !== "call") return;
  const { id, feature } = message;
  if (typeof id !== "number" || typeof feature !== "string") return;
  if (id <= lastId) run += 1;
  lastId = id;
  const method = methodOf(feature);
  // init() is where an app says which SDK it runs. Kept apart from its
  // entry in the log, which Clear empties.
  if (method === "init" && isRecord(message.input) && typeof message.input.sdk === "string") log = { ...log, sdk: message.input.sdk };
  const key = `${run}:${id}`;
  began.set(key, Date.now());
  const entry: CallEntry = { key, at: typeof message.at === "number" ? message.at : Date.now(), input: message.input };
  withEntry(method, (section) => ({ ...section, count: section.count + 1, entries: [entry, ...section.entries].slice(0, ENTRIES_KEPT) }));
  void answerCall({ frame, origin: event.origin, run, id, feature }, message.input);
}

/**
 * The answer to a call, sent to the app and written in the log. Called by the
 * host relay (lib/host.ts) once the host, or a sheet, has decided. An answer
 * for a page that has since been replaced is written down and goes nowhere.
 */
export function answer(target: CallTarget, outcome: { ok: true; value?: unknown } | { ok: false; error: string }) {
  const { id } = target;
  if (frame === target.frame && frame.contentWindow) {
    const result = outcome.ok ? { bankroll: CHANNEL, type: "result", id, ok: true, value: outcome.value } : { bankroll: CHANNEL, type: "result", id, ok: false, error: outcome.error };
    frame.contentWindow.postMessage(result, target.origin);
  }
  const key = `${target.run}:${id}`;
  const started = began.get(key);
  began.delete(key);
  const ended = { ok: outcome.ok, value: outcome.ok ? outcome.value : undefined, error: outcome.ok ? undefined : outcome.error, ms: started === undefined ? undefined : Date.now() - started };
  withEntry(methodOf(target.feature), (section) => {
    // Counted once: when its call is still waiting to hear how it ended.
    const waiting = section.entries.some((entry) => entry.key === key && entry.ok === undefined);
    return {
      ...section,
      failed: section.failed + (waiting && !ended.ok ? 1 : 0),
      entries: section.entries.map((entry) => (entry.key === key ? { ...entry, ...ended } : entry)),
    };
  });
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

// Listening starts with the first app and never stops. It cannot wait for the
// sidebar to be on the page: the frame and the sidebar hydrate separately, and
// an app says ready the moment its SDK loads.
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("message", hear);
  // Which Bankroll app the host imitates, from the CLI; presumed until it says.
  void fetch("/api/host")
    .then((response) => (response.ok ? response.json() : null))
    .then((told: unknown) => {
      if (isRecord(told) && typeof told.version === "string" && told.version) hostVersion = told.version;
    })
    .catch(() => {});
}

const SERVER_METHODS: string[] = [...SDK_CALLS];

// Each hook reads one part of the log, so a call re-renders its own section
// and nothing else: a balance read every two seconds should not redraw the lot.

/** True once the open app's bridge has been heard from. */
export function useHostConnected(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => log.connected,
    () => false,
  );
}

/** The SDK the open app runs, or undefined when it has not said. */
export function useReportedSdk(): string | undefined {
  return useSyncExternalStore(
    subscribe,
    () => log.sdk,
    () => undefined,
  );
}

/** The calls to list: the SDK's, then any other the app makes. */
export function useHostMethods(): string[] {
  return useSyncExternalStore(
    subscribe,
    () => log.methods,
    () => SERVER_METHODS,
  );
}

/** One call's section, re-rendering only when that call is made or answered. */
export function useCallSection(method: string): CallSection {
  return useSyncExternalStore(
    subscribe,
    () => log.sections[method] ?? EMPTY_SECTION,
    () => EMPTY_SECTION,
  );
}

/**
 * Says hello to the app in the frame, and with it the safe area of the phone
 * around it. Its bridge answers with everything since its page loaded. Said
 * again when the phone changes, the new safe area replaces the old.
 */
export function greet(origin: string, phone: Insets) {
  safeArea = phone;
  frame?.contentWindow?.postMessage(hello(), origin);
}

/** A new app is on the screen: its frame is the one listened to, and the log starts over. */
export function attachFrame(element: HTMLIFrameElement) {
  listen();
  frame = element;
  run += 1;
  lastId = 0;
  began.clear();
  forgetSheets();
  publish(emptyLog());
}

/** The app left the screen. */
export function detachFrame(element: HTMLIFrameElement) {
  if (frame !== element) return;
  frame = null;
  forgetSheets();
  publish(emptyLog());
}

/** Empties the log and keeps listening. What the app said of itself stands. */
export function clearHostLog() {
  publish({ ...emptyLog(), connected: log.connected, ...(log.sdk ? { sdk: log.sdk } : {}) });
}
