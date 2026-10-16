import type { ReactNode } from "react";
import "./worksite-mobile.css";
import "../elos-redesign-round2.css";
import "../elos-redesign-round2-structural.css";
import WorksiteMobileEnhancer from "./worksite-mobile-enhancer";
import Round2Structure from "../round2-structure";

export default function ExecutionLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <WorksiteMobileEnhancer />
      <div className="elos-round2-module elos-round2-execution"><Round2Structure />{children}</div>
    </>
  );
}
