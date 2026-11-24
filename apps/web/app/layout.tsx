import "./globals.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Haven — live shopping, powered by AI",
  description: "Shop live shows, auctions and stores. Sell by snapping a photo.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0a1a2f" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Montserrat:wght@600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen">
        {process.env.NEXT_PUBLIC_DEMO === "1" && (
          <div className="bg-warn px-4 py-2 text-center text-xs font-semibold text-black">
            Demo with sample items. Nothing here is a real listing, and no orders, bids or payments are real. Your cart and bids stay in this browser.
          </div>
        )}
        <Nav />
        <main className="mx-auto max-w-7xl px-4 pb-16 pt-6">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-6 text-xs text-muted">
            <span>© {new Date().getFullYear()} Seaside Haven LLC</span>
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
            <Link href="/settings/account" className="hover:text-ink">Account settings</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
