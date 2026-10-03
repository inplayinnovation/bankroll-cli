"use client";

import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { hostOf } from "@/lib/apps";
import { clearHostLog, useCallSection, useHostConnected, useHostMethods, type CallEntry } from "@/lib/host-log";
import { askManifest, useKnownManifest } from "@/lib/manifests";
import { useOpenApp } from "@/lib/open-app";
import { PersonPicker } from "./person";
import { Runtime } from "./runtime";
import { SheetList } from "./sheet";

// How long an app gets to report before the sidebar says why it may not be.
const PATIENCE_MS = 2500;

/**
 * The column beside the phone. At the top, who the app is shown to. Then every
 * call the open app makes to its host: one section per call the SDK offers,
 * always listed and under the SDK's name for it, with how many times it was
 * made; a section opens to its calls, and its header flashes each time one is
 * made: red when one fails, and it then says how many have. A call the SDK has
 * no function for gets a section when the app makes it. When the host would
 * ask the person something, the sheet appears under the call's row.
 */
export function HostSidebar() {
  const url = useOpenApp();

  return (
    <aside className="sidebar" aria-label="Host calls">
      {url !== undefined && <PersonPicker />}
      {/* Empty until it is known whether an app is open: a note that an app replaces a moment later is a flicker. */}
      {url === undefined ? null : url ? (
        <OpenAppCalls key={url} url={url} />
      ) : (
        <SidebarNote title="Host calls">Open an app to see what it asks of its host.</SidebarNote>
      )}
      {/* Along the bottom, whatever is above it: what the app runs in. */}
      {url !== undefined && <Runtime url={url} />}
    </aside>
  );
}

function OpenAppCalls({ url }: { url: string }) {
  const connected = useHostConnected();
  const methods = useHostMethods();
  const manifest = useKnownManifest(url);
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    void askManifest(url);
    const timer = setTimeout(() => setWaited(true), PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [url]);

  const name = manifest?.name ?? hostOf(url);

  // An app with no Bankroll manifest has no host to call. If its page reports
  // calls all the same, it is listened to: what it says outranks what it lacks.
  if (!connected && manifest && !manifest.bankroll) {
    return <SidebarNote title={name}>This isn&apos;t a Bankroll app, so it has no host to call.</SidebarNote>;
  }

  return (
    <>
      <header className="sidebar-header">
        <div className="min-w-0">
          <h2 className="sidebar-title">Host calls</h2>
          <p className="sidebar-subtitle">{name}</p>
        </div>
        <button type="button" className="sidebar-button" onClick={clearHostLog}>
          Clear
        </button>
      </header>
      {!connected && waited && (
        <p className="sidebar-notice">
          {name} hasn&apos;t reported in. Its calls show here when it runs on an SDK with the simulator&apos;s bridge (0.33.0 or later), started by <code>bankroll dev --simulator</code>.
        </p>
      )}
      <ul className="sidebar-list">
        {methods.map((method) => (
          <CallSectionRow key={method} method={method} />
        ))}
      </ul>
    </>
  );
}

function SidebarNote({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <header className="sidebar-header">
        <h2 className="sidebar-title">{title}</h2>
      </header>
      <p className="sidebar-empty">{children}</p>
    </>
  );
}

/** One call: a header that counts and flashes, and its calls underneath when open. */
const CallSectionRow = memo(function CallSectionRow({ method }: { method: string }) {
  const { count, failed, entries } = useCallSection(method);
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLButtonElement>(null);
  const flashed = useRef({ count, failed });

  // Each call flashes the header, open or shut, and a call that fails flashes
  // it red. Run as an animation and not a class: two calls in quick succession
  // should flash twice.
  useEffect(() => {
    const flash = failed > flashed.current.failed ? "var(--flash-failed)" : count > flashed.current.count ? "var(--flash)" : null;
    if (flash && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      header.current?.animate([{ backgroundColor: flash }, { backgroundColor: "transparent" }], { duration: 700, easing: "ease-out" });
    }
    flashed.current = { count, failed };
  }, [count, failed]);

  return (
    <li className="call-section">
      <button ref={header} type="button" className="call-header" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <svg className="call-chevron" width="8" height="10" viewBox="0 0 8 10" aria-hidden>
          <path d="M1.5 1l5 4-5 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="call-name">{method}</span>
        {failed > 0 && <span className="call-failed">{failed} failed</span>}
        <span className="call-count" data-none={count === 0 || undefined}>
          {count}
        </span>
      </button>
      <SheetList method={method} />
      {open && (
        <ol className="call-entries">
          {entries.length === 0 && <li className="call-none">Not called yet.</li>}
          {entries.map((entry) => (
            <CallEntryRow key={entry.key} entry={entry} />
          ))}
          {count > entries.length && <li className="call-none">The {entries.length} most recent of {count}.</li>}
        </ol>
      )}
    </li>
  );
});

function CallEntryRow({ entry }: { entry: CallEntry }) {
  const answered = entry.ok !== undefined;
  return (
    <li className="call-entry">
      <p className="call-when">
        <time>{clock(entry.at)}</time>
        {entry.ms !== undefined && <span>{entry.ms} ms</span>}
      </p>
      <dl className="call-facts">
        <dt>in</dt>
        <dd>{entry.input === undefined ? <span className="call-nothing">nothing</span> : <pre>{show(entry.input)}</pre>}</dd>
        <dt>out</dt>
        <dd>
          {!answered ? (
            <span className="call-nothing">waiting</span>
          ) : !entry.ok ? (
            <pre className="call-error">{entry.error ?? "failed"}</pre>
          ) : entry.value === undefined ? (
            <span className="call-nothing">nothing</span>
          ) : (
            <pre>{show(entry.value)}</pre>
          )}
        </dd>
      </dl>
    </li>
  );
}

const clock = (at: number) => {
  const time = new Date(at);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}.${pad(time.getMilliseconds(), 3)}`;
};

const MOCK_SIGNATURE = "mock-";

// A session token and a mock payment's signature are both JSON in base64:
// unreadable as they travel, and the whole point of looking. They are shown
// opened up, under a word that says which they are.
function show(value: unknown): string {
  if (typeof value === "string") {
    const token = /^[\w-]+\.([\w-]+)\.[\w-]*$/.exec(value);
    const opened = token ? decode(token[1]) : value.startsWith(MOCK_SIGNATURE) ? decode(value.slice(MOCK_SIGNATURE.length)) : undefined;
    if (opened !== undefined) return `${token ? "token" : "mock signature"} ${JSON.stringify(opened, null, 2)}`;
  }
  return JSON.stringify(value, null, 2);
}

function decode(base64url: string): unknown {
  try {
    const bytes = Uint8Array.from(atob(base64url.replace(/-/g, "+").replace(/_/g, "/")), (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof parsed === "object" && parsed !== null ? parsed : undefined;
  } catch {
    return undefined;
  }
}
