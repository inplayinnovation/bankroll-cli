# TODO

Open work on the CLI. One line per item, with the why when it is not obvious.
Tick an item when it ships, and delete ticked items at the next release.

## 1.0.0, unpublished

`bankroll dev` opens the app in Bankroll Desktop (the `bankroll` monorepo's
`desktop/`), installs it when a Mac has none, and the web simulator is gone
from the package: the page, its host, the local chain, the Solana libraries.
`--simulator` and `--no-open` are gone with it; `--port` is for `--phone`.
The simulator's open ideas moved to `desktop/TODO.md` there. The monorepo's
`TRACKER.md` has the steps as TRK-153.

## Next

- [ ] **Publish 1.0.0** (Gianni), after a Bankroll Desktop 0.1.6 or later is on the stable channel: that is the first build that takes the link. Then the starter pins `^1.0.0`, and its README and AGENTS.md say Bankroll Desktop.
- [ ] **A `bankroll desktop` command group** for agents and CI, so an agent can drive the app as a person: open, what is open, the people, the sheets and a way to answer them, the calls the host saw. The state file is the first half; the rest is a command surface on Bankroll Desktop (TRK-153, later).
- [ ] **Node 22 or 24** — the floor is `>=22` (`package.json` engines): 22 is maintenance LTS until April 2027, 24 the active LTS. Gianni asked why not require the current LTS; 24 would turn away developers on 22 for nothing we need. Decide, and change the one line if 24.
- [ ] **PMORPG** (`~/Projects/pmorpg`) — runs a dogfood copy of the SDK and guards its `init()` call with `'init' in bankroll` because a deploy installed 0.32.0. Pin `@joinbankroll/sdk` to `^0.33.0`, drop the guard in `src/lib/client/bankroll.ts`, and remove the temporary `src/app/app/balance-check.tsx` and its three lines in `src/app/app/page.tsx`, which poll `balances()` every two seconds and were only there to watch calls fail before `init()`. Two commits of Gianni's are unpushed there; `git push bankroll main` builds the test version.
- [ ] **Live apps** — each adds the one `bankroll.init()` line when it moves to 0.33.0; nothing works there without it.
- [ ] **The Bankroll app** (hs3) — an `init` method on its `window.bankroll`, to hear which SDK a page runs; until then the phone ignores `init()` and nothing changes there. Its `bridge/injected-javascript.ts` is the page-side script Bankroll Desktop's bridge mirrors; sharing one copy through the SDK was considered and deferred.

## To raise with Greg

- [ ] **Location is the client's word** — the api takes a session's location from the `X-Latitude` and `X-Longitude` headers the client sends (`api/src/lib/geo.ts`, read 2026-10-02), with no cross-check found, and accepts the CLI's Privy login for `mintAppToken` on any public https origin. So a location can be claimed against live apps today. Noted here so it is not lost; TRK-152 in the monorepo's tracker limits what a CLI login can ask.

## Proposed, not decided

- [ ] **The credential helper and the PATH** — a clone's git helper runs `bankroll` from the PATH. Where that is missing (another Node version under nvm) or is another program, fetch and push fail with nothing pointing at the cause. Check at clone time, or make the helper not depend on the PATH.
- [ ] **`create-bankroll-app`** — the docs no longer point at `npm create @joinbankroll/app`. Fold what is left of it into the CLI, or retire it.
