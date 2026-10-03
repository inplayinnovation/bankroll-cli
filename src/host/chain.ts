// The local chain: surfpool on this computer, started fresh for one run of the
// simulator and stopped with it.
//
// surfpool is a Solana network of one node that stands in for mainnet: an
// account it does not have, it fetches from mainnet the first time something
// asks, so the Bankroll dollar exists here at its real address with no setup.
// And it takes orders no real node would: a wallet's balance can simply be
// set. That is how a pretend person comes to hold fake dollars, and all that
// "fake" means: the dollar is the real token, on a chain that is ours alone.
//
// Nothing here is valid anywhere else. A payment made on this chain is not on
// mainnet, and a key made for it holds nothing there.
import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { delimiter, join } from 'node:path';

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TokenAccountNotFoundError,
  TokenInvalidAccountOwnerError,
} from '@solana/spl-token';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';

import { SIMULATOR_DIR } from './people';

/** The Bankroll dollar's mint on mainnet (HSUSD; the SDK's HSUSD_MINT in a live environment). */
export const DOLLAR_MINT = '4FVaHEubcqws8hKwJSiW8f8CmKGUyMsBxTKUytcGdRvd';
export const DOLLAR_DECIMALS = 9;
/** Base units in one cent: the dollar has nine decimals. */
export const BASE_UNITS_PER_CENT = 10n ** BigInt(DOLLAR_DECIMALS - 2);
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

/** Where surfpool listens unless the port is taken. */
export const CHAIN_PORT = 8899;
const PORT_ATTEMPTS = 10;
// How long the node gets to answer its first request.
const START_TIMEOUT_MS = 30_000;
const ASK_EVERY_MS = 250;
// How long surfpool gets to stop on its own before it is killed.
const KILL_AFTER_MS = 2_000;
// What the sponsor and the treasury get to pay network fees with.
const FEE_SOL = 10;

export interface Chain {
  /** The node's address, for the app's server and for this host. */
  rpc: string;
  stop(): void;
}

/** The surfpool program on this computer, or null when there is none to find. */
export function findSurfpool(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'surfpool');
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here.
    }
  }
  return null;
}

async function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

/** A port for the chain, and the one after it: surfpool takes both. */
export async function freeChainPort(start: number): Promise<number> {
  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt++) {
    const port = start + attempt * 2;
    // surfpool takes two ports: the node's, and the one after it for websockets.
    if ((await portFree(port)) && (await portFree(port + 1))) return port;
  }
  throw new Error(`No free pair of ports for the local chain from ${start} to ${start + PORT_ATTEMPTS * 2}.`);
}

/** One JSON-RPC call to the node, surfpool's own included. */
export async function rpc<T>(url: string, method: string, params: unknown[] = [], timeoutMs = 10_000): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await response.json()) as { result?: T; error?: { code: number; message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message} (${body.error.code})`);
  return body.result as T;
}

async function answering(url: string): Promise<boolean> {
  try {
    await rpc(url, 'getVersion', [], 1_000);
    return true;
  } catch {
    return false;
  }
}

export interface StartOptions {
  surfpool?: string;
  port?: number;
  /** Where the node's own output goes; nowhere unless given. */
  log?: (line: string) => void;
}

/**
 * Starts a fresh surfpool and resolves once it answers. It is killed with the
 * process that started it, so a run never leaves a node behind.
 */
export async function startChain(options: StartOptions = {}): Promise<Chain> {
  const program = options.surfpool ?? findSurfpool();
  if (!program) throw new Error('surfpool is not installed on this computer.');
  // A port given is one the caller found free; otherwise find one.
  const port = options.port ?? (await freeChainPort(CHAIN_PORT));
  const rpcUrl = `http://127.0.0.1:${port}`;
  // surfpool writes its logs under .surfpool/ in the folder it runs in. That
  // is the simulator's own folder, not the app's, which it would otherwise
  // leave a stray folder in.
  mkdirSync(SIMULATOR_DIR, { recursive: true });
  const child: ChildProcess = spawn(program, ['start', '--no-tui', '--no-studio', '--no-deploy', '-y', '-p', String(port), '-w', String(port + 1)], {
    cwd: SIMULATOR_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const say = options.log ?? (() => {});
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) if (line.trim()) say(line);
    });
  }
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });
  // surfpool stops on an interrupt, as from Ctrl-C, and not on a plain
  // termination signal; a node still there a moment later is killed outright.
  const stop = () => {
    if (exited) return;
    child.kill('SIGINT');
    setTimeout(() => {
      if (!exited) child.kill('SIGKILL');
    }, KILL_AFTER_MS).unref();
  };
  // At exit there is no moment to wait: a node still running is killed outright.
  process.on('exit', () => {
    if (!exited) child.kill('SIGKILL');
  });

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`surfpool stopped before it answered (exit code ${child.exitCode}).`);
    if (await answering(rpcUrl)) return { rpc: rpcUrl, stop };
    await new Promise((resolve) => setTimeout(resolve, ASK_EVERY_MS));
  }
  stop();
  throw new Error(`surfpool did not answer on port ${port} within ${START_TIMEOUT_MS / 1000} seconds.`);
}

