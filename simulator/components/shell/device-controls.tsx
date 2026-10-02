"use client";

import { goHome } from "@/lib/apps";

/** The row under the device. Home for now; other device controls go here too. */
export function DeviceControls() {
  return (
    <nav aria-label="Device controls" className="flex h-9 flex-none items-center gap-2">
      {/* preventDefault keeps focus where it was, so the keyboard stays with the app. */}
      <button type="button" aria-label="Home" title="Home" className="control-button" onMouseDown={(event) => event.preventDefault()} onClick={goHome}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path d="M9.3 2.3a1.1 1.1 0 0 1 1.4 0l7 5.9c.6.5.2 1.5-.6 1.5H16v6.8c0 .6-.5 1.1-1.1 1.1h-2.6v-4.9c0-.4-.3-.7-.7-.7H8.4c-.4 0-.7.3-.7.7v4.9H5.1c-.6 0-1.1-.5-1.1-1.1V9.7H2.9c-.8 0-1.2-1-.6-1.5l7-5.9Z" />
        </svg>
      </button>
    </nav>
  );
}
