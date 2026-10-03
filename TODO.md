# TODO

Open work on the CLI. One line per item, with the why when it is not obvious.
Tick an item when it ships, and delete ticked items at the next release.

## Next release

- [ ] **Release 0.6.0** — what is on `main`: `apps create [name]`, `wait`, `faucet`, the `apps` table with its test and live commits and without `publish`/`unpublish`, the simulator as `dev`'s default (the phone loop is `dev --phone`), the host with its users, sheets, local chain and transactions, `apps create` installing the clone, Node 22, and the out-of-date notice. `apps` selects `test` and `live` on `builderApp`, which the api's environments promote brought to production on 2026-10-02, so nothing gates the release now. Bump the version and publish: the README and the skill already describe all of it, and 0.5.0 knows none of it.
- [ ] **The SDK release the simulator needs** — the simulator is the app's host only from `@joinbankroll/sdk` 0.33.0 on, which is where the SDK's bridge comes in (pull request #4 on `bankroll-sdk`). Until that is published an app runs in the simulator with no host: an empty sidebar and its content under the status bar. The starter pins `^0.32.0`: move it to 0.33.0 with the release, and add the `bankroll.init()` call the release requires.
- [ ] **Starter: pin the release** — the starter pins `@joinbankroll/cli` at `^0.4.0`, with 0.4.0 in its lockfile. Before 1.0 a caret stays inside the minor, so a new app's `npm run dev` never reaches a newer CLI, or its simulator, on its own. Bump it with every release.
- [ ] **Starter: drop the mock host** — with `@joinbankroll/sdk` 0.33.0 the simulator's host is the SDK's bridge, and `src/app/app/mock-host.tsx` is only for a plain browser tab; keep it as the SDK's `MockHost` from `@joinbankroll/sdk/next`, or drop it, and add `bankroll.init()`.
- [ ] **Docs** — local development needs a section on `bankroll dev` and the simulator, and the phone loop moving to `--phone`.

## The simulator

- [ ] **Download the chain** — `dev` starts surfpool only when it is already installed, and says how to install it otherwise. The CLI should fetch a pinned build for the machine on first run, as it fetches the tunnel program (about 30 MB each for macOS arm64 and x64, Linux x64 and Windows x64, Apache-2.0), cached under the home folder, so nobody installs anything by hand.
- [ ] **Other machines** — only this Mac has run the simulator with the chain. Linux, then Windows, with its own process handling, before the download ships.
- [ ] **An agent at the wheel** — an agent (Claude Code, say) cannot click a sheet or pick a person. It needs the host's paths as commands or flags (`dev --simulator --as alice`, a way to answer sheets, an auto-approve mode) so it can drive the app as a person and read what the host saw.
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
