# TODO

Open work on the CLI. One line per item, with the why when it is not obvious.
Tick an item when it ships, and delete ticked items at the next release.

## Shipped on 2026-10-06, in this order

Kept until the next release, as the file's rule says, and because the order
is the story of how an app first runs: install the CLI, `bankroll login`,
`bankroll apps create "Name"`, `cd name && npm run dev`, and the app is in the
simulator, shown to a pretend user who pays fake dollars on a local chain.

- [x] **`@joinbankroll/sdk` 0.33.0** — pull request #4 on `bankroll-sdk`, squashed onto `main` (`4e711c9`) and published by Gianni. `bankroll.init()`, required; the simulator's bridge, which is what makes the simulator the app's host; `MockHost`; the safe-area variables; reference lookups that ask a local chain.
- [x] **Starter: SDK 0.33.0** (`a26651a`) — pins `^0.33.0`; `src/lib/client/bankroll.ts` calls `bankroll.init()` as it loads and is where client code gets `bankroll` from; the app's own mock host gave way to the SDK's `MockHost`, in the layout.
- [x] **`@joinbankroll/cli` 0.6.0** — `gs/simulator` fast-forwarded onto `main` (`e5c7ec6`) and published by Gianni. `apps create [name]` that installs the clone and fetches the chain's node, `wait`, `faucet`, the `apps` table, `dev` opening the simulator (the phone loop is `dev --phone`), the host with its users, sheets, local chain and transactions, Node 22, the out-of-date notice.
- [x] **Starter: CLI 0.6.0** (`7f7e4cb`) — pins `^0.6.0`; `npm run phone` is the tunnel and the QR; README and AGENTS.md teach `dev` as the simulator. Checked from the published packages: `npm run dev` in the clone opened the app in the simulator as tester with $1,000, the sidebar listing `init()` and the balance reads, the Transactions tab the minting and the funding.

## Next

- [ ] **Docs** (docs.joinbankroll.com, source in `docs/` of the `bankroll` monorepo) — nothing there mentions the simulator. Needed: a local-development section on `bankroll dev` and the simulator (users, sheets, the local chain, the Transactions tab, `~/.config/bankroll/simulator/`), the phone loop as `--phone` and `npm run phone`, the safe-area variables (`var(--bankroll-safe-area-inset-top, env(safe-area-inset-top))`), a 0.33.0 changelog entry that leads with `init()` as the one line every app must add, and 0.6.0 notes that say `dev` changed. The Bankroll skill installed on Gianni's Mac (`~/.claude/skills/bankroll`) is the August copy; the current one is `skills/bankroll/SKILL.md` here.
- [ ] **Node 22 or 24** — the floor is `>=22` (`package.json` engines): 22 is maintenance LTS until April 2027, 24 the active LTS, and `WebSocket`, which the chain watcher uses, arrived in 22. Gianni asked why not require the current LTS; 24 would turn away developers on 22 for nothing we need. Decide, and change the one line if 24.
- [ ] **PMORPG** (`~/Projects/pmorpg`) — runs a dogfood copy of the SDK and guards its `init()` call with `'init' in bankroll` because a deploy installed 0.32.0. Pin `@joinbankroll/sdk` to `^0.33.0`, drop the guard in `src/lib/client/bankroll.ts`, and remove the temporary `src/app/app/balance-check.tsx` and its three lines in `src/app/app/page.tsx`, which poll `balances()` every two seconds and were only there to watch calls fail before `init()`. Two commits of Gianni's are unpushed there; `git push bankroll main` builds the test version.
- [ ] **Live apps** — each adds the one `bankroll.init()` line when it moves to 0.33.0; nothing works there without it.
- [ ] **The Bankroll app** (hs3) — an `init` method on its `window.bankroll`, to hear which SDK a page runs; until then the phone ignores `init()` and nothing changes there. Its `bridge/injected-javascript.ts` is the page-side script the simulator's bridge mirrors; sharing one copy through the SDK was considered and deferred.

## To raise with Greg

- [ ] **Location is the client's word** — the api takes a session's location from the `X-Latitude` and `X-Longitude` headers the client sends (`api/src/lib/geo.ts`, read 2026-10-02), with no cross-check found, and accepts the CLI's Privy login for `mintAppToken` on any public https origin. So a location can be claimed against live apps today, with or without a simulator. Not the simulator's doing, and not changed by it; noted here so it is not lost.

## The simulator

