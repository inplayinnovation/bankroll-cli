"use client";

import { useEffect, useRef } from "react";
import { hostOf, originOf } from "@/lib/apps";
import { attachFrame, detachFrame, greet } from "@/lib/host-log";

/**
 * An app on the phone's screen: its own page, on its own origin, in a frame
 * that fills the display edge to edge. The status bar and the home indicator
 * are drawn over it.
 *
 * The key remounts the frame for each app, so one never shows the last one's
 * page while its own loads.
 */
export function AppFrame({ url }: { url: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const origin = originOf(url);

  // The sidebar hears this app's host from here on. The app's page may have
  // loaded before this one was listening, or may load after: hello is said now
  // and again whenever the frame loads a page, and the host answers either way.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    attachFrame(element);
    greet(origin);
    return () => detachFrame(element);
  }, [origin]);

  return <iframe key={url} ref={frame} className="app-frame" src={url} title={hostOf(url)} allow="autoplay; clipboard-write; fullscreen; gamepad" onLoad={() => greet(origin)} />;
}
