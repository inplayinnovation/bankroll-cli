// bankroll — command-line tools for Built for Bankroll apps.
//
// `dev` is local: the only credential involved is a signing key on this
// machine, and it never leaves it. `login` is separate: it keeps a Bankroll
// account session on this machine for the commands that act on your account
// and your apps.
import { Argument, Command, Option } from 'commander';

// Replaced at build time with this package's version — see tsup.config.ts.
declare const __VERSION__: string;

import * as apps from './apps';
import { faucet } from './faucet';
import { DEFAULT_KEYPAIR_PATH } from './keypair';
import { login, logout, whoami } from './login';
import * as repo from './repo';
import { TARGETS, wait } from './wait';

// `dev` loads the tunnel library, which is slow to start. It is imported
// when it runs, so the account commands and the git credential helper never
// pay for it.
const lazy = { dev: () => import('./dev') };

const KEYPAIR_HELP = `signing key to use (default: ${DEFAULT_KEYPAIR_PATH}, created on first use)`;

const program = new Command();

program
  .name('bankroll')
  .description('Command-line tools for Built for Bankroll apps')
  .version(__VERSION__)
  // A wrong command should show what the right ones are. Without this the whole
  // reply is "unknown command", which is true and useless.
  .showHelpAfterError()
  .showSuggestionAfterError()
  .option('-e, --env <name>', 'a Bankroll api other than production, from ~/.config/bankroll/environments.json');

program
  .command('dev')
  .description('Run the dev server and open the app in the simulator: a phone on this computer, shown to a pretend user, paying fake dollars')
  .option('-p, --port <port>', 'port to use (default: any free one)')
  .option('--phone', 'open the app on your phone instead: a public tunnel and a QR, your signing key, real money')
  .option('-k, --keypair <path>', `with --phone, the ${KEYPAIR_HELP}`)
  .option('--no-open', 'print the simulator\'s link and leave the browser alone')
  // The flag the simulator had while the phone was the default: still taken, so an older `npm run dev -- --simulator` keeps working.
  .addOption(new Option('--simulator', 'the default; kept for scripts that pass it').hideHelp())
  .action(async (options) => {
    const { dev } = await lazy.dev();
    await dev({ ...program.opts(), ...options }, __VERSION__);
  });

program
  .command('login')
  .description('Log in to your Bankroll account from this computer')
  .option('--allow-file-session', 'keep the login in a plain file if the credential store cannot be used')
  .action(async (options) => {
    await login({ ...program.opts(), ...options });
  });

program
  .command('logout')
  .description('Forget the login on this computer')
  .action(() => {
    logout(program.opts());
  });

program
  .command('whoami')
  .description('Who this computer is logged in as')
  .action(async () => {
    await whoami(program.opts());
  });

// Git is the interface to an app's versions: `git push bankroll main` builds
// the test version, `git push bankroll main:live` publishes it. These two
// observe and supply; neither wraps a git command.
program
  .command('wait')
  .addArgument(new Argument('<version>', 'which version to wait for').choices([...TARGETS]))
  .option('--app <id>', 'the app, by its id from the list (default: the clone this runs in)')
  .description("Watch the build a push started, then print where that version is")
  .action(async (version, options) => {
    await wait(version, { ...program.opts(), ...options });
  });

program
  .command('faucet')
  .description('Send yourself test cash: what a test version takes instead of real money')
  .action(async () => {
    await faucet(program.opts());
  });

const builtApps = program.command('apps').description('The apps you built with Bankroll');

builtApps
  .command('list', { isDefault: true })
  .description('List your apps, newest first; archived ones are left out')
  .option('--archived', 'only archived apps')
  .option('--all', 'archived apps too')
  .action(async (options) => {
    await apps.list({ ...program.opts(), ...options });
  });

builtApps
  .command('create')
  .argument('[name]', "the app's name: written into the clone, and what the clone's directory is called")
  .option('--no-clone', "leave the app's repo on Bankroll instead of cloning it here")
  .option('--no-install', 'clone, but leave `npm install` to you')
  .description('A new app from the starter, cloned here with its dependencies installed: `cd` in and `npm run dev`')
  .action(async (name, options) => {
    await apps.create(name, { ...program.opts(), noClone: options.clone === false, noInstall: options.install === false });
  });

builtApps
  .command('clone')
  .argument('<id>', 'the app, by its id from the list')
  .argument('[directory]', 'where to put it (default: the repo name)')
  .description("Clone the app's repo, with the remote named bankroll")
  .action(async (id, directory) => {
    await repo.clone(id, directory, program.opts());
  });

builtApps
  .command('archive')
  .argument('<id>', 'the app, by its id from the list')
  .description('Take an app off the air; its code, data, and wallet stay')
  .action(async (id) => {
    await apps.archive(id, program.opts());
  });

builtApps
  .command('unarchive')
  .argument('<id>', 'the app, by its id from the list')
  .description('Put an archived app back on the air, same version')
  .action(async (id) => {
    await apps.unarchive(id, program.opts());
  });

// Git runs this one; a person never types it. See src/repo.ts.
program
  .command(repo.CREDENTIAL_COMMAND, { hidden: true })
  .argument('<id>')
  .argument('<action>')
  .action(async (id, action) => {
    await repo.gitCredential(id, action, program.opts());
  });

// A thrown error is a real failure, and its message is the whole message — no
// stack trace in a developer's terminal for "you have no SOL".
try {
  await program.parseAsync(process.argv);
} catch (error) {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
