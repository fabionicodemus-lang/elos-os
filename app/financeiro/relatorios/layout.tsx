import { Suspense, type ReactNode } from "react";
import { FiscalExportButton } from "./fiscal-export-button";

export default function FinancialReportsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <FiscalExportButton />
      </Suspense>
    </>
  );
}
