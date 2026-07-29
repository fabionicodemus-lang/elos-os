import type { ReactNode } from "react";
import { XmlImportOverlayFix } from "./xml-import-overlay-fix";
import "../../finance-electronic-invoice-import-fix.css";

export default function ElectronicInvoicesLayout({ children }: { children: ReactNode }) {
  return <><XmlImportOverlayFix />{children}</>;
}
