import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dressly — Your AI personal stylist",
  description:
    "Tell Dressly where you're going and let the AI stylist build and virtually try the outfit for you.",
};

export const viewport: Viewport = {
  themeColor: "#f4f1ea",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="grain min-h-screen antialiased">{children}</body>
    </html>
  );
}
