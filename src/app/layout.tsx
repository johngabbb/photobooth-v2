import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "pamkin photo bee",
  description: "A photobooth for two, on two devices, with one shutter.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The booth is a fixed-viewport app, not a document: the page itself never
    // scrolls. Anything that needs to overflow scrolls inside its own pane.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full overflow-hidden antialiased`}
    >
      <body className="flex h-full flex-col overflow-hidden">{children}</body>
    </html>
  );
}
