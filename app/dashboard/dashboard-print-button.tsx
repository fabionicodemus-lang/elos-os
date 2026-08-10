"use client";

export function DashboardPrintButton({
  label = "🖨 Exportar PDF",
  className = "v20-print-button",
}: {
  label?: string;
  className?: string;
}) {
  return <button className={className} type="button" onClick={() => window.print()}>{label}</button>;
}
