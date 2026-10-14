import type { ReactNode } from "react";
import "./worksite-mobile.css";
import WorksiteMobileEnhancer from "./worksite-mobile-enhancer";

export default function ExecutionLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <WorksiteMobileEnhancer />
      {children}
    </>
  );
}
