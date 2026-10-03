"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPerson, loadPeople, selectPerson, usePeople, type Person } from "@/lib/people";

// Who the app is shown to: at the top of the sidebar, one line, a menu of the
// pretend people on this computer. The last entry makes a new one, which takes
// a username, an age or none, and a balance; everything else about a person,
// their wallet first, is made up for them.

const NEW = "__new__";

export const dollars = (cents: number): string => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const describe = (person: Person): string => `${person.username} · ${person.age === null ? "unverified" : person.age} · ${dollars(person.balanceCents)}`;

export function PersonPicker() {
  const { people, current, problem } = usePeople();
  const [making, setMaking] = useState(false);

  useEffect(() => {
    void loadPeople();
  }, []);

  return (
    <section className="person" aria-label="Person">
      <header className="person-header">
        <h2 className="sidebar-title">Person</h2>
        {people && !making && (
          <select
            className="menu-select person-select"
            aria-label="Who the app is shown to"
            value={current ?? ""}
            onChange={(event) => {
              if (event.target.value === NEW) setMaking(true);
              else void selectPerson(event.target.value);
            }}
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {describe(person)}
              </option>
            ))}
            <option value={NEW}>New person…</option>
          </select>
        )}
        {!people && <span className="person-waiting">{problem ? "The CLI is not answering." : "…"}</span>}
      </header>
      {making && <NewPersonForm onDone={() => setMaking(false)} />}
    </section>
  );
}

function NewPersonForm({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [age, setAge] = useState("30");
  const [balance, setBalance] = useState("1000");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const cents = Math.round(Number(balance.replace(/[$,\s]/g, "")) * 100);
    try {
      await createPerson({ username: username.trim(), age: age.trim() === "" ? null : Number(age), balanceCents: Number.isFinite(cents) ? cents : NaN });
      onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  }

  return (
    <form className="person-form" onSubmit={submit}>
      <label className="person-field">
        <span>Username</span>
        <input className="person-input" value={username} onChange={(event) => setUsername(event.target.value)} autoFocus autoComplete="off" spellCheck={false} placeholder="alice" />
      </label>
      <label className="person-field">
        <span>Age</span>
        <input className="person-input" value={age} onChange={(event) => setAge(event.target.value)} inputMode="numeric" placeholder="blank for unverified" />
      </label>
      <label className="person-field">
        <span>Balance</span>
        <input className="person-input" value={balance} onChange={(event) => setBalance(event.target.value)} inputMode="decimal" placeholder="1000" />
      </label>
      {problem && <p className="person-problem">{problem}</p>}
      <div className="person-actions">
        <button type="button" className="sidebar-button" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="sidebar-button sidebar-button-primary" disabled={busy || username.trim() === ""}>
          Create
        </button>
      </div>
    </form>
  );
}
