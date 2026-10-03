// The local chain's activity, watched whole.
//
// surfpool tells its websocket subscribers of every transaction it processes,
// the moment it does (`logsSubscribe` to "all"), and only of its own: a forked
// chain answers some questions from mainnet, but never this one. Each
// signature heard is read back parsed and written down as a row the simulator
// can list: who paid whom how much, with the memo and the reference, or what
// else happened (SOL for fees, an account made), or that it failed and why.
//
// Rows name addresses, not people: the host puts names to them when it hands
// the list out, so a user renamed is renamed throughout, and the bank's
// minting reads as minting.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** The programs whose instructions the rows understand. */
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TOKEN_PROGRAMS = new Set(['spl-token', 'spl-token-2022']);
// Accounts that are never a reference: the programs and sysvars a transfer
// names along the way, whether or not an instruction of its own invokes them.
const KNOWN_PROGRAMS = new Set([
  SYSTEM_PROGRAM,
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
  'ComputeBudget111111111111111111111111111111',
  'SysvarRent111111111111111111111111111111111',
  'SysvarC1ock11111111111111111111111111111111',
]);
const KEPT = 500;
// A transaction heard of is read back a few times if the node has not
// written it yet, and the websocket is reopened when it closes.
const READ_ATTEMPTS = 8;
const READ_AGAIN_MS = 250;
const RECONNECT_MS = 1_000;

export type TransactionKind =
  /** The dollar, one wallet to another. */
  | 'transfer'
  /** New dollars, minted to a wallet: the bank's float, when the chain starts and when it runs low. */
  | 'mint'
  /** SOL moved, or dropped from the sky: what pays the fees. */
  | 'fees'
  /** A dollar account made, and nothing else. */
  | 'account'
  | 'other';

export interface Instruction {
  program: string;
  type?: string;
  info?: Json;
}

/** One transaction, as the list shows it. */
export interface ChainTransaction {
  /** Its place in the list, counting up; what a page asks for more after. */
  seq: number;
  signature: string;
  slot: number;
  /** When it was heard, in milliseconds since the epoch: a moment after it landed. A forked chain's own clock says when the fork was, not now. */
  at: number;
  ok: boolean;
  error?: string;
  kind: TransactionKind;
  /** The owner the dollars left, and the owner they reached. */
  from?: string;
  to?: string;
  /** When they reached several owners at once, as a fresh chain's funding does: each, with its share. */
  recipients?: { to: string; amountCents: number }[];
  amountCents?: number;
  memo?: string;
  /** An account the transfer carried for no other reason: the app's reference. */
  reference?: string;
  feePayer: string;
  /** The fee in lamports. */
  fee: number;
  instructions: Instruction[];
  accounts: string[];
}

interface ParsedTransaction {
  slot: number;
  blockTime?: number | null;
  meta: {
    err: unknown;
    fee: number;
    logMessages?: string[];
    preTokenBalances?: { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }[];
    postTokenBalances?: { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }[];
    innerInstructions?: { instructions: RawInstruction[] }[];
  } | null;
  transaction: {
    message: {
      accountKeys: { pubkey: string; signer: boolean; writable: boolean }[];
      instructions: RawInstruction[];
    };
  };
}

