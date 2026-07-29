// bankroll — command-line tools for Built for Bankroll apps.
//
// Grouped by what they act on rather than by verb: `token` for what a mint
// authority does, `treasury` for what a wallet does. Nothing is left implied —
// `token mint` issues new supply, `treasury send` moves what is already held,
// and neither can be mistaken for the other.
//
// Everything here is local or on-chain. There is no account, no API key, and
// nothing to revoke: the only credential involved is a Solana keypair on this
// machine, and it never leaves it.
import { Command } from 'commander';

import { dev } from './dev';
import { DEFAULT_KEYPAIR_PATH } from './keypair';
import * as token from './token';
import * as treasury from './treasury';

const KEYPAIR_HELP = `signing key to use (default: ${DEFAULT_KEYPAIR_PATH}, created on first use)`;
const RPC_HELP = 'Solana RPC endpoint (default: SOLANA_RPC_URL, else the public endpoint)';

const program = new Command();

program
  .name('bankroll')
  .description('Command-line tools for Built for Bankroll apps')
  .version(process.env.npm_package_version ?? '0.1.0')
  // A wrong command should show what the right ones are. Without this the whole
  // reply is "unknown command", which is true and useless.
  .showHelpAfterError()
  .showSuggestionAfterError();

program
  .command('dev')
  .description('Run the dev server behind a public tunnel and print a QR to open it on a phone')
  .option('-p, --port <port>', 'port the dev server listens on', '3000')
  .option('-k, --keypair <path>', KEYPAIR_HELP)
  .action(async (options) => {
    await dev(options);
  });

const tokens = program.command('token').description("The app's own tokens");

tokens
  .command('list', { isDefault: true })
  .description('List the tokens this app declares')
  .action(() => {
    token.list();
  });

tokens
  .command('create')
  .description('Create a token: 9 decimals, whole supply on your signing key')
  .option('--name <name>', 'what Bankroll calls it')
  .option('--description <text>', 'what it is for')
  .option('--supply <amount>', 'how many to mint', '1000000')
  .option('-k, --keypair <path>', KEYPAIR_HELP)
  .option('--rpc <url>', RPC_HELP)
  .action(async (options) => {
    await token.create(options);
  });

tokens
  .command('mint')
  .argument('<mint>', 'a token this key is the mint authority for')
  .description('Issue more supply of a token you control')
  .option('--supply <amount>', 'how many to issue', '1000000')
  .option('-k, --keypair <path>', KEYPAIR_HELP)
  .option('--rpc <url>', RPC_HELP)
  .action(async (mint, options) => {
    await token.mint(mint, options);
  });

const wallet = program.command('treasury').description('The wallet the app runs on');

wallet
  .command('show', { isDefault: true })
  .description('The address, and everything it holds')
  .option('-k, --keypair <path>', KEYPAIR_HELP)
  .option('--rpc <url>', RPC_HELP)
  .action(async (options) => {
    await treasury.show(options);
  });

wallet
  .command('send')
  .argument('<wallet>', 'where to send it')
  .description('Send HSUSD, or one of your tokens, from the treasury')
  .requiredOption('--amount <amount>', 'how much to send')
  .option('--token <mint>', 'send this token instead of HSUSD')
  .option('-k, --keypair <path>', KEYPAIR_HELP)
  .option('--rpc <url>', RPC_HELP)
  .action(async (recipient, options) => {
    await treasury.send(recipient, options);
  });

// A thrown error is a real failure, and its message is the whole message — no
// stack trace in a developer's terminal for "you have no SOL".
try {
  await program.parseAsync(process.argv);
} catch (error) {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
