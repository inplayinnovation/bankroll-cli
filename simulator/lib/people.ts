"use client";

import { useSyncExternalStore } from "react";
import { reloadApp } from "./reload";

// The pretend people the app can be shown to. They live in the CLI, which keeps
// them on this computer (src/host/people.ts); this page asks for the list and
// says who to show the app to. Switching reloads the app: a session belongs to
// one person, and the app starts over as the next.

export interface Person {
  id: string;
  username: string;
  /** The verified age, or null for an account that has not verified. */
  age: number | null;
  wallet: string;
  /** What the person holds when the chain starts fresh, in cents. */
  balanceCents: number;
  grants: string[];
}

export interface PeopleState {
  /** Undefined until the CLI has answered. */
  people?: Person[];
  current?: string;
  /** Why the CLI could not be asked, when it could not. */
  problem?: string;
}

let state: PeopleState = {};
const listeners = new Set<() => void>();

function publish(next: PeopleState) {
  state = next;
  listeners.forEach((listener) => listener());
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

async function ask(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/host/${path}`, init);
  const told: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(isRecord(told) && typeof told.error === "string" ? told.error : `the host answered ${response.status}`);
  if (!isRecord(told)) throw new Error("the host's answer made no sense");
  return told;
}

const post = (path: string, body: unknown) => ask(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function take(told: Record<string, unknown>) {
  publish({ people: Array.isArray(told.people) ? (told.people as Person[]) : [], current: typeof told.current === "string" ? told.current : undefined });
}

let asked = false;
/** Asks the CLI who there is, once; `again` asks again. */
export async function loadPeople(again = false): Promise<void> {
  if (asked && !again) return;
  asked = true;
  try {
    take(await ask("people"));
  } catch (error) {
    publish({ ...state, problem: error instanceof Error ? error.message : String(error) });
  }
}

/** Shows the app to this person from now on, and starts the app over as them. */
export async function selectPerson(id: string): Promise<void> {
  if (id === state.current) return;
  take(await post("people/select", { id }));
  reloadApp();
}

/** A new person, shown the app from now on. Throws the reason when the CLI refuses. */
export async function createPerson(input: { username: string; age: number | null; balanceCents: number }): Promise<Person> {
  const { person } = await post("people", input);
  const made = person as Person;
  await selectPerson(made.id);
  return made;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Everyone, and who the app is shown to. */
export function usePeople(): PeopleState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** The person the app is shown to, once known. */
export function useCurrentPerson(): Person | undefined {
  const { people, current } = usePeople();
  return people?.find((person) => person.id === current);
}
