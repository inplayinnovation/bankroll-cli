"use client";

import { useSyncExternalStore } from "react";

// What an app asks of its host, as the simulator hears it.
//
// A Bankroll app talks to its host through one object, window.bankroll. On a
// phone the Bankroll app answers. Here the SDK's stand-in host answers, inside
// the app's own page, and tells this page each call in window messages, which
// is the only way one origin learns anything of another. The messages are the
// SDK's (`SimulatorMessage` in @joinbankroll/sdk/mock):
//
//   app -> here   ready    a stand-in host is on the page
//   here -> app   hello    tell me, and whatever I missed
//   app -> here   call     a call began
//   app -> here   result   the same call ended

const CHANNEL = "simulator";

/** Every call a host answers, in the order the sidebar lists them. */
export const HOST_CALLS = ["session", "identity", "pay", "balances", "deposit", "haptics", "promptReview", "quote", "requestAmount"] as const;

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
  /** The most recent calls, newest first. */
  entries: CallEntry[];
}

export interface HostLog {
  /** True once the open app's stand-in host has been heard from. */
  connected: boolean;
  /** The nine calls, then any other the app's host turns out to answer. */
  methods: string[];
  sections: Record<string, CallSection>;
}

// A balance read every two seconds would otherwise grow without end.
const ENTRIES_KEPT = 100;
const EMPTY_SECTION: CallSection = { count: 0, entries: [] };

const emptyLog = (): HostLog => ({
  connected: false,
  methods: [...HOST_CALLS],
  sections: Object.fromEntries(HOST_CALLS.map((method) => [method, EMPTY_SECTION])),
});

let log = emptyLog();
let frame: HTMLIFrameElement | null = null;
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
    frame.contentWindow?.postMessage({ bankroll: CHANNEL, type: "hello" }, event.origin);
    if (!log.connected) publish({ ...log, connected: true });
    return;
  }
  const { id, method } = message;
  if (typeof id !== "number" || typeof method !== "string") return;

  if (message.type === "call") {
    if (id <= lastId) run += 1;
    lastId = id;
    const entry: CallEntry = { key: `${run}:${id}`, at: typeof message.at === "number" ? message.at : Date.now(), input: message.input };
    withEntry(method, (section) => ({ count: section.count + 1, entries: [entry, ...section.entries].slice(0, ENTRIES_KEPT) }));
  } else if (message.type === "result") {
    const key = `${run}:${id}`;
    const ended = { ok: message.ok === true, value: message.value, error: typeof message.error === "string" ? message.error : undefined, ms: typeof message.ms === "number" ? message.ms : undefined };
    withEntry(method, (section) => ({ ...section, entries: section.entries.map((entry) => (entry.key === key ? { ...entry, ...ended } : entry)) }));
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

const SERVER_METHODS: string[] = [...HOST_CALLS];

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

/** The calls to list: the nine, then any other the app's host answers. */
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

/** Says hello to the app in the frame. Its host answers with everything since its page loaded. */
export function greet(origin: string) {
  frame?.contentWindow?.postMessage({ bankroll: CHANNEL, type: "hello" }, origin);
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

/** Empties the log and keeps listening. */
export function clearHostLog() {
  publish({ ...emptyLog(), connected: log.connected });
}
