# bankroll-cli

Command-line tools for [Built for Bankroll](https://joinbankroll.com/build) apps.

```bash
npm create bankroll-app@latest my-app
cd my-app
npm run bankroll      # tunnel + QR — scan it to open the app inside Bankroll
npm run mint          # your own token
```

Installed as a devDependency by the scaffolder, so `npm run` finds it. To use it
in any directory, `npm i -g bankroll-cli`.

## Commands

```
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

The QR points at your app's origin. Bankroll loads exactly that, so what a scan
opens is whatever you serve at the root.

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

## No account required

Everything here is local or on-chain. There is no Bankroll account, no API key,
and nothing to revoke.
