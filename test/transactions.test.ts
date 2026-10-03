import { describe as suite, expect, it } from 'vitest';

import { BASE_UNITS_PER_CENT, DOLLAR_MINT } from '../src/host/chain';
import { describe, wsOf } from '../src/host/transactions';

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const SPONSOR = 'SponsorSponsorSponsorSponsorSponsorSponsor11';
const ALICE = 'A1iceA1iceA1iceA1iceA1iceA1iceA1iceA1iceA1i';
const PAYEE = 'PayeePayeePayeePayeePayeePayeePayeePayeePay1';
const REFERENCE = 'RefRefRefRefRefRefRefRefRefRefRefRefRefRefRe';
const ALICE_ATA = 'A1iceTokenAccountA1iceTokenAccountA1iceTok1';
const PAYEE_ATA = 'PayeeTokenAccountPayeeTokenAccountPayeeTok1';
const cents = (value: number) => (BigInt(value) * BASE_UNITS_PER_CENT).toString();

/** A payment as surfpool parses one: the phone's shape, with a reference and a memo. */
function payment({ failed = false, withReference = true }: { failed?: boolean; withReference?: boolean } = {}) {
  const keys = [
    { pubkey: SPONSOR, signer: true, writable: true },
    { pubkey: ALICE, signer: true, writable: true },
    { pubkey: ALICE_ATA, signer: false, writable: true },
    { pubkey: PAYEE_ATA, signer: false, writable: true },
    { pubkey: PAYEE, signer: false, writable: false },
    { pubkey: DOLLAR_MINT, signer: false, writable: false },
    ...(withReference ? [{ pubkey: REFERENCE, signer: false, writable: false }] : []),
    { pubkey: TOKEN, signer: false, writable: false },
    { pubkey: ATA, signer: false, writable: false },
    { pubkey: MEMO, signer: false, writable: false },
    { pubkey: '11111111111111111111111111111111', signer: false, writable: false },
  ];
  const balance = (accountIndex: number, owner: string, amount: string) => ({ accountIndex, mint: DOLLAR_MINT, owner, uiTokenAmount: { amount } });
  return {
    slot: 452_792_654,
    blockTime: 1_759_440_000,
    meta: {
      err: failed ? { InstructionError: [1, { Custom: 1 }] } : null,
      fee: 10_000,
      logMessages: failed ? ['Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]', 'Program log: Error: insufficient funds', 'Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA failed: custom program error: 0x1'] : [],
      preTokenBalances: failed ? [] : [balance(2, ALICE, cents(100_00)), balance(3, PAYEE, cents(0))],
      postTokenBalances: failed ? [] : [balance(2, ALICE, cents(95_00)), balance(3, PAYEE, cents(5_00))],
      innerInstructions: [],
    },
    transaction: {
      message: {
        accountKeys: keys,
        instructions: [
          { program: 'spl-associated-token-account', programId: ATA, parsed: { type: 'createIdempotent', info: { account: PAYEE_ATA, mint: DOLLAR_MINT, source: SPONSOR, wallet: PAYEE } } },
          { program: 'spl-token', programId: TOKEN, parsed: { type: 'transferChecked', info: { authority: ALICE, destination: PAYEE_ATA, mint: DOLLAR_MINT, source: ALICE_ATA, tokenAmount: { amount: cents(5_00), decimals: 9 } } } },
          { program: 'spl-memo', programId: MEMO, parsed: 'Golden Sun: one game' },
        ],
      },
    },
  };
}

