---
name: bankroll
description: Build, run, and ship Bankroll apps — real-money web apps that run inside the Bankroll mobile app (joinbankroll.com), with verified identity, geolocation, and HSUSD payments on Solana. Use when the user mentions Bankroll, joinbankroll, HSUSD, @joinbankroll packages, the bankroll CLI, a bankroll-starter repo, or asks to build a real-money app on Bankroll. Do not use for generic Solana, wallet, or payment work that does not involve Bankroll.
---

# Bankroll

A Bankroll app is a web app that Bankroll hosts and opens inside its mobile
app. You make one with the Bankroll CLI, build it in its repo, and push; the
push is the deploy. The host supplies verified identity (one person, one
account, with a verified age), per-session geolocation, payments in HSUSD (a
one-dollar stablecoin on Solana), haptics, and a review card. Charges settle
on-chain to the app's own wallet, which Bankroll runs. Settlement is final:
there are no chargebacks, and mistakes move real money. That is why this skill
is mostly rules.

## The CLI

```bash
npm i -g @joinbankroll/cli          # once per machine
bankroll login                      # opens the browser; log in with a phone number, approve the code
bankroll apps                       # your apps, each with its latest run's state
bankroll apps create --name "Name"  # a new app from the starter; prints its id
bankroll apps clone <id>            # its repo, with the remote named bankroll
bankroll apps publish <id>          # list it for everyone: from then on real players pay
bankroll --help                     # discover the rest; do not recall commands from memory
```

Inside an app repo, `npx bankroll` runs the version the app pins. Leave the
`-e` option alone unless the user asks for it.

## Build: create, clone, run

1. `bankroll apps create --name "<name>"`, then `bankroll apps clone <id>`, `cd`
   into it, `npm install`.
2. Look for `.env.development` at the project root. Bankroll writes it when
   it creates an app, with `STORE=fs`, `BANKROLL_MOCK=1`, and the app's name,
   payee, owner, and wallet id, and `next dev` reads it. An older app has
   none; give it the three settings that matter before running anything:

   ```bash
   printf 'STORE=fs\nBANKROLL_MOCK=1\nBANKROLL_APP_NAME=<name>\n' > .env.local
   ```

   `STORE=fs` keeps documents in local files instead of Vercel Blob.
   `BANKROLL_MOCK=1` makes the server accept a stand-in host: its token, its
   made-up charge signatures, and simulated payouts, so no money moves and no
   key is needed. Production builds ignore both files.
3. Read the repo's `AGENTS.md` before you write code. It is the authority on the
   app's structure, screens, and money rules; where it and this skill differ,
   follow `AGENTS.md`. Fetch the docs once: https://docs.joinbankroll.com/llms-full.txt
   (the index is /llms.txt), or add the docs MCP server at
   https://docs.joinbankroll.com/mcp, user-scoped: search, every page as a
   file, and a `submit_feedback` tool for a wrong or confusing page. Do not
   write SDK calls from memory: the SDK is
   pre-1.0 and minor versions carry breaking changes; check the installed
   version, then the changelog page.
