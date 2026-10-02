import { BEZELS, DEVICES, SCREEN_OUTLINES, type BezelSpec, type DeviceSpec, type Orientation } from "./generated";
import { METRICS, type DeviceMetrics } from "./metrics";

export { DEVICES };
export type { BezelSpec, ButtonSpec, DeviceSpec, Orientation } from "./generated";

// Landscape is listed and not yet available. The Bankroll app is locked
// upright on a phone, so an app there is only ever seen in portrait, and the
// simulator shows it no other way. The phone here can turn (frameGeometry
// below): the menu and parseOrientation are what keep it upright.
export const ORIENTATIONS: readonly { id: Orientation; label: string; available: boolean }[] = [
  { id: "portrait", label: "Portrait", available: true },
  { id: "landscape-left", label: "Landscape Left", available: false },
  { id: "landscape-right", label: "Landscape Right", available: false },
];

export const DEFAULT_DEVICE_ID = "iphone-18-pro";
export const DEFAULT_ORIENTATION: Orientation = "portrait";

/** Falls back to the default device for unknown or missing ids. */
export function getDevice(id: string | undefined): DeviceSpec {
  const device = DEVICES.find((candidate) => candidate.id === id) ?? DEVICES.find((candidate) => candidate.id === DEFAULT_DEVICE_ID);
  if (!device) throw new Error(`Default device "${DEFAULT_DEVICE_ID}" is missing from the generated device list`);
  return device;
}

/** Falls back to upright for anything unknown, and for a way up that is not available: one saved before it was greyed out. */
export function parseOrientation(value: string | undefined): Orientation {
  return ORIENTATIONS.find((orientation) => orientation.available && orientation.id === value)?.id ?? DEFAULT_ORIENTATION;
}

export function getMetrics(device: DeviceSpec): DeviceMetrics {
  const metrics = METRICS[device.id];
  if (!metrics) throw new Error(`lib/devices/metrics.ts has no entry for "${device.id}"`);
  return metrics;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function safeAreaInsets(device: DeviceSpec, orientation: Orientation): Insets {
  const { portrait, landscape } = getMetrics(device).safeArea;
  if (orientation === "portrait") return { top: portrait.top, right: 0, bottom: portrait.bottom, left: 0 };
  return { top: landscape.top, right: landscape.side, bottom: landscape.bottom, left: landscape.side };
}

export interface FrameGeometry {
  bezel: BezelSpec;
  /** The whole device including room for the side buttons, as laid out upright. */
  portraitWindow: { width: number; height: number };
  /** The same box after rotation: what the page actually has to fit. */
  window: { width: number; height: number };
  /** Where the screen lands inside `window`, already in its final orientation. */
  screen: { x: number; y: number; width: number; height: number };
  /** Screen shape as SVG path data, relative to `screen`. */
  outline: string;
  /** Maps the upright hardware layer onto `window`. */
  hardwareTransform: string | undefined;
}

export function frameGeometry(device: DeviceSpec, orientation: Orientation): FrameGeometry {
  const bezel = BEZELS[device.bezel];
  const { padding, inset } = bezel;
  const { width, height } = device.screen;
  const portraitWindow = {
    width: bezel.width + padding.left + padding.right,
    height: bezel.height + padding.top + padding.bottom,
  };
  const outline = SCREEN_OUTLINES[device.screen.outline][orientation];

  if (orientation === "portrait") {
    return {
      bezel,
      portraitWindow,
      window: portraitWindow,
      screen: { x: padding.left + inset, y: padding.top + inset, width, height },
      outline,
      hardwareTransform: undefined,
    };
  }

  // Rotating about the top-left corner and sliding back into view keeps every
  // edge on a whole pixel. Rotating about the centre would not when the
  // window's width and height differ by an odd number.
  const window = { width: portraitWindow.height, height: portraitWindow.width };
  if (orientation === "landscape-left") {
    return {
      bezel,
      portraitWindow,
      window,
      screen: { x: padding.top + inset, y: padding.right + inset, width: height, height: width },
      outline,
      hardwareTransform: `translate(0px, ${portraitWindow.width}px) rotate(-90deg)`,
    };
  }
  return {
    bezel,
    portraitWindow,
    window,
    screen: { x: padding.bottom + inset, y: padding.left + inset, width: height, height: width },
    outline,
    hardwareTransform: `translate(${portraitWindow.height}px, 0px) rotate(90deg)`,
  };
}
