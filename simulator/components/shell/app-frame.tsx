"use client";

import { useEffect, useRef } from "react";
import { keyboardToApp } from "@/lib/app-keyboard";
import { hostOf, originOf } from "@/lib/apps";
import { attachFrame, detachFrame, greet } from "@/lib/host-log";
import { useShell } from "./device-provider";

/**
 * An app on the phone's screen: its own page, on its own origin, in a frame
 * that fills the display edge to edge, as the Bankroll app shows it. The status
 * bar and the home indicator are drawn over it, and the app is told how much
 * room they take (the phone's safe area), to keep its own content clear.
 *
 * The key remounts the frame for each app, so one never shows the last one's
 * page while its own loads.
 */
export function AppFrame({ url }: { url: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const origin = originOf(url);
  const { safeArea } = useShell();

  // The sidebar hears this app's host from here on.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    attachFrame(element);
    return () => detachFrame(element);
  }, [origin]);

  // The app's page may have loaded before this one was listening, or may load
  // after: hello is said now, and again whenever the frame loads a page, and
  // the host answers either way. It carries the phone's safe area, so it is
  // said again when the phone changes.
  useEffect(() => {
    greet(origin, safeArea);
  }, [origin, safeArea]);

  // Keys pressed anywhere on the page go to the app: see lib/app-keyboard.ts.
  useEffect(() => {
    if (frame.current) return keyboardToApp(frame.current);
  }, [url]);

  return <iframe key={url} ref={frame} className="app-frame" src={url} title={hostOf(url)} allow="autoplay; clipboard-write; fullscreen; gamepad" onLoad={() => greet(origin, safeArea)} />;
}