interface RawInstruction {
  program?: string;
  programId: string;
  parsed?: { type?: string; info?: Record<string, unknown> } | string;
  accounts?: string[];
  data?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * Reads a parsed transaction into a row. `mint` is the dollar's: a transfer of
 * anything else is `other`. Exported for its tests; the watcher calls it.
 */
export function describe(seq: number, signature: string, parsed: ParsedTransaction, mint: string, baseUnitsPerCent: bigint, heardAt = Date.now()): ChainTransaction {
  const { meta } = parsed;
  const keys = parsed.transaction.message.accountKeys;
  const accounts = keys.map((key) => key.pubkey);
  const feePayer = accounts[0] ?? '';
  const top = parsed.transaction.message.instructions;
  const inner = (meta?.innerInstructions ?? []).flatMap((group) => group.instructions);
  const all = [...top, ...inner];

  const instructions: Instruction[] = top.map((instruction) => ({
    program: instruction.program ?? instruction.programId,
    ...(typeof instruction.parsed === 'object' && instruction.parsed?.type ? { type: instruction.parsed.type } : {}),
    ...(typeof instruction.parsed === 'object' && instruction.parsed?.info ? { info: instruction.parsed.info as Json } : typeof instruction.parsed === 'string' ? { info: instruction.parsed } : {}),
  }));

  // Who the dollars left and reached: the owners whose balances of the mint
  // fell and rose, net of everything in the transaction, as the SDK reads a
  // charge. Token accounts stand for their owners.
  const owners = new Map<string, bigint>();
  const tokenAccountOwners = new Map<number, string>();
  const add = (balances: NonNullable<ParsedTransaction['meta']>['preTokenBalances'], sign: bigint) => {
    for (const balance of balances ?? []) {
      if (balance.mint !== mint || !balance.owner) continue;
      tokenAccountOwners.set(balance.accountIndex, balance.owner);
      owners.set(balance.owner, (owners.get(balance.owner) ?? 0n) + sign * BigInt(balance.uiTokenAmount.amount));
    }
  };
  add(meta?.preTokenBalances, -1n);
  add(meta?.postTokenBalances, 1n);
  const payers = [...owners].filter(([, delta]) => delta < 0n);
  const payees = [...owners].filter(([, delta]) => delta > 0n);

  const memoInstruction = all.find((instruction) => instruction.program === 'spl-memo' && typeof instruction.parsed === 'string');
  const memo = memoInstruction && typeof memoInstruction.parsed === 'string' ? memoInstruction.parsed : undefined;

  // A transfer that failed moved nothing, so the balances say nothing; the
  // instruction itself still says what was meant.
  const meant = all.find((instruction) => TOKEN_PROGRAMS.has(instruction.program ?? '') && typeof instruction.parsed === 'object' && /^transfer/.test(instruction.parsed?.type ?? ''));
  const meantInfo = meant && typeof meant.parsed === 'object' ? (meant.parsed?.info ?? {}) : {};
  const meantAmount = typeof meantInfo.tokenAmount === 'object' && meantInfo.tokenAmount !== null ? (meantInfo.tokenAmount as { amount?: string }).amount : typeof meantInfo.amount === 'string' ? meantInfo.amount : undefined;
  const meantMint = typeof meantInfo.mint === 'string' ? meantInfo.mint : undefined;

  const minted = all.find((instruction) => TOKEN_PROGRAMS.has(instruction.program ?? '') && typeof instruction.parsed === 'object' && /^mintTo/.test(instruction.parsed?.type ?? ''));

  let kind: TransactionKind = 'other';
  let from: string | undefined;
  let to: string | undefined;
  let recipients: { to: string; amountCents: number }[] | undefined;
  let amountCents: number | undefined;
  if (minted && payers.length === 0 && payees.length === 1) {
    kind = 'mint';
    to = payees[0]![0];
    amountCents = Number(payees[0]![1] / baseUnitsPerCent);
  } else if (payers.length === 1 && payees.length >= 1) {
    kind = 'transfer';
    from = payers[0]![0];
    if (payees.length === 1) to = payees[0]![0];
    else recipients = payees.map(([owner, delta]) => ({ to: owner, amountCents: Number(delta / baseUnitsPerCent) }));
    amountCents = Number(-payers[0]![1] / baseUnitsPerCent);
  } else if (meant && (meantMint === undefined || meantMint === mint) && meantAmount !== undefined) {
    kind = 'transfer';
    from = typeof meantInfo.authority === 'string' ? meantInfo.authority : undefined;
    amountCents = Number(BigInt(meantAmount) / baseUnitsPerCent);
  } else if (meant || [...owners.keys()].length > 0 || (meta?.preTokenBalances ?? []).length > 0 || (meta?.postTokenBalances ?? []).length > 0) {
    // Some other token moved: not the dollar's business, but not nothing.
    kind = 'other';
  } else if (all.some((instruction) => instruction.program === 'system' && typeof instruction.parsed === 'object' && instruction.parsed?.type === 'transfer') || accounts.includes(SYSTEM_PROGRAM) && all.every((instruction) => instruction.program === 'system')) {
    kind = 'fees';
  } else if (all.some((instruction) => instruction.program === 'spl-associated-token-account')) {
    kind = 'account';
  }

  // The reference: an account the transfer names that plays no other part. It
  // is read-only, signs nothing, and is neither a program, the mint, a token
  // account, nor an owner.
  let reference: string | undefined;
  if (kind === 'transfer') {
    const programs = new Set(all.map((instruction) => instruction.programId));
    const tokenAccounts = new Set([...tokenAccountOwners.keys()].map((index) => accounts[index]).filter((account): account is string => account !== undefined));
    const spoken = new Set<string>([mint, ...owners.keys(), ...tokenAccounts, ...programs, ...KNOWN_PROGRAMS, feePayer]);
    for (const value of Object.values(meantInfo)) if (typeof value === 'string') spoken.add(value);
    const spare = keys.filter((key) => !key.signer && !key.writable && !spoken.has(key.pubkey));
    if (spare.length === 1) reference = spare[0]!.pubkey;
  }

  const failed = meta?.err != null;
  const reason = failed ? (meta?.logMessages ?? []).map((line) => /Error: (.*)$/.exec(line)?.[1]).find((found): found is string => typeof found === 'string') : undefined;

  return {
    seq,
    signature,
    slot: parsed.slot,
    at: heardAt,
    ok: !failed,
    ...(failed ? { error: reason ?? JSON.stringify(meta?.err) } : {}),
    kind,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(recipients ? { recipients } : {}),
    ...(amountCents !== undefined ? { amountCents } : {}),
    ...(memo ? { memo } : {}),
    ...(reference ? { reference } : {}),
    feePayer,
    fee: meta?.fee ?? 0,
    instructions,
    accounts,
  };
}

export interface WatcherOptions {
  rpc: string;
  /** The websocket the node's subscriptions are on; the port after the RPC's, for surfpool. */
  ws?: string;
  mint: string;
  baseUnitsPerCent: bigint;
  /** Where a problem is said; nowhere unless given. */
  log?: (line: string) => void;
}

/** Hears every transaction the local chain processes, and keeps the last few hundred. */
export class Watcher {
  private readonly rows: ChainTransaction[] = [];
  private readonly seen = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private seq = 0;
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnect: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: WatcherOptions) {}

