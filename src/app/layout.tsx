import type { Metadata } from "next";
import { Geist, Gloock, Fraunces } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const gloock = Gloock({
  variable: "--font-gloock",
  weight: "400",
  subsets: ["latin"],
});

// For the landlord flow (src/app/landlord/*) — a separate editorial serif
// from Wurzelraum's Gloock, matching that section's own design direction.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Wurzelraum — find the Berlin Kiez where your family fits",
  description:
    "Compare your Berlin neighbourhood with three alternatives, using real data and an honest word on the trade-offs.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${gloock.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
