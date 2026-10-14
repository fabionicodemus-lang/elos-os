"use client";

import { useSearchParams } from "next/navigation";

export function FiscalExportButton() {
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const href = `/api/financeiro/exportacao-fiscal${query ? `?${query}` : ""}`;

  return (
    <div
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        zIndex: 45,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <a className="elos-button" href={href} title="Exportar dados fiscais e a apropriação da obra para a contabilidade">
        Exportar fiscal · XLSX
      </a>
    </div>
  );
}