suite('describe', () => {
  it('reads a payment: who paid whom how much, the memo, and the reference', () => {
    const row = describe(7, 'sig', payment(), DOLLAR_MINT, BASE_UNITS_PER_CENT, 1_759_440_000_000);
    expect(row).toMatchObject({
      seq: 7,
      signature: 'sig',
      slot: 452_792_654,
      at: 1_759_440_000_000,
      ok: true,
      kind: 'transfer',
      from: ALICE,
      to: PAYEE,
      amountCents: 500,
      memo: 'Golden Sun: one game',
      reference: REFERENCE,
      feePayer: SPONSOR,
      fee: 10_000,
    });
    expect(row.instructions.map((instruction) => `${instruction.program}:${instruction.type ?? ''}`)).toEqual(['spl-associated-token-account:createIdempotent', 'spl-token:transferChecked', 'spl-memo:']);
    expect(row.accounts).toHaveLength(11);
  });

  it('lists each recipient when the dollars reached several at once', () => {
    const funding = payment({ withReference: false });
    const BOB = 'BobBobBobBobBobBobBobBobBobBobBobBobBobBobBo';
    funding.meta.preTokenBalances.push({ accountIndex: 7, mint: DOLLAR_MINT, owner: BOB, uiTokenAmount: { amount: cents(0) } });
    funding.meta.postTokenBalances.push({ accountIndex: 7, mint: DOLLAR_MINT, owner: BOB, uiTokenAmount: { amount: cents(2_00) } });
    funding.meta.postTokenBalances[0]!.uiTokenAmount.amount = cents(93_00);
    const row = describe(6, 'sig', funding, DOLLAR_MINT, BASE_UNITS_PER_CENT);
    expect(row).toMatchObject({ kind: 'transfer', from: ALICE, amountCents: 700, recipients: [{ to: PAYEE, amountCents: 500 }, { to: BOB, amountCents: 200 }] });
    expect(row.to).toBeUndefined();
  });

  it('names no reference when the transfer carried none', () => {
    expect(describe(1, 'sig', payment({ withReference: false }), DOLLAR_MINT, BASE_UNITS_PER_CENT).reference).toBeUndefined();
  });

  it("reads a failed payment from what was meant, with the chain's reason", () => {
    const row = describe(2, 'sig', payment({ failed: true }), DOLLAR_MINT, BASE_UNITS_PER_CENT);
    expect(row).toMatchObject({ ok: false, error: 'insufficient funds', kind: 'transfer', from: ALICE, amountCents: 500, memo: 'Golden Sun: one game' });
    expect(row.to).toBeUndefined();
  });

  it('calls SOL moving fees, and an account made on its own an account', () => {
    const sol = {
      slot: 1,
      blockTime: null,
      meta: { err: null, fee: 5000 },
      transaction: {
        message: {
          accountKeys: [{ pubkey: SPONSOR, signer: true, writable: true }, { pubkey: ALICE, signer: false, writable: true }, { pubkey: '11111111111111111111111111111111', signer: false, writable: false }],
          instructions: [{ program: 'system', programId: '11111111111111111111111111111111', parsed: { type: 'transfer', info: { source: SPONSOR, destination: ALICE, lamports: 1_000_000_000 } } }],
        },
      },
    };
    const fees = describe(3, 'sig', sol, DOLLAR_MINT, BASE_UNITS_PER_CENT, 42);
    expect(fees).toMatchObject({ kind: 'fees', at: 42, ok: true, feePayer: SPONSOR });
    expect(fees.amountCents).toBeUndefined();

    const account = { ...sol, transaction: { message: { accountKeys: sol.transaction.message.accountKeys, instructions: [{ program: 'spl-associated-token-account', programId: ATA, parsed: { type: 'create', info: {} } }] } } };
    expect(describe(4, 'sig', account, DOLLAR_MINT, BASE_UNITS_PER_CENT).kind).toBe('account');
  });

  it('calls a transfer of some other token other', () => {
    const other = payment();
    for (const balance of [...other.meta.preTokenBalances, ...other.meta.postTokenBalances]) balance.mint = 'OtherMint111111111111111111111111111111111';
    (other.transaction.message.instructions[1]!.parsed as { info: { mint: string } }).info.mint = 'OtherMint111111111111111111111111111111111';
    expect(describe(5, 'sig', other, DOLLAR_MINT, BASE_UNITS_PER_CENT).kind).toBe('other');
  });
});

suite('wsOf', () => {
  it("is the port after the RPC's", () => {
    expect(wsOf('http://127.0.0.1:8899')).toBe('ws://127.0.0.1:8900');
    expect(wsOf('https://chain.example:443')).toBe('wss://chain.example:444');
  });
});
