"use client";

import { memo, useEffect, useState } from "react";
import { dollars } from "@/lib/format";
import { useTransactions, watchTransactions, type ChainTransaction } from "@/lib/transactions";

// The local chain's activity, newest first: one line per transaction, who →
// whom and how much for a transfer of the dollar, what else happened
// otherwise, in red when the chain refused it. A row opens to the facts an
// app's server would read: the signature, the reference, the slot, the fee
// payer, the instructions and the accounts, each copyable.

export function TransactionList({ origin }: { origin: string | null }) {
  const { entries, names, clearedThrough, problem } = useTransactions();

  useEffect(() => watchTransactions(origin), [origin]);

  if (entries === undefined) return <p className="sidebar-empty">{problem ? `The chain is not answering: ${problem}` : "Listening to the chain…"}</p>;
  const shown = entries.filter((entry) => entry.seq > clearedThrough);
  if (shown.length === 0) return <p className="sidebar-empty">Nothing on the chain yet. A payment or a payout shows here the moment it lands.</p>;

  return (
    <ol className="transactions">
      {shown.map((entry) => (
        <TransactionRow key={entry.signature} entry={entry} names={names} />
      ))}
    </ol>
  );
}

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
const nameOf = (names: Record<string, string>, address: string | undefined) => (address ? (names[address] ?? short(address)) : "?");

const clock = (at: number) => {
  const time = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}`;
};

/** The line's words for a transaction that is not a transfer of the dollar. */
function describe(entry: ChainTransaction, names: Record<string, string>): string {
  switch (entry.kind) {
    case "mint":
      return `minted → ${nameOf(names, entry.to)}`;
    case "fees":
      return `SOL for fees → ${nameOf(names, entry.accounts[1])}`;
    case "account":
      return "a dollar account made";
    default:
      return entry.instructions.map((instruction) => (instruction.type ? `${instruction.program} ${instruction.type}` : instruction.program)).join(", ") || "a transaction";
  }
}

const TransactionRow = memo(function TransactionRow({ entry, names }: { entry: ChainTransaction; names: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const transfer = entry.kind === "transfer";
  const money = transfer || entry.kind === "mint";
  return (
    <li className="transaction" data-failed={!entry.ok || undefined} data-quiet={!money || undefined}>
      <button type="button" className="transaction-line" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <svg className="call-chevron" width="8" height="10" viewBox="0 0 8 10" aria-hidden>
          <path d="M1.5 1l5 4-5 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <time className="transaction-when">{clock(entry.at)}</time>
        <span className="transaction-who">
          {transfer ? (
            <>
              {nameOf(names, entry.from)} <span className="transaction-arrow">→</span> {entry.recipients ? `${entry.recipients.length} wallets` : nameOf(names, entry.to)}
            </>
          ) : (
            describe(entry, names)
          )}
        </span>
        {entry.amountCents !== undefined && <span className="transaction-amount">{dollars(entry.amountCents)}</span>}
      </button>
      {(entry.memo || !entry.ok || entry.recipients) && (
        <p className="transaction-note">
          {!entry.ok && <span className="transaction-failed">failed: {entry.error ?? "the chain refused it"}</span>}
          {!entry.ok && (entry.memo || entry.recipients) && " · "}
          {entry.recipients?.map((recipient) => `${nameOf(names, recipient.to)} ${dollars(recipient.amountCents)}`).join(", ")}
          {entry.recipients && entry.memo && " · "}
          {entry.memo}
        </p>
      )}
      {open && <TransactionFacts entry={entry} names={names} />}
    </li>
  );
});

function TransactionFacts({ entry, names }: { entry: ChainTransaction; names: Record<string, string> }) {
  return (
    <dl className="transaction-facts">
      <dt>signature</dt>
      <dd>
        <Copyable value={entry.signature} />
      </dd>
      {entry.reference && (
        <>
          <dt>reference</dt>
          <dd>
            <Copyable value={entry.reference} />
          </dd>
        </>
      )}
      <dt>slot</dt>
      <dd>{entry.slot.toLocaleString("en-US")}</dd>
      <dt>fee payer</dt>
      <dd>
        {nameOf(names, entry.feePayer)} · {(entry.fee / 1_000_000_000).toLocaleString("en-US", { maximumFractionDigits: 9 })} SOL
      </dd>
      <dt>instructions</dt>
      <dd>
        <ol className="transaction-instructions">
          {entry.instructions.map((instruction, index) => (
            <li key={index}>
              <span>
                {instruction.program}
                {instruction.type ? ` ${instruction.type}` : ""}
              </span>
              {instruction.info !== undefined && <pre>{typeof instruction.info === "string" ? instruction.info : JSON.stringify(instruction.info, null, 2)}</pre>}
            </li>
          ))}
        </ol>
      </dd>
      <dt>accounts</dt>
      <dd>
        <ul className="transaction-accounts">
          {entry.accounts.map((account) => (
            <li key={account}>
              <Copyable value={account} label={names[account]} />
            </li>
          ))}
        </ul>
      </dd>
    </dl>
  );
}

/** An address or a signature: the name if there is one, the value in full, and a click copies it. */
function Copyable({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copyable"
      title="Copy"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1000);
        });
      }}
    >
      {label && <span className="copyable-name">{label} </span>}
      <code>{value}</code>
      {copied && <span className="copyable-done"> copied</span>}
    </button>
  );
}
