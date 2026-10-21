import {openTitleAmount,paidTitleCash,paidTitlePrincipal} from "../finance-core/titles.mjs";
// Centros de custo de incorporação: orçado (estudo de viabilidade) × apropriado (títulos rateados no centro).
// Funções puras — o carregamento do banco fica em server.ts.

export const DEVELOPMENT_CATEGORY_LABELS = {
  land: "Terreno",
  onerous_grant: "Outorga onerosa",
  design: "Projetos",
  commission: "Comissões",
  marketing: "Marketing",
  taxes: "Impostos da incorporação",
  central_office: "Administração central",
  financial: "Custo financeiro",
  cancellations: "Distratos",
};

// Comissões e impostos acompanham as vendas: a projeção usa a taxa do estudo sobre o VGV.
export const RATE_BASED_CATEGORIES = new Set(["commission", "taxes"]);

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function classifyDevelopmentCost(budget, appropriated) {
  if (budget <= 0 && appropriated > 0.01) return "no_budget";
  if (appropriated > budget + 0.01) return "over";
  if (budget > 0 && appropriated / budget >= 0.9) return "attention";
  return "ok";
}

/**
 * @param {{ centers?: Array<{id:string, code:string, description:string, development_cost_category:string}>,
 *           budgets?: Array<{service_id:string, budget_amount:number|string, source?:string}>,
 *           allocations?: Array<{payable_id:string, service_id:string|null, allocation_amount:number|string}>,
 *           payables?: Array<{id:string, status:string, amount:number|string, paid_amount?:number|string|null}> }} input
 */
export function buildDevelopmentCostSummary({ centers = [], budgets = [], allocations = [], payables = [] } = {}) {
  const payableById = new Map(payables.map((payable) => [payable.id, payable]));
  const rows = new Map(centers.map((center) => [center.id, {
    serviceId: center.id,
    code: center.code,
    name: center.description,
    category: center.development_cost_category,
    budget: 0,
    budgetSource: null,
    paid: 0,
    paidPrincipal: 0,
    open: 0,
    titles: new Set(),
  }]));

  for (const budget of budgets) {
    const row = rows.get(budget.service_id);
    if (!row) continue;
    row.budget += Math.max(0, n(budget.budget_amount));
    row.budgetSource = budget.source ?? row.budgetSource;
  }

  for (const allocation of allocations) {
    const row = allocation.service_id ? rows.get(allocation.service_id) : null;
    const payable = payableById.get(allocation.payable_id);
    if (!row || !payable || payable.status === "cancelled") continue;
    const amount = Math.max(0, n(allocation.allocation_amount));
    const titleAmount=n(payable.amount);
    row.paid += titleAmount>0 ? amount*paidTitleCash(payable)/titleAmount : 0;
    row.paidPrincipal += titleAmount>0 ? amount*paidTitlePrincipal(payable)/titleAmount : 0;
    row.open += titleAmount>0 ? amount*openTitleAmount(payable)/titleAmount : 0;
    row.titles.add(payable.id);
  }

  const resultRows = [...rows.values()]
    .map((row) => {
      const appropriated = row.paid + row.open;
      return {
        serviceId: row.serviceId,
        code: row.code,
        name: row.name,
        category: row.category,
        rateBased: RATE_BASED_CATEGORIES.has(row.category),
        budget: row.budget,
        budgetSource: row.budgetSource,
        paid: row.paid,
        paidPrincipal:row.paidPrincipal,
        basis:"financial_cash_and_open",
        economicCostCertified:false,
        open: row.open,
        appropriated,
        balance: row.budget - appropriated,
        consumptionPct: row.budget > 0 ? appropriated / row.budget * 100 : appropriated > 0 ? 100 : 0,
        titleCount: row.titles.size,
        status: classifyDevelopmentCost(row.budget, appropriated),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }));

  const totals = resultRows.reduce((sum, row) => ({
    budget: sum.budget + row.budget,
    paid: sum.paid + row.paid,
    open: sum.open + row.open,
    appropriated: sum.appropriated + row.appropriated,
    balance: sum.balance + row.balance,
  }), { budget: 0, paid: 0, open: 0, appropriated: 0, balance: 0 });

  return { rows: resultRows, totals, hasBudget: budgets.length > 0 };
}
