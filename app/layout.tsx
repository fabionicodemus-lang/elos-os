import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google";
import { BudgetAnalyticalDetails } from "@/components/budget-analytical-details";
import { CurvesBarValues } from "@/components/curves-bar-values";
import { GlobalSearchableSelect } from "@/components/global-searchable-select";
import { SefazNfeLauncher } from "@/components/sefaz-nfe-launcher";
import { ServiceInlineComposition } from "@/components/service-inline-composition";
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
import "./budget-analytical-details.css";
import "./services.css";
import "./inputs.css";
import "./prices.css";
import "./price-import.css";
import "./compositions.css";
import "./services-compositions-merged.css";
import "./takeoffs.css";
import "./takeoff-import.css";
import "./analytical-budget.css";
import "./schedule.css";
import "./schedule-scrollbar.css";
import "./execution-schedule.css";
import "./physical-progress.css";
import "./projects.css";
import "./project-details.css";
import "./project-locations.css";
import "./project-units.css";
import "./legal-entities.css";
import "./curves.css";
import "./curves-bar-values.css";
import "./creatable-combobox.css";
import "./global-searchable-select.css";
import "./global-search.css";
import "./dashboard.css";
import "./taxes.css";
import "./proposals.css";
import "./brokers.css";
import "./sefaz-nfe.css";
import "./financial-installments.css";
import "./elos-theme.css";
import "./version-marker.css";

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
  title: "Elos OS · V0.71.8",
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
        <BudgetAnalyticalDetails />
        <ServiceInlineComposition />
        <CurvesBarValues />
        <GlobalSearchableSelect />
        <SefazNfeLauncher />
        <Suspense fallback={null}><TakeoffImportGlobal /></Suspense>
      </body>
    </html>
  );
}
