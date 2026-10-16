"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { label: string; href: string; match?: string[] };
type TabSet = { aria: string; tabs: Tab[] };

function activeFor(pathname: string, tab: Tab) {
  const matches = tab.match ?? [tab.href];
  return matches.some((match) => pathname === match || pathname.startsWith(`${match}/`));
}

function resolveTabs(pathname: string): TabSet[] {
  if (pathname.startsWith("/financeiro/")) return [{ aria: "Navegação do Financeiro", tabs: [
    { label: "Contas a Pagar", href: "/financeiro/contas-a-pagar" }, { label: "Contas a Receber", href: "/financeiro/contas-a-receber" }, { label: "Fluxo de Caixa", href: "/financeiro/fluxo-de-caixa" }, { label: "Relatórios", href: "/financeiro/relatorios" }, { label: "Notas Manuais", href: "/financeiro/notas-manuais" }, { label: "Notas Eletrônicas", href: "/financeiro/notas-eletronicas" }, { label: "Impostos", href: "/financeiro/impostos" }, { label: "Contas Bancárias", href: "/financeiro/contas-bancarias" }, { label: "Índices", href: "/financeiro/indices-de-correcao" },
  ] }];

  if (pathname.startsWith("/suprimentos/")) {
    const primary: TabSet = { aria: "Navegação de Suprimentos", tabs: [
      { label: "Compras", href: "/suprimentos/orcamentos-materiais", match: ["/suprimentos/orcamentos-materiais", "/suprimentos/pedidos-compras", "/suprimentos/recebimento-materiais", "/suprimentos/aprovacoes-compras", "/suprimentos/oportunidades"] },
      { label: "Estoque", href: "/suprimentos/estoque" },
      { label: "Controle Integrado", href: "/suprimentos/controle-integrado", match: ["/suprimentos/controle-integrado", "/suprimentos/indicadores", "/suprimentos/desempenho-fornecedores"] },
    ] };
    const sets: TabSet[] = [primary];
    if (activeFor(pathname, primary.tabs[0])) sets.push({ aria: "Etapas de Compras", tabs: [
      { label: "Cotações", href: "/suprimentos/orcamentos-materiais" }, { label: "Pedidos", href: "/suprimentos/pedidos-compras" }, { label: "Recebimentos", href: "/suprimentos/recebimento-materiais" }, { label: "Alçadas", href: "/suprimentos/aprovacoes-compras" }, { label: "Oportunidades", href: "/suprimentos/oportunidades" },
    ] });
    if (pathname.startsWith("/suprimentos/controle-integrado") || pathname.startsWith("/suprimentos/indicadores") || pathname.startsWith("/suprimentos/desempenho-fornecedores")) sets.push({ aria: "Controle e inteligência de Suprimentos", tabs: [
      { label: "Visão Integrada", href: "/suprimentos/controle-integrado" }, { label: "Indicadores", href: "/suprimentos/indicadores" }, { label: "Fornecedores", href: "/suprimentos/desempenho-fornecedores" },
    ] });
    return sets;
  }

  if (pathname.startsWith("/execucao/") || pathname.startsWith("/engenharia/custo-orcamento")) {
    const sets: TabSet[] = [{ aria: "Navegação de Obra", tabs: [
      { label: "Cronograma", href: "/execucao/cronograma" }, { label: "Custo × Orçamento", href: "/engenharia/custo-orcamento" }, { label: "Diário de Obras", href: "/execucao/diario-obras" }, { label: "Qualidade", href: "/execucao/qualidade" }, { label: "Solicitações", href: "/execucao/solicitacoes-materiais" },
      { label: "Contratos e Medições", href: "/execucao/contratos-servicos", match: ["/execucao/contratos-servicos", "/execucao/medicoes-contratos", "/execucao/medicoes-por-etapas", "/execucao/ordens-servico", "/execucao/contratacoes-servicos"] },
    ] }];
    if (["/execucao/contratos-servicos", "/execucao/medicoes-contratos", "/execucao/medicoes-por-etapas", "/execucao/ordens-servico", "/execucao/contratacoes-servicos"].some((p) => pathname.startsWith(p))) sets.push({ aria: "Contratos e Medições", tabs: [
      { label: "Contratos", href: "/execucao/contratos-servicos" }, { label: "Medições", href: "/execucao/medicoes-contratos" }, { label: "Por Etapas", href: "/execucao/medicoes-por-etapas" }, { label: "Ordens de Serviço", href: "/execucao/ordens-servico" }, { label: "Contratações", href: "/execucao/contratacoes-servicos" },
    ] });
    return sets;
  }

  if (pathname.startsWith("/engenharia/")) return [{ aria: "Navegação de Pré-Obra", tabs: [
    { label: "Orçamentos", href: "/engenharia/orcamentos", match: ["/engenharia/orcamentos", "/engenharia/orcamento-analitico"] }, { label: "Cronograma", href: "/engenharia/cronograma" }, { label: "Plano de Contratações", href: "/engenharia/plano-contratacoes" }, { label: "Suprimentos Planejados", href: "/engenharia/planejamento-suprimentos" },
  ] }];

  if (pathname.startsWith("/comercial/") && !pathname.startsWith("/comercial/incorporacao/viabilidade") && !pathname.startsWith("/comercial/incorporacao/resultado")) return [{ aria: "Navegação Comercial", tabs: [
    { label: "Propostas", href: "/comercial/propostas" }, { label: "Vendas", href: "/comercial/vendas" }, { label: "Planos", href: "/comercial/planos-de-pagamento" }, { label: "Tabelas", href: "/comercial/incorporacao/tabelas" }, { label: "Corretores", href: "/comercial/corretores" }, { label: "Carteira", href: "/comercial/incorporacao", match: ["/comercial/incorporacao"] },
  ] }];
  return [];
}

export function ModuleTabs() {
  const pathname = usePathname();
  const sets = resolveTabs(pathname);
  if (!sets.length) return null;
  return <div className="elos-module-tabs-stack">{sets.map((set, setIndex) => (
    <nav className={`elos-module-tabs ${setIndex > 0 ? "secondary" : ""}`} aria-label={set.aria} key={set.aria}>
      {set.tabs.map((tab) => <Link prefetch={false} className={activeFor(pathname, tab) ? "active" : ""} href={tab.href} key={tab.href}>{tab.label}</Link>)}
    </nav>
  ))}</div>;
}
