import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import type { Ledger } from '../src/host/chain';
import { type Answer, DEPOSIT_DEFAULT_CENTS, FEATURES, Host, HOST_VERSION, TREASURY_FLOAT_CENTS, VERIFIED_AGE_DEFAULT } from '../src/host/host';
import { invalidPerson, MAX_BALANCE_CENTS, People } from '../src/host/people';
import { DEFAULT_EXPIRY_SECONDS, judgePayment, paymentFingerprint, WIRE_INSUFFICIENT_FUNDS, WIRE_INVALID_AMOUNT, WIRE_INVALID_REFERENCE } from '../src/host/payments';
import { sessionToken } from '../src/host/tokens';
import { loadTreasury } from '../src/host/treasury';
import { newKeypair } from '../src/keypair';

const APP = 'http://localhost:3000';
const PAYEE = newKeypair().address;
const jwt = (claims: unknown) => `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const decode = (token: string) => JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as Record<string, unknown>;

const scratch = () => mkdtempSync(join(tmpdir(), 'bankroll-host-'));

/** An app's server, as fetch sees it: the manifest it serves, if any. */
function appWith(claims: unknown | null): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (claims !== null && url === `${APP}/.well-known/bankroll.jwt`) return new Response(jwt(claims), { status: 200 });
    return new Response('not here', { status: 404 });
  }) as typeof fetch;
}

/** A chain that keeps balances in a map and pays by moving numbers between them. */
function fakeLedger(start: Record<string, number> = {}) {
  const dollars = new Map(Object.entries(start));
  const payments: { payer: string; payee: string; amountCents: number; reference?: string; memo?: string }[] = [];
  const ledger = {
    rpc: 'http://127.0.0.1:8899',
    sponsor: { publicKey: { toBase58: () => 'SponsorSponsorSponsorSponsorSponsorSponsor11' } },
    prepare: vi.fn(async () => {}),
    airdrop: vi.fn(async () => {}),
    setDollars: vi.fn(async (owner: string, cents: number) => {
      dollars.set(owner, cents);
    }),
    dollarsOf: vi.fn(async (owner: string) => dollars.get(owner) ?? 0),
    pay: vi.fn(async (input: { payerSecretKey: string; payee: string; amountCents: number; reference?: string; memo?: string }) => {
      const payer = bs58.encode(bs58.decode(input.payerSecretKey).subarray(32));
      dollars.set(payer, (dollars.get(payer) ?? 0) - input.amountCents);
      dollars.set(input.payee, (dollars.get(input.payee) ?? 0) + input.amountCents);
      payments.push({ payer, payee: input.payee, amountCents: input.amountCents, ...(input.reference ? { reference: input.reference } : {}), ...(input.memo ? { memo: input.memo } : {}) });
      return `sig${payments.length}`;
    }),
  };
  return { ledger: ledger as unknown as Ledger, dollars, payments };
}

function host(options: { ledger?: Ledger | null; manifest?: unknown | null; chainProblem?: string } = {}) {
  const dir = scratch();
  const people = new People(join(dir, 'people.json'));
  const treasury = loadTreasury(join(dir, 'treasury.json'));
  const made = new Host({
    people,
    treasury,
    ledger: options.ledger === undefined ? null : options.ledger,
    ...(options.chainProblem ? { chainProblem: options.chainProblem } : {}),
    fetchImpl: appWith(options.manifest === undefined ? { name: 'Golden Sun', capabilities: { session: true, payments: PAYEE } } : options.manifest),
  });
  return { host: made, people, treasury };
}

const sheetOf = (answer: Answer) => {
  if (answer.done || !answer.sheet) throw new Error(`expected a sheet, got ${JSON.stringify(answer)}`);
  return answer.sheet;
};
const valueOf = (answer: Answer) => {
  if (!answer.done || !answer.ok) throw new Error(`expected an answer, got ${JSON.stringify(answer)}`);
  return answer.value;
};
const errorOf = (answer: Answer) => {
  if (!answer.done || answer.ok) throw new Error(`expected a refusal, got ${JSON.stringify(answer)}`);
  return answer.error;
};

describe('People', () => {
  it('starts with the tester, keeps the file to itself, and remembers who was chosen', () => {
    const path = join(scratch(), 'people.json');
    const people = new People(path);
    expect(people.list().map((person) => [person.username, person.age, person.balanceCents])).toEqual([['tester', 30, 100_000]]);
    expect(people.current().username).toBe('tester');
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, 'utf8')).toContain('"secretKey"');

    const kid = people.create({ username: 'kid', age: null, balanceCents: 25_00 });
    // A base58 key is 43 or 44 characters, depending on its leading bytes.
    expect(kid.wallet).toMatch(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    people.select(kid.id);
    expect(new People(path).current().username).toBe('kid');
    expect(people.list().every((person) => !('secretKey' in person))).toBe(true);
  });

  it('refuses what is not a person', () => {
    expect(invalidPerson({ username: '', age: 30 })).toMatch(/username/);
    expect(invalidPerson({ username: 'a b', age: 30 })).toMatch(/username/);
    expect(invalidPerson({ username: 'ok', age: 1.5 })).toMatch(/age/);
    expect(invalidPerson({ username: 'ok', age: 200 })).toMatch(/age/);
    expect(invalidPerson({ username: 'ok', age: null, balanceCents: -1 })).toMatch(/balance/);
    expect(invalidPerson({ username: 'ok', age: null, balanceCents: MAX_BALANCE_CENTS + 1 })).toMatch(/balance/);
    expect(invalidPerson({ username: 'ok', age: null })).toBeNull();
  });

  it('changes a person, and forgets one, but never the last', () => {
    const path = join(scratch(), 'people.json');
    const people = new People(path);
    const tester = people.current();
    expect(() => people.remove(tester.id)).toThrow(/last person/);
    const kid = people.create({ username: 'kid', age: null, balanceCents: 25_00 });
    expect(people.update(kid.id, { username: 'kiddo', balanceCents: 30_00 })).toMatchObject({ username: 'kiddo', age: null, balanceCents: 30_00, wallet: kid.wallet });
    expect(() => people.update(kid.id, { username: '!!' })).toThrow(/username/);
    expect(() => people.update('nobody', {})).toThrow(/no person/);
    people.select(kid.id);
    people.remove(kid.id);
    expect(new People(path).current().id).toBe(tester.id);
    expect(() => people.remove('nobody')).toThrow(/no person/);
  });

  it('keeps grants and verification', () => {
    const path = join(scratch(), 'people.json');
    const people = new People(path);
    const kid = people.create({ username: 'kid', age: null });
    people.grant(kid.id, APP);
    people.grant(kid.id, APP);
    people.verify(kid.id, 21);
    const again = new People(path).find(kid.id)!;
    expect(again.grants).toEqual([APP]);
    expect(again.age).toBe(21);
  });
});

describe('sessionToken', () => {
  it('is an unsigned token in the shape of a real one, scoped to the app', () => {
    const people = new People(join(scratch(), 'people.json'));
    const token = sessionToken(people.current(), APP, 1_700_000_000_000);
    expect(token.endsWith('.')).toBe(true);
    expect(decode(token)).toEqual({ mock: true, iss: 'bankroll-mock', sub: people.current().wallet, username: 'tester', kyc: { age: 30 }, aud: APP, iat: 1_700_000_000, exp: 1_700_003_600 });
    const kid = people.create({ username: 'kid', age: null });
    expect(decode(sessionToken(kid, APP)).kyc).toBe(false);
  });
});

describe('judgePayment', () => {
  const app = { origin: APP, name: 'Golden Sun', payee: PAYEE, appTokens: {} };
  const taken = ['PayerPayerPayerPayerPayerPayerPayerPayerPaye'];

  it("judges in the phone's order, with the phone's words", () => {
    expect(judgePayment({ amountCents: 0 }, app, 1000, taken)).toEqual({ ok: false, error: WIRE_INVALID_AMOUNT });
    expect(judgePayment({ amountCents: 1.5 }, app, 1000, taken)).toEqual({ ok: false, error: WIRE_INVALID_AMOUNT });
    expect(judgePayment({ amountCents: 100, idempotencyKey: '' }, app, 1000, taken)).toMatchObject({ ok: false, error: expect.stringContaining('idempotencyKey') });
    expect(judgePayment({ amountCents: 100, expiresInSeconds: -1 }, app, 1000, taken)).toMatchObject({ ok: false, error: expect.stringContaining('expiresInSeconds') });
    expect(judgePayment({ amountCents: 100, token: 'Mint111' }, app, 1000, taken)).toEqual({ ok: false, error: `${APP} is not registered for token Mint111` });
    expect(judgePayment({ amountCents: 100, token: 'Mint111' }, { ...app, appTokens: { Mint111: {} } }, 1000, taken)).toMatchObject({ ok: false, error: expect.stringContaining('dollars only') });
    expect(judgePayment({ amountCents: 100 }, { origin: APP, name: 'Golden Sun', appTokens: {} }, 1000, taken)).toMatchObject({ ok: false, error: expect.stringContaining('Bankroll manifest') });
    expect(judgePayment({ amountCents: 100, reference: 'not an address' }, app, 1000, taken)).toEqual({ ok: false, error: WIRE_INVALID_REFERENCE });
    expect(judgePayment({ amountCents: 100, reference: PAYEE }, app, 1000, taken)).toEqual({ ok: false, error: WIRE_INVALID_REFERENCE });
    expect(judgePayment({ amountCents: 100 }, app, null, taken)).toMatchObject({ ok: false, error: expect.stringContaining('no local chain') });
    expect(judgePayment({ amountCents: 100 }, app, 99, taken)).toEqual({ ok: false, error: WIRE_INSUFFICIENT_FUNDS });
  });

  it('quotes a payment the person can make, with the memo cut to the phone\'s length and the app\'s deadline', () => {
    const reference = newKeypair().address;
    const judged = judgePayment({ amountCents: 500, memo: ` ${'m'.repeat(100)} `, idempotencyKey: 'k', reference, expiresInSeconds: 30 }, app, 1000, taken, 1_000_000);
    expect(judged).toEqual({ ok: true, quote: { amountCents: 500, payee: PAYEE, memo: 'm'.repeat(80), reference, idempotencyKey: 'k', deadline: 1_030_000 } });
    expect(judgePayment({ amountCents: 1 }, app, 1, taken, 0)).toMatchObject({ ok: true, quote: { deadline: DEFAULT_EXPIRY_SECONDS * 1000 } });
    const { quote } = judged as { ok: true; quote: Parameters<typeof paymentFingerprint>[0] };
    expect(paymentFingerprint(quote)).toBe(paymentFingerprint({ ...quote, deadline: 0, idempotencyKey: 'other' }));
    expect(paymentFingerprint(quote)).not.toBe(paymentFingerprint({ ...quote, amountCents: 501 }));
  });
});

describe('Host', () => {
  it('answers the calls that need no one asked, and refuses what it does not know', async () => {
    const { host: h } = host();
    expect(await h.call(APP, FEATURES.init, { sdk: '0.33.0' })).toEqual({ done: true, ok: true });
    expect(await h.call(APP, FEATURES.haptics, { type: 'light' })).toEqual({ done: true, ok: true });
    expect(await h.call(APP, FEATURES.promptReview, undefined)).toEqual({ done: true, ok: true });
    expect(await h.call(APP, FEATURES.quote, { assetId: 'x', price: 1 })).toEqual({ done: true, ok: true });
    expect(valueOf(await h.call(APP, FEATURES.requestAmount, { kind: 'cash' }))).toEqual({ status: 'dismissed' });
    expect(errorOf(await h.call(APP, 'hotstreak:getBalances', undefined))).toBe('Unsupported bankroll request: hotstreak:getBalances');
    expect(HOST_VERSION).toBe('5');
  });

  it('asks consent the first time an app wants to know who the person is, then not again', async () => {
    const { host: h, people } = host();
    const sheet = sheetOf(await h.call(APP, FEATURES.session, undefined));
    expect(sheet).toMatchObject({ kind: 'consent', feature: FEATURES.session, person: { username: 'tester' }, app: { origin: APP, name: 'Golden Sun' } });
    expect(errorOf(await h.decide(sheet.id, false, undefined))).toBe('consent_declined');

    const again = sheetOf(await h.call(APP, FEATURES.identity, undefined));
    const token = valueOf(await h.decide(again.id, true, undefined)) as string;
    expect(decode(token)).toMatchObject({ username: 'tester', aud: APP, kyc: { age: 30 } });
    expect(people.current().grants).toEqual([APP]);
    expect(decode(valueOf(await h.call(APP, FEATURES.session, undefined)) as string).sub).toBe(people.current().wallet);
    // Another app asks again.
    expect(sheetOf(await h.call('http://localhost:3001', FEATURES.session, undefined)).kind).toBe('consent');
    expect(errorOf(await h.decide('s999', true, undefined))).toMatch(/no longer open/);
  });

  it('takes an unverified person through verification when an app asks for an identity', async () => {
    const { host: h, people } = host();
    const kid = people.create({ username: 'kid', age: null });
    people.select(kid.id);
    people.grant(kid.id, APP);
    expect(decode(valueOf(await h.call(APP, FEATURES.session, undefined)) as string).kyc).toBe(false);

    const sheet = sheetOf(await h.call(APP, FEATURES.session, { identity: true }));
    expect(sheet).toMatchObject({ kind: 'verify', age: VERIFIED_AGE_DEFAULT });
    expect(errorOf(await h.decide(sheet.id, false, undefined))).toBe('verification_declined');
    const next = sheetOf(await h.call(APP, FEATURES.session, { identity: true }));
    expect(decode(valueOf(await h.decide(next.id, true, { age: 19 })) as string).kyc).toEqual({ age: 19 });
    expect(people.find(kid.id)!.age).toBe(19);

    // Consent first, then verification, for a person who gave neither.
    const other = people.create({ username: 'other', age: null });
    people.select(other.id);
    const consent = sheetOf(await h.call(APP, FEATURES.session, { identity: true }));
    expect(consent.kind).toBe('consent');
    expect(sheetOf(await h.decide(consent.id, true, undefined)).kind).toBe('verify');
  });

  it('reads balances from the chain, or from the person when there is none', async () => {
    const { host: h, people } = host();
    expect(valueOf(await h.call(APP, FEATURES.balances, undefined))).toEqual({ cashCents: 100_000, creditsCents: 0, tokens: {} });
    const chain = fakeLedger({ [people.current().wallet]: 12_34 });
    const { host: withChain } = host({ ledger: chain.ledger });
    // Different people file, same first person... different wallet: the fake chain knows nothing of them.
    expect(valueOf(await withChain.call(APP, FEATURES.balances, undefined))).toEqual({ cashCents: 0, creditsCents: 0, tokens: {} });
  });

  it('pays on the chain once the sheet is approved, and keeps to the phone\'s rules', async () => {
    const chain = fakeLedger();
    const { host: h, people } = host({ ledger: chain.ledger });
    await h.start();
    const tester = people.current();
    expect(chain.dollars.get(tester.wallet)).toBe(100_000);
    expect(chain.dollars.get(h.listPeople().people[0]!.wallet)).toBe(100_000);
    expect((await h.treasuryReport()).balanceCents).toBe(TREASURY_FLOAT_CENTS);

    expect(errorOf(await h.call(APP, FEATURES.pay, { amountCents: 200_000 }))).toBe(WIRE_INSUFFICIENT_FUNDS);
    const reference = newKeypair().address;
    const sheet = sheetOf(await h.call(APP, FEATURES.pay, { amountCents: 500, memo: 'one game', idempotencyKey: 'k1', reference }));
    expect(sheet).toMatchObject({ kind: 'pay', amountCents: 500, memo: 'one game', payee: PAYEE, app: { name: 'Golden Sun' } });

    // The same key while the sheet is open: the same sheet.
    expect(sheetOf(await h.call(APP, FEATURES.pay, { amountCents: 500, memo: 'one game', idempotencyKey: 'k1', reference })).id).toBe(sheet.id);
    // The same key for another payment: refused.
    expect(errorOf(await h.call(APP, FEATURES.pay, { amountCents: 600, idempotencyKey: 'k1' }))).toBe('idempotency_conflict');

    expect(valueOf(await h.decide(sheet.id, true, undefined))).toBe('sig1');
    expect(chain.payments).toEqual([{ payer: tester.wallet, payee: PAYEE, amountCents: 500, reference, memo: 'one game' }]);
    expect(chain.dollars.get(tester.wallet)).toBe(99_500);
    // The same key again, settled: the same signature, no sheet.
    expect(valueOf(await h.call(APP, FEATURES.pay, { amountCents: 500, memo: 'one game', idempotencyKey: 'k1', reference }))).toBe('sig1');

    // Declined, and the key is free again.
    const declined = sheetOf(await h.call(APP, FEATURES.pay, { amountCents: 100, idempotencyKey: 'k2' }));
    expect(errorOf(await h.decide(declined.id, false, undefined))).toBe('payment_denied');
    expect(sheetOf(await h.call(APP, FEATURES.pay, { amountCents: 100, idempotencyKey: 'k2' })).kind).toBe('pay');

    // Expired before the decision.
    const slow = sheetOf(await h.call(APP, FEATURES.pay, { amountCents: 100, expiresInSeconds: 0.001 }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(errorOf(await h.decide(slow.id, true, undefined))).toBe('charge_expired');
    expect(chain.payments).toHaveLength(1);
  });

  it('refuses a payment with no chain, and says why', async () => {
    const { host: h } = host({ chainProblem: 'surfpool is not installed' });
    expect(errorOf(await h.call(APP, FEATURES.pay, { amountCents: 100 }))).toMatch(/no local chain/);
    expect((await h.treasuryReport()).chain).toEqual({ ready: false, reason: 'surfpool is not installed' });
  });

  it('pays the app where its manifest says, or nowhere', async () => {
    const chain = fakeLedger();
    const { host: h } = host({ ledger: chain.ledger, manifest: { name: 'Quiet', capabilities: { session: true } } });
    await h.start();
    expect(errorOf(await h.call(APP, FEATURES.pay, { amountCents: 100 }))).toMatch(/Bankroll manifest/);
    const { host: silent } = host({ ledger: chain.ledger, manifest: null });
    expect(errorOf(await silent.call(APP, FEATURES.pay, { amountCents: 100 }))).toMatch(/Bankroll manifest/);
    expect((await silent.treasuryReport(APP)).ours).toBe(true);
    expect(await h.treasuryReport(APP)).toMatchObject({ ours: true });
    const { host: paid, treasury } = host({ ledger: chain.ledger });
    expect(await paid.treasuryReport(APP)).toMatchObject({ address: PAYEE, ours: false });
    expect(await paid.treasuryReport()).toMatchObject({ address: treasury.address, ours: true });
  });

  it('answers a deposit at once and adds the money on the sheet', async () => {
    const chain = fakeLedger();
    const { host: h, people } = host({ ledger: chain.ledger });
    await h.start();
    const answer = await h.call(APP, FEATURES.deposit, undefined);
    expect(answer).toMatchObject({ done: true, ok: true, sheet: { kind: 'deposit', amountCents: DEPOSIT_DEFAULT_CENTS, balanceCents: 100_000 } });
    const sheet = (answer as { sheet: { id: string } }).sheet;
    expect(await h.decide(sheet.id, true, { amountCents: 25_00 })).toEqual({ done: true, ok: true });
    expect(chain.dollars.get(people.current().wallet)).toBe(102_500);
    const { host: dry } = host();
    const none = (await dry.call(APP, FEATURES.deposit, undefined)) as { sheet: { id: string } };
    expect(errorOf(await dry.decide(none.sheet.id, true, undefined))).toMatch(/no local chain/);
  });

  it('makes people, with their balance on the chain from the start, and refuses what is not a person', async () => {
    const chain = fakeLedger();
    const { host: h } = host({ ledger: chain.ledger });
    const made = await h.createPerson({ username: 'alice', age: '42', balanceCents: 5_00 });
    expect(made).toMatchObject({ username: 'alice', age: 42, balanceCents: 500 });
    expect(chain.dollars.get(made.wallet)).toBe(500);
    expect(await h.createPerson({ username: 'bob', age: '' })).toMatchObject({ age: null, balanceCents: 100_000 });
    await expect(h.createPerson({ username: 'no good' })).rejects.toThrow(/username/);
    expect(h.selectPerson(made.id).current).toBe(made.id);
    expect(() => h.selectPerson('nobody')).toThrow(/no person/);

    // A new balance is what they hold now, on the chain too; a new name is not.
    expect(await h.updatePerson(made.id, { balanceCents: 7_00 })).toMatchObject({ balanceCents: 700 });
    expect(chain.dollars.get(made.wallet)).toBe(700);
    chain.ledger.setDollars = vi.fn(async () => {}) as typeof chain.ledger.setDollars;
    expect(await h.updatePerson(made.id, { username: 'alicia', age: '' })).toMatchObject({ username: 'alicia', age: null, balanceCents: 700 });
    expect(chain.ledger.setDollars).not.toHaveBeenCalled();
    await expect(h.updatePerson(made.id, { username: 'bad name' })).rejects.toThrow(/username/);
    expect(h.removePerson(made.id).people.map((person) => person.username)).toEqual(['tester', 'bob']);
    expect(() => h.removePerson('nobody')).toThrow(/no person/);
  });
});
