import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { SubmitButton } from "../operacoes/submit-button";
import { cancelCardPurchase, closeCardCycle, payCardCycle, postCardPurchase, saveCardSettings } from "./actions";
import "../operacoes/operations.css";

const money = (value: number | string | null) => Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const today = () => new Date().toISOString().slice(0, 10);

export default async function CardsPage({ searchParams }: {
  searchParams: Promise<{ instrument?: string; error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, roleKey } = await requireCompanyPermission("finance.bank_accounts.view");
  const [cardsResult, accountsResult, projectsResult, permissionResult] = await Promise.all([
    supabase.from("finance_bank_instruments").select("id,bank_account_id,label,last_four,status,card_limit,closing_day,card_due_day").eq("company_id", companyId).eq("kind", "card").order("label"),
    supabase.from("finance_bank_accounts").select("id,label,bank_name").eq("company_id", companyId).eq("status", "active").order("label"),
    supabase.from("projects").select("id,name,code").eq("company_id", companyId).neq("status", "archived").order("name"),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "finance.bank_accounts.manage" }),
  ]);
  const cards = cardsResult.data ?? [];
  const card = cards.find((item) => item.id === params.instrument) ?? cards[0] ?? null;
  const accounts = accountsResult.data ?? [];
  const projects = projectsResult.data ?? [];
  const canManage = permissionResult.data === true || roleKey === "owner" || roleKey === "admin";

  const [cyclesResult, purchasesResult] = card
    ? await Promise.all([
        supabase.from("finance_card_cycle_balances").select("id,reference_month,closing_date,due_date,status,total_amount,paid_amount,remaining_amount").eq("company_id", companyId).eq("instrument_id", card.id).order("reference_month", { ascending: false }).limit(36),
        supabase.from("finance_card_transactions").select("id,cycle_id,project_id,purchase_date,description,amount,installment_number,installment_total,purchase_group,status,cancellation_reason").eq("company_id", companyId).order("purchase_date", { ascending: false }).limit(500),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  const cycles = cyclesResult.data ?? [];
  const cycleIds = new Set(cycles.map((cycle) => cycle.id));
  const purchases = (purchasesResult.data ?? []).filter((purchase) => cycleIds.has(purchase.cycle_id));
  const error = cardsResult.error?.message || accountsResult.error?.message || projectsResult.error?.message || cyclesResult.error?.message || purchasesResult.error?.message;

  return <AppShell
    activeGroup="finance"
    activeItem="bank-accounts"
    eyebrow="Financeiro · Banking"
    title="Cartões corporativos"
    description={`${company.name} · compras, parcelamentos, fechamento e pagamento de faturas.`}
    actions={<><Link href="/financeiro/contas-bancarias">Contas bancárias</Link><Link href="/financeiro/contas-bancarias/operacoes?tab=instruments">Cartões e cheques</Link></>}
  >
    <div className="bank-operations">
      {params.error ? <p role="alert" className="auth-message error">{params.error}</p> : null}
      {params.success ? <p role="status" className="auth-message success">{params.success}</p> : null}
      {error ? <p role="alert" className="auth-message error">{error}</p> : null}

      <section className="bank-op-panel">
        <form method="get">
          <label>Cartão
            <select name="instrument" defaultValue={card?.id ?? ""}>
              {cards.map((item) => <option key={item.id} value={item.id}>{item.label}{item.last_four ? ` · final ${item.last_four}` : ""}</option>)}
            </select>
          </label>
          <SubmitButton>Abrir</SubmitButton>
        </form>
        {!cards.length ? <p>Cadastre um cartão em Operações bancárias → Cartões e cheques.</p> : null}
      </section>

      {card ? <>
        <section className="bank-op-panel">
          <h2>Configuração</h2>
          <p>{card.label}{card.last_four ? ` · final ${card.last_four}` : ""} · {card.status === "active" ? "Ativo" : "Inativo"}</p>
          {canManage ? <form action={saveCardSettings}>
            <input type="hidden" name="instrument" value={card.id} />
            <label>Limite<input name="limit" type="number" min="0.01" step="0.01" defaultValue={card.card_limit ?? ""} /></label>
            <label>Dia de fechamento<input name="closing_day" type="number" min="1" max="28" defaultValue={card.closing_day ?? 20} required /></label>
            <label>Dia de vencimento<input name="due_day" type="number" min="1" max="28" defaultValue={card.card_due_day ?? 27} required /></label>
            <SubmitButton>Salvar configuração</SubmitButton>
          </form> : null}
        </section>

        <section className="bank-op-panel">
          <h2>Nova compra</h2>
          <p>Parcelamentos são distribuídos automaticamente pelas faturas futuras conforme o dia de fechamento.</p>
          {canManage ? <form action={postCardPurchase}>
            <input type="hidden" name="instrument" value={card.id} />
            <label>Data<input name="purchase_date" type="date" defaultValue={today()} required /></label>
            <label>Descrição<input name="description" required maxLength={250} /></label>
            <label>Valor total<input name="total" type="number" min="0.01" step="0.01" required /></label>
            <label>Parcelas<input name="installments" type="number" min="1" max="48" defaultValue="1" required /></label>
            <label>Obra<select name="project"><option value="">Corporativo / sem obra</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code ? `${project.code} · ` : ""}{project.name}</option>)}</select></label>
            <label>Referência externa opcional<input name="external_reference" maxLength={180} /></label>
            <SubmitButton>Lançar compra</SubmitButton>
          </form> : null}
        </section>

        {cycles.map((cycle) => {
          const rows = purchases.filter((purchase) => purchase.cycle_id === cycle.id);
          const groups = [...new Map(rows.map((row) => [row.purchase_group, row])).values()];
          return <section className="bank-op-panel" key={cycle.id}>
            <div className="bank-op-heading"><div><small>{cycle.reference_month.slice(0,7)} · fecha {cycle.closing_date} · vence {cycle.due_date}</small><h2>Fatura {cycle.status === "open" ? "aberta" : cycle.status === "closed" ? "fechada" : cycle.status === "paid" ? "paga" : "cancelada"}</h2></div><strong>{money(cycle.total_amount)}</strong></div>
            <p>Pago: {money(cycle.paid_amount)} · saldo: {money(cycle.remaining_amount)}</p>
            <div className="registry-table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Parcela</th><th>Obra</th><th>Valor</th><th>Situação</th></tr></thead><tbody>
              {rows.map((row) => { const project = projects.find((item) => item.id === row.project_id); return <tr key={row.id}><td>{row.purchase_date}</td><td>{row.description}</td><td>{row.installment_number}/{row.installment_total}</td><td>{project?.code ?? project?.name ?? "Corporativo"}</td><td>{money(row.amount)}</td><td>{row.status === "active" ? "Ativa" : "Cancelada"}</td></tr>; })}
            </tbody></table></div>
            {canManage && cycle.status === "open" ? <>
              <form action={closeCardCycle}><input type="hidden" name="instrument" value={card.id} /><input type="hidden" name="cycle" value={cycle.id} /><SubmitButton>Fechar fatura</SubmitButton></form>
              {groups.filter((row) => row.status === "active").map((row) => <details key={row.purchase_group}><summary>Cancelar compra: {row.description}</summary><form action={cancelCardPurchase}><input type="hidden" name="instrument" value={card.id} /><input type="hidden" name="purchase_group" value={row.purchase_group} /><label>Motivo<input name="reason" minLength={5} required /></label><SubmitButton>Cancelar todas as parcelas</SubmitButton></form></details>)}
            </> : null}
            {canManage && cycle.status === "closed" && Number(cycle.remaining_amount) > 0 ? <form action={payCardCycle}>
              <input type="hidden" name="instrument" value={card.id} /><input type="hidden" name="cycle" value={cycle.id} />
              <label>Conta de pagamento<select name="account" defaultValue={card.bank_account_id}>{accounts.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.bank_name}</option>)}</select></label>
              <label>Data<input name="date" type="date" defaultValue={today()} required /></label>
              <label>Valor<input name="amount" type="number" min="0.01" max={Number(cycle.remaining_amount)} step="0.01" defaultValue={Number(cycle.remaining_amount).toFixed(2)} required /></label>
              <SubmitButton>Registrar pagamento</SubmitButton>
            </form> : null}
          </section>;
        })}
        {!cycles.length ? <section className="bank-op-panel"><p>As faturas serão criadas automaticamente ao lançar a primeira compra.</p></section> : null}
      </> : null}
    </div>
  </AppShell>;
}
