import type { ReactNode } from "react";
import "../elos-redesign-round2.css";

export default function FinanceLayout({ children }: { children: ReactNode }) {
  return <div className="elos-round2-module elos-round2-finance">{children}</div>;
}
