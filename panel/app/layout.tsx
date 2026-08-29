import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bid Copilot",
  description: "Fast freelance project capture, bid generation and submission control"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
