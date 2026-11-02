import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dressly — Your AI personal stylist",
  description:
    "Tell Dressly where you're going and let the AI stylist build and virtually try the outfit for you.",
};

export const viewport: Viewport = {
  themeColor: "#0b0a09",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="grain min-h-screen antialiased">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
