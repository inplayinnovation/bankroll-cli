// `bankroll treasury` — the wallet your app runs on.
//
// It receives every charge, signs every payout, and pays its own network fees.
// So it holds three kinds of thing, and all three run out for different reasons:
// SOL for fees, HSUSD for real-money payouts, and whatever app tokens you issue.
//
// There is no `fund` command. SOL and HSUSD arrive from an exchange or another
// wallet, which is not something a CLI can do — all it can do is tell you the
// address, which is the first line of the output below.
import { PublicKey, Transaction } from '@solana/web3.js';

import { readAppTokens } from './appTokens';
import { HSUSD_MINT, LAMPORTS_PER_SOL, open, requireSol, type CommonOptions } from './solana';
import {
  associatedTokenAddress,
  BASE_UNITS_PER_TOKEN,
  createAtaIdempotent,
  DECIMALS,
  transferChecked,
} from './spl';

// A transfer pays fees, and opening a token account for a recipient who has
// none pays one-time, refundable rent.
const SOL_TO_SEND = 0.003;

export interface SendOptions extends CommonOptions {
  amount?: string;
  token?: string;
}

async function balanceOf(
  wallet: ReturnType<typeof open>,
  mint: string,
): Promise<string | null> {
  const account = associatedTokenAddress(new PublicKey(mint), wallet.keypair.publicKey);
  try {
    const balance = await wallet.connection.getTokenAccountBalance(account);
    return balance.value.uiAmountString ?? '0';
  } catch {
    // No account for this mint is a zero balance, not a failure.
    return null;
  }
}

/** The address and everything it holds. */
export async function show(options: CommonOptions): Promise<void> {
  const wallet = open(options);
  const lamports = await wallet.connection.getBalance(wallet.keypair.publicKey);

  console.log(`\n  ${wallet.signer.address}\n`);
  console.log(`    SOL      ${(lamports / LAMPORTS_PER_SOL).toFixed(6)}   (network fees)`);

  const hsusd = await balanceOf(wallet, HSUSD_MINT);
  console.log(`    HSUSD    ${hsusd ?? '0'}   (real money — what payouts spend)`);

  const tokens = readAppTokens();
  for (const [mint, token] of Object.entries(tokens)) {
    const held = await balanceOf(wallet, mint);
    const label = token.name ?? mint;
    console.log(`    ${label}   ${held ?? '0'}`);
  }

  console.log(`\n  Key: ${wallet.signer.path}\n`);
}

/**
 * Send something this wallet holds to an address.
 *
 * HSUSD by default — taking revenue out of the treasury is the common case.
 * `--token <mint>` sends one of your own tokens instead, which is how you fund a
 * wallet for testing.
 */
export async function send(recipient: string, options: SendOptions): Promise<void> {
  const amount = BigInt(options.amount ?? '0');
  if (amount <= 0n) throw new Error('--amount is required and must be greater than zero');

  const mint = options.token ?? HSUSD_MINT;
  const wallet = open(options);
  await requireSol(wallet, SOL_TO_SEND);

  const owner = new PublicKey(recipient);
  const mintKey = new PublicKey(mint);
  const from = associatedTokenAddress(mintKey, wallet.keypair.publicKey);
  const to = associatedTokenAddress(mintKey, owner);

  const { blockhash, lastValidBlockHeight } = await wallet.connection.getLatestBlockhash();
  const transaction = new Transaction({
    feePayer: wallet.keypair.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(
    createAtaIdempotent(wallet.keypair.publicKey, to, owner, mintKey),
    transferChecked(
      from,
      mintKey,
      to,
      wallet.keypair.publicKey,
      amount * BASE_UNITS_PER_TOKEN,
      DECIMALS,
    ),
  );
  transaction.sign(wallet.keypair);

  const signature = await wallet.connection.sendRawTransaction(transaction.serialize());
  await wallet.connection.confirmTransaction(
    { blockhash, lastValidBlockHeight, signature },
    'confirmed',
  );

  console.log(`
  Sent ${amount.toLocaleString()}

    to         ${recipient}
    mint       ${mint}${mint === HSUSD_MINT ? '   (HSUSD)' : ''}
    signature  ${signature}
`);
}
