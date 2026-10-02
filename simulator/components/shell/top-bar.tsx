"use client";

import type { ChangeEvent } from "react";
import { DEVICES, ORIENTATIONS, type DeviceSpec, type Orientation } from "@/lib/devices";
import { THEME_COOKIE, clearSettingCookie, writeSettingCookie } from "@/lib/settings";
import { useShell } from "./device-provider";

// Devices arrive in menu order, newest generation first.
const FAMILIES = [...Map.groupBy(DEVICES, (device: DeviceSpec) => device.family)];

// Flips between light and dark. Landing back on what the system uses drops the
// override, so the page goes back to following the system setting.
function toggleTheme() {
  const root = document.documentElement;
  const system = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  const next = (root.dataset.theme ?? system) === "dark" ? "light" : "dark";
  if (next === system) {
    delete root.dataset.theme;
    clearSettingCookie(THEME_COOKIE);
  } else {
    root.dataset.theme = next;
    writeSettingCookie(THEME_COOKIE, next);
  }
}

export function TopBar() {
  const { device, orientation, setDevice, setOrientation } = useShell();

  // Hand the keyboard back afterwards, or arrow keys keep changing the menu
  // instead of reaching the game. Deferred, because a closing picker returns
  // focus to its select after this event.
  const change = (apply: (value: string) => void) => (event: ChangeEvent<HTMLSelectElement>) => {
    const select = event.target;
    apply(select.value);
    setTimeout(() => select.blur());
  };

  return (
    <header className="top-bar">
      <select aria-label="Device" className="menu-select" value={device.id} onChange={change(setDevice)}>
        {FAMILIES.map(([family, devices]) => (
          <optgroup key={family} label={family}>
            {devices.map(({ id, name }) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <select
        aria-label="Orientation"
        className="menu-select"
        value={orientation}
        onChange={change((value) => setOrientation(value as Orientation))}
      >
        {ORIENTATIONS.map(({ id, label }) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="top-bar-button"
        aria-label="Switch between light and dark"
        title="Switch between light and dark"
        onClick={toggleTheme}
        onMouseDown={(event) => event.preventDefault()}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5Z" fill="currentColor" />
        </svg>
      </button>
    </header>
  );
}
