"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ModuleTabs } from "@/components/module-tabs";

export default function Round2Structure() {
  const [tabsHost, setTabsHost] = useState<HTMLElement | null>(null);
  const [searchHost, setSearchHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    document.body.classList.add("elos-round2-active");

    const pageTop = document.querySelector<HTMLElement>(".elos-page-top");
    let localTabsHost = document.getElementById("elos-round2-tabs-host");
    if (pageTop && !localTabsHost) {
      localTabsHost = document.createElement("div");
      localTabsHost.id = "elos-round2-tabs-host";
      pageTop.insertAdjacentElement("afterend", localTabsHost);
    }

    const logo = document.querySelector<HTMLElement>(".elos-logo");
    let localSearchHost = document.getElementById("elos-round2-search-host");
    if (logo && !localSearchHost) {
      localSearchHost = document.createElement("div");
      localSearchHost.id = "elos-round2-search-host";
      logo.insertAdjacentElement("afterend", localSearchHost);
    }

    setTabsHost(localTabsHost as HTMLElement | null);
    setSearchHost(localSearchHost as HTMLElement | null);

    return () => {
      document.body.classList.remove("elos-round2-active");
      localTabsHost?.remove();
      localSearchHost?.remove();
    };
  }, []);

  const openSearch = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  };

  return (
    <>
      {tabsHost ? createPortal(<ModuleTabs />, tabsHost) : null}
      {searchHost ? createPortal(
        <button className="elos-sidebar-search-v2" type="button" onClick={openSearch} aria-label="Buscar no Elos OS">
          <span aria-hidden="true">⌕</span>
          <strong>Buscar</strong>
          <kbd>Ctrl K</kbd>
        </button>,
        searchHost,
      ) : null}
    </>
  );
}
