# TODO

Open work on the CLI. One line per item, with the why when it is not obvious.
Tick an item when it ships, and delete ticked items at the next release.

## Next release

- [ ] **Release 0.6.0** — what is on `main`: `apps create [name]`, `wait`, `faucet`, the `apps` table with its test and live commits and without `publish`/`unpublish`, `dev --simulator` and the simulator it serves, and the out-of-date notice. `apps` selects `test` and `live` on `builderApp`, which the api's environments promote brought to production on 2026-10-02, so nothing gates the release now. Bump the version and publish: the README and the skill already describe all of it, and 0.5.0 knows none of it.
- [ ] **The SDK release the simulator needs** — the sidebar lists an app's calls, and the app learns the phone's safe area, only from `@joinbankroll/sdk` 0.33.0 on, which is where the stand-in host starts talking to a simulator. Until that is published an app runs in the simulator with an empty list and its content under the status bar. The starter pins `^0.32.0`: move it to 0.33.0 with the release, and in the same change add `bankroll.init()` at the top of `src/lib/client/bankroll.ts`. From 0.33.0 every call but `status()` fails without it.
- [ ] **Starter: pin the release** — the starter pins `@joinbankroll/cli` at `^0.4.0`, with 0.4.0 in its lockfile. Before 1.0 a caret stays inside the minor, so a new app's `npm run dev` never reaches a newer CLI, or its simulator, on its own. Bump it with every release.
- [ ] **Starter: the SDK's `MockHost`** — once the SDK has it, replace `src/app/app/mock-host.tsx` with the one from `@joinbankroll/sdk/next`.
- [ ] **Docs** — local development needs a section on `dev --simulator`.

## The simulator

- [ ] **Control from the sidebar** — choose how a call turns out: a declined payment, a dismissed sheet. Today the stand-in host answers by itself and the sidebar only watches.
- [ ] **Real sessions** — a switch from the pretend user to a real Bankroll session, with the login this CLI already holds. Until then the home screen has nothing to gain from listing the account's deployed apps: outside Bankroll they only say to open them in Bankroll.
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
