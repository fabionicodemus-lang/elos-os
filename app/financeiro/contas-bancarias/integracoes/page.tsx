import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { SubmitButton } from "../operacoes/submit-button";
import { issueAsaasCharge, saveBankConnection } from "../operacoes/provider-actions";
import "../operacoes/operations.css";

const money = (value: number | string | null) => Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function BankIntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; error?: string; success?: string }>;
}) {
  const params = await searchParams;
  const { supabase, company, companyId, roleKey } = await requireCompanyPermission("finance.bank_accounts.view");

  const [accountsResult, manageResult, collectResult] = await Promise.all([
    supabase.from("finance_bank_accounts").select("id,label,bank_name,bank_code").eq("company_id", companyId).eq("status", "active").order("label"),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "finance.bank_accounts.manage" }),
    supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "receivables.manage" }),
  ]);
  const accounts = accountsResult.data ?? [];
  const account = accounts.find((item) => item.id === params.account) ?? accounts[0] ?? null;
  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";
  const canCollect = collectResult.data === true || roleKey === "owner" || roleKey === "admin";

  const [connectionsResult, draftsResult, chargesResult] = account
    ? await Promise.all([
        supabase.from("finance_bank_connections").select("id,provider,label,environment,credential_ref,provider_account_ref,status,created_at").eq("company_id", companyId).eq("bank_account_id", account.id).order("created_at", { ascending: false }),
        supabase.from("finance_collection_drafts").select("id,receivable_id,amount,due_date,fine_percent,monthly_interest_percent,instructions,status,created_at").eq("company_id", companyId).eq("bank_account_id", account.id).order("created_at", { ascending: false }).limit(100),
        supabase.from("finance_collection_charges").select("id,draft_id,receivable_id,billing_type,provider,external_id,status,amount,net_amount,fee_amount,due_date,paid_at,invoice_url,bank_slip_url,pix_payload,created_at").eq("company_id", companyId).eq("bank_account_id", account.id).order("created_at", { ascending: false }).limit(100),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];

  const connections = connectionsResult.data ?? [];
  const drafts = draftsResult.data ?? [];
  const charges = chargesResult.data ?? [];
  const activeAsaas = connections.filter((item) => item.provider === "asaas" && item.status === "active");
  const error = accountsResult.error?.message || connectionsResult.error?.message || draftsResult.error?.message || chargesResult.error?.message;

  return (
    <AppShell
      activeGroup="finance"
      activeItem="bank-accounts"
      eyebrow="Financeiro · Banking"
      title="Integrações bancárias"
      description={`${company.name} · conexões, boleto, Pix e retorno automático de liquidações.`}
      actions={<><Link href="/financeiro/contas-bancarias">Contas bancárias</Link><Link href={`/financeiro/contas-bancarias/operacoes${account ? `?account=${account.id}&tab=collections` : ""}`}>Operações</Link></>}
    >
      <div className="bank-operations">
        {params.error ? <p role="alert" className="auth-message error">{params.error}</p> : null}
        {params.success ? <p role="status" className="auth-message success">{params.success}</p> : null}
        {error ? <p role="alert" className="auth-message error">{error}</p> : null}

        <section className="bank-op-panel">
          <form method="get">
            <label>Conta bancária
              <select name="account" defaultValue={account?.id ?? ""}>
                {accounts.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.bank_name}</option>)}
              </select>
            </label>
            <SubmitButton>Abrir</SubmitButton>
          </form>
        </section>

        {!account ? <section className="bank-op-panel"><h2>Nenhuma conta ativa</h2><p>Cadastre uma conta bancária antes de configurar integrações.</p></section> : <>
          <section className="bank-op-panel">
            <h2>Conexões</h2>
            <p>A chave do provedor não é salva no banco. O campo “Referência da credencial” aponta para um segredo configurado somente no servidor.</p>
            {canManage ? <form action={saveBankConnection}>
              <input type="hidden" name="account" value={account.id} />
              <label>Provedor
                <select name="provider" defaultValue="asaas"><option value="asaas">Asaas · boleto e Pix</option><option value="cnab">CNAB · remessa/retorno</option><option value="nexxera">Nexxera</option><option value="other">Outro</option></select>
              </label>
              <label>Nome da conexão<input name="label" required maxLength={120} placeholder="Ex.: Cobrança Bossa" /></label>
              <label>Ambiente<select name="environment" defaultValue="sandbox"><option value="sandbox">Sandbox / homologação</option><option value="production">Produção</option></select></label>
              <label>Referência da credencial<input name="credential_ref" placeholder="Ex.: bossa-principal" /></label>
              <label>ID da conta no provedor<input name="provider_account_ref" /></label>
              <input type="hidden" name="status" value="active" />
              <SubmitButton>Salvar conexão</SubmitButton>
            </form> : null}
            {connections.map((connection) => <details key={connection.id}>
              <summary>{connection.label} · {connection.provider.toUpperCase()} · {connection.environment === "production" ? "Produção" : "Sandbox"} · {connection.status === "active" ? "Ativa" : "Inativa"}</summary>
              <p>Referência da credencial: <strong>{connection.credential_ref ?? "—"}</strong></p>
              {connection.provider_account_ref ? <p>Conta no provedor: {connection.provider_account_ref}</p> : null}
              {connection.provider === "asaas" ? <p>Webhook: <code>/api/banking/webhooks/asaas/{connection.id}</code></p> : null}
            </details>)}
            {!connections.length ? <p>Nenhuma conexão cadastrada.</p> : null}
          </section>

          <section className="bank-op-panel">
            <h2>Emitir boleto ou Pix</h2>
            <p>A cobrança é criada no provedor com referência idempotente do Elos. Repetir a emissão recupera a cobrança existente em vez de gerar outra.</p>
            {!activeAsaas.length ? <p>Cadastre e ative uma conexão Asaas para emitir cobranças.</p> : null}
            {drafts.map((draft) => {
              const charge = charges.find((item) => item.draft_id === draft.id);
              return <details key={draft.id} open={!charge && draft.status === "draft"}>
                <summary>{draft.due_date} · {money(draft.amount)} · {charge ? `${charge.billing_type === "pix" ? "Pix" : "Boleto"} ${charge.status}` : draft.status === "issued" ? "Emitido" : draft.status === "cancelled" ? "Cancelado" : "Pronto para emissão"}</summary>
                <p>Multa {draft.fine_percent}% · juros {draft.monthly_interest_percent}%</p>
                {charge ? <>
                  <p>Provedor: {charge.provider} · ID {charge.external_id}</p>
                  <p>Bruto: {money(charge.amount)} · líquido: {charge.net_amount == null ? "aguardando" : money(charge.net_amount)} · tarifa: {money(charge.fee_amount)}</p>
                  {charge.invoice_url ? <p><a href={charge.invoice_url} target="_blank" rel="noreferrer">Abrir cobrança</a></p> : null}
                  {charge.bank_slip_url ? <p><a href={charge.bank_slip_url} target="_blank" rel="noreferrer">Abrir boleto</a></p> : null}
                  {charge.pix_payload ? <details><summary>Pix copia e cola</summary><pre>{charge.pix_payload}</pre></details> : null}
                </> : canCollect && draft.status === "draft" && activeAsaas.length ? <form action={issueAsaasCharge}>
                  <input type="hidden" name="account" value={account.id} />
                  <input type="hidden" name="draft" value={draft.id} />
                  <label>Conexão Asaas<select name="connection">{activeAsaas.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.environment}</option>)}</select></label>
                  <label>Forma<select name="billing_type"><option value="boleto">Boleto registrado</option><option value="pix">Pix cobrança</option></select></label>
                  <SubmitButton>Emitir cobrança</SubmitButton>
                </form> : null}
              </details>;
            })}
            {!drafts.length ? <p>Prepare uma cobrança na tela de Operações bancárias para iniciar.</p> : null}
          </section>

          <section className="bank-op-panel">
            <h2>Liquidações recentes</h2>
            {charges.filter((item) => item.status === "received").map((item) => <p key={item.id}>{item.paid_at ?? item.due_date} · {item.billing_type === "pix" ? "Pix" : "Boleto"} · bruto {money(item.amount)} · líquido {money(item.net_amount)} · tarifa {money(item.fee_amount)}</p>)}
            {!charges.some((item) => item.status === "received") ? <p>Nenhuma cobrança liquidada por provedor nesta conta.</p> : null}
          </section>
        </>}
      </div>
    </AppShell>
  );
}
