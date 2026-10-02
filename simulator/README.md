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
- **The sidebar** (`components/host/sidebar.tsx`) lists the app's host calls.
  The app is another origin, so nothing of it can be read from here: the SDK's
  stand-in host tells this page each call in window messages
  (`lib/host-log.ts`, and `SimulatorMessage` in `@joinbankroll/sdk/mock`). That
  needs `@joinbankroll/sdk` 0.33.0 in the app, running with `BANKROLL_MOCK=1`.
- **Two paths on its own origin** are answered by whoever serves the page,
  which is the CLI: `/api/manifest?url=` reads an app's manifest, which the
  page cannot fetch across origins, and `/api/apps` names the app the CLI is
  running.
- **The keyboard** is the app's while one is open (`lib/app-keyboard.ts`). A
  key goes to whichever document has focus, and nothing can forward one into
  another origin's page, so the frame is given focus: when the app opens, and
  again whenever the simulator's own controls are done with it. A game is
  played from the keyboard with no click on the phone first. A controller needs
  nothing from here: the frame allows the browser's Gamepad API.
- **Turning the phone** is the simulator's own doing. The Bankroll app is
  portrait only on a phone, so the menu sets landscape apart and a line under
  the turned phone says so (`shownOnPhones` in `lib/devices`).
- **Settings** (device, orientation, theme) and the apps added by hand are kept
  in the browser's localStorage.

## Working on it

```bash
npm install          # here, once
npm run dev          # http://localhost:4100, hot reloading
```

`npm run dev` serves the page only. The two `/api` paths are handed to the
CLI's server at `http://localhost:4101` (`BANKROLL_SIMULATOR_API` changes
that), so run it alongside the CLI. `npm run dogfood -- <app directory>` in the
repo root starts both, with an app.

## The device art

`public/devices` and `lib/devices/generated.ts` are generated from a local
Xcode install by `npm run devices:extract`, and committed. Safe areas and
Dynamic Island sizes are kept by hand in `lib/devices/metrics.ts`.
