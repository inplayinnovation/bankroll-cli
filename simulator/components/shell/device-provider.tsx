"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { frameGeometry, getDevice, safeAreaInsets, type DeviceSpec, type FrameGeometry, type Insets, type Orientation } from "@/lib/devices";
import { DEVICE_COOKIE, ORIENTATION_COOKIE, writeSettingCookie } from "@/lib/settings";

interface Shell {
  device: DeviceSpec;
  orientation: Orientation;
  geometry: FrameGeometry;
  safeArea: Insets;
  setDevice: (id: string) => void;
  setOrientation: (orientation: Orientation) => void;
}

const ShellContext = createContext<Shell | null>(null);

export function DeviceProvider({
  initialDeviceId,
  initialOrientation,
  children,
}: {
  initialDeviceId: string;
  initialOrientation: Orientation;
  children: ReactNode;
}) {
  const [deviceId, setDeviceId] = useState(initialDeviceId);
  const [orientation, setOrientationState] = useState(initialOrientation);

  const shell = useMemo<Shell>(() => {
    const device = getDevice(deviceId);
    return {
      device,
      orientation,
      geometry: frameGeometry(device, orientation),
      safeArea: safeAreaInsets(device, orientation),
      setDevice(id) {
        setDeviceId(id);
        writeSettingCookie(DEVICE_COOKIE, id);
      },
      setOrientation(next) {
        setOrientationState(next);
        writeSettingCookie(ORIENTATION_COOKIE, next);
      },
    };
  }, [deviceId, orientation]);

  return <ShellContext value={shell}>{children}</ShellContext>;
}

/** The device being simulated, for the shell's own components. */
export function useShell(): Shell {
  const shell = useContext(ShellContext);
  if (!shell) throw new Error("useShell must be used inside <DeviceProvider>");
  return shell;
}
