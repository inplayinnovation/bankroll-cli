"use client";

import { useState, type CSSProperties } from "react";
import { originOf } from "@/lib/apps";

// Stable per app, so a tile keeps its colour between visits.
function hueFor(text: string) {
  let hash = 0;
  for (const character of text) hash = (hash * 31 + character.charCodeAt(0)) % 360;
  return hash;
}

/** An app's own icon, or a tile with its initial until it has drawn one. */
export function AppIcon({ url, name, icon }: { url: string; name: string; icon?: string }) {
  // The icon that last failed to load, so a new one is tried again.
  const [broken, setBroken] = useState<string>();

  if (icon && icon !== broken) {
    return (
      // A plain <img>: the icon is on the app's origin, which no image config could list ahead of time.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={icon} alt="" width={60} height={60} draggable={false} className="app-icon" onError={() => setBroken(icon)} />
    );
  }
  return (
    <span className="app-icon app-icon-generated" style={{ "--hue": hueFor(originOf(url)) } as CSSProperties} aria-hidden>
      {name[0]?.toUpperCase()}
    </span>
  );
}