4. Run and look: `npx next dev`, then `npm run check -- /app` loads the app in
   a headless phone-sized browser with the stand-in host and fails on any
   console error, page error, or failed request; read its screenshots in
   `checks/`. Under `BANKROLL_MOCK=1` the app also puts the stand-in host on
   its own page, so `http://localhost:3000/app` runs in any browser as the
   pretend user (an app from before 2026-09-26 lacks this and shows "Open this
   in Bankroll" in a browser; use `npm run check` there).
5. On a phone: `npm run dev` runs the dev server behind a public tunnel and
   prints a QR that opens the app inside Bankroll, with real sessions and real
   charges paid to a dev signing key at `~/.config/bankroll/keypair.json`.
   Leave `BANKROLL_MOCK` out of `.env.local` for that loop. The tunnel URL
   changes on every restart: "Can't open this app" means a dead tunnel.
6. Before a push: `npm run typecheck && npm run lint && npm run build`. A build
   that fails is not deployed.

## Ship: the push is the deploy

Check `git remote -v` first.

- **A remote named `bankroll`**: a laptop clone. Commit your own files with a
  plain message about the change, then `git push bankroll main`. Bankroll
  reads the code, classifies what the app does (free, paid, prizes; that
  sets where it may take money), signs its manifest, and deploys it, in a
  minute or two. `bankroll apps` shows the run: `pushed` while it builds,
  then `live`, or `error`, and the owner's phone gets the reason. Players open
  the app at `https://joinbankroll.com/play?url=<address>/app`.
- **A remote named `origin`**: Bankroll's own builder sandbox. Do not commit or
  push; the builder does that when the run ends, and its rules file applies.

Never deploy the app yourself: no `vercel link`, no `vercel deploy`;
`vercel.json` keeps `git.deploymentEnabled: false` so only Bankroll's build
deploys. Never create or edit files under `.github/workflows`. Nothing about
money or keys goes in the repo: the wallet, the signed manifest, the webhook
secret, and the restrictions are settings Bankroll puts on the deployment.

## The QR, when you run the phone loop

Run `npm run dev` as a background task and leave it running. Its output is
never shown to the user. Put the QR **in your chat reply** as plain monospace
glyphs in a fenced code block with the play link under it; when stdout is not a
TTY the CLI prints exactly that, so re-print it verbatim. Never send the QR as
an image or attachment; neither renders in a terminal chat.

## Money rules — never break these

1. Every fact about the user comes from the verified session: `wallet`,
   `username`, `identity`, `geo`, `age`. Never from the request body.
2. The server computes amounts. The client never names a price or a recipient.
3. Before you release value, check all four facts on the confirmed charge:
   `payee` is the app's payee (`payeeAddress()`), `mint` is HSUSD or a declared
   app token, `amountCents` matches the order, `payer` is the session wallet.
   The `payee` check is the classic miss. The `mint` check is what stops free
   tokens from buying real value.
4. Record each charge with one atomic create, keyed by the transaction
   (`sortableId(slot, signature)`). `created: false` means a retry or a replay:
   return the existing charge; never grant twice.
5. Mint a `reference` and an `idempotencyKey` on the server *before* you call
   `charge()`, and store them. If the result never comes back, find the charge
   with `findChargeByReference()`. Never call `charge()` again to learn an
   outcome.
6. Store the payout's signature BEFORE broadcasting it: `buildAndSignPayout()`,
   persist bytes, signature, and expiry in the same write that locks the payout
   row, then `sendPayout()`, then `confirmPayout()`. Never blind-retry: only
   `expired` proves the transaction never landed and never can.
7. Pay back in the asset that paid. A charge in app tokens pays out app
   tokens, never HSUSD.
8. Call `paidPlayRestriction(session)` on the server before any paid action and
   refuse while its `reason` is set. Bankroll sets the policy from what the
   code does.

## STOP — ask the user first

- `bankroll apps publish`: from then on real players pay real money.
- Anything that writes a secret key into the project, a log, or a commit.
- Movement of more real money than the task needs.

## Common failures

| Symptom | Cause | Fix |
| --- | --- | --- |
| `bankroll apps` shows `error` after a push | The build failed: describe, classify, sign, or deploy | The owner's phone has the reason; fix and push again |
| "Could not set up the app" from `apps create` | Provisioning failed on Bankroll's side | Try once more; if it repeats, tell the user |
| "Can't open this app" on the phone | The tunnel died on restart | Restart `npm run dev`, scan the new QR |
| `update_required` | The Bankroll app is too old | Ask the user to update the app |
| 401 from API routes in a browser | No host outside Bankroll | Expected; use `npm run check` or the phone |
| `manifest_error` | The manifest is missing or malformed | `curl <address>/.well-known/bankroll.jwt`; check `sub` equals the exact origin |

## Before you finish

Run `npm run typecheck && npm run lint && npm run build && npm test`. Confirm
the replay guard: the same signature must not grant value twice. After a push,
confirm `bankroll apps` shows the run `live`.
