"use client";

import { useSyncExternalStore } from "react";
import { getDevice, parseOrientation, type Orientation } from "./devices";
import { THEME_KEY, type Theme } from "./theme";

// The shell's settings: which device, which way up, and the theme. The
// simulator is served as static files, so no server reads them and renders the
// right phone first. They live in this browser, and the phone is drawn once
// they have been read.

const DEVICE_KEY = "simulator-device";
const ORIENTATION_KEY = "simulator-orientation";

export interface DeviceSettings {
  deviceId: string;
  orientation: Orientation;
}

const listeners = new Set<() => void>();
// Where the settings go when storage is switched off: they hold for the visit.
const memory = new Map<string, string>();
// useSyncExternalStore needs the same object back while nothing has changed.
let cached: { raw: string; settings: DeviceSettings } | undefined;

function stored(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return memory.get(key);
  }
}

function store(key: string, value: string | undefined) {
  try {
    if (value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    if (value === undefined) memory.delete(key);
    else memory.set(key, value);
  }
  listeners.forEach((listener) => listener());
}

function read(): DeviceSettings {
  const deviceId = stored(DEVICE_KEY);
  const orientation = stored(ORIENTATION_KEY);
  const raw = `${deviceId} ${orientation}`;
  // Anything unknown, or nothing at all, falls back to the default device, upright.
  if (cached?.raw !== raw) cached = { raw, settings: { deviceId: getDevice(deviceId).id, orientation: parseOrientation(orientation) } };
  return cached.settings;
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

/** The chosen device and orientation; null on the server and until this browser's are read. */
export function useDeviceSettings(): DeviceSettings | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

export const saveDevice = (id: string) => store(DEVICE_KEY, id);

export const saveOrientation = (orientation: Orientation) => store(ORIENTATION_KEY, orientation);

/** Pins the theme, or with undefined goes back to following the system. */
export const saveTheme = (theme: Theme | undefined) => store(THEME_KEY, theme);