- [x] **Download the chain** — the CLI fetches the surfpool release it pins (`src/host/surfpool.ts`), checked against its SHA-256, once per computer: after `npm install` in `apps create`, or when `dev` finds none. `npm run pin-surfpool -- <version>` moves the pin. A surfpool on the PATH is the fallback.
- [ ] **Other machines** — only this Mac has run the simulator with the chain. The fetch has a build for Mac x64, Linux x64 and Windows x64 too, untried; Windows needs `tar.exe` (Windows 10 and later have it) and its own process handling.
- [ ] **An agent at the wheel** — an agent (Claude Code, say) cannot click a sheet or pick a person. It needs the host's paths as commands or flags (`dev --as alice`, a way to answer sheets, an auto-approve mode) so it can drive the app as a person and read what the host saw.
- [ ] **Automated tests in CI** — start the chain and the host from a script, drive the app headless, assert on the host's answers. The pieces exist (`src/host/`, `/api/host`); what is missing is a command that runs them without the page.
- [ ] **More of a person** — a location (country and region, carried as the session's `geo`), account states Bankroll's gates react to (restricted, verification pending), and editing a person after they are made. Today a person is a wallet, a username, an age or none, and a balance.
- [ ] **Two people at once** — two phones side by side, each as its own person, for a match or a trade.
- [ ] **A restriction policy for the app** — an app only reacts to an underage or wrong-country person if it has one (`BANKROLL_RESTRICTIONS`), which Bankroll sets on deployed builder apps and nothing sets locally. The simulator could hand the app Bankroll's standard policy, editable.
- [ ] **Bankroll's other services** — timers, managed references and their webhooks, matchmaking, push and server wallets still run as the SDK's pretend versions (`BANKROLL_MOCK=1`), since there is no Bankroll API here. The simulator could stand in for them, reached through `BANKROLL_API_URL`.
- [ ] **Signed sessions** — a person's session token is unsigned and accepted only under `BANKROLL_MOCK=1`. The simulator could sign with a key of its own that the SDK's server half trusts in development, so the real verification path runs and the pretend branch can go.
- [ ] **The pretend chain in the SDK** — `confirmCharge` and the payout code still accept the stand-in host's made-up signatures under `BANKROLL_MOCK=1`, for `npm run check` and tests that run the app with no chain. Once those run against a local chain too, the branches can come out.
- [ ] **App tokens** — a payment in a token the app declared (`appTokens`) is refused with a reason; the simulator pays in dollars only.
- [ ] **A chain that stays** — the chain starts fresh every time, by design, so a run is repeatable. A switch to keep balances and history across restarts would need surfpool's state saved and restored, and the Transactions list kept with it: today it is the CLI's memory, and empties with each start.
- [ ] **Failed transactions, on purpose** — the Transactions tab shows a refused transaction in red with the chain's reason, but the host refuses a payment the user cannot cover before the chain sees it, so the red row has only been seen in tests. A way to send a payment the chain will refuse would let an app's handling of one be watched.
- [ ] **The chain's clock** — a forked surfpool stamps its blocks with the fork's time, so a row's time is when the CLI heard of it, a moment after it landed. Right to the second for a local chain; said here so nobody chases the block times.
- [ ] **A fork of mainnet** — the chain runs offline: the dollar's mint is made by hand, and no program beyond the built-in ones (system, token, associated token, memo) exists. surfpool can fork mainnet instead and fetch any account an app touches, at the price of a public RPC's limits, which refused a reference lookup mid-proof. An app that uses other on-chain programs would want that as a setting.
- [ ] **An orphaned chain** — a CLI killed outright (not Ctrl-C) can leave surfpool running on 8899; the next start takes 8901. The CLI could notice one of its own and stop it.
- [x] **The out-of-date notice, in the page** — at the bottom of the sidebar: a line each for the app's SDK and the CLI, marked when a later release is out, when the install is stale, and when it is a local build.
- [ ] **Apps that are not Bankroll apps** — they load, and get an empty sidebar. Nothing more is decided.
- [ ] **Check Safari and Firefox** — it has only been used in Chrome. The keyboard going to the app (`simulator/lib/app-keyboard.ts`) is the part most likely to differ: it rests on how a browser moves focus into a frame.
- [ ] **A game controller** — the frame allows the browser's Gamepad API and nothing else should be needed, but none has been plugged in to see. The same goes for a controller paired with a phone, inside Bankroll.
- [ ] **Pull to refresh and swipe back** — the Bankroll app's web view has both, and the simulator has neither, so an app's own drag or swipe never meets them here. Skipped for now.
- [ ] **Bankroll's bar under the app** — the Bankroll app draws a bar of its own under every app (its icon and name, a menu), 56 points above the home indicator, and folds it away when the page scrolls down. The simulator draws none, so an app is that much taller here than on a phone. Left out for now.
- [ ] **The safe area, against a phone** — the insets the simulator says come from published tables (`simulator/lib/devices/metrics.ts`; the 18 Pro's are assumed), and that Bankroll's web view reports the same through `env(safe-area-inset-*)` is read from its code. Nobody has put a phone beside the simulator, on iOS or on Android.
- [ ] **Landscape** — listed in the Orientation menu, greyed out as not yet available: the Bankroll app is portrait only on a phone. The simulator's phone can already turn, and the menu is all that holds it upright, for the day Bankroll turns.
- [ ] **iPhone 18 Pro's Dynamic Island** — its size in `simulator/lib/devices/metrics.ts` is provisional.

## Proposed, not decided

- [ ] **A finger, not a mouse** — the simulator's pointer is a mouse, so an app that listens for touch events alone gets nothing here. An app that uses pointer events works in both, which may be all the answer needed: say so in the docs, or have the simulator send touches.
- [ ] **The credential helper and the PATH** — a clone's git helper runs `bankroll` from the PATH. Where that is missing (another Node version under nvm) or is another program, fetch and push fail with nothing pointing at the cause. Check at clone time, or make the helper not depend on the PATH.
- [ ] **`create-bankroll-app`** — the docs no longer point at `npm create @joinbankroll/app`. Fold what is left of it into the CLI, or retire it.
