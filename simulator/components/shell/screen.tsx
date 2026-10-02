"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Launcher } from "@/components/launcher/launcher";
import { APP_PARAM, launchUrl, namesNoPage, parseAppUrl } from "@/lib/apps";
import { askManifest } from "@/lib/manifests";
import { AppFrame } from "./app-frame";

/** What the phone is showing: the app named in the URL, or the home screen. */
export function Screen() {
  const url = parseAppUrl(useSearchParams().get(APP_PARAM) ?? "");
  return url ? <OpenApp key={url} url={url} /> : <Launcher />;
}

/**
 * An app, opening. An address alone ("localhost:3001") may be a Bankroll app's,
 * whose own front page only says to open it in Bankroll: the app is at the
 * launch path its manifest names. So the app is asked now, as it opens, and
 * never from what the home screen knew: its server may have started since.
 */
function OpenApp({ url }: { url: string }) {
  const settled = !namesNoPage(url);
  const [page, setPage] = useState(settled ? url : null);

  useEffect(() => {
    if (settled) return;
    let current = true;
    void askManifest(url).then((manifest) => {
      if (!current) return;
      const launch = launchUrl(url, manifest);
      // The page's URL takes the launch path too, in place of the address:
      // a reload opens the same page, and Back still leads home.
      if (launch !== url) window.history.replaceState(null, "", `?${new URLSearchParams({ [APP_PARAM]: launch })}`);
      else setPage(url);
    });
    return () => {
      current = false;
    };
  }, [url, settled]);

  // Until the app answers, the screen is black, as it is while any app launches.
  return page && <AppFrame url={page} />;
}
