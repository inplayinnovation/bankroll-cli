"use client";

import { useId, type ReactNode } from "react";
import { useReportedSdk } from "@/lib/host-log";
import { useVersionReport, type PackageReport, type SdkReport } from "@/lib/versions";
import { TreasuryLine } from "./treasury";

/**
 * The bottom of the sidebar: what the app runs in. The app's treasury in the
 * simulator, a lock and "Secure Runtime", then a line each for the SDK the
 * open app runs and the CLI that serves the simulator, with a word beside a
 * version when there is something to say of it:
 *
 *   local    a build of someone's own, not a published release
 *   update   a later release is out
 *   stale    what is installed is not what the project asks for
 *
 * A line says more when the pointer rests on it: the detail, and what to do
 * about it. The popup is the line's own child and sits right on top of it, so
 * the pointer can move into it and a command in it can be copied.
 */
export function Runtime({ url }: { url: string | null }) {
  // Undefined when whoever serves this page could not say: the lines are left out, not guessed.
  const report = useVersionReport(url, useReportedSdk());
  const sdk = report?.sdk;

  return (
    <footer className="runtime" aria-label="Runtime">
      <div className="treasury">
        <TreasuryLine origin={url ? new URL(url).origin : null} />
      </div>
      <Line
        className="runtime-secure"
        tip={
          <p>
            The Bankroll app is the runtime an app&apos;s page runs in. It is what knows who the user is and what signs for them: the page never touches a wallet. In the simulator the SDK&apos;s stand-in takes its place, with a
            pretend user, and no money moves.
          </p>
        }
      >
        <svg width="9" height="11" viewBox="0 0 12 14" fill="currentColor" fillRule="evenodd" aria-hidden>
          <path d="M6 0a3.75 3.75 0 0 0-3.75 3.75V6H1.5A1.5 1.5 0 0 0 0 7.5v5A1.5 1.5 0 0 0 1.5 14h9a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 10.5 6h-.75V3.75A3.75 3.75 0 0 0 6 0Zm2.25 6h-4.5V3.75a2.25 2.25 0 0 1 4.5 0V6Z" />
        </svg>
        Secure Runtime
      </Line>
      {sdk && (
        <Line tip={<SdkDetails sdk={sdk} />}>
          <span className="runtime-name">SDK</span>
          <span className="version">{sdk.version ?? (notInstalled(sdk) ? "not installed" : "not reported")}</span>
          <Tags of={sdk} stale={sdk.stale} />
        </Line>
      )}
      {report && (
        <Line tip={<CliDetails cli={report.cli} />}>
          <span className="runtime-name">CLI</span>
          <span className="version">{report.cli.version ?? "unknown"}</span>
          <Tags of={report.cli} />
        </Line>
      )}
    </footer>
  );
}

/** One line, and the popup that says more of it while the pointer rests there, or focus does. */
export function Line({ className, tip, children }: { className?: string; tip: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <div className={className ? `runtime-line ${className}` : "runtime-line"} tabIndex={0} aria-describedby={id}>
      {children}
      <div className="runtime-tip" role="tooltip" id={id}>
        <div className="runtime-tip-card">{tip}</div>
      </div>
    </div>
  );
}

// The project asks for the SDK and node_modules has none.
const notInstalled = (sdk: SdkReport) => sdk.stale && sdk.installed === undefined;

// A stale install is behind because it is stale. The install comes first: once
// it is what the project asks for, a later release is worth mentioning.
const behind = (of: PackageReport, stale = false) => of.behind && !stale;

function Tags({ of, stale = false }: { of: PackageReport; stale?: boolean }) {
  return (
    <>
      {of.local && <span className="version-tag" data-kind="local">local</span>}
      {stale && <span className="version-tag" data-kind="stale">stale</span>}
      {behind(of, stale) && <span className="version-tag" data-kind="update">update</span>}
    </>
  );
}

function SdkDetails({ sdk }: { sdk: SdkReport }) {
  const { version, installed, wanted, locked, latest } = sdk;
  // What the app said and what its folder holds are two facts. They differ
  // under a local build, and when the app was started before an install.
  const running = version !== undefined && version !== installed;

  return (
    <>
      {version === undefined && !notInstalled(sdk) && (
        <p>
          This app has not said which SDK it runs. From 0.33.0 an app says so when it calls <code>bankroll.init()</code>.
        </p>
      )}
      {running && (
        <p>
          The app runs <code>{version}</code>.
        </p>
      )}
      {installed && (
        <p>
          <code>{installed}</code> is installed.
          {wanted && (
            <>
              {" "}
              The project asks for <code>{wanted}</code>
              {locked && (
                <>
                  , <code>{locked}</code> in its lockfile
                </>
              )}
              .
            </>
          )}
        </p>
      )}
      {latest && (
        <p>
          The latest release is <code>{latest}</code>.
        </p>
      )}
      {sdk.local && <Note kind="local">A local build, copied or linked into the app. Not a published release.</Note>}
      {sdk.stale &&
        (installed ? (
          <Note kind="stale">
            What is installed is not what the project asks for. In the app&apos;s folder: <code>npm ci</code>
          </Note>
        ) : (
          <Note kind="stale">
            The project asks for <code>{wanted ?? locked}</code> and nothing is installed. In the app&apos;s folder: <code>npm install</code>
          </Note>
        ))}
      {behind(sdk, sdk.stale) && (
        <Note kind="update">
          <code>{latest}</code> is out. In the app&apos;s folder: <code>npm i @joinbankroll/sdk@latest</code>
        </Note>
      )}
    </>
  );
}

function CliDetails({ cli }: { cli: PackageReport }) {
  return (
    <>
      <p>
        This simulator is served by <code>{cli.version ?? "an unknown version"}</code>.
        {cli.latest && (
          <>
            {" "}
            The latest release is <code>{cli.latest}</code>.
          </>
        )}
      </p>
      {cli.local && <Note kind="local">Run from a checkout of the CLI. Not a published release.</Note>}
      {cli.behind && (
        <Note kind="update">
          <code>{cli.latest}</code> is out. In an app: <code>npm i -D @joinbankroll/cli@latest</code>. On this computer: <code>npm i -g @joinbankroll/cli@latest</code>
        </Note>
      )}
    </>
  );
}

function Note({ kind, children }: { kind: "local" | "stale" | "update"; children: ReactNode }) {
  return (
    <p className="runtime-note" data-kind={kind}>
      {children}
    </p>
  );
}
