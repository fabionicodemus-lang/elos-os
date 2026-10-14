import { SubmitButton } from "./submit-button";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { suggestMatches } from "@/lib/banking/ofx";
import {
  importOfx,
  postDifference,
  linkEntry,
  reverseLink,
  saveSettings,
  uploadPdf,
  saveInstrument,
  changeInstrument,
  cancelCollection,
  draftCollection,
} from "./actions";
import "./operations.css";
const money = (n: number | string) =>
  Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const tabs = [
  ["reconcile", "Conciliação"],
  ["ledger", "Extrato interno"],
  ["files", "Arquivos"],
  ["settings", "Organização e fechamento"],
  ["collections", "Cobranças"],
  ["instruments", "Cartões e cheques"],
] as const;
export default async function Operations({
  searchParams,
}: {
  searchParams: Promise<{
    account?: string;
    tab?: string;
    page?: string;
    q?: string;
    error?: string;
    success?: string;
  }>;
}) {
  const p = await searchParams;
  const { supabase, companyId } = await requireCompanyPermission(
    "finance.bank_accounts.view",
  );
  const tab = tabs.some(([key]) => key === p.tab) ? p.tab! : "reconcile";
  const page = Math.max(1, parseInt(p.page ?? "1") || 1);
  const start = (page - 1) * 50;
  const [ar, gr, pr] = await Promise.all([
    supabase
      .from("finance_bank_accounts")
      .select("id,label,closed_through,bank_group_id")
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("label")
      .limit(500),
    supabase
      .from("finance_bank_groups")
      .select("id,name")
      .eq("company_id", companyId)
      .order("name")
      .limit(500),
    Promise.all(
      [
        "finance.bank_accounts.manage",
        "finance.bank_accounts.reconcile",
        "receivables.manage",
      ].map((permission) =>
        supabase.rpc("has_company_permission", {
          target_company_id: companyId,
          target_permission: permission,
        }),
      ),
    ),
  ]);
  const accounts = ar.data ?? [];
  const account = accounts.find((a) => a.id === p.account) ?? accounts[0];
  const groups = gr.data ?? [];
  const canManage = pr[0].data === true,
    canReconcile = pr[1].data === true,
    canCollect = pr[2].data === true;
  const aid = account?.id ?? "";
  const url = (t = tab, n = page) =>
    `?${new URLSearchParams({ account: aid, tab: t, page: String(n), q: p.q ?? "" })}`;
  const hidden = (
    <>
      <input type="hidden" name="account" value={aid} />
      <input type="hidden" name="tab" value={tab} />
    </>
  );
  let content: React.ReactNode = null;
  let count = 0;
  let dataError = ar.error?.message || gr.error?.message;
  if (account && !dataError) {
    if (tab === "reconcile") {
      const er = await supabase
        .from("finance_statement_balances")
        .select("*", { count: "exact" })
        .eq("company_id", companyId)
        .eq("bank_account_id", aid)
        .order("transaction_date", { ascending: false })
        .order("id")
        .range(start, start + 49);
      const entries = er.data ?? [];
      count = er.count ?? 0;
      dataError = er.error?.message;
      let tq = supabase
        .from("finance_bank_reconciliation_candidates")
        .select(
          "id,transaction_date,remaining_amount,direction,description,status",
        )
        .eq("company_id", companyId)
        .eq("bank_account_id", aid)
        .gt("remaining_amount", 0)
        .order("transaction_date", { ascending: false })
        .limit(100);
      if (p.q) tq = tq.ilike("description", `%${p.q.replace(/[%_]/g, "")}%`);
      const tr = await tq;
      const transactions = (tr.data ?? []).map((t) => ({
        ...t,
        amount: Number(t.remaining_amount),
      }));
      const lr = entries.length
        ? await supabase
            .from("finance_reconciliation_links")
            .select("*")
            .eq("company_id", companyId)
            .in(
              "entry_id",
              entries.map((e) => e.id),
            )
            .is("reversed_at", null)
        : { data: [], error: null };
      const links = lr.data ?? [];
      dataError = dataError || tr.error?.message || lr.error?.message;
      content = (
        <>
          <section className="bank-op-panel">
            <h2>Extrato bancário e correspondências</h2>
            <p>
              Importar não altera o saldo interno nem dá baixa em títulos.
              Confirme os vínculos após conferir os documentos. Cada movimento
              pode ser dividido entre vários lançamentos.
            </p>
            {canManage && (
              <form action={importOfx}>
                {hidden}
                <label>
                  Extrato OFX (até 4 MB)
                  <input name="file" type="file" accept=".ofx" required />
                </label>
                <SubmitButton>Importar OFX</SubmitButton>
              </form>
            )}
            <form method="get">
              {hidden}
              <input type="hidden" name="tab" value="reconcile" />
              <label>
                Buscar lançamento interno
                <input
                  name="q"
                  defaultValue={p.q}
                  placeholder="Descrição do pagamento ou recebimento"
                />
              </label>
              <SubmitButton>Buscar</SubmitButton>
            </form>
            <small>
              Seleção mostra até 100 lançamentos internos abertos. Refine a
              busca quando necessário.
            </small>
          </section>
          {entries.map((e) => {
            const rowLinks = links.filter((l) => l.entry_id === e.id);
            const remaining = Number(e.remaining_amount);
            const suggestions = suggestMatches(
              { ...e, amount: Number(e.amount) > 0 ? remaining : -remaining },
              transactions,
            );
            return (
              <section className="bank-op-panel" key={e.id}>
                <div className="bank-op-heading">
                  <div>
                    <small>
                      {e.transaction_date} · FITID {e.fit_id}
                    </small>
                    <h3>{e.description}</h3>
                  </div>
                  <strong>{money(e.amount)}</strong>
                </div>
                <p>
                  {remaining === 0
                    ? "Conferido com o banco"
                    : `Restante a vincular: ${money(remaining)}`}
                </p>
                {canReconcile && remaining > 0 && (
                  <form action={linkEntry}>
                    {hidden}
                    <input type="hidden" name="entry" value={e.id} />
                    <label>
                      Lançamento correspondente
                      <select name="transaction" required defaultValue="">
                        <option value="" disabled>
                          Selecione após conferir
                        </option>
                        {suggestions.length > 0 && (
                          <optgroup label="Sugestões por valor, natureza e proximidade de data">
                            {suggestions.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.transaction_date} · {t.description} ·{" "}
                                {money(t.amount)}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        <optgroup label="Lançamentos disponíveis">
                          {transactions
                            .filter(
                              (t) =>
                                Number(e.amount) > 0 ===
                                (t.direction === "credit"),
                            )
                            .map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.transaction_date} · {t.description} ·{" "}
                                {money(t.amount)}
                              </option>
                            ))}
                        </optgroup>
                      </select>
                    </label>
                    <label>
                      Valor do vínculo
                      <input
                        type="number"
                        name="amount"
                        min="0.01"
                        max={remaining}
                        step="0.01"
                        defaultValue={remaining.toFixed(2)}
                        required
                      />
                    </label>
                    <SubmitButton>Confirmar vínculo</SubmitButton>
                  </form>
                )}
                {canManage && canReconcile && remaining > 0 && (
                  <details>
                    <summary>
                      Registrar tarifa ou diferença de {money(remaining)}
                    </summary>
                    <p>
                      Use somente se a diferença ainda não existe nos
                      lançamentos internos. Esta confirmação cria um lançamento
                      e vincula todo o restante do movimento.
                    </p>
                    <form action={postDifference}>
                      {hidden}
                      <input type="hidden" name="entry" value={e.id} />
                      <label>
                        Tipo
                        <select name="type">
                          <option value="fee">Tarifa</option>
                          <option value="interest">Juros</option>
                          <option value="adjustment">Ajuste</option>
                        </select>
                      </label>
                      <label>
                        Justificativa
                        <input name="reason" minLength={5} required />
                      </label>
                      <SubmitButton>
                        Registrar e conciliar {money(remaining)}
                      </SubmitButton>
                    </form>
                  </details>
                )}
                {rowLinks.map((l) => (
                  <details key={l.id}>
                    <summary>
                      Vínculo de {money(l.amount)} ·{" "}
                      {new Date(l.created_at).toLocaleDateString("pt-BR")}
                    </summary>
                    {canReconcile && (
                      <form action={reverseLink}>
                        {hidden}
                        <input type="hidden" name="link" value={l.id} />
                        <label>
                          Motivo para desfazer
                          <input name="reason" minLength={5} required />
                        </label>
                        <SubmitButton>Desfazer vínculo</SubmitButton>
                      </form>
                    )}
                  </details>
                ))}
              </section>
            );
          })}
          {!entries.length && (
            <p>Nenhum movimento bancário importado nesta página.</p>
          )}
        </>
      );
    }
    if (tab === "ledger") {
      const r = await supabase
        .from("finance_bank_ledger")
        .select(
          "id,transaction_date,description,direction,amount,running_balance,status",
          { count: "exact" },
        )
        .eq("company_id", companyId)
        .eq("bank_account_id", aid)
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(start, start + 49);
      count = r.count ?? 0;
      dataError = r.error?.message;
      content = (
        <section className="bank-op-panel">
          <h2>Saldo acumulado por movimento</h2>
          <p>
            Saldo calculado pelos registros do Elos. Cancelamentos não alteram o
            saldo.
          </p>
          <div className="registry-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th>Valor</th>
                  <th>Saldo após movimento</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {r.data?.map((t) => (
                  <tr key={t.id}>
                    <td>{t.transaction_date}</td>
                    <td>{t.description}</td>
                    <td>
                      {money(t.direction === "debit" ? -t.amount : t.amount)}
                    </td>
                    <td>{money(t.running_balance)}</td>
                    <td>
                      {t.status === "reconciled"
                        ? "Conciliado"
                        : t.status === "cancelled"
                          ? "Cancelado"
                          : "A conferir"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      );
    }
    if (tab === "settings") {
      const r = await supabase
        .from("finance_bank_audit")
        .select("id,event,details,created_at", { count: "exact" })
        .eq("company_id", companyId)
        .eq("bank_account_id", aid)
        .order("created_at", { ascending: false })
        .range(start, start + 49);
      count = r.count ?? 0;
      dataError = r.error?.message;
      const br = await supabase
        .from("finance_bank_group_balances")
        .select("id,bank_group_id,balance")
        .eq("company_id", companyId)
        .limit(500);
      const balances = br.data ?? [];
      dataError = dataError || br.error?.message;
      content = (
        <>
          <section className="bank-op-panel">
            <h2>Grupos de contas</h2>
            {[...groups, { id: null, name: "Sem grupo" }].map((g) => (
              <p key={g.id ?? "none"}>
                <strong>{g.name}</strong> ·{" "}
                {balances
                  .filter((a) => a.bank_group_id === g.id)
                  .some((a) => a.balance === null)
                  ? "Saldo indisponível"
                  : money(
                      balances
                        .filter((a) => a.bank_group_id === g.id)
                        .reduce((sum, a) => sum + (a.balance ?? 0), 0),
                    )}
              </p>
            ))}
          </section>
          <section className="bank-op-panel">
            <h2>Organização e fechamento</h2>
            <p>
              Fechado até:{" "}
              <strong>{account.closed_through ?? "Nenhum período"}</strong>. O
              fechamento exige conciliação comprovada de todos os movimentos até
              a data.
            </p>
            {canManage && (
              <form action={saveSettings}>
                {hidden}
                <label>
                  Grupo
                  <input
                    name="group"
                    list="bank-groups"
                    defaultValue={
                      groups.find((g) => g.id === account.bank_group_id)
                        ?.name ?? ""
                    }
                    maxLength={100}
                  />
                  <datalist id="bank-groups">
                    {groups.map((g) => (
                      <option key={g.id} value={g.name} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Fechar até (vazio reabre todos os períodos)
                  <input
                    name="closed"
                    type="date"
                    defaultValue={account.closed_through ?? ""}
                  />
                </label>
                <label>
                  Motivo da alteração
                  <input name="reason" required minLength={5} />
                </label>
                <SubmitButton>Salvar organização e fechamento</SubmitButton>
              </form>
            )}
          </section>
          <section className="bank-op-panel">
            <h2>Histórico de operações</h2>
            {r.data?.map((a) => (
              <details key={a.id}>
                <summary>
                  {new Date(a.created_at).toLocaleString("pt-BR")} ·{" "}
                  {(
                    {
                      settings: "Organização ou fechamento",
                      ofx_import: "Importação OFX",
                      reconciliation_link: "Conciliação confirmada",
                      reconciliation_reversed: "Conciliação desfeita",
                      statement_difference: "Tarifa ou diferença registrada",
                      instrument_status: "Situação de cartão ou cheque",
                      collection_cancelled: "Rascunho cancelado",
                    } as Record<string, string>
                  )[a.event] ?? "Operação bancária"}
                </summary>
                <p>{a.details.reason ?? "Operação registrada no histórico."}</p>
                {a.details.amount != null && (
                  <p>Valor: {money(a.details.amount)}</p>
                )}
                {a.event === "settings" && (
                  <p>
                    Fechamento anterior: {a.details.old_closed ?? "Aberto"} ·
                    Novo fechamento: {a.details.closed ?? "Aberto"}
                  </p>
                )}
              </details>
            ))}
          </section>
        </>
      );
    }
    if (tab === "files") {
      const [r, imports, transactionOptions] = await Promise.all([
        supabase
          .from("finance_bank_documents")
          .select("*", { count: "exact" })
          .eq("company_id", companyId)
          .eq("bank_account_id", aid)
          .order("created_at", { ascending: false })
          .range(start, start + 49),
        supabase
          .from("finance_bank_imports")
          .select("id,file_name,entry_count,created_at", { count: "exact" })
          .eq("company_id", companyId)
          .eq("bank_account_id", aid)
          .order("created_at", { ascending: false })
          .range(start, start + 49),
        supabase
          .from("finance_bank_transactions")
          .select("id,description,transaction_date,amount")
          .eq("company_id", companyId)
          .eq("bank_account_id", aid)
          .neq("status", "cancelled")
          .ilike("description", `%${(p.q ?? "").replace(/[%_]/g, "")}%`)
          .order("transaction_date", { ascending: false })
          .limit(100),
      ]);
      count = Math.max(r.count ?? 0, imports.count ?? 0);
      dataError =
        r.error?.message ||
        imports.error?.message ||
        transactionOptions.error?.message;
      const files = await Promise.all(
        (r.data ?? []).map(async (d) => {
          const signed = await supabase.storage
            .from("bank-documents")
            .createSignedUrl(d.storage_path, 300);
          return { ...d, url: signed.data?.signedUrl };
        }),
      );
      content = (
        <>
          <section className="bank-op-panel">
            <h2>Extratos PDF e comprovantes</h2>
            <p>
              Documentos privados. O PDF é arquivado para conferência; não há
              extração automática de transações.
            </p>
            <form method="get">
              {hidden}
              <label>
                Buscar lançamento para vincular o comprovante
                <input name="q" defaultValue={p.q} />
              </label>
              <SubmitButton>Buscar</SubmitButton>
            </form>
            <small>
              Seleção limitada aos 100 lançamentos mais recentes da busca.
            </small>
            {canManage && (
              <form action={uploadPdf}>
                {hidden}
                <label>
                  PDF (até 4 MB)
                  <input
                    name="file"
                    type="file"
                    accept="application/pdf"
                    required
                  />
                </label>
                <label>
                  Tipo
                  <select name="kind">
                    <option value="statement">Extrato</option>
                    <option value="receipt">Comprovante</option>
                  </select>
                </label>
                <label>
                  Lançamento vinculado (opcional)
                  <select name="transaction">
                    <option value="">Sem vínculo</option>
                    {transactionOptions.data?.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.transaction_date} · {t.description} ·{" "}
                        {money(t.amount)}
                      </option>
                    ))}
                  </select>
                </label>
                <SubmitButton>Arquivar PDF</SubmitButton>
              </form>
            )}
            {files.map((f) => (
              <p key={f.id}>
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noreferrer">
                    {f.file_name}
                  </a>
                ) : (
                  f.file_name
                )}{" "}
                · {new Date(f.created_at).toLocaleDateString("pt-BR")}
              </p>
            ))}
          </section>
          <section className="bank-op-panel">
            <h2>Histórico de importação OFX</h2>
            {imports.data?.map((i) => (
              <p key={i.id}>
                {i.file_name} · {i.entry_count} novos movimentos ·{" "}
                {new Date(i.created_at).toLocaleString("pt-BR")}
              </p>
            ))}
          </section>
        </>
      );
    }
    if (tab === "collections") {
      const [r, receivables] = await Promise.all([
        supabase
          .from("finance_collection_drafts")
          .select("*", { count: "exact" })
          .eq("company_id", companyId)
          .eq("bank_account_id", aid)
          .order("created_at", { ascending: false })
          .range(start, start + 49),
        supabase
          .from("receivables")
          .select("id,description,amount,adjusted_amount,due_date")
          .eq("company_id", companyId)
          .eq("status", "open")
          .order("due_date")
          .limit(100),
      ]);
      count = r.count ?? 0;
      dataError = r.error?.message || receivables.error?.message;
      content = (
        <section className="bank-op-panel">
          <h2>Preparação de cobranças</h2>
          <p>
            <strong>Registro bancário ainda não habilitado.</strong> Estes
            registros são rascunhos internos. Não são boletos, não possuem
            código de barras e não devem ser enviados como cobrança registrada.
            A emissão e os retornos dependem de um conector homologado.
          </p>
          {canCollect && (
            <form action={draftCollection}>
              {hidden}
              <label>
                Parcela (100 próximos vencimentos)
                <select name="receivable" required defaultValue="">
                  <option value="" disabled>
                    Selecione
                  </option>
                  {receivables.data?.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.due_date} · {r.description} ·{" "}
                      {money(r.adjusted_amount ?? r.amount)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Multa (%)
                <input
                  name="fine"
                  type="number"
                  step="0.001"
                  min="0"
                  max="100"
                  defaultValue="0"
                />
              </label>
              <label>
                Juros mensais (%)
                <input
                  name="interest"
                  type="number"
                  step="0.001"
                  min="0"
                  max="100"
                  defaultValue="0"
                />
              </label>
              <label>
                Instruções
                <textarea name="instructions" maxLength={2000} />
              </label>
              <SubmitButton>Preparar rascunho</SubmitButton>
            </form>
          )}
          {r.data?.map((d) => (
            <details key={d.id}>
              <summary>
                {d.due_date} · {money(d.amount)} ·{" "}
                {d.status === "cancelled"
                  ? "Rascunho cancelado"
                  : "Rascunho não registrado"}
              </summary>
              <p>
                Multa: {d.fine_percent}% · Juros mensais:{" "}
                {d.monthly_interest_percent}%
              </p>
              <p>{d.instructions}</p>
              {canCollect && d.status === "draft" && (
                <form action={cancelCollection}>
                  {hidden}
                  <input name="draft" type="hidden" value={d.id} />
                  <label>
                    Motivo do cancelamento
                    <input name="reason" minLength={5} required />
                  </label>
                  <SubmitButton>Cancelar rascunho</SubmitButton>
                </form>
              )}
            </details>
          ))}
        </section>
      );
    }
    if (tab === "instruments") {
      const r = await supabase
        .from("finance_bank_instruments")
        .select("*", { count: "exact" })
        .eq("company_id", companyId)
        .eq("bank_account_id", aid)
        .order("created_at", { ascending: false })
        .range(start, start + 49);
      count = r.count ?? 0;
      dataError = r.error?.message;
      content = (
        <section className="bank-op-panel">
          <h2>Cartões e cheques</h2>
          <p>
            Cadastro interno. Registre somente os últimos quatro dígitos do
            cartão. A compensação de cheque registra a saída no Elos e deve
            corresponder a uma operação já realizada no banco.
          </p>
          {canManage && (
            <form action={saveInstrument}>
              {hidden}
              <label>
                Tipo
                <select name="kind">
                  <option value="card">Cartão</option>
                  <option value="cheque">Cheque</option>
                </select>
              </label>
              <label>
                Identificação / número do cheque
                <input name="label" required maxLength={120} />
              </label>
              <label>
                Últimos 4 dígitos (cartão)
                <input name="last_four" pattern="[0-9]{4}" maxLength={4} />
              </label>
              <label>
                Valor do cheque
                <input name="amount" type="number" min="0.01" step="0.01" />
              </label>
              <label>
                Data prevista do cheque
                <input name="due" type="date" />
              </label>
              <SubmitButton>Cadastrar</SubmitButton>
            </form>
          )}
          {r.data?.map((i) => (
            <details key={i.id}>
              <summary>
                {i.kind === "card" ? "Cartão" : "Cheque"} · {i.label}
                {i.last_four ? ` · final ${i.last_four}` : ""} ·{" "}
                {i.status === "active"
                  ? "Ativo"
                  : i.status === "settled"
                    ? "Compensado"
                    : "Cancelado"}{" "}
                {i.amount ? money(i.amount) : ""}
              </summary>
              {canManage && i.status === "active" && (
                <form action={changeInstrument}>
                  {hidden}
                  <input type="hidden" name="instrument" value={i.id} />
                  <label>
                    Ação
                    <select name="cancel">
                      <option value="1">Cancelar cadastro</option>
                      {i.kind === "cheque" && (
                        <option value="0">Registrar compensação interna</option>
                      )}
                    </select>
                  </label>
                  <label>
                    Data da compensação
                    <input name="date" type="date" />
                  </label>
                  <label>
                    Motivo / referência
                    <input name="reason" minLength={5} required />
                  </label>
                  <SubmitButton>Confirmar registro</SubmitButton>
                </form>
              )}
            </details>
          ))}
        </section>
      );
    }
  }
  return (
    <AppShell
      activeGroup="finance"
      activeItem="bank-accounts"
      eyebrow="Financeiro"
      title="Operações bancárias"
      description="Extratos, conciliação e controle das contas"
      actions={
        <Link href="/financeiro/contas-bancarias">Voltar às contas</Link>
      }
    >
      <div className="bank-operations">
        {p.error && (
          <p role="alert" className="auth-message error">
            {p.error}
          </p>
        )}
        {p.success && (
          <p role="status" className="auth-message success">
            {p.success}
          </p>
        )}
        {dataError ? (
          <p role="alert">
            Não foi possível carregar as operações bancárias. A estrutura
            precisa estar disponível e seu perfil deve ter acesso.
          </p>
        ) : (
          <>
            <form method="get" className="bank-op-panel">
              <label>
                Conta bancária
                <select name="account" defaultValue={aid}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </label>
              <input type="hidden" name="tab" value={tab} />
              <SubmitButton>Abrir conta</SubmitButton>
            </form>
            <nav aria-label="Operações bancárias">
              {tabs.map(([key, label]) => (
                <Link
                  key={key}
                  aria-current={tab === key ? "page" : undefined}
                  href={url(key, 1)}
                >
                  {label}
                </Link>
              ))}
            </nav>
            {account ? (
              content
            ) : (
              <p>Cadastre uma conta bancária para começar.</p>
            )}
            <div className="registry-pagination">
              <span>
                {count} registros · página {page}
              </span>
              <div>
                {page > 1 && <Link href={url(tab, page - 1)}>Anterior</Link>}
                {start + 50 < count && (
                  <Link href={url(tab, page + 1)}>Próxima</Link>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
