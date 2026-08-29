import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { DM_Sans, Instrument_Serif } from "next/font/google";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-desk-sans",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-desk-display",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Signal Desk",
  description:
    "Your market sidekick — dips, breakouts, paper PnL, and chatty recommendations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/desk"
      signUpFallbackRedirectUrl="/desk"
      afterSignOutUrl="/"
    >
      <html
        lang="en"
        className={`${dmSans.variable} ${instrumentSerif.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col font-sans">{children}</body>
      </html>
    </ClerkProvider>
  );
}
