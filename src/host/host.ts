// The host: what answers an app's calls in the simulator, as the Bankroll app
// does on a phone.
//
// The app's page reaches it through the SDK's bridge and the simulator page,
// which relays each call here on its own origin (src/simulator.ts, /api/host).
// Each call is answered at once, refused with the phone's words, or held
// while a sheet is shown to the developer, as the phone shows one to its user:
// consent the first time an app asks who the person is, approval of every
// payment, identity verification for a person who has none, and a deposit.
// The simulator page draws the sheet; the decision comes back here, and the
// answer goes out from here.
//
// Money is real to the chain: a payment is a transfer on the local chain,
// which the app's server confirms with the SDK's real code. Without a chain
// the person still has a session and a balance to show, and a payment is
// refused with the reason.
import { PublicKey } from '@solana/web3.js';

import { manifestClaims, MANIFEST_PATH } from '../manifest';
import type { Ledger } from './chain';
import { invalidPerson, type NewPerson, type People, type Person, publicPerson, type PublicPerson } from './people';
import {
  type AppFacts,
  judgePayment,
  paymentFingerprint,
  type Quote,
  WIRE_CHARGE_EXPIRED,
  WIRE_CONSENT_DECLINED,
  WIRE_IDEMPOTENCY_CONFLICT,
  WIRE_PAYMENT_DENIED,
  WIRE_VERIFICATION_DECLINED,
} from './payments';
import { sessionToken } from './tokens';

/** The phone's name for each call, as the bridge sends it. */
export const FEATURES = {
  init: 'bankroll:init',
  session: 'bankroll:session',
  identity: 'bankroll:identity',
  pay: 'bankroll:pay',
  balances: 'bankroll:balances',
  deposit: 'bankroll:deposit',
  haptics: 'bankroll:haptics',
  requestAmount: 'bankroll:requestAmount',
  quote: 'bankroll:quote',
  promptReview: 'bankroll:promptReview',
} as const;

/** The version of the Bankroll app this host imitates: hs3's BANKROLL_CLIENT_VERSION. */
export const HOST_VERSION = '5';
/** What the app's treasury holds when the chain starts fresh, so payouts have something to pay from. */
export const TREASURY_FLOAT_CENTS = 1_000_00;
/** What a deposit sheet offers to add. */
export const DEPOSIT_DEFAULT_CENTS = 100_00;
/** The age a verification sheet offers. */
export const VERIFIED_AGE_DEFAULT = 30;
const FACTS_KEPT_MS = 10_000;
const MANIFEST_TIMEOUT_MS = 3_000;

interface SheetBase {
  id: string;
  feature: string;
  person: { id: string; username: string };
  app: { origin: string; name?: string };
}
/** What the simulator page shows the developer, under the call's row. */
export type Sheet =
  | (SheetBase & { kind: 'consent' })
  | (SheetBase & { kind: 'verify'; age: number })
  | (SheetBase & { kind: 'pay'; amountCents: number; memo?: string; payee: string; deadline: number })
  | (SheetBase & { kind: 'deposit'; amountCents: number; balanceCents: number | null });

/**
 * How a call comes out: answered now (a deposit also shows a sheet, as the
 * phone resolves it once its screen is up), refused with the phone's words,
 * or held behind a sheet whose decision answers it.
 */
export type Answer =
  | { done: true; ok: true; value?: unknown; sheet?: Sheet }
  | { done: true; ok: false; error: string }
  | { done: false; sheet: Sheet };

interface Held {
  sheet: Sheet;
  person: Person;
  app: AppFacts;
  /** For a session: whether verification was asked for too. */
  identity?: boolean;
  quote?: Quote;
}

interface Paid {
  fingerprint: string;
  signature?: string;
  /** The sheet still open for this key, when it is. */
  sheetId?: string;
}

export interface Treasury {
  address: string;
  secretKey: string;
}

export interface HostOptions {
  people: People;
  treasury: Treasury;
  /** The local chain, or null and the reason there is none. */
  ledger: Ledger | null;
  chainProblem?: string;
  fetchImpl?: typeof fetch;
}

