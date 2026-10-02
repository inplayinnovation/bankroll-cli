import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { HostSidebar } from "@/components/host/sidebar";
import { BankrollLogo } from "@/components/shell/bankroll-logo";
import { DeviceProvider } from "@/components/shell/device-provider";
import { DeviceStage } from "@/components/shell/device-stage";
import { TopBar } from "@/components/shell/top-bar";
import { THEME_SCRIPT } from "@/lib/theme";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The script below sets data-theme before React is on the page, so that
    // attribute is not React's to compare against what it rendered.
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex h-dvh">
        {/* The phone's column. The menus, the phone and the logo are all centred in it, not in the window. */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Draws nothing until the browser says which device: see DeviceProvider. */}
          <DeviceProvider>
            <TopBar />
            {/* The page renders on the phone's screen. */}
            <DeviceStage>{children}</DeviceStage>
          </DeviceProvider>
          {/* Pushed to the bottom while the stage above it is still empty. */}
          <footer className="mt-auto flex flex-none flex-col items-center pb-3 text-(--logo-ink)">
            <BankrollLogo className="h-5 w-auto" />
            <p className="footer-secure">
              <svg width="10" height="12" viewBox="0 0 12 14" fill="currentColor" fillRule="evenodd" aria-hidden>
                <path d="M6 0a3.75 3.75 0 0 0-3.75 3.75V6H1.5A1.5 1.5 0 0 0 0 7.5v5A1.5 1.5 0 0 0 1.5 14h9a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 10.5 6h-.75V3.75A3.75 3.75 0 0 0 6 0Zm2.25 6h-4.5V3.75a2.25 2.25 0 0 1 4.5 0V6Z" />
              </svg>
              Secure Runtime
            </p>
          </footer>
        </div>
        <HostSidebar />
      </body>
    </html>
  );
}
