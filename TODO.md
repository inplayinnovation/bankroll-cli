# TODO

Open work on the CLI. One line per item, with the why when it is not obvious.
Tick an item when it ships, and delete ticked items at the next release.

## Next release

- [ ] **Release `apps create [name]`** — it is committed but not published. Bump the version, publish, and merge the README and the skill at the same moment: both already describe the argument, and 0.5.0 answers it with "too many arguments".
- [ ] **Starter: pin the release** — the starter pins `@joinbankroll/cli` at `^0.4.0`, with 0.4.0 in its lockfile. Before 1.0 a caret stays inside the minor, so a new app's `npm run dev` never reaches 0.5.x on its own. Bump it with every release.
- [ ] **Docs quickstart and the starter's README: show the named form** — once released, `bankroll apps create "My App"`.

## The simulator

A desktop phone for testing an app without a physical one, served by `bankroll dev`.

- [ ] **Serve it from `bankroll dev`** — built into this package as static files, served on localhost and opened in the browser. The tunnel and the QR stay, for real phones. It moves into this repo once it can load an app by URL.
- [ ] **Say when the CLI is out of date** — the simulator is pinned to the CLI's version, and nothing tells a developer that a newer one is published.

## Proposed, not decided

- [ ] **`BANKROLL_SIMULATOR_URL`** — point `dev` at a running simulator dev server in place of the bundled files, for working on the simulator itself.
- [ ] **A dogfood script** — one command for working on the SDK, the simulator and an app together: the simulator's dev server, an SDK watch build copied into the app's `node_modules`, and `bankroll dev` in the app. Copied, not linked: Turbopack does not resolve a linked package outside the app's root.
- [ ] **`dev` without the tunnel** — for simulator-only work, where a new tunnel on every restart is time spent on nothing.
- [ ] **The credential helper and the PATH** — a clone's git helper runs `bankroll` from the PATH. Where that is missing (another Node version under nvm) or is another program, fetch and push fail with nothing pointing at the cause. Check at clone time, or make the helper not depend on the PATH.
- [ ] **`create-bankroll-app`** — the docs no longer point at `npm create @joinbankroll/app`. Fold what is left of it into the CLI, or retire it.
