import type { ReactNode } from "react";
import "./worksite-mobile.css";
import "../elos-redesign-round2.css";
import WorksiteMobileEnhancer from "./worksite-mobile-enhancer";

export default function ExecutionLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <WorksiteMobileEnhancer />
      <div className="elos-round2-module elos-round2-execution">{children}</div>
    </>
  );
}