  /** Opens the subscription, and reopens it whenever it drops. */
  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnect) clearTimeout(this.reconnect);
    this.socket?.close();
    this.socket = null;
  }

  /** The rows after `after`, oldest first. */
  list(after = 0): ChainTransaction[] {
    return this.rows.filter((row) => row.seq > after);
  }

  /** Runs `onChange` each time a row is added. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private connect(): void {
    if (this.stopped) return;
    if (typeof WebSocket === 'undefined') {
      this.options.log?.('this Node has no WebSocket, so the chain is not watched. The CLI needs Node 22 or later.');
      return;
    }
    const url = this.options.ws ?? wsOf(this.options.rpc);
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      this.options.log?.(`the chain's websocket could not be opened: ${error instanceof Error ? error.message : String(error)}`);
      this.later();
      return;
    }
    this.socket = socket;
    socket.onopen = () => socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: ['all', { commitment: 'confirmed' }] }));
    socket.onmessage = (event) => {
      let message: unknown;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!isRecord(message) || message.method !== 'logsNotification' || !isRecord(message.params)) return;
      const result = isRecord(message.params.result) ? message.params.result : null;
      const value = result && isRecord(result.value) ? result.value : null;
      if (value && typeof value.signature === 'string') void this.heard(value.signature);
    };
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      this.later();
    };
    socket.onerror = () => {
      // onclose follows, and reopens.
    };
  }

  private later(): void {
    if (this.stopped || this.reconnect) return;
    this.reconnect = setTimeout(() => {
      this.reconnect = null;
      this.connect();
    }, RECONNECT_MS);
    this.reconnect.unref?.();
  }

  /** A transaction the node just processed: read back, described, kept. */
  async heard(signature: string): Promise<void> {
    if (this.seen.has(signature)) return;
    this.seen.add(signature);
    for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt++) {
      const parsed = await this.read(signature);
      if (parsed) {
        this.add(describe(++this.seq, signature, parsed, this.options.mint, this.options.baseUnitsPerCent));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, READ_AGAIN_MS));
    }
    this.options.log?.(`the chain never returned transaction ${signature}`);
  }

  private add(row: ChainTransaction): void {
    this.rows.push(row);
    if (this.rows.length > KEPT) this.rows.splice(0, this.rows.length - KEPT);
    this.listeners.forEach((listener) => listener());
  }

  private async read(signature: string): Promise<ParsedTransaction | null> {
    try {
      const response = await fetch(this.options.rpc, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { commitment: 'confirmed', encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }] }),
        signal: AbortSignal.timeout(5_000),
      });
      const body = (await response.json()) as { result?: ParsedTransaction | null };
      return body.result ?? null;
    } catch {
      return null;
    }
  }
}

/** surfpool's websocket is on the port after its RPC's. */
export function wsOf(rpc: string): string {
  const url = new URL(rpc);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.port = String(Number(url.port || (url.protocol === 'wss:' ? 443 : 80)) + 1);
  return url.toString().replace(/\/$/, '');
}
