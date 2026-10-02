"use client";

import { useSyncExternalStore } from "react";
import { getMetrics } from "@/lib/devices";
import { useShell } from "./device-provider";

// Wakes on each minute boundary.
function subscribeToMinutes(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    timer = setTimeout(() => {
      onChange();
      schedule();
    }, 60_000 - (Date.now() % 60_000) + 50);
  };
  schedule();
  return () => clearTimeout(timer);
}

const currentTime = () => new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "");

/**
 * What iOS draws over every app: the status bar (portrait only) and the home
 * indicator. An app is another origin, so its colours cannot be read; the layer
 * blends against whatever is under it instead (`.system-ui` in globals.css),
 * which comes out light over a dark page and dark over a light one.
 */
export function SystemUI() {
  const { device, orientation, geometry } = useShell();
  // The server cannot know the viewer's clock, so it renders Apple's 9:41 and the
  // real time takes over after hydration.
  const time = useSyncExternalStore(subscribeToMinutes, currentTime, () => "9:41");

  const { width } = geometry.screen;
  const portrait = orientation === "portrait";
  const { island } = getMetrics(device);

  // Time and indicators sit either side of the island or notch, centred on it vertically.
  const band = island
    ? { top: island.top, height: island.height, inset: width * 0.193, fontSize: 17 }
    : { top: 7, height: device.notch?.height ?? 34, inset: (width - (device.notch?.width ?? 0)) / 4, fontSize: 16 };

  return (
    <div className="system-ui">
      {portrait && (
        <div className="absolute inset-x-0" style={{ top: band.top, height: band.height }}>
          <span
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 leading-none font-semibold tracking-[-0.02em] tabular-nums"
            style={{ left: band.inset, fontSize: band.fontSize }}
          >
            {time}
          </span>
          <span className="absolute top-1/2 flex translate-x-1/2 -translate-y-1/2 items-center gap-[6px]" style={{ right: band.inset }}>
            <Cellular />
            <WiFi />
            <Battery />
          </span>
        </div>
      )}
      <div
        className="absolute bottom-2 left-1/2 h-[5px] -translate-x-1/2 rounded-full bg-current"
        style={{ width: Math.round(width * (portrait ? 0.343 : 0.257)) }}
      />
    </div>
  );
}

function Cellular() {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor" aria-hidden>
      <rect x="0" y="8" width="3" height="4" rx="0.8" />
      <rect x="5" y="5.5" width="3" height="6.5" rx="0.8" />
      <rect x="10" y="3" width="3" height="9" rx="0.8" />
      <rect x="15" y="0" width="3" height="12" rx="0.8" />
    </svg>
  );
}

function WiFi() {
  return (
    <svg width="17" height="12" viewBox="0 0 17 12" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden>
      <path d="M1.3 4.1a10.3 10.3 0 0 1 14.4 0" strokeWidth="1.9" />
      <path d="M3.9 6.9a6.6 6.6 0 0 1 9.2 0" strokeWidth="1.9" />
      <circle cx="8.5" cy="10.2" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Battery() {
  return (
    <svg width="27" height="13" viewBox="0 0 27 13" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="23" height="12" rx="3.8" stroke="currentColor" strokeOpacity="0.4" />
      <rect x="2" y="2" width="20" height="9" rx="2.5" fill="currentColor" />
      <path d="M25 4.5v4a2.2 2.2 0 0 0 1.4-2 2.2 2.2 0 0 0-1.4-2Z" fill="currentColor" fillOpacity="0.45" />
    </svg>
  );
}
