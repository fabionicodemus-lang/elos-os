"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SefazNfeLauncher() {
  const pathname = usePathname();
  if (!pathname.startsWith("/financeiro/notas-eletronicas") || pathname === "/financeiro/notas-eletronicas/sefaz") return null;
  return <Link prefetch={false} className="sefaz-floating-launcher" href="/financeiro/notas-eletronicas/sefaz" title="Consultar NF-e destinadas à SPE na SEFAZ"><span>⇩</span><strong>Importar da SEFAZ</strong></Link>;
}
