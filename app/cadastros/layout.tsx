import type { ReactNode } from "react";
import "../elos-redesign-round2.css";
import "../elos-redesign-round2-structural.css";
import "../elos-final-modules.css";
import Round2Structure from "../round2-structure";

export default function RegistryLayout({ children }: { children: ReactNode }) {
  return <div className="elos-round2-module elos-final-module elos-final-registry"><Round2Structure />{children}</div>;
}
