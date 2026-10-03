// The pretend people the simulator shows an app to.
//
// A person is a wallet made on the spot, a username, an age or none (an
// unverified account), and the balance they are brought up to each time the
// local chain starts fresh. They live in one file in this tool's own config
// folder, never in a project, so an app's server can go on knowing a person
// by their wallet from one run to the next and nothing of them reaches git.
// The keys are worthless anywhere but the chain on this computer; they are
// kept like the signing key all the same.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { newKeypair } from '../keypair';

/** Where the simulator keeps what it makes up. */
export const SIMULATOR_DIR = join(homedir(), '.config', 'bankroll', 'simulator');
const PEOPLE_FILE = 'people.json';
const SECRET_FILE_MODE = 0o600;

/** The first person, there before anyone has made one: today's tester. */
export const FIRST_PERSON = { username: 'tester', age: 30, balanceCents: 100_000 } as const;
export const DEFAULT_BALANCE_CENTS = FIRST_PERSON.balanceCents;
// The chain's balance-setting call takes a JSON number, which is exact below
// 2^53 base units: a little under $900,000,000. This leaves room under it.
export const MAX_BALANCE_CENTS = 100_000_000_00;
export const MAX_AGE = 120;
const USERNAME = /^[a-z0-9_]{1,32}$/i;

export interface Person {
  id: string;
  username: string;
  /** The verified age, or null for an account that has not verified. */
  age: number | null;
  /** Base58 public key: the wallet. */
  wallet: string;
  /** Base58 secret key, as the SDK's keypairSigner takes it. */
  secretKey: string;
  /** What the person holds when the chain starts fresh, in cents. */
  balanceCents: number;
  /** The app origins this person has let see who they are. */
  grants: string[];
}

/** A person as the page sees them: everything but the key. */
export type PublicPerson = Omit<Person, 'secretKey'>;

export interface PeopleFile {
  /** The person the app is shown to. */
  current: string;
  people: Person[];
}

export interface NewPerson {
  username: string;
  age: number | null;
  balanceCents?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export const publicPerson = ({ secretKey: _secret, ...person }: Person): PublicPerson => person;

/** Why a person cannot be made as asked, or null when they can. */
export function invalidPerson(input: NewPerson): string | null {
  if (typeof input.username !== 'string' || !USERNAME.test(input.username)) return 'a username is 1 to 32 letters, digits or underscores';
  if (input.age !== null && (!Number.isInteger(input.age) || input.age < 0 || input.age > MAX_AGE)) return `an age is a whole number up to ${MAX_AGE}, or none`;
  const balance = input.balanceCents ?? DEFAULT_BALANCE_CENTS;
  if (!Number.isInteger(balance) || balance < 0 || balance > MAX_BALANCE_CENTS) return `a balance is a whole number of cents up to ${MAX_BALANCE_CENTS}`;
  return null;
}

function readPerson(value: unknown): Person | null {
  if (!isRecord(value)) return null;
  const { id, username, age, wallet, secretKey, balanceCents, grants } = value;
  if (typeof id !== 'string' || typeof username !== 'string' || typeof wallet !== 'string' || typeof secretKey !== 'string') return null;
  return {
    id,
    username,
    age: typeof age === 'number' && Number.isInteger(age) ? age : null,
    wallet,
    secretKey,
    balanceCents: typeof balanceCents === 'number' && Number.isInteger(balanceCents) && balanceCents >= 0 ? balanceCents : DEFAULT_BALANCE_CENTS,
    grants: Array.isArray(grants) ? grants.filter((grant): grant is string => typeof grant === 'string') : [],
  };
}

/** The people on this computer, read from their file; a fresh file holds the first person. */
export class People {
  private file: PeopleFile;

