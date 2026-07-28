// The three SPL Token instructions this CLI needs, encoded here rather than
// pulled from @solana/spl-token, which carries an unfixable advisory. They are
// small and the layouts are stable.
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);

/** A mint account is a fixed 82 bytes. */
export const MINT_ACCOUNT_BYTES = 82;

/**
 * The only shape charges settle in: 9 decimals, one token to the dollar. The
 * host refuses any other scale before it signs, so this is not a preference.
 */
export const DECIMALS = 9;
export const BASE_UNITS_PER_TOKEN = 10n ** BigInt(DECIMALS);

const IX_INITIALIZE_MINT_2 = 20;
const IX_MINT_TO = 7;
const IX_TRANSFER_CHECKED = 12;
const IX_ATA_CREATE_IDEMPOTENT = 1;

const NO_FREEZE_AUTHORITY = 0;

const u64 = (value: bigint): Buffer => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(value);
  return buffer;
};

/**
 * InitializeMint2 — like InitializeMint but without the rent sysvar account.
 *
 * No freeze authority: freezing your own users' balances is a footgun, and a
 * token nobody can freeze is easier to reason about.
 */
export const initializeMint2 = (mint: PublicKey, decimals: number, mintAuthority: PublicKey) =>
  new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
    data: Buffer.concat([
      Buffer.from([IX_INITIALIZE_MINT_2, decimals]),
      mintAuthority.toBuffer(),
      Buffer.from([NO_FREEZE_AUTHORITY]),
    ]),
  });

export const associatedTokenAddress = (mint: PublicKey, owner: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];

/**
 * Idempotent: succeeds whether or not the account already exists, so re-running
 * never fails on an account a previous run made.
 */
export const createAtaIdempotent = (
  payer: PublicKey,
  ata: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
) =>
  new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([IX_ATA_CREATE_IDEMPOTENT]),
  });

export const mintTo = (
  mint: PublicKey,
  destination: PublicKey,
  authority: PublicKey,
  amount: bigint,
) =>
  new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([IX_MINT_TO]), u64(amount)]),
  });

/**
 * transferChecked rather than transfer: the mint and decimals are verified
 * on-chain, so a wrong scale fails the transfer instead of moving the wrong
 * amount.
 */
export const transferChecked = (
  source: PublicKey,
  mint: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint,
  decimals: number,
) =>
  new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.concat([Buffer.from([IX_TRANSFER_CHECKED]), u64(amount), Buffer.from([decimals])]),
  });
