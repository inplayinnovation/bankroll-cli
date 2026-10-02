"use client";

import { shownOnPhones } from "@/lib/devices";
import { goHome } from "@/lib/open-app";
import { useShell } from "./device-provider";

/** The row under the device. Home for now; other device controls go here too. */
export function DeviceControls() {
  const { orientation } = useShell();

  return (
    <>
      <nav aria-label="Device controls" className="flex h-9 flex-none items-center gap-2">
        <button type="button" aria-label="Home" title="Home" className="control-button" onClick={goHome}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M9.3 2.3a1.1 1.1 0 0 1 1.4 0l7 5.9c.6.5.2 1.5-.6 1.5H16v6.8c0 .6-.5 1.1-1.1 1.1h-2.6v-4.9c0-.4-.3-.7-.7-.7H8.4c-.4 0-.7.3-.7.7v4.9H5.1c-.6 0-1.1-.5-1.1-1.1V9.7H2.9c-.8 0-1.2-1-.6-1.5l7-5.9Z" />
          </svg>
        </button>
      </nav>
      {/* A layout that only works turned would never be seen. Said here, under the turned phone. */}
      {!shownOnPhones(orientation) && <p className="stage-note">The Bankroll app is portrait only. On a phone, an app never turns like this.</p>}
    </>
  );
}
