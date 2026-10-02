"use client";

import type { CSSProperties, ReactNode } from "react";
import { DeviceControls } from "./device-controls";
import { DeviceFrame } from "./device-frame";
import { useShell } from "./device-provider";

/** Fills the page under the top bar and shrinks the device to fit (see globals.css). */
export function DeviceStage({ children }: { children: ReactNode }) {
  const { width, height } = useShell().geometry.window;

  return (
    <main className="stage min-h-0 flex-1">
      <div className="stage-fit" style={{ "--device-width": width, "--device-height": height } as CSSProperties}>
        <div className="device-fit">
          <DeviceFrame>{children}</DeviceFrame>
        </div>
        <DeviceControls />
      </div>
    </main>
  );
}
