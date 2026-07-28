// `bankroll token` — the app's own tokens.
//
// A token you make yourself, hand out for free, and accept as payment: promo
// credit, or funds for exercising the money loop without spending real money. It
// is worth nothing outside your app — that is the point. Bankroll shows it as
// your app's funds, and a charge settles in it only because your manifest
// declares it.
//
// Two on-chain operations, which are the only two a mint authority has: create a
// token, and issue supply of one. Moving tokens that already exist belongs to
// `bankroll treasury send` — that is a wallet spending what it holds, and doing
// it here would quietly spend the supply the app needs to pay users back.
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

import { addAppToken, APP_TOKENS_FILE, readAppTokens } from './appTokens';
import { ask } from './prompt';
import { open, requireSol, type CommonOptions } from './solana';
import {
  associatedTokenAddress,
  BASE_UNITS_PER_TOKEN,
  createAtaIdempotent,
  DECIMALS,
  initializeMint2,
  MINT_ACCOUNT_BYTES,
  mintTo,
  TOKEN_PROGRAM_ID,
} from './spl';

// Creating pays one-time, refundable rent for a mint account and a token
// account. Issuing more creates neither, so it needs only fees.
const SOL_TO_CREATE = 0.01;
const SOL_TO_MINT = 0.003;

const DEFAULT_SUPPLY = 1_000_000n;

export interface CreateOptions extends CommonOptions {
  name?: string;
  description?: string;
  supply?: string;
}

export interface MintOptions extends CommonOptions {
  supply?: string;
}

/** What this app declares, straight from the file the manifest is built from. */
export function list(): void {
  const tokens = readAppTokens();
  const mints = Object.keys(tokens);

  if (mints.length === 0) {
    console.log(`\n  No tokens in ${APP_TOKENS_FILE}. Create one with \`bankroll token create\`.\n`);
    return;
  }

  console.log(`\n  ${mints.length} token${mints.length === 1 ? '' : 's'} in ${APP_TOKENS_FILE}\n`);
  for (const mint of mints) {
    const token = tokens[mint];
    console.log(`    ${mint}`);
    if (token?.name) console.log(`      name         ${token.name}`);
    if (token?.description) console.log(`      description  ${token.description}`);
  }
  console.log('');
}

/**
 * Create a token and record it.
 *
 * The shape is fixed because the host refuses anything else: 9 decimals, one
 * token to the dollar, no freeze authority. The signing key becomes the mint
 * authority and holds the supply, because it needs the supply to pay users back.
 */
export async function create(options: CreateOptions): Promise<void> {
  const name = await ask(options.name, 'Token name', { required: true });
  const description = await ask(options.description, 'Description (optional)');

  const supply = BigInt(options.supply ?? DEFAULT_SUPPLY);
  if (supply <= 0n) throw new Error('--supply must be greater than zero');

  const wallet = open(options);
  await requireSol(wallet, SOL_TO_CREATE);

  const authority = wallet.keypair;
  const mint = Keypair.generate();
  const account = associatedTokenAddress(mint.publicKey, authority.publicKey);
  const { blockhash, lastValidBlockHeight } = await wallet.connection.getLatestBlockhash();

  // One transaction: create the mint, initialize it, open the account, and mint
  // the supply into it. Either the token exists complete or nothing happened.
  const transaction = new Transaction({
    feePayer: authority.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: await wallet.connection.getMinimumBalanceForRentExemption(MINT_ACCOUNT_BYTES),
      space: MINT_ACCOUNT_BYTES,
      programId: TOKEN_PROGRAM_ID,
    }),
    initializeMint2(mint.publicKey, DECIMALS, authority.publicKey),
    createAtaIdempotent(authority.publicKey, account, authority.publicKey, mint.publicKey),
    mintTo(mint.publicKey, account, authority.publicKey, supply * BASE_UNITS_PER_TOKEN),
  );
  transaction.sign(authority, mint);

  const signature = await wallet.connection.sendRawTransaction(transaction.serialize());
  await wallet.connection.confirmTransaction(
    { blockhash, lastValidBlockHeight, signature },
    'confirmed',
  );

  const address = mint.publicKey.toBase58();
  // Recorded only after it exists on-chain, so the file never names a token that
  // was never made.
  addAppToken(address, { ...(name ? { name } : {}), ...(description ? { description } : {}) });

  console.log(`
  Created ${name}

    mint       ${address}
    supply     ${supply.toLocaleString()}
    authority  ${wallet.signer.address}
    decimals   ${DECIMALS}
    signature  ${signature}

  Added to ${APP_TOKENS_FILE}. Your manifest declares it on the next request,
  which is what lets a charge settle in it.
`);
}

/**
 * Issue more of a token this key controls.
 *
 * Fresh supply, not a transfer: the point of holding the authority is that you
 * never have to spend what you are keeping to pay users back.
 */
export async function mint(address: string, options: MintOptions): Promise<void> {
  const amount = BigInt(options.supply ?? DEFAULT_SUPPLY);
  if (amount <= 0n) throw new Error('--supply must be greater than zero');

  const wallet = open(options);
  await requireSol(wallet, SOL_TO_MINT);

  const authority = wallet.keypair;
  const mintKey = new PublicKey(address);

  // Both failures are easy to hit and useless as raw RPC errors: a typo in the
  // address, or a token somebody else controls.
  const info = await wallet.connection.getParsedAccountInfo(mintKey);
  const parsed = (info.value?.data as { parsed?: { info?: { mintAuthority?: string } } } | undefined)
    ?.parsed?.info;
  if (!parsed) throw new Error(`${address} is not an SPL token mint.`);
  if (parsed.mintAuthority !== wallet.signer.address) {
    throw new Error(
      `This key cannot mint ${address}.\n\n` +
        `    your key        ${wallet.signer.address}\n` +
        `    mint authority  ${parsed.mintAuthority ?? 'none — the supply is frozen forever'}`,
    );
  }

  const account = associatedTokenAddress(mintKey, authority.publicKey);
  const { blockhash, lastValidBlockHeight } = await wallet.connection.getLatestBlockhash();
  const transaction = new Transaction({
    feePayer: authority.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    createAtaIdempotent(authority.publicKey, account, authority.publicKey, mintKey),
    mintTo(mintKey, account, authority.publicKey, amount * BASE_UNITS_PER_TOKEN),
  );
  transaction.sign(authority);

  const signature = await wallet.connection.sendRawTransaction(transaction.serialize());
  await wallet.connection.confirmTransaction(
    { blockhash, lastValidBlockHeight, signature },
    'confirmed',
  );

  const balance = await wallet.connection.getTokenAccountBalance(account);
  console.log(`
  Minted ${amount.toLocaleString()} more

    mint       ${address}
    holding    ${balance.value.uiAmountString} tokens
    signature  ${signature}
`);
}
