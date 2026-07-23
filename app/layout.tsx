import type { Metadata } from "next";
import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google";
import "./globals.css";
import "./workspace.css";
import "./registry.css";
import "./finance.css";
import "./elos-theme.css";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Elos OS",
  description: "Sistema integrado de gestão para construtoras e incorporadoras.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${ibmPlexSans.variable} ${spaceGrotesk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