  constructor(private readonly path = join(SIMULATOR_DIR, PEOPLE_FILE)) {
    this.file = this.read() ?? { current: '', people: [] };
    if (this.file.people.length === 0) {
      const first = this.create(FIRST_PERSON);
      this.file.current = first.id;
      this.save();
    }
    if (!this.file.people.some((person) => person.id === this.file.current)) {
      this.file.current = this.file.people[0]!.id;
      this.save();
    }
  }

  private read(): PeopleFile | null {
    if (!existsSync(this.path)) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.path, 'utf8'));
    } catch {
      throw new Error(`${this.path} is not readable as JSON. Fix it or delete it; the people in it are only pretend.`);
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.people)) return null;
    const people = parsed.people.map(readPerson).filter((person): person is Person => person !== null);
    return { current: typeof parsed.current === 'string' ? parsed.current : '', people };
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    // Written whole, beside the file, then moved over it: a crash leaves the
    // old file, not half of a new one.
    const draft = `${this.path}.${process.pid}.tmp`;
    writeFileSync(draft, `${JSON.stringify(this.file, null, 2)}\n`, { mode: SECRET_FILE_MODE });
    chmodSync(draft, SECRET_FILE_MODE);
    renameSync(draft, this.path);
  }

  /** Everyone, keys left out. */
  list(): PublicPerson[] {
    return this.file.people.map(publicPerson);
  }

  /** The person the app is shown to. */
  current(): Person {
    return this.file.people.find((person) => person.id === this.file.current) ?? this.file.people[0]!;
  }

  find(id: string): Person | undefined {
    return this.file.people.find((person) => person.id === id);
  }

  /** Makes the app be shown to this person from now on. */
  select(id: string): Person {
    const person = this.find(id);
    if (!person) throw new Error(`no person ${id}`);
    this.file.current = id;
    this.save();
    return person;
  }

  /** A new person with a wallet of their own. Validate with `invalidPerson` first. */
  create(input: NewPerson): Person {
    const reason = invalidPerson(input);
    if (reason) throw new Error(reason);
    const { address, secretKey } = newKeypair();
    const person: Person = {
      id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      username: input.username,
      age: input.age,
      wallet: address,
      secretKey,
      balanceCents: input.balanceCents ?? DEFAULT_BALANCE_CENTS,
      grants: [],
    };
    this.file.people.push(person);
    this.save();
    return person;
  }

  /** The person has let this app see who they are. */
  grant(id: string, origin: string): void {
    const person = this.find(id);
    if (!person || person.grants.includes(origin)) return;
    person.grants.push(origin);
    this.save();
  }

  /** The person verified their identity, at this age. */
  verify(id: string, age: number): void {
    const person = this.find(id);
    if (!person) return;
    person.age = age;
    this.save();
  }

  /** The balance the person is brought up to when the chain starts fresh. */
  setBalance(id: string, balanceCents: number): void {
    const person = this.find(id);
    if (!person) return;
    person.balanceCents = balanceCents;
    this.save();
  }

  /** Changes what was asked of a person. Throws the reason when the result is not a person. */
  update(id: string, changes: Partial<NewPerson>): Person {
    const person = this.find(id);
    if (!person) throw new Error(`no person ${id}`);
    const next: NewPerson = {
      username: changes.username ?? person.username,
      age: changes.age === undefined ? person.age : changes.age,
      balanceCents: changes.balanceCents ?? person.balanceCents,
    };
    const reason = invalidPerson(next);
    if (reason) throw new Error(reason);
    person.username = next.username;
    person.age = next.age;
    person.balanceCents = next.balanceCents ?? person.balanceCents;
    this.save();
    return person;
  }

  /** Forgets a person. Not the last one: the app is always shown to somebody. */
  remove(id: string): void {
    const index = this.file.people.findIndex((person) => person.id === id);
    if (index === -1) throw new Error(`no person ${id}`);
    if (this.file.people.length === 1) throw new Error('the last person stays: the app is always shown to somebody');
    this.file.people.splice(index, 1);
    if (this.file.current === id) this.file.current = this.file.people[0]!.id;
    this.save();
  }
}
