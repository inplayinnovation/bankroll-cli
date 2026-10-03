"use client";

import { useSyncExternalStore } from "react";

// Starting the open app over: the frame is remounted, so the app's page loads
// again from nothing, as it does when the simulator shows it to another person.

let generation = 0;
const listeners = new Set<() => void>();

/** Starts the open app over. */
export function reloadApp() {
  generation += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** Changes each time the app is started over; part of the frame's key. */
export function useAppGeneration(): number {
  return useSyncExternalStore(
    subscribe,
    () => generation,
    () => 0,
  );
}
