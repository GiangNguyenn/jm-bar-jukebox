import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { HeroUIProvider } from "@heroui/react";
import Header from "@/components/Header";

// const geistSans = localFont({
//   src: "./fonts/GeistVF.woff",
//   variable: "--font-geist-sans",
//   weight: "100 900",
// });
// const geistMono = localFont({
//   src: "./fonts/GeistMonoVF.woff",
//   variable: "--font-geist-mono",
//   weight: "100 900",
// });

const parkLane = localFont({
  src: "./fonts/ParkLaneNF.woff",
  variable: "--font-parklane",
});

export const metadata: Metadata = {
  title: "3B Bar Jukebox",
  description: "Generated by create next app",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="">
      <body className={`${parkLane.variable} antialiased min-h-screen`}>
        <HeroUIProvider>
          <Header />
          {children}
        </HeroUIProvider>
      </body>
    </html>
  );
}
