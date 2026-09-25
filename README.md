# @joinbankroll/cli

Command-line tools for [Built for Bankroll](https://joinbankroll.com/build) apps.

```bash
npm create @joinbankroll/app@latest my-app
cd my-app
npm run bankroll      # tunnel + QR — scan it to open the app inside Bankroll
npm run token         # what this app declares
```

Installed as a devDependency by the scaffolder, so `npm run` finds it. To use it
in any directory, `npm i -g @joinbankroll/cli` — the binary is `bankroll` either
way.

## Commands

```
bankroll login                                  log in to your Bankroll account
bankroll logout                                 forget the login on this computer
bankroll whoami                                 who this computer is logged in as
bankroll apps                                   your apps, archived ones left out
bankroll apps --published                       only the ones listed for everyone
bankroll apps --archived                        only archived; --all for everything
bankroll apps clone <id> [dir]                  the app's repo, remote named bankroll
bankroll apps archive <id>                      off the air; code, data, wallet stay
bankroll apps unarchive <id>                    back on the air
bankroll apps publish <id>                      listed for everyone
bankroll apps unpublish <id>                    unlisted; still playable by link

bankroll dev                                    tunnel + QR, injects your key

bankroll token list                             what this app declares
bankroll token create --name "Acme Credit"      create one, and record it
bankroll token mint <mint> --supply 1000        issue more of one you control

bankroll treasury                               address, SOL, HSUSD, your tokens
bankroll treasury send <wallet> --amount 100    HSUSD, or --token <mint>
```

Grouped by what they act on. `token mint` issues new supply; `treasury send`
moves what is already held. They are different operations and never share a
name.

### `bankroll dev`

Runs your dev server behind a Cloudflare quick tunnel and prints a QR code.

A Bankroll app only runs inside the Bankroll host, and the host refuses any
origin that is not public HTTPS — so localhost cannot be opened however
reachable it is. The tunnel needs no Cloudflare account, and because the phone
reaches the app over the internet rather than the local network, this works on
Wi-Fi that isolates clients from each other.

The QR carries your app's `launch` path, read from the manifest it is serving —
Bankroll loads exactly the URL it is given, so a scan opens your app rather than
whatever sits at the root.

On a TTY the QR is drawn with explicit ANSI colors, dark-on-light, so a dark
terminal cannot invert it. When stdout is **not** a TTY — piped or backgrounded,
which is how coding agents run it — the QR is bare block glyphs instead, safe to
re-print into a chat transcript, where ANSI would be stripped and the colored
form would collapse into a wall of `▀`. Setting `NO_COLOR` forces the bare form
on a TTY too. The full play link is printed under the QR either way.

### `bankroll token`

The two things a mint authority does. The shape is fixed because the host
refuses anything else: 9 decimals, one token to the dollar, no freeze authority.
Your signing key becomes the mint authority and holds the supply, because it
needs the supply to pay users back — which is why `mint` issues fresh supply
rather than moving what you are holding.

`create` is one transaction, so either the token exists complete or nothing
happened, and it records the token only after it exists on-chain. It prompts for
a name and description if you do not pass them, unless there is no terminal — in
which case `--name` is required, so CI fails rather than hangs.

Costs about 0.01 SOL to create and 0.003 to issue more, most of it refundable
account rent.

### `bankroll treasury`

The wallet your app runs on: it receives every charge, signs every payout, and
pays its own fees. So it holds SOL for fees, HSUSD for real-money payouts, and
whatever tokens you issue — and all three run out for different reasons.

There is no `fund` command. SOL and HSUSD arrive from an exchange or another
wallet, which a CLI cannot do; all it can do is show you the address.

`send` moves HSUSD out by default — taking revenue from the treasury is the
common case. `--token <mint>` sends one of your own instead, which is how you
fund a wallet for testing.

## app-tokens.json

The tokens your app issues live in `app-tokens.json` at the project root. The
file **is** the manifest's `appTokens` claim, so nothing transforms it on the
way out:

```json
{
  "Fh2EUwnL52CbeHttBGdW8yHKshvCbVR7pTEa5JYLKxJm": {
    "name": "Acme Credit",
    "description": "Promo credit for Acme."
  }
}
```

A file rather than an environment variable, because an app may issue several
tokens and each carries metadata — neither of which one env var can hold.

## The signing key

Kept at `~/.config/bankroll/keypair.json`, created on first use and never
overwritten. It is a Solana keypair file in the same format `solana-keygen`
writes, so the Solana CLI reads it:

```bash
solana balance --keypair ~/.config/bankroll/keypair.json
```

**Never `~/.config/solana/id.json`** — that is the Solana CLI default and, on
many machines, a developer's actual wallet. This tool puts the key it loads into
a dev server's environment, so it gets its own: the blast radius is bounded, and
deleting one file is a complete cleanup.

The secret is injected into the process `bankroll dev` spawns and is never
written into your project, so it cannot be committed.

**Back it up.** This key becomes your token's mint authority — lose it and the
token can never be minted again. A deployment should use a *different*
`BANKROLL_TREASURY_KEY`, set as a sensitive variable, so the durable mint
authority never goes near the app.

## Logging in

`bankroll login` prints a link and a short code. Open the link, log in to
Bankroll with your phone number, and approve the code. The terminal finishes on
its own. It is the same device login GitHub's CLI uses.

The session goes into your credential store: the keychain on macOS, the
keyring through `secret-tool` on Linux. It refreshes itself and lasts 30 days
from the last use. `bankroll logout` removes it.

Where there is no store, the CLI says why and asks before keeping the session
in `~/.config/bankroll/session.json`, readable by your user only but not
encrypted. `--allow-file-session` gives that answer up front, for a shell
nobody is watching.

`-e <name>` uses another Bankroll api, described in
`~/.config/bankroll/environments.json` as `{ "<name>": { "apiUrl": …,
"privyAppId": … } }`, with a session file of its own.

### `bankroll apps clone`

Clones the app's private repo with the remote named `bankroll`, so
`git push bankroll main` saves your changes to it. Git gets its credentials
from this tool: a token for that one repo, good for an hour, fetched from the
api each time git asks. Nothing is written to disk, and `bankroll logout`
ends the access.

The project commands above need no account: `dev`, `token`, and `treasury` are
local or on-chain, and the only credential they use is the signing key.
