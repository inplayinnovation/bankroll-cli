"use client";

import { useEffect, useState } from "react";
import { onSettled } from "@/lib/host";
import { dollars } from "./person";
import { Line } from "./runtime";

// Where the open app is paid, and what that holds on the local chain. For an
// app the CLI started that is the simulator's own treasury, a key made up for
// it, which signs the app's payouts too; an app with a treasury of its own
// names it in its manifest, and is paid there. One line, like the runtime
// lines beside it: the address, short, and the balance; the rest when the
// pointer rests on it.

interface TreasuryReport {
  address: string;
  ours: boolean;
  balanceCents: number | null;
  chain: { ready: true; rpc: string } | { ready: false; reason: string };
}

const REFRESH_MS = 10_000;

export function TreasuryLine({ origin }: { origin: string | null }) {
  const [report, setReport] = useState<TreasuryReport | null>(null);

  useEffect(() => {
    let alive = true;
    const ask = () =>
      fetch(`/api/host/treasury${origin ? `?${new URLSearchParams({ app: origin })}` : ""}`)
        .then((response) => (response.ok ? (response.json() as Promise<TreasuryReport>) : null))
        .then((told) => {
          if (alive && told) setReport(told);
        })
        .catch(() => {});
    void ask();
    const timer = setInterval(ask, REFRESH_MS);
    const stop = onSettled(() => void ask());
    return () => {
      alive = false;
      clearInterval(timer);
      stop();
    };
  }, [origin]);

  if (!report) return null;
  const short = `${report.address.slice(0, 4)}…${report.address.slice(-4)}`;

  return (
    <Line
      className="treasury-line"
      tip={
        <>
          {report.ours ? (
            <p>
              The app&apos;s wallet in the simulator: it receives payments and signs payouts, with a key made up for the purpose. Your dev signing key, which holds real money, is not used here.
            </p>
          ) : (
            <p>
              Where this app&apos;s manifest says it is paid. It is the app&apos;s own address, not the simulator&apos;s made-up treasury, so payouts from it are the app&apos;s to sign.
            </p>
          )}
          <p>
            <code>{report.address}</code>
          </p>
          {report.chain.ready ? (
            <p>
              It holds fake dollars on the local chain at <code>{report.chain.rpc}</code>, fresh each start.
            </p>
          ) : (
            <p className="runtime-note" data-kind="stale">
              {report.chain.reason}
            </p>
          )}
        </>
      }
    >
      <span className="runtime-name">Treasury</span>
      <span className="version">{short}</span>
      <span className="version treasury-balance">{report.balanceCents === null ? "no chain" : dollars(report.balanceCents)}</span>
    </Line>
  );
}
