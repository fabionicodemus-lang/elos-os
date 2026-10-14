import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { RenegotiationBuilder } from "./renegotiation-builder";

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));
}

type Sale = {
  id: string;
  project_id: string;
  number: string;
  contract_number: string | null;
  total_amount: number;
  status: string;
  clients: { name: string } | { name: string }[] | null;
  units: { code: string } | { code: string }[] | null;
};
type Receivable = {
  id: string;
  category: string;
  description: string;
  due_date: string;
  amount: number;
  adjusted_amount: number | null;
  paid_amount: number | null;
  interest_rate_monthly: number | null;
  correction_index_id: string | null;
  status: string;
};
function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }

export default async function RenegotiatePage({
  params,
  searchParams,
}: {
  params: Promise<{ saleId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { saleId } = await params;
  const query = await searchParams;
  const { supabase, company, companyId, roleKey } = await requireCompanyPermission("commercial.incorporation.view");
  const [saleResult, receivablesResult, indicesResult, approveResult] = await Promise.all([
    supabase.from("sales").select("id,project_id,number,contract_number,total_amount,status,clients(name),units(code)").eq("id", saleId).eq("company_id", companyId).maybeSingle(),
    supabase.from("receivables").select("id,category,description,due_date,amount,adjusted_amount,paid_amount,interest_rate_monthly,correction_index_id,status").eq("company_id", companyId).eq("sale_id", saleId).eq("status", "open").order("due_date"),
    supabase.from("correction_indices").select("id,code,name").eq("company_id", companyId).eq("status", "active").order("code"),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "commercial.incorporation.approve" }),
  ]);
  if (!saleResult.data) notFound();
  const sale = saleResult.data as unknown as Sale;
  if (sale.status !== "active") redirect(`/comercial/incorporacao/${saleId}?error=${encodeURIComponent("Somente vendas ativas podem ser renegociadas.")}`);
  const canApprove = approveResult.data === true || roleKey === "owner" || roleKey === "admin";
  if (!canApprove) redirect(`/comercial/incorporacao/${saleId}?error=${encodeURIComponent("Seu perfil não pode executar renegociações.")}`);

  const receivables = (receivablesResult.data ?? []) as Receivable[];
  const partial = receivables.filter((row) => Number(row.paid_amount ?? 0) > 0);
  const currentOpen = receivables.reduce((sum, row) => sum + Math.max(Number(row.adjusted_amount || row.amount) - Number(row.paid_amount ?? 0), 0), 0);
  const client = one(sale.clients);
  const unit = one(sale.units);
  const initialRows = receivables.map((row) => ({
    category: row.category,
    description: row.description,
    due_date: row.due_date,
    amount: String(Number(row.adjusted_amount || row.amount).toFixed(2)),
    correction_index_id: row.correction_index_id ?? "",
    interest_rate_monthly: row.interest_rate_monthly == null ? "" : String(row.interest_rate_monthly),
  }));

  return <AppShell
    activeGroup="commercial"
    activeItem="incorporation"
    eyebrow="Comercial · Incorporação"
    title={`Renegociar ${unit?.code ?? sale.number}`}
    description={`${company.name} · ${client?.name ?? "Cliente"} · contrato ${sale.contract_number ?? "sem número"}`}
    actions={<>
      <Link className="elos-button" prefetch={false} href={`/comercial/incorporacao/${saleId}`}>Voltar ao dossiê</Link>
      <Link className="elos-button" prefetch={false} href={`/comercial/vendas/${saleId}`}>Plano atual</Link>
    </>}
  >
    {query.error ? <div className="auth-message error workspace-message">{query.error}</div> : null}
    {receivablesResult.error || indicesResult.error ? <div className="auth-message error workspace-message">Não foi possível carregar o plano ou os índices. Confirme as migrations do ERP de incorporação.</div> : null}

    <section className="sale-detail-hero">
      <div><span>Renegociação contratual</span><h2>{sale.number} · unidade {unit?.code ?? "—"}</h2><p>A operação preserva parcelas recebidas e cria um aditivo executado com snapshot do plano anterior e do novo plano.</p></div>
      <div className="sale-detail-values"><div><span>Valor contratual atual</span><strong>{money(sale.total_amount)}</strong></div><div><span>Saldo aberto atual</span><strong>{money(currentOpen)}</strong></div><div><span>Parcelas abertas</span><strong>{receivables.length}</strong></div></div>
    </section>

    {partial.length > 0 ? <div className="auth-message error workspace-message">
      Existem {partial.length} parcela(s) aberta(s) com pagamento parcial. A renegociação automática está bloqueada para preservar a rastreabilidade. Regularize ou desdobre essas parcelas antes de continuar.
    </div> : null}

    {!receivables.length ? <p>Não há saldo aberto para renegociar.</p> : null}
    {receivables.length && !partial.length ? <section className="registry-create" style={{ display: "block" }}>
      <div className="section-heading"><div><span>Novo fluxo</span><h2>Monte o plano substituto</h2></div></div>
      <RenegotiationBuilder saleId={saleId} currentOpen={currentOpen} initialRows={initialRows} indices={indicesResult.data ?? []} />
    </section> : null}
  </AppShell>;
}