export interface TreasuryReport {
  /** Where the open app is paid: the address its manifest names, or the simulator's own treasury. */
  address: string;
  /** True when that is the simulator's made-up treasury, which also signs payouts. */
  ours: boolean;
  /** Null without a chain. */
  balanceCents: number | null;
  chain: { ready: true; rpc: string } | { ready: false; reason: string };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const refused = (error: string): Answer => ({ done: true, ok: false, error });
const answered = (value?: unknown): Answer => ({ done: true, ok: true, ...(value === undefined ? {} : { value }) });

export class Host {
  private readonly people: People;
  private readonly treasury: Treasury;
  private readonly ledger: Ledger | null;
  private readonly chainProblem: string;
  private readonly fetchImpl: typeof fetch;
  private readonly held = new Map<string, Held>();
  private readonly paid = new Map<string, Paid>();
  private readonly facts = new Map<string, { facts: AppFacts; at: number }>();
  private sheets = 0;

  constructor(options: HostOptions) {
    this.people = options.people;
    this.treasury = options.treasury;
    this.ledger = options.ledger;
    this.chainProblem = options.chainProblem ?? 'there is no local chain';
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** Funds the treasury and brings every person up to their balance, on a chain that just started. */
  async start(): Promise<void> {
    if (!this.ledger) return;
    await this.ledger.prepare();
    await this.ledger.airdrop(new PublicKey(this.treasury.address));
    await this.ledger.setDollars(this.treasury.address, TREASURY_FLOAT_CENTS);
    for (const person of this.people.list()) await this.ledger.setDollars(person.wallet, person.balanceCents);
  }

  // -- People -------------------------------------------------------------

  listPeople(): { people: PublicPerson[]; current: string } {
    return { people: this.people.list(), current: this.people.current().id };
  }

  selectPerson(id: string): { people: PublicPerson[]; current: string } {
    this.people.select(id);
    return this.listPeople();
  }

  /** A new person, holding their balance on the chain from now. Throws the reason when the input is not a person. */
  async createPerson(input: unknown): Promise<PublicPerson> {
    const asked = isRecord(input) ? input : {};
    const person: NewPerson = {
      username: typeof asked.username === 'string' ? asked.username.trim() : '',
      age: asked.age === null || asked.age === undefined || asked.age === '' ? null : Number(asked.age),
      ...(asked.balanceCents !== undefined ? { balanceCents: Number(asked.balanceCents) } : {}),
    };
    const reason = invalidPerson(person);
    if (reason) throw new Error(reason);
    const made = this.people.create(person);
    if (this.ledger) await this.ledger.setDollars(made.wallet, made.balanceCents);
    return publicPerson(made);
  }

  /**
   * The app's treasury as the simulator sees it. An app started by the CLI
   * names the simulator's treasury in its manifest; an app with a treasury of
   * its own (a server wallet, say) names that, and is paid there.
   */
  /** Changes a person. A new balance is what they hold from now, on the chain too. Throws the reason when refused. */
  async updatePerson(id: string, input: unknown): Promise<PublicPerson> {
    const asked = isRecord(input) ? input : {};
    const changes: Partial<NewPerson> = {
      ...(asked.username !== undefined ? { username: typeof asked.username === 'string' ? asked.username.trim() : '' } : {}),
      ...(asked.age !== undefined ? { age: asked.age === null || asked.age === '' ? null : Number(asked.age) } : {}),
      ...(asked.balanceCents !== undefined ? { balanceCents: Number(asked.balanceCents) } : {}),
    };
    // Read before the change: update() changes the person in place.
    const held = this.people.find(id)?.balanceCents;
    const person = this.people.update(id, changes);
    if (this.ledger && held !== person.balanceCents) await this.ledger.setDollars(person.wallet, person.balanceCents);
    return publicPerson(person);
  }

  /** Forgets a person; the app is shown to another when it was theirs. */
  removePerson(id: string): { people: PublicPerson[]; current: string } {
    this.people.remove(id);
    return this.listPeople();
  }

  async treasuryReport(appOrigin?: string): Promise<TreasuryReport> {
    const facts = appOrigin ? await this.appFacts(appOrigin) : null;
    const address = facts?.payee ?? this.treasury.address;
    return {
      address,
      ours: address === this.treasury.address,
      balanceCents: this.ledger ? await this.ledger.dollarsOf(address) : null,
      chain: this.ledger ? { ready: true, rpc: this.ledger.rpc } : { ready: false, reason: this.chainProblem },
    };
  }

  // -- Calls --------------------------------------------------------------

  /** Answers one call from the app at `origin`, made by the current person. */
  async call(origin: string, feature: string, input: unknown): Promise<Answer> {
    const person = this.people.current();
    switch (feature) {
      case FEATURES.init:
      case FEATURES.haptics:
      case FEATURES.quote:
      case FEATURES.promptReview:
        return answered();
      case FEATURES.requestAmount:
        return answered({ status: 'dismissed' });
      case FEATURES.balances:
        return answered({ cashCents: await this.balanceOf(person), creditsCents: 0, tokens: {} });
      case FEATURES.session:
      case FEATURES.identity:
        return this.session(origin, feature, person, isRecord(input) && input.identity === true);
      case FEATURES.pay:
        return this.pay(origin, person, input);
      case FEATURES.deposit:
        return this.deposit(origin, person);
      default:
        return refused(`Unsupported bankroll request: ${feature}`);
    }
  }

  /** The developer answered a sheet. */
  async decide(sheetId: string, approve: boolean, input: unknown): Promise<Answer> {
    const held = this.held.get(sheetId);
    if (!held) return refused('that sheet is no longer open');
    this.held.delete(sheetId);
    const { sheet, person, app } = held;
    switch (sheet.kind) {
      case 'consent':
        if (!approve) return refused(WIRE_CONSENT_DECLINED);
        this.people.grant(person.id, app.origin);
        return this.session(app.origin, sheet.feature, this.people.find(person.id) ?? person, held.identity === true);
      case 'verify': {
        if (!approve) return refused(WIRE_VERIFICATION_DECLINED);
        const age = isRecord(input) && typeof input.age === 'number' && Number.isInteger(input.age) && input.age >= 0 ? input.age : sheet.age;
        this.people.verify(person.id, age);
        return answered(sessionToken(this.people.find(person.id) ?? { ...person, age }, app.origin));
      }
      case 'pay':
        return this.settlePayment(held, approve);
      case 'deposit': {
        if (!approve) return answered();
        const amount = isRecord(input) && typeof input.amountCents === 'number' && Number.isInteger(input.amountCents) && input.amountCents > 0 ? input.amountCents : sheet.amountCents;
        if (!this.ledger) return refused(this.chainProblem);
        await this.ledger.setDollars(person.wallet, (await this.ledger.dollarsOf(person.wallet)) + amount);
        return answered();
      }
    }
  }

  // -- Each call ----------------------------------------------------------

  private async balanceOf(person: Person): Promise<number> {
    return this.ledger ? this.ledger.dollarsOf(person.wallet) : person.balanceCents;
  }

  private async session(origin: string, feature: string, person: Person, identity: boolean): Promise<Answer> {
    const app = await this.appFacts(origin);
    if (!person.grants.includes(origin)) return this.hold({ kind: 'consent', ...this.base(feature, person, app) }, { person, app, identity });
    if (identity && person.age === null) return this.hold({ kind: 'verify', age: VERIFIED_AGE_DEFAULT, ...this.base(feature, person, app) }, { person, app, identity });
    return answered(sessionToken(person, origin));
  }

  private async pay(origin: string, person: Person, input: unknown): Promise<Answer> {
    const app = await this.appFacts(origin);
    const taken = [person.wallet, ...(this.ledger ? [this.ledger.sponsor.publicKey.toBase58()] : [])];
    const judged = judgePayment(input, app, this.ledger ? await this.balanceOf(person) : null, taken);
    if (!judged.ok) return refused(judged.error);
    const { quote } = judged;

    // The same key names the same payment: the one answer serves every asker.
    // A key reused for a different payment is refused, as on the phone.
    if (quote.idempotencyKey) {
      const key = `${origin}|${person.wallet}|${quote.idempotencyKey}`;
      const before = this.paid.get(key);
      const fingerprint = paymentFingerprint(quote);
      if (before) {
        if (before.fingerprint !== fingerprint) return refused(WIRE_IDEMPOTENCY_CONFLICT);
        if (before.signature) return answered(before.signature);
        const open = before.sheetId && this.held.get(before.sheetId);
        if (open) return { done: false, sheet: open.sheet };
      }
      const sheet = this.paySheet(person, app, quote);
      this.paid.set(key, { fingerprint, sheetId: sheet.id });
      return this.hold(sheet, { person, app, quote });
    }
    return this.hold(this.paySheet(person, app, quote), { person, app, quote });
  }

  private paySheet(person: Person, app: AppFacts, quote: Quote): Sheet {
    return { kind: 'pay', amountCents: quote.amountCents, ...(quote.memo ? { memo: quote.memo } : {}), payee: quote.payee, deadline: quote.deadline, ...this.base(FEATURES.pay, person, app) };
  }

  private async settlePayment(held: Held, approve: boolean): Promise<Answer> {
    const { person, app, quote } = held;
    if (!quote) return refused(WIRE_PAYMENT_DENIED);
    const key = quote.idempotencyKey ? `${app.origin}|${person.wallet}|${quote.idempotencyKey}` : null;
    const forget = () => {
      if (key) this.paid.delete(key);
    };
    // Judged before the decline, as on the phone: a sheet that lapsed is an
    // expired charge, not one the person turned down.
    if (Date.now() > quote.deadline) {
      forget();
      return refused(WIRE_CHARGE_EXPIRED);
    }
    if (!approve) {
      forget();
      return refused(WIRE_PAYMENT_DENIED);
    }
    if (!this.ledger) {
      forget();
      return refused(this.chainProblem);
    }
    try {
      const signature = await this.ledger.pay({
        payerSecretKey: person.secretKey,
        payee: quote.payee,
        amountCents: quote.amountCents,
        ...(quote.reference ? { reference: quote.reference } : {}),
        ...(quote.memo ? { memo: quote.memo } : {}),
      });
      if (key) this.paid.set(key, { fingerprint: paymentFingerprint(quote), signature });
      return answered(signature);
    } catch (error) {
      forget();
      return refused(error instanceof Error ? error.message : String(error));
    }
  }

  private async deposit(origin: string, person: Person): Promise<Answer> {
    const app = await this.appFacts(origin);
    const sheet: Sheet = { kind: 'deposit', amountCents: DEPOSIT_DEFAULT_CENTS, balanceCents: this.ledger ? await this.balanceOf(person) : null, ...this.base(FEATURES.deposit, person, app) };
    this.held.set(sheet.id, { sheet, person, app });
    // Resolved once the sheet is up, as the phone resolves it: the deposit
    // itself happens on the sheet, not in the call.
    return { done: true, ok: true, sheet };
  }

  // -- Sheets and facts ---------------------------------------------------

  private base(feature: string, person: Person, app: AppFacts): SheetBase {
    return {
      id: `s${++this.sheets}`,
      feature,
      person: { id: person.id, username: person.username },
      app: { origin: app.origin, ...(app.name ? { name: app.name } : {}) },
    };
  }

  private hold(sheet: Sheet, held: Omit<Held, 'sheet'>): Answer {
    this.held.set(sheet.id, { sheet, ...held });
    return { done: false, sheet };
  }

  /** What the app's manifest says, asked at most every few seconds. */
  private async appFacts(origin: string): Promise<AppFacts> {
    const known = this.facts.get(origin);
    if (known && Date.now() - known.at < FACTS_KEPT_MS) return known.facts;
    let facts: AppFacts = { origin, appTokens: {} };
    try {
      const response = await this.fetchImpl(`${origin}${MANIFEST_PATH}`, { signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS) });
      const claims = response.ok ? manifestClaims(await response.text()) : null;
      if (claims) {
        const capabilities = isRecord(claims.capabilities) ? claims.capabilities : {};
        facts = {
          origin,
          ...(typeof claims.name === 'string' && claims.name.trim() ? { name: claims.name.trim() } : {}),
          ...(typeof capabilities.payments === 'string' && capabilities.payments ? { payee: capabilities.payments } : {}),
          appTokens: isRecord(claims.appTokens) ? claims.appTokens : {},
        };
      }
    } catch {
      // An app that is not answering has no manifest to read; a payment to it is refused below.
    }
    this.facts.set(origin, { facts, at: Date.now() });
    return facts;
  }
}
