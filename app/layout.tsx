import type { Metadata } from "next";
import { Inter, Space_Grotesk, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./components/providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "YieldBonds — Save Securely. Win Massively.",
  description:
    "YieldBonds is a prize-linked savings protocol on Solana. Deposit USDC, earn yield through Kamino Lending, and win weekly prizes — all without risking your principal.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <Providers>
        <body
          suppressHydrationWarning
          className={`${inter.variable} ${spaceGrotesk.variable} ${geistMono.variable}`}
        >
          {children}
        </body>
      </Providers>
    </html>
  );
}
