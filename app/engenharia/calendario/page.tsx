import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { deleteCalendarException, saveCalendarException, seedNationalHolidays } from "./actions";
import "../../preconstruction-95.css";

type CalendarRow = { id: string; exception_date: string; exception_type: "non_working" | "working"; name: string; source: string; notes: string | null };

function dateBR(value: string) { const [y,m,d] = value.slice(0,10).split("-"); return `${d}/${m}/${y}`; }

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ year?: string; success?: string; error?: string }> }) {
  const params = await searchParams;
  const year = /^20\d{2}$/.test(params.year ?? "") ? params.year! : String(new Date().getFullYear());
  const { supabase, company, companyId, projectId, roleKey } = await requireCompanyPermission("schedule.view");
  const rowsResult = projectId
    ? await supabase.from("engineering_schedule_calendar_exceptions").select("id, exception_date, exception_type, name, source, notes")
        .eq("company_id", companyId).eq("project_id", projectId).gte("exception_date", `${year}-01-01`).lte("exception_date", `${year}-12-31`).order("exception_date")
    : { data: [], error: null };
  const canManage = roleKey === "owner" || roleKey === "admin"
    ? true
    : (await supabase.rpc("has_company_permission", { target_company_id: companyId, target_permission: "schedule.manage" })).data === true;
  const rows = (rowsResult.data ?? []) as CalendarRow[];
  const nonWorking = rows.filter((item) => item.exception_type === "non_working").length;
  const working = rows.filter((item) => item.exception_type === "working").length;

  return (
    <AppShell activeGroup="engineering" activeItem="calendar" eyebrow="Engenharia · Planejamento" title="Calendário da obra"
      description={`${company.name} · feriados, recessos e dias de trabalho excepcionais usados no cronograma.`}
      actions={<><Link prefetch={false} className="elos-button" href="/engenharia/preobra">Painel Pré-Obra</Link><Link prefetch={false} className="elos-button" href="/engenharia/cronograma">Cronograma</Link></>}>
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}
      {rowsResult.error ? <div className="auth-message error workspace-message">O calendário exige a migration do pacote Pré-Obra 9.5.</div> : null}
      {!projectId ? <div className="pre95-empty">Selecione uma obra.</div> : null}
      {projectId ? <>
        <section className="pre95-summary">
          <article><span>Ano</span><strong>{year}</strong><small>calendário ativo</small></article>
          <article><span>Não trabalhados</span><strong>{nonWorking}</strong><small>feriados e recessos</small></article>
          <article><span>Trabalho excepcional</span><strong>{working}</strong><small>domingos/sábados liberados manualmente</small></article>
          <article><span>Exceções totais</span><strong>{rows.length}</strong><small>usadas no cálculo de término</small></article>
        </section>

        <section className="pre95-card pre95-calendar-tools">
          <form method="get"><label><span>Ano</span><input name="year" type="number" min="2000" max="2100" defaultValue={year} /></label><button type="submit">Abrir ano</button></form>
          {canManage ? <form action={seedNationalHolidays}><input type="hidden" name="year" value={year} /><div><span>Calendário brasileiro</span><strong>Carregar datas nacionais</strong><small>Depois revise feriados estaduais, municipais e recessos específicos da obra.</small></div><button type="submit">Carregar {year}</button></form> : null}
        </section>

        {canManage ? <section className="pre95-card">
          <div className="pre95-heading"><div><span>Nova exceção</span><h2>Alterar um dia do calendário padrão</h2></div><p>O cronograma continua respeitando domingo e a configuração de sábado da linha de base.</p></div>
          <form action={saveCalendarException} className="pre95-form-grid">
            <label><span>Data</span><input name="exception_date" type="date" defaultValue={`${year}-01-01`} required /></label>
            <label><span>Tipo</span><select name="exception_type" defaultValue="non_working"><option value="non_working">Não trabalhar</option><option value="working">Trabalhar excepcionalmente</option></select></label>
            <label className="pre95-wide"><span>Motivo</span><input name="name" placeholder="Feriado municipal, recesso, concretagem especial..." required /></label>
            <label className="pre95-wide"><span>Observações</span><input name="notes" /></label>
            <button type="submit">Salvar exceção</button>
          </form>
        </section> : null}

        <section className="pre95-card">
          <div className="pre95-heading"><div><span>{year}</span><h2>Exceções cadastradas</h2></div><p>Estas datas alteram o cálculo de dias úteis das atividades.</p></div>
          <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>Data</th><th>Regra</th><th>Descrição</th><th>Origem</th><th>Observações</th><th>Ação</th></tr></thead><tbody>
            {rows.map((row) => <tr key={row.id}><td><strong>{dateBR(row.exception_date)}</strong></td><td><span className={`calendar-badge ${row.exception_type}`}>{row.exception_type === "working" ? "TRABALHAR" : "NÃO TRABALHAR"}</span></td><td>{row.name}</td><td>{row.source === "feriados_br" ? "Calendário BR" : "Manual"}</td><td>{row.notes ?? "—"}</td><td>{canManage ? <form action={deleteCalendarException}><input type="hidden" name="id" value={row.id} /><input type="hidden" name="year" value={year} /><button className="pre95-danger" type="submit">Remover</button></form> : "—"}</td></tr>)}
            {!rows.length ? <tr><td colSpan={6}>Nenhuma exceção cadastrada para {year}.</td></tr> : null}
          </tbody></table></div>
        </section>
      </> : null}
    </AppShell>
  );
}