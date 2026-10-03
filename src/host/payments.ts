// A payment, judged the way the phone judges one before it asks the user.
//
// The order and the words are the Bankroll app's (hs3, bridgeHandlers.ts
// handlePay): an app that passes here and fails on a phone, or the reverse,
// would make the simulator a liar. Each refusal is the string the phone sends
// across its bridge, which the SDK turns into the error code an app reads.
import { PublicKey } from '@solana/web3.js';

/** What the SDK sends for `pay`, as the phone reads it. */
export interface PayInput {
  amountCents: number;
  expiresInSeconds?: number;
  idempotencyKey?: string;
  memo?: string;
  reference?: string;
  token?: string;
}

/** What is known of the app the payment goes to, from its manifest. */
export interface AppFacts {
  origin: string;
  name?: string;
  /** The address the manifest declares under capabilities.payments. */
  payee?: string;
  appTokens: Record<string, unknown>;
}

/** A payment the user may now be asked about. */
export interface Quote {
  amountCents: number;
  payee: string;
  memo?: string;
  reference?: string;
  idempotencyKey?: string;
  /** When the offer lapses, in milliseconds since the epoch. */
  deadline: number;
}

export type Judgement = { ok: true; quote: Quote } | { ok: false; error: string };

// The phone's words, verbatim.
export const WIRE_INVALID_AMOUNT = 'pay requires a positive whole-cent amount';
export const WIRE_INVALID_REFERENCE = 'pay reference must be an address the payment can carry';
export const WIRE_INSUFFICIENT_FUNDS = 'insufficient_funds';
export const WIRE_IDEMPOTENCY_CONFLICT = 'idempotency_conflict';
export const WIRE_PAYMENT_DENIED = 'payment_denied';
export const WIRE_CHARGE_EXPIRED = 'charge_expired';
export const WIRE_CONSENT_DECLINED = 'consent_declined';
export const WIRE_VERIFICATION_DECLINED = 'verification_declined';
// The SDK reads "Bankroll manifest" in a reason as a manifest problem.
const MANIFEST_MARKER = 'Bankroll manifest';

export const MEMO_MAX_LENGTH = 80;
const IDEMPOTENCY_KEY_MAX_LENGTH = 255;
/** How long the user has to approve when the app names no limit. */
export const DEFAULT_EXPIRY_SECONDS = 90;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * Judges a payment before anyone is asked: the input, the app's manifest, and
 * the payer's balance. `taken` says what the payer's wallet, the dollar, the
 * payee and the fee payer are, which a reference may not be.
 */
export function judgePayment(
  input: unknown,
  app: AppFacts,
  balanceCents: number | null,
  taken: string[],
  now = Date.now(),
): Judgement {
  const pay = isRecord(input) ? (input as Partial<PayInput>) : {};
  const { amountCents } = pay;
  if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, error: WIRE_INVALID_AMOUNT };

  const memo = typeof pay.memo === 'string' ? pay.memo.trim().slice(0, MEMO_MAX_LENGTH) : undefined;

  const { idempotencyKey } = pay;
  if (idempotencyKey != null && (typeof idempotencyKey !== 'string' || idempotencyKey.length === 0 || idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH)) {
    return { ok: false, error: `pay idempotencyKey must be a string of 1 to ${IDEMPOTENCY_KEY_MAX_LENGTH} characters` };
  }

  const { expiresInSeconds } = pay;
  if (expiresInSeconds !== undefined && (typeof expiresInSeconds !== 'number' || !Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0)) {
    return { ok: false, error: 'pay expiresInSeconds must be a positive number of seconds' };
  }

  const { token } = pay;
  if (token !== undefined && (typeof token !== 'string' || token === '')) return { ok: false, error: 'pay token must be a non-empty mint address' };
  if (typeof token === 'string' && !(token in app.appTokens)) return { ok: false, error: `${app.origin} is not registered for token ${token}` };
  if (typeof token === 'string') return { ok: false, error: `the simulator pays in dollars only for now; ${app.origin} asked for its token ${token}` };

  if (!app.payee) return { ok: false, error: `${app.origin} serves no ${MANIFEST_MARKER} with a payments address, so there is nowhere to pay` };

  const { reference } = pay;
  if (reference != null) {
    if (typeof reference !== 'string') return { ok: false, error: WIRE_INVALID_REFERENCE };
    try {
      new PublicKey(reference);
    } catch {
      return { ok: false, error: WIRE_INVALID_REFERENCE };
    }
    if (taken.includes(reference) || reference === app.payee) return { ok: false, error: WIRE_INVALID_REFERENCE };
  }

  if (balanceCents === null) return { ok: false, error: 'the simulator has no local chain to pay on: install surfpool and start again' };
  if (balanceCents < amountCents) return { ok: false, error: WIRE_INSUFFICIENT_FUNDS };

  return {
    ok: true,
    quote: {
      amountCents,
      payee: app.payee,
      ...(memo ? { memo } : {}),
      ...(typeof reference === 'string' ? { reference } : {}),
      ...(typeof idempotencyKey === 'string' ? { idempotencyKey } : {}),
      deadline: now + (expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS) * 1000,
    },
  };
}

/**
 * Everything a reused idempotency key must name identically to be the same
 * payment, as the phone fingerprints it.
 */
export function paymentFingerprint(quote: Quote, token?: string): string {
  return JSON.stringify({
    amountCents: quote.amountCents,
    memo: quote.memo ?? null,
    recipient: quote.payee,
    reference: quote.reference ?? null,
    token: token ?? null,
  });
}
