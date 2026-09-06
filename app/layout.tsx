import type { Metadata } from "next";
import { getSiteOrigin } from "../lib/origin";
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

export async function generateMetadata(): Promise<Metadata> {
  const origin = getSiteOrigin();
  const title = "Dilan & Laura — Nuestra boda";
  const description =
    "Acompáñanos a celebrar nuestra boda el 10 de octubre de 2026 en Tunja.";
  const socialImage = new URL("/og.png", origin).toString();

  return {
    title,
    description,
    referrer: "no-referrer",
    robots: { index: false, follow: false },
    openGraph: {
      type: "website",
      title,
      description,
      images: [{ url: socialImage, width: 1536, height: 1024, alt: "Dilan y Laura — 10 de octubre de 2026" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [socialImage],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
