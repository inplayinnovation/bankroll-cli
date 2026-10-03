"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { dollars } from "@/lib/format";
import { createPerson, loadPeople, removePerson, selectPerson, updatePerson, usePeople, type Person } from "@/lib/people";
import { IconButton, PencilIcon, PlusIcon, XIcon } from "./icons";

// Who the app is shown to: the pretend users on this computer, one row each,
// the way Figma lists pages. The chosen one has the filled row. The + in the
// title row makes another, through a small form; a row renames on a double
// click, and shows a pencil and an x when the pointer rests on it: the pencil
// opens the same form on that user, the x forgets them, never the last one.
// The balance on a row is what the wallet holds now, on the chain; a user's
// age, or that they have not verified, and their wallet show when the pointer
// rests on the row.

export function Users() {
  const { people, current, problem } = usePeople();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    void loadPeople();
  }, []);

  return (
    <section className="users" aria-label="Users">
      <header className="section-header">
        <h2 className="sidebar-title">Users</h2>
        <IconButton label="New user" onClick={() => setAdding(true)} disabled={adding}>
          <PlusIcon />
        </IconButton>
      </header>
      {problem && <p className="sidebar-notice">The CLI is not answering, so there is nobody to show the app to.</p>}
      {people && (
        <ul className="user-list" role="listbox" aria-label="Who the app is shown to">
          {people.map((person) => (
            <UserRow
              key={person.id}
              person={person}
              selected={person.id === current}
              alone={people.length === 1}
              editing={editing === person.id}
              onEdit={() => setEditing(person.id)}
              onDone={() => setEditing(null)}
            />
          ))}
        </ul>
      )}
      {adding && (
        <UserForm
          onCancel={() => setAdding(false)}
          onSubmit={async (input) => {
            await createPerson(input);
            setAdding(false);
          }}
        />
      )}
    </section>
  );
}

function UserRow({ person, selected, alone, editing, onEdit, onDone }: { person: Person; selected: boolean; alone: boolean; editing: boolean; onEdit: () => void; onDone: () => void }) {
  const [renaming, setRenaming] = useState(false);

  const choose = () => {
    if (!selected) void selectPerson(person.id);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose();
    }
  };

  return (
    <li className="user-item">
      <div
        className="user-row has-tip"
        role="option"
        aria-selected={selected}
        tabIndex={0}
        onClick={choose}
        onKeyDown={onKeyDown}
        onDoubleClick={(event) => {
          event.preventDefault();
          setRenaming(true);
        }}
      >
        {renaming ? (
          <Rename
            value={person.username}
            onDone={async (username) => {
              setRenaming(false);
              if (username && username !== person.username) await updatePerson(person.id, { username }).catch(() => {});
            }}
          />
        ) : (
          <span className="user-name">{person.username}</span>
        )}
        <span className="user-balance">{dollars(person.heldCents ?? person.balanceCents)}</span>
        <span className="user-actions" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
          <IconButton label={`Edit ${person.username}`} onClick={onEdit}>
            <PencilIcon />
          </IconButton>
          <IconButton label={`Forget ${person.username}`} onClick={() => void removePerson(person.id).catch(() => {})} disabled={alone}>
            <XIcon />
          </IconButton>
        </span>
        <div className="runtime-tip" role="tooltip">
          <div className="runtime-tip-card">
            <p>{person.age === null ? `${person.username} has not verified their identity.` : `${person.username} is ${person.age}, verified.`}</p>
            {person.heldCents !== undefined && person.heldCents !== person.balanceCents && <p>Holds {dollars(person.heldCents)}; starts each run with {dollars(person.balanceCents)}.</p>}
            <p>
              Wallet <code>{person.wallet}</code>
            </p>
          </div>
        </div>
      </div>
      {editing && (
        <UserForm
          initial={person}
          onCancel={onDone}
          onSubmit={async (input) => {
            await updatePerson(person.id, input);
            onDone();
          }}
        />
      )}
    </li>
  );
}

/** The name, typed over in place: Enter or leaving keeps it, Escape does not. */
function Rename({ value, onDone }: { value: string; onDone: (username: string) => void }) {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.select();
  }, []);
  return (
    <input
      ref={input}
      className="user-rename"
      value={draft}
      autoFocus
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => onDone(draft.trim())}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") onDone(draft.trim());
        if (event.key === "Escape") onDone(value);
      }}
    />
  );
}

interface UserInput {
  username: string;
  age: number | null;
  balanceCents: number;
}

/** A user's three facts: for a new one, or to change one. */
function UserForm({ initial, onCancel, onSubmit }: { initial?: Person; onCancel: () => void; onSubmit: (input: UserInput) => Promise<void> }) {
  const [username, setUsername] = useState(initial?.username ?? "");
  const [age, setAge] = useState(initial ? (initial.age === null ? "" : String(initial.age)) : "30");
  const [balance, setBalance] = useState(initial ? String(initial.balanceCents / 100) : "1000");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    const cents = Math.round(Number(balance.replace(/[$,\s]/g, "")) * 100);
    try {
      await onSubmit({ username: username.trim(), age: age.trim() === "" ? null : Number(age), balanceCents: Number.isFinite(cents) ? cents : NaN });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  }

  return (
    <form className="user-form" onSubmit={submit}>
      <Field label="Username">
        <input className="user-input" value={username} onChange={(event) => setUsername(event.target.value)} autoFocus autoComplete="off" spellCheck={false} placeholder="alice" />
      </Field>
      <Field label="Age">
        <input className="user-input" value={age} onChange={(event) => setAge(event.target.value)} inputMode="numeric" placeholder="blank for unverified" />
      </Field>
      <Field label="Balance">
        <input className="user-input" value={balance} onChange={(event) => setBalance(event.target.value)} inputMode="decimal" placeholder="1000" />
      </Field>
      {initial && (
        <p className="user-wallet">
          Wallet <code>{initial.wallet}</code>
        </p>
      )}
      {problem && <p className="user-problem">{problem}</p>}
      <div className="user-form-actions">
        <button type="button" className="sidebar-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="sidebar-button sidebar-button-primary" disabled={busy || username.trim() === ""}>
          {initial ? "Save" : "Create"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="user-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
