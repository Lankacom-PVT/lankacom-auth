import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@lankacom/auth/client";
import { getSession, handlers } from "@/lib/auth";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "@lankacom/auth demo",
  description: "Exercising @lankacom/auth",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Seed the client provider from the authoritative server read so useSession()
  // has data on the first client render (no loading flash). Strip secrets via
  // the library's toClientSnapshot.
  const session = await getSession();
  const initialSession = session ? handlers.toClientSnapshot(session) : null;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SessionProvider initialSession={initialSession}>
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
