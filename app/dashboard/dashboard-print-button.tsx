"use client";

export function DashboardPrintButton() {
  return <button className="v20-print-button" type="button" onClick={() => window.print()}>🖨 Exportar PDF</button>;
}
