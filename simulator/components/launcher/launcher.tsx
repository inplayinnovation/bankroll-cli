"use client";

import { useEffect, useState, type FormEvent, type MouseEvent } from "react";
import { APP_PARAM, hostOf, launchUrl, originOf, parseAppUrl } from "@/lib/apps";
import { askManifest, useKnownManifest } from "@/lib/manifests";
import { openApp } from "@/lib/open-app";
import { addSavedApp, removeSavedApp, useSavedApps } from "@/lib/saved-apps";
import { AppIcon } from "./app-icon";

/**
 * The home screen: one icon per app. Apps come from whoever is serving the
 * simulator (/api/apps: the app `bankroll dev --simulator` was run in) and
 * from URLs added here, which this browser keeps.
 */
export function Launcher() {
  const saved = useSavedApps();
  const [running, setRunning] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    let current = true;
    fetch("/api/apps")
      .then((response) => response.json())
      .then((body: { apps?: unknown }) => {
        const apps = Array.isArray(body.apps) ? body.apps.flatMap((app) => (typeof app === "string" ? (parseAppUrl(app) ?? []) : [])) : [];
        if (current) setRunning(apps);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);

  // The running app is always here and cannot be removed. Added by hand as
  // well, under any of its pages, it still shows once.
  const origins = new Set(running.map(originOf));
  const added = (saved ?? []).filter((url) => !origins.has(originOf(url)));

  return (
    <div className="app-viewport launcher">
      {/* Nothing until the saved list is read: an empty screen for a moment, not a wrong one. */}
      {saved !== null && (
        <ul className="launcher-grid">
          {running.map((url) => (
            <li key={url}>
              <AppTile url={url} />
            </li>
          ))}
          {added.map((url) => (
            <li key={url}>
              <AppTile url={url} onRemove={() => removeSavedApp(url)} />
            </li>
          ))}
          <li>
            <button type="button" className="app-tile" onClick={() => setAdding(true)}>
              <span className="app-icon app-icon-add" aria-hidden>
                +
              </span>
              <span className="app-label">Add app</span>
            </button>
          </li>
        </ul>
      )}
      {adding && <AddApp onClose={() => setAdding(false)} />}
    </div>
  );
}

/** One app: its icon and name from its manifest when it has one, its address when it does not. */
function AppTile({ url, onRemove }: { url: string; onRemove?: () => void }) {
  // Undefined until the app has answered once: an address that turns into a name a moment later reads as a glitch.
  const manifest = useKnownManifest(url);

  // An app's dev server starts and stops while this screen stays up. Asking
  // whenever the window comes back catches the usual case, a server started in
  // a terminal a moment ago, without a poll filling that server's log.
  useEffect(() => {
    const ask = () => void askManifest(url);
    const askIfVisible = () => document.visibilityState === "visible" && ask();
    ask();
    window.addEventListener("focus", askIfVisible);
    document.addEventListener("visibilitychange", askIfVisible);
    return () => {
      window.removeEventListener("focus", askIfVisible);
      document.removeEventListener("visibilitychange", askIfVisible);
    };
  }, [url]);

  if (!manifest) return <div className="app-tile" aria-hidden />;

  const name = manifest.name ?? hostOf(url);

  // A real link, so it can be copied or opened in a new tab; a plain click stays in this page.
  // A launch path this tile already knows saves the app being asked again as it
  // opens. When it knows none, the address goes as saved and the app is asked
  // then (see Screen): its server may have started since this tile last heard.
  function open(event: MouseEvent) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    openApp(launchUrl(url, manifest ?? null));
  }

  return (
    <div className="app-tile-slot">
      <a href={`?${new URLSearchParams({ [APP_PARAM]: url })}`} className="app-tile" draggable={false} onClick={open}>
        <AppIcon url={url} name={name} icon={manifest.icon} />
        <span className="app-label">{name}</span>
      </a>
      {onRemove && (
        <button type="button" className="app-remove" aria-label={`Remove ${name}`} title="Remove" onClick={onRemove}>
          <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M2 5h6" />
          </svg>
        </button>
      )}
    </div>
  );
}

/** A sheet over the home screen that takes a URL and saves it. */
function AddApp({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState("");
  const [refused, setRefused] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    const url = parseAppUrl(value);
    if (!url) {
      setRefused(true);
      return;
    }
    addSavedApp(url);
    onClose();
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form
        className="sheet"
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <label className="sheet-label" htmlFor="app-url">
          Add an app by its URL
        </label>
        <input
          id="app-url"
          className="sheet-input"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setRefused(false);
          }}
          placeholder="localhost:3001"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
        />
        <p className="sheet-note">{refused ? "That is not a web address." : "A Bankroll app opens at its launch path. Any other page opens as given."}</p>
        <div className="sheet-actions">
          <button type="button" className="sheet-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="sheet-button sheet-button-primary">
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
