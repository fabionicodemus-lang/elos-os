import type { ReactNode } from "react";
import "../elos-redesign-round2.css";
import "../elos-redesign-round2-structural.css";
import Round2Structure from "../round2-structure";

export default function ProcurementLayout({ children }: { children: ReactNode }) {
  return <div className="elos-round2-module elos-round2-procurement"><Round2Structure />{children}</div>;
}
