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

function findItem(group: ShellNavigationGroup | undefined, href: string) {
  return group?.items.find((item) => item.href === href);
}

function compactItem(
  label: string,
  href: string,
  source: ShellNavigationItem | undefined,
  pathname: string,
): ShellNavigationItem {
  return {
    label,
    href,
    disabled: source ? Boolean(source.disabled) : true,
    active: pathname === href || pathname.startsWith(`${href}/`),
  };
}

function buildNavigationGroups(groups: ShellNavigationGroup[], pathname: string) {
  const engineering = groups.find((group) => group.key === "engineering");
  const execution = groups.find((group) => group.key === "execution");
  const procurement = groups.find((group) => group.key === "procurement");
  const finance = groups.find((group) => group.key === "finance");
  const commercial = groups.find((group) => group.key === "commercial");
  const hr = groups.find((group) => group.key === "hr");
  const postwork = groups.find((group) => group.key === "postwork");
  const projects = groups.find((group) => group.key === "projects");
  const system = groups.find((group) => group.key === "system");

  const incorporationSource = findItem(commercial, "/comercial/incorporacao");
  const viabilityActive = pathname.startsWith("/comercial/incorporacao/viabilidade") || pathname.startsWith("/comercial/incorporacao/resultado");

  const viability: ShellNavigationGroup = {
    key: "viability",
    label: "Viabilidade",
    icon: "◈",
    active: viabilityActive,
    items: [
      compactItem("Estudo de Viabilidade", "/comercial/incorporacao/viabilidade", incorporationSource, pathname),
      compactItem("Resultado do Empreendimento", "/comercial/incorporacao/resultado", incorporationSource, pathname),
    ],
  };

  const preconstruction: ShellNavigationGroup = {
    key: "preconstruction",
    label: "Pré-Obra",
    icon: "♙",
    active: Boolean(engineering?.active) && !pathname.startsWith("/engenharia/custo-orcamento"),
    items: [
      compactItem("Orçamento", "/engenharia/orcamentos", findItem(engineering, "/engenharia/orcamentos"), pathname),
      compactItem("Cronograma", "/engenharia/cronograma", findItem(engineering, "/engenharia/cronograma"), pathname),
      compactItem("Planejamento de Contratações", "/engenharia/plano-contratacoes", findItem(engineering, "/engenharia/plano-contratacoes"), pathname),
      compactItem("Suprimentos Planejados", "/engenharia/planejamento-suprimentos", findItem(engineering, "/engenharia/planejamento-suprimentos"), pathname),
    ],
  };

  const obraActive = Boolean(execution?.active) || pathname.startsWith("/engenharia/custo-orcamento");
  const obra: ShellNavigationGroup = {
    key: "worksite",
    label: "Obra",
    icon: "✓",
    active: obraActive,
    items: [
      compactItem("Controle do Cronograma", "/execucao/cronograma", findItem(execution, "/execucao/cronograma"), pathname),
      {
        label: "Custo x Orçamento",
        href: "/engenharia/custo-orcamento",
        disabled: Boolean(findItem(engineering, "/engenharia/orcamentos")?.disabled ?? true),
        active: pathname.startsWith("/engenharia/custo-orcamento"),
      },
      compactItem("Diário de Obras", "/execucao/diario-obras", findItem(execution, "/execucao/diario-obras"), pathname),
      compactItem("Qualidade", "/execucao/qualidade", findItem(execution, "/execucao/qualidade"), pathname),
      compactItem("Solicitações de Materiais", "/execucao/solicitacoes-materiais", findItem(execution, "/execucao/solicitacoes-materiais"), pathname),
      compactItem("Contratos e Medições", "/execucao/contratos-servicos", findItem(execution, "/execucao/contratos-servicos"), pathname),
    ],
  };

  const comprasSource = findItem(procurement, "/suprimentos/pedidos-compras");
  const suprimentos: ShellNavigationGroup = {
    key: "procurement-compact",
    label: "Suprimentos",
    icon: "🛒",
    active: Boolean(procurement?.active) || pathname.startsWith("/execucao/contratacoes-servicos"),
    items: [
      compactItem("Compras", "/suprimentos/pedidos-compras", comprasSource, pathname),
      compactItem("Estoque", "/suprimentos/estoque", findItem(procurement, "/suprimentos/estoque"), pathname),
      compactItem("Controle Integrado", "/suprimentos/controle-integrado", findItem(procurement, "/suprimentos/controle-integrado"), pathname),
    ],
  };

  const financeCompact: ShellNavigationGroup = {
    key: "finance-compact",
    label: "Financeiro",
    icon: "$",
    active: Boolean(finance?.active),
    items: [
      compactItem("Contas a Pagar", "/financeiro/contas-a-pagar", findItem(finance, "/financeiro/contas-a-pagar"), pathname),
      compactItem("Contas a Receber", "/financeiro/contas-a-receber", findItem(finance, "/financeiro/contas-a-receber"), pathname),
      compactItem("Fluxo de Caixa", "/financeiro/fluxo-de-caixa", findItem(finance, "/financeiro/fluxo-de-caixa"), pathname),
      compactItem("Relatórios", "/financeiro/relatorios", findItem(finance, "/financeiro/relatorios"), pathname),
      compactItem("Notas Manuais", "/financeiro/notas-manuais", findItem(finance, "/financeiro/notas-manuais"), pathname),
      compactItem("Notas Eletrônicas · XML", "/financeiro/notas-eletronicas", findItem(finance, "/financeiro/notas-eletronicas"), pathname),
      compactItem("Impostos", "/financeiro/impostos", findItem(finance, "/financeiro/impostos"), pathname),
      compactItem("Contas Bancárias", "/financeiro/contas-bancarias", findItem(finance, "/financeiro/contas-bancarias"), pathname),
      compactItem("Índices de Correção", "/financeiro/indices-de-correcao", findItem(finance, "/financeiro/indices-de-correcao"), pathname),
    ],
  };

  const commercialActive = Boolean(commercial?.active) && !viabilityActive;
  const commercialCompact: ShellNavigationGroup = {
    key: "commercial-compact",
    label: "Comercial",
    icon: "◇",
    active: commercialActive,
    items: [
      compactItem("Propostas", "/comercial/propostas", findItem(commercial, "/comercial/propostas"), pathname),
      compactItem("Vendas", "/comercial/vendas", findItem(commercial, "/comercial/vendas"), pathname),
      compactItem("Carteira da Incorporadora", "/comercial/incorporacao", incorporationSource, pathname),
    ],
  };

  const hrCompact: ShellNavigationGroup = {
    key: "hr-compact",
    label: "RH",
    icon: "♧",
    active: Boolean(hr?.active),
    items: [
      compactItem("Colaboradores", "/rh/colaboradores", findItem(hr, "/rh/colaboradores"), pathname),
      compactItem("Folha de Pagamento", "/rh/folha", findItem(hr, "/rh/folha"), pathname),
    ],
  };

  const postworkCompact: ShellNavigationGroup = {
    key: "postwork-compact",
    label: "Pós-Obra",
    icon: "⌁",
    active: Boolean(postwork?.active),
    items: [
      compactItem("Assistências Técnicas", "/pos-obra/assistencias", findItem(postwork, "/pos-obra/assistencias"), pathname),
      compactItem("Vistorias e Chamados", "/pos-obra/vistorias", findItem(postwork, "/pos-obra/vistorias"), pathname),
      compactItem("Garantias", "/pos-obra/garantias", findItem(postwork, "/pos-obra/garantias"), pathname),
    ],
  };

  const projectsCompact: ShellNavigationGroup = {
    key: "projects-compact",
    label: "Empreendimentos",
    icon: "▦",
    active: Boolean(projects?.active),
    items: [
      compactItem("Empreendimentos", "/empreendimentos", findItem(projects, "/empreendimentos"), pathname),
      compactItem("Empresas / SPEs", "/empreendimentos/empresas", findItem(projects, "/empreendimentos/empresas"), pathname),
    ],
  };

  const systemCompact: ShellNavigationGroup = {
    key: "system-compact",
    label: "Sistema",
    icon: "⚙",
    active: Boolean(system?.active),
    items: [
      compactItem("Usuários", "/configuracoes/acessos", findItem(system, "/configuracoes/acessos"), pathname),
      compactItem("Permissões", "/configuracoes/permissoes", findItem(system, "/configuracoes/permissoes"), pathname),
      compactItem("Dados & Backup", "/configuracoes/dados-backup", findItem(system, "/configuracoes/dados-backup"), pathname),
    ],
  };

  return [
    viability,
    preconstruction,
    obra,
    suprimentos,
    financeCompact,
    commercialCompact,
    hrCompact,
    postworkCompact,
    projectsCompact,
    systemCompact,
  ];
}

export function ShellNavigation({
  groups,
  homeActive,
  assistantHref,
  assistantActive,
}: {
  groups: ShellNavigationGroup[];
  homeActive?: boolean;
  /** Link do Elos IA; ausente quando o usuário não tem a permissão. */
  assistantHref?: string;
  assistantActive?: boolean;
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
          <Link prefetch={false} className={`elos-main-item ${homeActive ? "active" : ""}`} href="/dashboard" onClick={closeMobile}>
            <span className="elos-icon">⌂</span>
            <span>Início</span>
          </Link>

          {assistantHref ? (
            <Link prefetch={false} className={`elos-main-item ${assistantActive ? "active" : ""}`} href={assistantHref} onClick={closeMobile}>
              <span className="elos-icon">✦</span>
              <span>Elos IA</span>
            </Link>
          ) : null}

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
                      <Link prefetch={false}
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
