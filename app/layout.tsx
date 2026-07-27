import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google";
import { GlobalSearchableSelect } from "@/components/global-searchable-select";
import { TakeoffImportGlobal } from "@/components/takeoff-import-global";
import "./globals.css";
import "./workspace.css";
import "./registry.css";
import "./finance.css";
import "./receivables.css";
import "./indices.css";
import "./cashflow.css";
import "./date-range.css";
import "./reports.css";
import "./budgets.css";
import "./services.css";
import "./inputs.css";
import "./prices.css";
import "./price-import.css";
import "./compositions.css";
import "./takeoffs.css";
import "./takeoff-import.css";
import "./analytical-budget.css";
import "./schedule.css";
import "./curves.css";
import "./contracts-plan.css";
import "./creatable-combobox.css";
import "./global-searchable-select.css";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0f1c1b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={`${ibmPlexSans.variable} ${spaceGrotesk.variable}`}>
      <body>
        {children}
        <GlobalSearchableSelect />
        <Suspense fallback={null}><TakeoffImportGlobal /></Suspense>
      </body>
    </html>
  );
}
