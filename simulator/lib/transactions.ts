"use client";

import { useSyncExternalStore } from "react";
import { loadPeople } from "./people";

// The local chain's activity, as the CLI hears it (src/host/transactions.ts
// there). This page asks for what is new every little while and keeps the
// rows, newest first; a new row also means balances moved, so the users are
// asked for again.

export type TransactionKind = "transfer" | "mint" | "fees" | "account" | "other";

export interface Instruction {
  program: string;
  type?: string;
  info?: unknown;
}

export interface ChainTransaction {
  seq: number;
  signature: string;
  slot: number;
  at: number;
  ok: boolean;
  error?: string;
  kind: TransactionKind;
  from?: string;
  to?: string;
  recipients?: { to: string; amountCents: number }[];
  amountCents?: number;
  memo?: string;
  reference?: string;
  feePayer: string;
  fee: number;
  instructions: Instruction[];
  accounts: string[];
}

export interface TransactionsState {
  /** Newest first. Undefined until the CLI has answered once. */
  entries?: ChainTransaction[];
  /** Wallets this host knows, by name. */
  names: Record<string, string>;
  /** Rows at or before this are hidden: what Clear does. */
  clearedThrough: number;
  problem?: string;
}

const ASK_EVERY_MS = 1_500;
const KEPT = 500;

let state: TransactionsState = { names: {}, clearedThrough: 0 };
let after = 0;
let origin: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let asking = false;
const listeners = new Set<() => void>();

function publish(next: TransactionsState) {
  state = next;
  listeners.forEach((listener) => listener());
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

async function ask(): Promise<void> {
  if (asking) return;
  asking = true;
  try {
    const query = new URLSearchParams({ after: String(after) });
    if (origin) query.set("app", origin);
    const response = await fetch(`/api/host/transactions?${query}`);
    const told: unknown = await response.json().catch(() => null);
    if (!response.ok || !isRecord(told) || !Array.isArray(told.entries)) {
      publish({ ...state, problem: isRecord(told) && typeof told.error === "string" ? told.error : `the host answered ${response.status}` });
      return;
    }
    const fresh = told.entries as ChainTransaction[];
    if (typeof told.after === "number") after = Math.max(after, told.after);
    const names = isRecord(told.names) ? (told.names as Record<string, string>) : state.names;
    const entries = fresh.length ? [...fresh.reverse(), ...(state.entries ?? [])].slice(0, KEPT) : (state.entries ?? []);
    publish({ entries, names, clearedThrough: state.clearedThrough });
    if (fresh.length) void loadPeople(true);
  } catch (error) {
    publish({ ...state, problem: error instanceof Error ? error.message : String(error) });
  } finally {
    asking = false;
  }
}

/** Starts asking the CLI for the chain's activity, for the app at `appOrigin`; stops when the returned function is called. */
export function watchTransactions(appOrigin: string | null): () => void {
  origin = appOrigin;
  void ask();
  if (!timer) timer = setInterval(() => void ask(), ASK_EVERY_MS);
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

/** Hides everything so far. New rows still arrive. */
export function clearTransactions() {
  publish({ ...state, clearedThrough: after });
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

const EMPTY: TransactionsState = { names: {}, clearedThrough: 0 };

export function useTransactions(): TransactionsState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}
