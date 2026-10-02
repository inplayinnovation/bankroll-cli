import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

// The simulator ships inside @joinbankroll/cli as static files: `next build`
// writes them to out/, and the CLI's own server (src/simulator.ts there)
// serves them and answers the two /api paths the page calls.
//
// While the simulator itself is being worked on, `next dev` serves the page,
// and hands those two paths to that same server.
const API = process.env.BANKROLL_SIMULATOR_API ?? "http://localhost:4101";

// This directory, said outright. The CLI's lockfile is one level up, and left
// to guess, Next takes that directory for the root.
const turbopack = { root: __dirname };

export default function config(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    return { turbopack, rewrites: async () => [{ source: "/api/:path*", destination: `${API}/api/:path*` }] };
  }
  return { turbopack, output: "export" };
}
