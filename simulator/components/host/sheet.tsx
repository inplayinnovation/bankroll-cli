"use client";

import { useEffect, useState, type ReactNode } from "react";
import { decide, useSheets, type Sheet } from "@/lib/host";
import { dollars } from "./person";

// What the phone would show its user, shown to the developer instead: a box
// under the call's row, with the facts and the two answers. Consent the first
// time an app asks who the person is; approval of a payment, with the time the
// app allowed; identity verification for a person who has none; and a deposit,
// which adds fake dollars.

export function SheetList({ method }: { method: string }) {
  const open = useSheets(method);
  if (open.length === 0) return null;
  return (
    <ul className="sheets">
      {open.map(({ sheet, deciding }) => (
        <li key={sheet.id}>
          <SheetCard sheet={sheet} deciding={deciding} />
        </li>
      ))}
    </ul>
  );
}

const appName = (sheet: Sheet) => sheet.app.name ?? sheet.app.origin.replace(/^https?:\/\//, "");

function SheetCard({ sheet, deciding }: { sheet: Sheet; deciding: boolean }) {
  switch (sheet.kind) {
    case "consent":
      return (
        <Card
          title={`${appName(sheet)} wants to know who you are`}
          detail={`It would learn ${sheet.person.username}'s wallet, username, and whether they are verified.`}
          no="Don't allow"
          yes="Allow"
          deciding={deciding}
          onDecide={(approve) => decide(sheet.id, approve)}
        />
      );
    case "verify":
      return <VerifyCard sheet={sheet} deciding={deciding} />;
    case "pay":
      return <PayCard sheet={sheet} deciding={deciding} />;
    case "deposit":
      return <DepositCard sheet={sheet} deciding={deciding} />;
  }
}

function Card({
  title,
  detail,
  children,
  no,
  yes,
  deciding,
  canYes = true,
  onDecide,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
  no: string;
  yes: string;
  deciding: boolean;
  /** False while what the yes button would send is not yet valid. */
  canYes?: boolean;
  onDecide: (approve: boolean) => void;
}) {
  return (
    <div className="sheet-card" role="group" aria-label={title}>
      <p className="sheet-card-title">{title}</p>
      {detail && <p className="sheet-card-detail">{detail}</p>}
      {children}
      <div className="sheet-card-actions">
        <button type="button" className="sidebar-button" disabled={deciding} onClick={() => onDecide(false)}>
          {no}
        </button>
        <button type="button" className="sidebar-button sidebar-button-primary" disabled={deciding || !canYes} onClick={() => onDecide(true)}>
          {yes}
        </button>
      </div>
    </div>
  );
}

function VerifyCard({ sheet, deciding }: { sheet: Extract<Sheet, { kind: "verify" }>; deciding: boolean }) {
  const [age, setAge] = useState(String(sheet.age));
  const parsed = Number(age);
  return (
    <Card
      title={`${appName(sheet)} asks for a verified identity`}
      detail={`${sheet.person.username} has not verified. Verifying sets their age.`}
      no="Decline"
      yes={`Verify as ${Number.isInteger(parsed) && parsed >= 0 ? parsed : "…"}`}
      deciding={deciding}
      onDecide={(approve) => decide(sheet.id, approve, { age: Number.isInteger(parsed) && parsed >= 0 ? parsed : sheet.age })}
    >
      <label className="sheet-card-field">
        <span>Age</span>
        <input className="person-input" value={age} onChange={(event) => setAge(event.target.value)} inputMode="numeric" />
      </label>
    </Card>
  );
}

function PayCard({ sheet, deciding }: { sheet: Extract<Sheet, { kind: "pay" }>; deciding: boolean }) {
  const left = useCountdown(sheet.deadline);
  return (
    <Card
      title={`Pay ${dollars(sheet.amountCents)} to ${appName(sheet)}`}
      detail={[sheet.memo, left === 0 ? "The time the app allowed is up." : `${sheet.person.username} has ${clock(left)} to decide.`].filter(Boolean).join(" · ")}
      no="Decline"
      yes="Pay"
      deciding={deciding}
      onDecide={(approve) => decide(sheet.id, approve)}
    />
  );
}

function DepositCard({ sheet, deciding }: { sheet: Extract<Sheet, { kind: "deposit" }>; deciding: boolean }) {
  const [amount, setAmount] = useState(String(sheet.amountCents / 100));
  const cents = Math.round(Number(amount.replace(/[$,\s]/g, "")) * 100);
  const valid = Number.isInteger(cents) && cents > 0;
  return (
    <Card
      title={`Add fake dollars to ${sheet.person.username}`}
      detail={sheet.balanceCents === null ? "There is no local chain, so nothing can be added." : `They hold ${dollars(sheet.balanceCents)}. On a phone this would be Add Cash.`}
      no="Cancel"
      yes={valid ? `Add ${dollars(cents)}` : "Add"}
      deciding={deciding}
      canYes={valid && sheet.balanceCents !== null}
      onDecide={(approve) => decide(sheet.id, approve, { amountCents: cents })}
    >
      <label className="sheet-card-field">
        <span>Amount</span>
        <input className="person-input" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
      </label>
    </Card>
  );
}

/** Seconds left until `deadline`, ticking once a second. */
function useCountdown(deadline: number): number {
  const remaining = () => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const [left, setLeft] = useState(remaining);
  useEffect(() => {
    const timer = setInterval(() => setLeft(remaining()), 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline]);
  return left;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
