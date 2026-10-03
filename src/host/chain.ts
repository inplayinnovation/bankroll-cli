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

/** Where the fake dollars come from: the simulator's bank, set once by the chain's cheat call and transferring from then on. */
export const BANK_CENTS = 1_000_000_000_00;
// A transaction has room for about this many recipients, each an account
// creation and a transfer.
const RECIPIENTS_PER_TRANSACTION = 5;

export interface Recipient {
  wallet: string;
  cents: number;
}

/**
 * The chain as this host uses it. Money starts in one place, the bank, which
 * the chain's cheat call fills once when the chain is fresh; everything after
 * that is a transfer, so every dollar that moves is a transaction the list
 * can show, as it is on a phone. The sponsor pays the network fee of each
 * payment, as Bankroll does.
 */
export class Ledger {
  readonly connection: Connection;
  /** Pays every payment's network fee, as Bankroll does on a phone. */
  readonly sponsor = Keypair.generate();
  /** Where fake dollars come from: funds every user and the treasury, and takes money back. */
  readonly bank = Keypair.generate();
  private readonly mint = new PublicKey(DOLLAR_MINT);

  constructor(readonly rpc: string) {
    this.connection = new Connection(rpc, 'confirmed');
  }

  /** Gives the sponsor and the bank what they need, and makes sure the dollar is here. */
  async prepare(): Promise<void> {
    await Promise.all([this.airdrop(this.sponsor.publicKey), this.airdrop(this.bank.publicKey)]);
    // Asking for the mint is what brings it over from mainnet.
    const mint = await this.connection.getAccountInfo(this.mint);
    if (!mint) throw new Error(`the local chain has no account for the dollar (${DOLLAR_MINT}): is this computer online?`);
    await this.fillBank();
  }

  /** Enough SOL for a run of fees. */
  async airdrop(address: PublicKey): Promise<void> {
    const signature = await this.connection.requestAirdrop(address, FEE_SOL * LAMPORTS_PER_SOL);
    await this.connection.confirmTransaction(signature, 'confirmed');
  }

  /**
   * The one thing no real chain allows: the bank's balance, set outright. A
   * JSON number carries it, and the bank's figure is one a double holds
   * exactly; it is refilled when it runs low rather than set higher.
   */
  private async fillBank(): Promise<void> {
    const amount = BigInt(BANK_CENTS) * BASE_UNITS_PER_CENT;
    await rpc(this.rpc, 'surfnet_setTokenAccount', [this.bank.publicKey.toBase58(), DOLLAR_MINT, { amount: Number(amount) }]);
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
   * Fake dollars for several wallets at once, from the bank, a few recipients
   * to a transaction: how a fresh chain's users and treasury are funded.
   * Resolves with the signatures.
   */
  async fund(recipients: Recipient[]): Promise<string[]> {
    const paid = recipients.filter((recipient) => recipient.cents > 0);
    const signatures: string[] = [];
    for (let i = 0; i < paid.length; i += RECIPIENTS_PER_TRANSACTION) {
      const batch = paid.slice(i, i + RECIPIENTS_PER_TRANSACTION);
      await this.coverFromBank(batch.reduce((sum, recipient) => sum + recipient.cents, 0));
      const transaction = new Transaction();
      for (const recipient of batch) transaction.add(...this.transferFrom(this.bank.publicKey, recipient.wallet, recipient.cents));
      signatures.push(await this.send(transaction, [this.bank], this.bank.publicKey));
    }
    return signatures;
  }

  /** Fake dollars for one wallet, from the bank. */
  async topUp(wallet: string, cents: number): Promise<string> {
    await this.coverFromBank(cents);
    return this.send(new Transaction().add(...this.transferFrom(this.bank.publicKey, wallet, cents)), [this.bank], this.bank.publicKey);
  }

  /**
   * Brings a wallet to a balance: dollars from the bank when it holds less,
   * dollars back to the bank when it holds more, which takes the wallet's
   * key, a pretend user's or the treasury's. Null when nothing moved.
   */
  async setBalance(secretKey: string, cents: number): Promise<string | null> {
    const owner = Keypair.fromSecretKey(bs58.decode(secretKey));
    const held = await this.dollarsOf(owner.publicKey.toBase58());
    if (held === cents) return null;
    if (held < cents) return this.topUp(owner.publicKey.toBase58(), cents - held);
    return this.send(new Transaction().add(...this.transferFrom(owner.publicKey, this.bank.publicKey.toBase58(), held - cents)), [this.sponsor, owner], this.sponsor.publicKey);
  }

  /**
   * A payment, as the phone makes one: a transfer of the dollar from the payer
   * to the payee, the fee on the sponsor, the reference riding the transfer as
   * a read-only account, and the memo after it. Resolves with the signature
   * once the chain has confirmed it.
   */
  async pay(input: { payerSecretKey: string; payee: string; amountCents: number; reference?: string; memo?: string }): Promise<string> {
    const payer = Keypair.fromSecretKey(bs58.decode(input.payerSecretKey));
    const [create, transfer] = this.transferFrom(payer.publicKey, input.payee, input.amountCents);
    if (input.reference) transfer!.keys.push({ pubkey: new PublicKey(input.reference), isSigner: false, isWritable: false });
    const transaction = new Transaction().add(create!, transfer!);
    if (input.memo) transaction.add(new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(input.memo, 'utf8') }));
    try {
      return await this.send(transaction, [this.sponsor, payer], this.sponsor.publicKey);
    } catch (error) {
      throw new Error(`the payment failed on the chain: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // The dollar account made if need be, then the transfer: the two
  // instructions every movement of the dollar is made of.
  private transferFrom(owner: PublicKey, to: string, cents: number): TransactionInstruction[] {
    const recipient = new PublicKey(to);
    const source = getAssociatedTokenAddressSync(this.mint, owner);
    const destination = getAssociatedTokenAddressSync(this.mint, recipient);
    const payer = owner.equals(this.bank.publicKey) ? this.bank.publicKey : this.sponsor.publicKey;
    return [
      createAssociatedTokenAccountIdempotentInstruction(payer, destination, recipient, this.mint),
      createTransferCheckedInstruction(source, this.mint, destination, owner, BigInt(cents) * BASE_UNITS_PER_CENT, DOLLAR_DECIMALS),
    ];
  }

  private async coverFromBank(cents: number): Promise<void> {
    if ((await this.dollarsOf(this.bank.publicKey.toBase58())) < cents) await this.fillBank();
  }

  private async send(transaction: Transaction, signers: Keypair[], feePayer: PublicKey): Promise<string> {
    transaction.feePayer = feePayer;
    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.sign(...signers);
    const signature = await this.connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
    const confirmed = await this.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    if (confirmed.value.err) throw new Error(JSON.stringify(confirmed.value.err));
    return signature;
  }
}
