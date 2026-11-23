import "./globals.css";
import type { Metadata, Viewport } from "next";
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
        <Nav />
        <main className="mx-auto max-w-7xl px-4 pb-24 pt-6">{children}</main>
      </body>
    </html>
  );
}
