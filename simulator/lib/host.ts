"use client";

import { useSyncExternalStore } from "react";
import { answer, methodOf, type CallTarget } from "./host-log";

// The host's answers, relayed. The host itself lives in the CLI (src/host/)
// and is reached on this page's own origin, so a call heard from the app's
// frame is posted there, and what comes back goes to the app:
//
//   an answer      sent to the app at once
//   a refusal      the same, with the phone's words for why
//   a sheet        shown under the call's row in the sidebar, as the phone shows
//                  one to its user; the developer's decision answers the call
//
// A deposit is both: answered at once, as the phone answers it when its
// screen is up, with a sheet that adds the money.

/** What the host asks the developer, under the call's row. */
export type Sheet = {
  id: string;
  feature: string;
  person: { id: string; username: string };
  app: { origin: string; name?: string };
} & (
  | { kind: "consent" }
  | { kind: "verify"; age: number }
  | { kind: "pay"; amountCents: number; memo?: string; payee: string; deadline: number }
  | { kind: "deposit"; amountCents: number; balanceCents: number | null }
);

type Outcome = { ok: true; value?: unknown } | { ok: false; error: string };
type Answer = ({ done: true; sheet?: Sheet } & Outcome) | { done: false; sheet: Sheet };

/** A sheet on the page, and the calls waiting on it. */
interface OpenSheet {
  sheet: Sheet;
  method: string;
  waiting: CallTarget[];
  /** True while the decision is on its way to the host. */
  deciding: boolean;
}

let sheets: OpenSheet[] = [];
const listeners = new Set<() => void>();
// Payments change what the treasury holds; whoever shows it is told.
const settled = new Set<() => void>();

function publish(next: OpenSheet[]) {
  sheets = next;
  listeners.forEach((listener) => listener());
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

async function askHost(path: string, body: unknown): Promise<Answer> {
  const response = await fetch(`/api/host/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const told: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(isRecord(told) && typeof told.error === "string" ? told.error : `the host answered ${response.status}`);
  }
  if (!isRecord(told) || typeof told.done !== "boolean") throw new Error("the host's answer made no sense");
  return told as unknown as Answer;
}

function show(sheet: Sheet, waiting: CallTarget[]) {
  const open = sheets.find((candidate) => candidate.sheet.id === sheet.id);
  if (open) {
    publish(sheets.map((candidate) => (candidate === open ? { ...open, waiting: [...open.waiting, ...waiting] } : candidate)));
  } else {
    publish([...sheets, { sheet, method: methodOf(sheet.feature), waiting, deciding: false }]);
  }
}

function settle(outcome: Outcome, waiting: CallTarget[]) {
  for (const target of waiting) answer(target, outcome);
  if (outcome.ok) settled.forEach((listener) => listener());
}

/** A call heard from the app: the host answers it, or asks first. */
export async function answerCall(target: CallTarget, input: unknown): Promise<void> {
  let told: Answer;
  try {
    told = await askHost("call", { app: target.origin, feature: target.feature, input });
  } catch (error) {
    answer(target, { ok: false, error: `the simulator's host did not answer: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  if (told.done) {
    answer(target, told.ok ? { ok: true, value: told.value } : { ok: false, error: told.error });
    if (told.ok) settled.forEach((listener) => listener());
    if (told.sheet) show(told.sheet, []);
  } else {
    show(told.sheet, [target]);
  }
}

/** The developer answered a sheet: the host hears, and the calls waiting on it are answered. */
export async function decide(sheetId: string, approve: boolean, input?: unknown): Promise<void> {
  const open = sheets.find((candidate) => candidate.sheet.id === sheetId);
  if (!open || open.deciding) return;
  publish(sheets.map((candidate) => (candidate === open ? { ...open, deciding: true } : candidate)));
  let told: Answer;
  try {
    told = await askHost("decide", { sheet: sheetId, approve, input });
  } catch (error) {
    publish(sheets.filter((candidate) => candidate.sheet.id !== sheetId));
    settle({ ok: false, error: `the simulator's host did not answer: ${error instanceof Error ? error.message : String(error)}` }, open.waiting);
    return;
  }
  publish(sheets.filter((candidate) => candidate.sheet.id !== sheetId));
  if (told.done) {
    settle(told.ok ? { ok: true, value: told.value } : { ok: false, error: told.error }, open.waiting);
    if (told.sheet) show(told.sheet, []);
  } else {
    // One sheet led to another: consent, then verification.
    show(told.sheet, open.waiting);
  }
}

/** The app's page went away: what it was asked is moot. */
export function forgetSheets() {
  if (sheets.length) publish([]);
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

const NONE: OpenSheet[] = [];

/** The sheets open under one call's row. */
export function useSheets(method: string): OpenSheet[] {
  const all = useSyncExternalStore(subscribe, () => sheets, () => NONE);
  return all.length === 0 ? NONE : all.filter((open) => open.method === method);
}

/** Runs `onChange` each time the host answers a call that may have moved money. */
export function onSettled(onChange: () => void): () => void {
  settled.add(onChange);
  return () => {
    settled.delete(onChange);
  };
}
