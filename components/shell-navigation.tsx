"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export type ShellNavigationItem = {
  label: string;
  href?: string;
  active?: boolean;
  disabled?: boolean;
  sectionLabel?: string;
};

export type ShellNavigationGroup = {
  key: string;
  label: string;
  icon: string;
  active?: boolean;
  items: ShellNavigationItem[];
};

function Logo() {
  return (
    <div className="elos-logo">
      <div className="elos-logo-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M7 4h10M7 20h10M6 4l6 8-6 8M18 4l-6 8 6 8" />
        </svg>
      </div>
      <div className="elos-logo-text">
        <strong>Elos OS</strong>
        <span>Construção conectada</span>
      </div>
    </div>
  );
}

function buildNavigationGroups(groups: ShellNavigationGroup[], pathname: string) {
  const engineering = groups.find((group) => group.key === "engineering");
  const execution = groups.find((group) => group.key === "execution");
  const budgetAccess = engineering?.items.find(
    (item) => !item.sectionLabel && (item.href === "/engenharia/orcamentos" || item.label === "Orçamentos"),
  );
  const scheduleItem = execution?.items.find((item) => item.href === "/execucao/cronograma");
  const contractsItem = engineering?.items.find((item) => item.href === "/engenharia/contratos");

  const controlItems: ShellNavigationItem[] = [
    {
      label: "Custos x Orçamento",
      href: "/engenharia/custo-orcamento",
      disabled: budgetAccess ? Boolean(budgetAccess.disabled) : true,
      active: pathname.startsWith("/engenharia/custo-orcamento"),
    },
    scheduleItem
      ? {
          ...scheduleItem,
          label: "Controle do Cronograma",
          active: pathname.startsWith("/execucao/cronograma"),
        }
      : {
          label: "Controle do Cronograma",
          disabled: true,
        },
    contractsItem
      ? {
          ...contractsItem,
          label: "Controle de Contratos",
          active: pathname.startsWith("/engenharia/contratos"),
        }
      : {
          label: "Controle de Contratos",
          disabled: true,
        },
  ];

  const controlActive = controlItems.some((item) => item.active);
  const navigationGroups: ShellNavigationGroup[] = [];

  for (const group of groups) {
    if (group.key === "engineering") {
      navigationGroups.push({
        ...group,
        label: "Pré-Obra",
        active: controlActive ? false : group.active,
        items: group.items.filter((item) => item.href !== "/engenharia/contratos"),
      });
      navigationGroups.push({
        key: "control",
        label: "Controle",
        icon: "◎",
        active: controlActive,
        items: controlItems,
      });
      continue;
    }

    if (group.key === "execution") {
      navigationGroups.push({
        ...group,
        active: controlActive ? false : group.active,
        items: group.items.filter((item) => item.href !== "/execucao/cronograma"),
      });
      continue;
    }

    navigationGroups.push(group);
  }

  return navigationGroups;
}

export function ShellNavigation({
  groups,
  homeActive,
}: {
  groups: ShellNavigationGroup[];
  homeActive?: boolean;
}) {
  const pathname = usePathname();
  const navigationGroups = buildNavigationGroups(groups, pathname);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(navigationGroups.filter((group) => group.active).map((group) => group.key)),
  );

  function toggleGroup(key: string) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function closeMobile() {
    setMobileOpen(false);
  }

  return (
    <>
      <button
        className="elos-mobile-menu-button"
        type="button"
        aria-label="Abrir menu"
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen(true)}
      >
        <span />
        <span />
        <span />
      </button>

      {mobileOpen ? <button className="elos-sidebar-backdrop" type="button" aria-label="Fechar menu" onClick={closeMobile} /> : null}

      <aside className={`elos-sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="elos-sidebar-top">
          <Logo />
          <button className="elos-mobile-close" type="button" aria-label="Fechar menu" onClick={closeMobile}>×</button>
        </div>

        <nav className="elos-module-menu" aria-label="Menu principal do Elos OS">
          <Link className={`elos-main-item ${homeActive ? "active" : ""}`} href="/dashboard" onClick={closeMobile}>
            <span className="elos-icon">⌂</span>
            <span>Início</span>
          </Link>

          {navigationGroups.map((group) => {
            const open = openGroups.has(group.key) || Boolean(group.active);
            return (
              <div className={`elos-module-group ${open ? "open" : ""}`} key={group.key}>
                <button
                  className={`elos-main-item ${group.active ? "active" : ""}`}
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                >
                  <span className="elos-icon">{group.icon}</span>
                  <span>{group.label}</span>
                  <span className="module-chevron">›</span>
                </button>
                <div className="elos-subnav">
                  {group.items.map((item, index) =>
                    item.sectionLabel ? (
                      <div className="elos-subtitle" key={`${group.key}-section-${index}`}>{item.sectionLabel}</div>
                    ) : item.href && !item.disabled ? (
                      <Link
                        className={item.active ? "active" : ""}
                        href={item.href}
                        key={`${group.key}-${item.label}`}
                        onClick={closeMobile}
                      >
                        {item.label}
                      </Link>
                    ) : (
                      <span className="elos-subnav-disabled" key={`${group.key}-${item.label}`}>{item.label}</span>
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="elos-sidebar-foot">
          <strong>Elos OS</strong>
          <span>Sistema Integrado</span>
          <small>Empreendimentos, engenharia e gestão conectados</small>
        </div>
      </aside>
    </>
  );
}
