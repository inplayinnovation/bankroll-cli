# @joinbankroll/cli

Command-line tools for [Built for Bankroll](https://joinbankroll.com/build) apps.

```bash
npm i -g @joinbankroll/cli               # once per computer
bankroll login                           # your Bankroll account
bankroll apps create "Free Throw Duel"   # the app, named, and its repo here
cd free-throw-duel && npm install        # what create prints
npm run dev                              # tunnel + QR — scan it to open the app inside Bankroll
git push bankroll main                   # Bankroll builds and deploys it
```

The [starter](https://github.com/inplayinnovation/bankroll-starter) carries it
as a devDependency, so `npm run` and `npx` find it inside an app. To use it in
any directory, `npm i -g @joinbankroll/cli` — the binary is `bankroll` either
way.

## Commands

```
bankroll login                                  log in to your Bankroll account
bankroll logout                                 forget the login on this computer
bankroll whoami                                 who this computer is logged in as
bankroll apps                                   your apps, archived ones left out
bankroll apps --published                       only the ones listed for everyone
bankroll apps --archived                        only archived; --all for everything
bankroll apps create [name]                     a new app, cloned here; --no-clone leaves it
bankroll apps clone <id> [dir]                  an existing app's repo, remote named bankroll
bankroll apps archive <id>                      off the air; code, data, wallet stay
bankroll apps unarchive <id>                    back on the air
bankroll apps publish <id>                      listed for everyone
bankroll apps unpublish <id>                    unlisted; still playable by link

bankroll dev                                    tunnel + QR, injects your key
```

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

A deployment should use a *different* `BANKROLL_TREASURY_KEY`, set as a
sensitive variable, so the key on your machine never goes near the app.

## Building with an agent

The `bankroll` skill teaches a coding agent this workflow: create, clone,
run, push, watch the build, publish, and the money rules. Install it once,
for every agent on the machine:

```bash
npx skills add inplayinnovation/bankroll-cli --skill bankroll -g
```

`apps create` and `apps clone` print that line. The skill lives in
[`skills/bankroll/SKILL.md`](./skills/bankroll/SKILL.md) in this repo.

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

### `bankroll apps create`

An app declares its own name, in `bankroll-app.json` at the root of its repo:
Bankroll signs that name into the app's manifest on the next push, and shows
it everywhere. The same file is what a remix starts from.

`bankroll apps create "Free Throw Duel"` makes that declaration for you. It
writes the name into the clone's `bankroll-app.json`, commits that one file,
and clones into `free-throw-duel`. Bankroll learns the name from the first
push, so until then `bankroll apps` lists an `Unnamed app`. If a directory of
that name is already here, nothing is made.

With no name the clone lands in a directory named after the repo,
`br-12-abc123`, and the name is yours to put in the file. `--no-clone` takes
no name: there is no clone to write it into.

### `bankroll apps clone`

Clones the app's private repo with the remote named `bankroll`, so
`git push bankroll main` saves your changes to it. Git gets its credentials
from this tool: a token for that one repo, good for an hour, fetched from the
api each time git asks. Nothing is written to disk, and `bankroll logout`
ends the access.

`dev` needs no account: it is local, and the only credential it uses is the
signing key.
