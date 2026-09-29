import type { Metadata } from "next";
import { Geist, Gloock } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Wurzelraum — find the Berlin Kiez where your family fits",
  description:
    "Compare your Berlin neighbourhood with three alternatives, using real data and an honest word on the trade-offs.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geist.variable} ${gloock.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
