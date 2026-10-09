# CLAUDE.md

The Bankroll CLI (`bankroll`, npm `@joinbankroll/cli`): what Built for
Bankroll apps carry as a devDependency. `bankroll dev` opens the app in
Bankroll Desktop (the `bankroll` monorepo's `desktop/`); `--phone` runs it
on a phone through a tunnel.

## Words for developers

Everything here is read by developers: the README, the help text, what a
command prints, the skill. Fixed on 2026-10-08, after "a phone on this
computer, shown to a pretend user, paying fake dollars" shipped in 1.0.0:

- **test user**, never "pretend user" or "pretend person".
- **test cash**, never "fake dollars"; say "no real money moves".
- **Bankroll Desktop runs your app on your Mac the way the Bankroll app runs
  it on a phone**, never "a phone on this computer" or "a phone frame".
- Never the mechanism: chain, local chain, ledger, keypair, RPC, surfpool,
  Solana. Developers do not know their apps settle on a chain, by design.
- The canonical sentence is at the top of the monorepo's `docs/build/dev.mdx`;
  shorten it here, never reinvent it. New product wording goes to Gianni
  first, as one line.

Read every line a developer will see as a web developer who has never heard
of Bankroll, before committing it.

## Working here

`npm test`, `npm run typecheck`, `npm run build` (tsup into `dist/`). Commits
are atomic: one change each. Publishing (`npm publish`) is Gianni's: it needs
his 2FA.
