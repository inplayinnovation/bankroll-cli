import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { HostSidebar } from "@/components/host/sidebar";
import { BankrollLogo } from "@/components/shell/bankroll-logo";
import { DeviceProvider } from "@/components/shell/device-provider";
import { DeviceStage } from "@/components/shell/device-stage";
import { TopBar } from "@/components/shell/top-bar";
import { getDevice, parseOrientation } from "@/lib/devices";
import { DEVICE_COOKIE, ORIENTATION_COOKIE, THEME_COOKIE, parseTheme } from "@/lib/settings";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bankroll Simulator",
  description: "A phone on your desk for running and testing Bankroll apps.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Read on the server so the first paint already shows the chosen device and theme.
  const cookieStore = await cookies();
  const device = getDevice(cookieStore.get(DEVICE_COOKIE)?.value);
  const orientation = parseOrientation(cookieStore.get(ORIENTATION_COOKIE)?.value);
  // Unset means "follow the system setting"; the top bar's toggle sets it.
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      data-theme={theme}
    >
      <body className="flex h-dvh">
        {/* The phone's column. The menus, the phone and the logo are all centred in it, not in the window. */}
        <div className="flex min-w-0 flex-1 flex-col">
          <DeviceProvider initialDeviceId={device.id} initialOrientation={orientation}>
            <TopBar />
            {/* The page renders on the phone's screen. */}
            <DeviceStage>{children}</DeviceStage>
          </DeviceProvider>
          <footer className="flex h-11 flex-none items-start justify-center text-(--logo-ink)">
            <BankrollLogo className="h-5 w-auto" />
          </footer>
        </div>
        {/* No Suspense boundary of its own: inside one it hydrates apart from the
            page, and later, while an app is already making calls. The route is
            rendered per request, so the URL's `app` parameter is known here. */}
        <HostSidebar />
      </body>
    </html>
  );
}
