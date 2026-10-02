# The simulator

A phone on your desk for a Bankroll app: the app in an iPhone frame, and beside
it every call the app makes to its host.

`bankroll dev --simulator` opens it. It ships inside `@joinbankroll/cli` as
static files: `npm run build` in the repo root builds it into `dist/simulator`,
and the CLI serves it from there (`src/simulator.ts`).

## How it fits together

- **The app** is a web page on its own origin, shown in a frame
  (`components/shell/app-frame.tsx`). Which app is open is in the page's URL:
  `/?app=http://localhost:3000/app`.
- **The sidebar** (`components/host/sidebar.tsx`) lists the app's host calls:
  the seven the SDK offers, always, under the SDK's names (`charge`, where the
  host hears `pay`), and any other only once the app makes it. `init` is first:
  an app calls it before anything else, and it says which SDK the app runs. A
  call that fails flashes its row red and is counted as failed. That includes a
  call the SDK refuses before it asks the host, one made before `init()`: the
  stand-in host is told of it and passes it on.
  The app is another origin, so nothing of it can be read from here: the SDK's
  stand-in host tells this page each call in window messages
  (`lib/host-log.ts`, and `SimulatorMessage` in `@joinbankroll/sdk/mock`). That
  needs `@joinbankroll/sdk` 0.33.0 in the app, running with `BANKROLL_MOCK=1`.
- **Three paths on its own origin** are answered by whoever serves the page,
  which is the CLI: `/api/manifest?url=` reads an app's manifest, which the
  page cannot fetch across origins, `/api/apps` names the app the CLI is
  running, and `/api/versions` says which CLI that is and which SDK the app
  has.
- **What the app runs in** is along the bottom of the sidebar
  (`components/host/runtime.tsx`): a lock and "Secure Runtime", then a line
  each for the SDK the open app runs and the CLI serving the page, with a word
  beside a version when there is something to say. `local` is a build of
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
  (`lib/devices/metrics.ts`) and the stand-in host sets them on the page as
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
repo root starts both, with an app.

## The device art

`public/devices` and `lib/devices/generated.ts` are generated from a local
Xcode install by `npm run devices:extract`, and committed. Safe areas and
Dynamic Island sizes are kept by hand in `lib/devices/metrics.ts`.
