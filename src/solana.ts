// Shared Solana plumbing: the endpoint, the signer, and the two checks every
// on-chain command makes before it spends anything.
import { Connection, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

import { loadSigner, type Signer } from './keypair';

/**
 * Solana's public endpoint — enough to develop against, rate-limited, and the
 * one thing here worth upgrading later.
 */
export const PUBLIC_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** HSUSD — real money, and what a charge settles in unless an app token is named. */
export const HSUSD_MINT = '4FVaHEubcqws8hKwJSiW8f8CmKGUyMsBxTKUytcGdRvd';

export interface CommonOptions {
  keypair?: string;
  rpc?: string;
}

export interface Wallet {
  signer: Signer;
  keypair: Keypair;
  connection: Connection;
}

export function open(options: CommonOptions): Wallet {
  const signer = loadSigner(options.keypair);
  return {
    signer,
    keypair: Keypair.fromSecretKey(bs58.decode(signer.secretKey)),
    connection: new Connection(
      options.rpc || process.env.SOLANA_RPC_URL || PUBLIC_MAINNET_RPC,
      'confirmed',
    ),
  };
}

/**
 * Stop with the address to fund rather than an RPC error.
 *
 * Every on-chain command pays its own fees, and the ones that create accounts
 * pay one-time, refundable rent on top.
 */
export async function requireSol(wallet: Wallet, needed: number): Promise<void> {
  const balance = await wallet.connection.getBalance(wallet.keypair.publicKey);
  if (balance >= needed * LAMPORTS_PER_SOL) return;
  throw new Error(
    `Not enough SOL.\n\n` +
      `    address   ${wallet.signer.address}\n` +
      `    balance   ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n` +
      `    needed    ~${needed} SOL\n\n` +
      `  Send SOL to that address and run this again.`,
  );
}
