"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { frameGeometry, getDevice, safeAreaInsets, type DeviceSpec, type FrameGeometry, type Insets, type Orientation } from "@/lib/devices";
import { saveDevice, saveOrientation, useDeviceSettings } from "@/lib/settings";

interface Shell {
  device: DeviceSpec;
  orientation: Orientation;
  geometry: FrameGeometry;
  safeArea: Insets;
  setDevice: (id: string) => void;
  setOrientation: (orientation: Orientation) => void;
}

const ShellContext = createContext<Shell | null>(null);

export function DeviceProvider({ children }: { children: ReactNode }) {
  const settings = useDeviceSettings();

  const shell = useMemo<Shell | null>(() => {
    if (!settings) return null;
    const device = getDevice(settings.deviceId);
    return {
      device,
      orientation: settings.orientation,
      geometry: frameGeometry(device, settings.orientation),
      safeArea: safeAreaInsets(device, settings.orientation),
      setDevice: saveDevice,
      setOrientation: saveOrientation,
    };
  }, [settings]);

  // Which phone to draw is kept in the browser, and the page's HTML was written
  // before any browser was asked. Until it is known nothing is drawn: an empty
  // desk for a moment, not the wrong phone.
  if (!shell) return null;

  return <ShellContext value={shell}>{children}</ShellContext>;
}

/** The device being simulated, for the shell's own components. */
export function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("useShell must be used inside <DeviceProvider>");
  return shell;
}
