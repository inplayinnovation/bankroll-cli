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
          <footer className="mt-auto flex h-11 flex-none items-start justify-center text-(--logo-ink)">
            <BankrollLogo className="h-5 w-auto" />
          </footer>
        </div>
        <HostSidebar />
      </body>
    </html>
  );
}
