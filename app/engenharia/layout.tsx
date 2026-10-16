import type { ReactNode } from "react";
import "../elos-redesign-round2.css";

export default function EngineeringLayout({ children }: { children: ReactNode }) {
  return <div className="elos-round2-module elos-round2-engineering">{children}</div>;
}