/**
 * The chain as this host uses it: fake dollars set outright, network fees paid
 * by a sponsor, and payments built the way the phone builds them.
 */
export class Ledger {
  readonly connection: Connection;
  /** Pays every payment's network fee, as Bankroll does on a phone. */
  readonly sponsor = Keypair.generate();
  private readonly mint = new PublicKey(DOLLAR_MINT);

  constructor(readonly rpc: string) {
    this.connection = new Connection(rpc, 'confirmed');
  }

  /** Gives the sponsor what it needs, and makes sure the dollar is here. */
  async prepare(): Promise<void> {
    await this.airdrop(this.sponsor.publicKey);
    // Asking for the mint is what brings it over from mainnet.
    const mint = await this.connection.getAccountInfo(this.mint);
    if (!mint) throw new Error(`the local chain has no account for the dollar (${DOLLAR_MINT}): is this computer online?`);
  }

  /** Enough SOL for a run of fees. */
  async airdrop(address: PublicKey): Promise<void> {
    const signature = await this.connection.requestAirdrop(address, FEE_SOL * LAMPORTS_PER_SOL);
    await this.connection.confirmTransaction(signature, 'confirmed');
  }

  /** Sets what a wallet holds, in cents. */
  async setDollars(owner: string, cents: number): Promise<void> {
    const amount = BigInt(cents) * BASE_UNITS_PER_CENT;
    await rpc(this.rpc, 'surfnet_setTokenAccount', [owner, DOLLAR_MINT, { amount: Number(amount) }]);
  }

  /** What a wallet holds, in whole cents; a wallet with no dollar account holds none. */
  async dollarsOf(owner: string): Promise<number> {
    const account = getAssociatedTokenAddressSync(this.mint, new PublicKey(owner));
    try {
      const { amount } = await getAccount(this.connection, account, 'confirmed');
      return Number(amount / BASE_UNITS_PER_CENT);
    } catch (error) {
      if (error instanceof TokenAccountNotFoundError || error instanceof TokenInvalidAccountOwnerError) return 0;
      throw error;
    }
  }

  /**
   * A payment, as the phone makes one: a transfer of the dollar from the payer
   * to the payee, the fee on the sponsor, the reference riding the transfer as
   * a read-only account, and the memo after it. Resolves with the signature
   * once the chain has confirmed it.
   */
  async pay(input: { payerSecretKey: string; payee: string; amountCents: number; reference?: string; memo?: string }): Promise<string> {
    const payer = Keypair.fromSecretKey(bs58.decode(input.payerSecretKey));
    const payee = new PublicKey(input.payee);
    const from = getAssociatedTokenAddressSync(this.mint, payer.publicKey);
    const to = getAssociatedTokenAddressSync(this.mint, payee);
    const transfer = createTransferCheckedInstruction(from, this.mint, to, payer.publicKey, BigInt(input.amountCents) * BASE_UNITS_PER_CENT, DOLLAR_DECIMALS);
    if (input.reference) transfer.keys.push({ pubkey: new PublicKey(input.reference), isSigner: false, isWritable: false });
    const transaction = new Transaction().add(createAssociatedTokenAccountIdempotentInstruction(this.sponsor.publicKey, to, payee, this.mint), transfer);
    if (input.memo) transaction.add(new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(input.memo, 'utf8') }));
    transaction.feePayer = this.sponsor.publicKey;
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.sign(this.sponsor, payer);
    const signature = await this.connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
    const confirmed = await this.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    if (confirmed.value.err) throw new Error(`the payment failed on the chain: ${JSON.stringify(confirmed.value.err)}`);
    return signature;
  }
}
