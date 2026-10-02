import { Suspense } from "react";
import { Screen } from "@/components/shell/screen";

// The one page. What the phone shows depends on the URL's `app` parameter,
// which is read in the browser, so the choice is a Client Component's. The
// Suspense boundary is what lets a prerendered build leave it to that component.
export default function Page() {
  return (
    <Suspense>
      <Screen />
    </Suspense>
  );
}
