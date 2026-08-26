import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import Footer from "@/components/Footer";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Metron - Negotiated pricing for machine data",
  description:
    "Metron is a negotiated-price payment layer in front of live financial and on-chain intelligence data, settled via x402 on Base mainnet.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable}`}>
      <body className="font-body bg-canvas text-ink-body min-h-screen w-full max-w-[100vw]">
        {children}
        <Footer />
      </body>
    </html>
  );
}
