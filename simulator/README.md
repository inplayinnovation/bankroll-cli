# The simulator

A phone on your desk for a Bankroll app: the app in an iPhone frame, and beside
it every call the app makes to its host.

`bankroll dev` opens it. It ships inside `@joinbankroll/cli` as
static files: `npm run build` in the repo root builds it into `dist/simulator`,
and the CLI serves it from there (`src/simulator.ts`).

## How it fits together

- **The app** is a web page on its own origin, shown in a frame
  (`components/shell/app-frame.tsx`). Which app is open is in the page's URL:
  `/?app=http://localhost:3000/app`.
- **The users** the app can be shown to are at the top of the sidebar
  (`components/host/users.tsx`, `lib/people.ts`), one row each, laid out as a
  design tool lists pages: the chosen row filled, a + in the title row for a
  new one, a rename on a double click, and a pencil and an x when the pointer
  rests on a row. The users are the CLI's (`src/host/people.ts` there), kept
  in `~/.config/bankroll/simulator/`; this page asks for the list and says who
  to show the app to. Choosing another starts the app over (`lib/reload.ts`):
  a session belongs to one user. The sidebar's other sections follow the same
  shape (`components/host/icons.tsx`): a title row, with an action as an icon where there is one.
- **The sidebar** (`components/host/sidebar.tsx`) has two tabs in its middle,
  as a design tool's panel does. **SDK Calls** lists the app's host calls: the seven the SDK
  offers, always, under the SDK's names (`charge`, where the host hears
  `pay`), and any other only once the app makes it. `init` is first: an app
  calls it before anything else, and it says which SDK the app runs. A call
  that fails flashes its row red and is counted as failed. That includes a
  call the SDK refuses before it asks the host, one made before `init()`: the
  bridge tells this page of it. **Transactions** (`components/host/transactions.tsx`,
  `lib/transactions.ts`) lists the local chain's activity, newest first, as the
  CLI hears it over the chain's websocket (`src/host/transactions.ts` there,
  `/api/host/transactions`): a transfer of the dollar as who → whom and how
  much, with the memo; SOL for fees and accounts made, quieter; a refused
  transaction in red with its reason. A row opens to the facts, each
  copyable. New rows also mean balances moved, so the users are asked for
  again; a user's row shows what their wallet holds now.
- **The host** is the CLI (`src/host/` there), and this page is how the app
  reaches it. The app is another origin, so nothing of it can be read from
  here: the SDK puts a bridge on the app's page, which sends each call here in
  a window message (`lib/host-log.ts`, and `SimulatorMessage` in
  `@joinbankroll/sdk/mock`). This page relays it to the CLI on its own origin
  (`lib/host.ts`, `/api/host/call`) and sends the answer back. That needs
  `@joinbankroll/sdk` 0.33.0 in the app, started by `bankroll dev`.
- **The sheets** (`components/host/sheet.tsx`): where the phone would stop and
  ask its user, the CLI answers with a sheet instead of a result, and it is
  drawn under the call's row: consent, a payment with its countdown, identity
  verification, a deposit. The decision goes back to the CLI
  (`/api/host/decide`), which answers the call. A deposit is answered at once,
  as the phone answers it, and its sheet adds the money.
- **Paths on its own origin** are answered by whoever serves the page, which
  is the CLI: `/api/manifest?url=` reads an app's manifest, which the page
  cannot fetch across origins, `/api/apps` names the app the CLI is running,
  `/api/versions` says which CLI that is and which SDK the app has, and
  `/api/host/...` is the host: the people, the treasury, the calls and the
  decisions (`src/host/routes.ts` there).
- **What the app runs in** is along the bottom of the sidebar
  (`components/host/runtime.tsx`): where the app is paid and what that holds
  on the local chain (`components/host/treasury.tsx`: the simulator's made-up
  treasury, or the app's own when its manifest names one), then under a line,
  a lock and "Secure Runtime", then a line each for the SDK the open app runs and the CLI serving
  the page, with a word beside a version when there is something to say. `local` is a build of
  someone's own, `update` a later release, `stale` an install that is not what
  the project asks for. A line says more when the pointer rests on it. The app
  says which SDK it runs in `init()`; the rest is read by the CLI, in the app's
  folder and at the registry (`src/versions.ts` there), since this page can
  reach neither.
- **The safe area** reaches the app the same way, in the other direction. The
  app's frame fills the display, as Bankroll's web view does, and the status
  bar and the home indicator are drawn over it. A browser on a computer reports
  every `env(safe-area-inset-*)` as zero, and nothing outside a page can set
  them, so hello carries the insets of the phone on screen
  (`lib/devices/metrics.ts`) and the SDK's bridge sets them on the page as
  `--bankroll-safe-area-inset-*`, for the app's CSS to prefer to the phone's
  own. Changing the phone says hello again. Bankroll's own bar under the app is
  not drawn: an app is that much taller here than on a phone.
- **The keyboard** is the app's while one is open (`lib/app-keyboard.ts`). A
  key goes to whichever document has focus, and nothing can forward one into
  another origin's page, so the frame is given focus: when the app opens, and
  again whenever the simulator's own controls are done with it. A game is
  played from the keyboard with no click on the phone first. A controller needs
  nothing from here: the frame allows the browser's Gamepad API.
- **Landscape** is in the Orientation menu, greyed out as not yet available.
  The Bankroll app is portrait only on a phone, so the simulator shows an app
  no other way (`ORIENTATIONS` in `lib/devices`). The phone here can turn; the
  menu is what keeps it upright.
- **Settings** (device, orientation, theme) and the apps added by hand are kept
  in the browser's localStorage.

## Working on it

```bash
npm install          # here, once
npm run dev          # http://localhost:4100, hot reloading
```

`npm run dev` serves the page only. The `/api` paths are handed to the
CLI's server at `http://localhost:4101` (`BANKROLL_SIMULATOR_API` changes
that), so run it alongside the CLI. `npm run dogfood -- <app directory>` in the
repo root starts both, with an app and the local chain (the pinned surfpool,
fetched once if it is not here).

## The device art

`public/devices` and `lib/devices/generated.ts` are generated from a local
Xcode install by `npm run devices:extract`, and committed. Safe areas and
Dynamic Island sizes are kept by hand in `lib/devices/metrics.ts`.
