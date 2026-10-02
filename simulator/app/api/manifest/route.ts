import type { NextRequest } from "next/server";
import { originOf, parseAppUrl, type AppManifest } from "@/lib/apps";

const MANIFEST_PATH = "/.well-known/bankroll.jwt";
const ICON_PATH = "/.well-known/bankroll-icon.png";
// A dev server that is not running should not hold the home screen up.
const TIMEOUT_MS = 3000;

// What an app says about itself, for its icon on the home screen and for where
// it opens. The page cannot read this directly: the app is another origin and
// its manifest carries no CORS header. So it asks whoever serves the simulator,
// which today is this route and later is the CLI's local server, answering at
// the same path.
export async function GET(request: NextRequest) {
  const url = parseAppUrl(request.nextUrl.searchParams.get("url") ?? "");
  if (!url) return Response.json({ error: "url must be a web address" }, { status: 400 });
  return Response.json(await readManifest(originOf(url)));
}

const ask = (url: string) => fetch(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });

async function readManifest(origin: string): Promise<AppManifest> {
  try {
    const response = await ask(`${origin}${MANIFEST_PATH}`);
    if (!response.ok) return { bankroll: false };
    // A manifest is a JWT: header.claims.signature. Only the claims are read, and
    // the signature is not checked: this names an icon, it does not admit an app.
    const claims: unknown = JSON.parse(Buffer.from((await response.text()).split(".")[1] ?? "", "base64url").toString("utf8"));
    if (typeof claims !== "object" || claims === null) return { bankroll: false };
    const { name, launch } = claims as Record<string, unknown>;
    return {
      bankroll: true,
      ...(typeof name === "string" && name.trim() !== "" ? { name: name.trim() } : {}),
      ...(typeof launch === "string" && launch.startsWith("/") ? { launch } : {}),
      ...((await hasIcon(origin)) ? { icon: `${origin}${ICON_PATH}` } : {}),
    };
  } catch {
    // Not running, not reachable, or not a manifest: an app all the same, just not a Bankroll one.
    return { bankroll: false };
  }
}

// An app has no icon until someone draws one, and a missing file answers with a page, not an image.
async function hasIcon(origin: string): Promise<boolean> {
  try {
    const response = await ask(`${origin}${ICON_PATH}`);
    void response.body?.cancel();
    return response.ok && (response.headers.get("content-type") ?? "").startsWith("image/");
  } catch {
    return false;
  }
}
