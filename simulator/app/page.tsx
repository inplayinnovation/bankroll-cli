import { Screen } from "@/components/shell/screen";

// The one page. What the phone shows depends on the URL's `app` parameter,
// which is read in the browser (lib/open-app.ts), so the choice is Screen's.
export default function Page() {
  return <Screen />;
}
