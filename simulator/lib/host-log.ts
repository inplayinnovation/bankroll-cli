"use client";

import { useSyncExternalStore } from "react";
import type { Insets } from "./devices";

// What an app asks of its host, as the simulator hears it.
//
// A Bankroll app talks to its host through one object, window.bankroll. On a
// phone the Bankroll app answers. Here the SDK's stand-in host answers, inside
// the app's own page, and tells this page each call in window messages, which
// is the only way one origin learns anything of another. The messages are the
// SDK's (`SimulatorMessage` in @joinbankroll/sdk/mock):
//
//   app -> here   ready    a stand-in host is on the page
//   here -> app   hello    tell me, and whatever I missed; with it, the phone's safe area
//   app -> here   call     a call began
//   app -> here   result   the same call ended
//
// The safe area goes the other way, and for the same reason. On a phone a page
// reads how far the status bar and the home indicator reach into the screen
// from env(safe-area-inset-*). In a browser on a computer those are zero, and
// nothing outside the page can set them. So hello carries the safe area of the
// phone drawn around the app, and the app's stand-in host puts it on the page
// as CSS variables (--bankroll-safe-area-inset-top and the rest), which the
// app's CSS prefers to the phone's own.

const CHANNEL = "simulator";

/**
 * The calls an app makes to its host through the SDK, by the SDK's names and
 * in the order the sidebar lists them. init() comes first, as it does in an
 * app, and says which SDK the app runs. status() is not one: it reads the page
 * and asks the host nothing.
 */
export const SDK_CALLS = ["init", "session", "charge", "balances", "deposit", "haptics", "promptReview"] as const;

// What is heard here is what the host was asked, and the host's name for a
// call is not always the SDK's. charge() asks the host for `pay`: the SDK
// renamed its function and kept the name on the wire, for the Bankroll apps
// already on phones. A call is listed under the name an app's code calls it by.
//
// The host answers three more that the SDK has no function for (identity, the
// old name for session, and quote and requestAmount). They are not listed
// until an app makes one, by reaching past the SDK to window.bankroll.
//
// A call the SDK refuses before it asks, one made before init(), never
// reaches the host. The stand-in host is told of it and tells it here as a
// call that failed, so it shows where the call would have.
const SDK_NAME = new Map([["pay", "charge"]]);

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
  /** True once the open app's stand-in host has been heard from. */
  connected: boolean;
  /** The SDK the open app said it runs, in init(). Undefined until it has, and for an app on an SDK from before init(). */
  sdk?: string;
  /** The SDK's calls, then any other the app turns out to make. */
  methods: string[];
  sections: Record<string, CallSection>;
}

// A balance read every two seconds would otherwise grow without end.
const ENTRIES_KEPT = 100;
const EMPTY_SECTION: CallSection = { count: 0, failed: 0, entries: [] };

const emptyLog = (): HostLog => ({
  connected: false,
  methods: [...SDK_CALLS],
  sections: Object.fromEntries(SDK_CALLS.map((method) => [method, EMPTY_SECTION])),
});

let log = emptyLog();
let frame: HTMLIFrameElement | null = null;
// The safe area of the phone on screen, as last said: every hello carries it.
let safeArea: Insets | undefined;
const hello = () => ({ bankroll: CHANNEL, type: "hello", safeArea });
// An app's page numbers its calls from 1, and starts again when it reloads.
// The run tells one page load's calls from the next's.
let run = 0;
let lastId = 0;
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
    if (!log.connected) publish({ ...log, connected: true });
    return;
  }
  const { id } = message;
  if (typeof id !== "number" || typeof message.method !== "string") return;
  const method = SDK_NAME.get(message.method) ?? message.method;

  if (message.type === "call") {
    if (id <= lastId) run += 1;
    lastId = id;
    // init() is where an app says which SDK it runs. Kept apart from its
    // entry in the log, which Clear empties.
    if (method === "init" && isRecord(message.input) && typeof message.input.sdk === "string") log = { ...log, sdk: message.input.sdk };
    const entry: CallEntry = { key: `${run}:${id}`, at: typeof message.at === "number" ? message.at : Date.now(), input: message.input };
    withEntry(method, (section) => ({ ...section, count: section.count + 1, entries: [entry, ...section.entries].slice(0, ENTRIES_KEPT) }));
  } else if (message.type === "result") {
    const key = `${run}:${id}`;
    const ended = { ok: message.ok === true, value: message.value, error: typeof message.error === "string" ? message.error : undefined, ms: typeof message.ms === "number" ? message.ms : undefined };
    withEntry(method, (section) => {
      // Counted once: when its call is still waiting to hear how it ended.
      const waiting = section.entries.some((entry) => entry.key === key && entry.ok === undefined);
      return {
        ...section,
        failed: section.failed + (waiting && !ended.ok ? 1 : 0),
        entries: section.entries.map((entry) => (entry.key === key ? { ...entry, ...ended } : entry)),
      };
    });
  }
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

// Listening starts with the first app and never stops. It cannot wait for the
// sidebar to be on the page: the frame and the sidebar hydrate separately, and
// an app answers hello with everything it has done so far, at once.
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("message", hear);
}

const SERVER_METHODS: string[] = [...SDK_CALLS];

// Each hook reads one part of the log, so a call re-renders its own section
// and nothing else: a balance read every two seconds should not redraw the lot.

/** True once the open app's stand-in host has been heard from. */
export function useHostConnected(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => log.connected,
    () => false,
  );
}

/** The SDK the open app said it runs, or undefined when it has not said. */
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
 * around it. Its host answers with everything since its page loaded. Said
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
  publish(emptyLog());
}

/** The app left the screen. */
export function detachFrame(element: HTMLIFrameElement) {
  if (frame !== element) return;
  frame = null;
  publish(emptyLog());
}

/** Empties the log and keeps listening. What the app said of itself stands. */
export function clearHostLog() {
  publish({ ...emptyLog(), connected: log.connected, ...(log.sdk ? { sdk: log.sdk } : {}) });
}
