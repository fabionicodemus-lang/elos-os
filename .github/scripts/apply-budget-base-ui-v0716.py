from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: esperado 1 trecho, encontrado {count}")
    return text.replace(old, new, 1)


def update(path: str, transform):
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    updated = transform(text)
    if updated == text:
        raise RuntimeError(f"{path}: nenhuma alteração aplicada")
    file.write_text(updated, encoding="utf-8")


def app_shell(text: str) -> str:
    text = replace_once(
        text,
        '  const analyticalBudgetHref = can("budgets.view") ? "/engenharia/orcamento-analitico" : undefined;\n',
        '',
        'remover href analítico',
    )
    text = replace_once(
        text,
        '      { label: "Cadastro de Orçamentos", href: budgetsHref, active: activeItem === "budgets", disabled: !budgetsHref },',
        '      { label: "Orçamentos", href: budgetsHref, active: activeItem === "budgets", disabled: !budgetsHref },',
        'renomear menu',
    )
    text = replace_once(
        text,
        '      { label: "Orçamento Analítico", href: analyticalBudgetHref, active: activeItem === "analytical-budget", disabled: !analyticalBudgetHref },\n',
        '',
        'remover menu analítico',
    )
    return text


def project_switcher(text: str) -> str:
    if 'V0.71.5' not in text:
        raise RuntimeError('versão V0.71.5 não encontrada')
    return text.replace('V0.71.5', 'V0.71.6')


def budget_list(text: str) -> str:
    text = replace_once(
        text,
        '  notes: string | null;\n  updated_at: string;\n};',
        '  notes: string | null;\n  is_base: boolean;\n  base_set_at: string | null;\n  updated_at: string;\n};',
        'tipo do orçamento na lista',
    )
    text = replace_once(
        text,
        '.select("id, code, name, version, status, reference_date, area_m2, notes, updated_at")',
        '.select("id, code, name, version, status, reference_date, area_m2, notes, is_base, base_set_at, updated_at")',
        'consulta da lista',
    )
    text = replace_once(text, '  approved: "Revisão fechada",', '  approved: "Aprovado",', 'status aprovado lista')
    text = replace_once(
        text,
        '  const latestBudget = activeBudgets[0] ?? null;\n  const latestMetrics = latestBudget ? metricsByBudget.get(latestBudget.id) ?? buildMetrics([]) : buildMetrics([]);',
        '  const baseBudget = activeBudgets.find((budget) => budget.is_base) ?? null;\n  const latestBudget = baseBudget ?? activeBudgets[0] ?? null;\n  const latestMetrics = latestBudget ? metricsByBudget.get(latestBudget.id) ?? buildMetrics([]) : buildMetrics([]);',
        'orçamento base nos indicadores',
    )
    text = replace_once(text, '      title="Visão geral do orçamento"', '      title="Orçamentos"', 'título da tela')
    text = replace_once(text, '<span className="active">▦ Visão geral</span>', '<span className="active">▦ Orçamentos</span>', 'aba ativa')
    text = replace_once(text, '<span>Revisões ativas</span>', '<span>Orçamentos ativos</span>', 'kpi ativos')
    text = replace_once(text, '<span>Serviços na revisão atual</span>', '<span>Serviços no orçamento base</span>', 'kpi serviços')
    text = replace_once(text, '<span>Custo total da revisão atual</span>', '<span>Custo total do orçamento base</span>', 'kpi custo')
    text = replace_once(
        text,
        '<td><span className={`budget-status ${budget.status}`}>{statusLabels[budget.status]}</span></td>',
        '<td><span className={`budget-status ${budget.status}`}>{statusLabels[budget.status]}</span>{budget.is_base ? <span className="budget-base-badge">Orçamento base</span> : null}</td>',
        'badge base na lista',
    )
    return text


def budget_actions(text: str) -> str:
    text = replace_once(
        text,
        '.select("id, project_id, status")',
        '.select("id, project_id, status, is_base")',
        'consulta de ação',
    )
    text = replace_once(
        text,
        '  redirect(detailUrl(budgetId, "Revisão fechada e registrada como referência da obra.", "success"));',
        '  redirect(detailUrl(budgetId, "Orçamento aprovado. Agora ele pode ser salvo como orçamento base da obra.", "success"));',
        'mensagem de aprovação',
    )
    marker = 'export async function archiveBudget(formData: FormData) {'
    insertion = '''export async function setBudgetAsBase(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  if (!budgetId) redirect(listUrl("Orçamento inválido."));

  const { supabase, companyId, budget } = await findBudget(budgetId, true);
  if (!budget) redirect(listUrl("Orçamento não localizado."));

  const { error } = await supabase.rpc("set_engineering_budget_base", {
    p_company_id: companyId,
    p_project_id: budget.project_id,
    p_budget_id: budgetId,
  });

  if (error) redirect(detailUrl(budgetId, error.message));
  revalidatePath(LIST_PATH);
  revalidatePath(detailPath(budgetId));
  revalidatePath("/engenharia/orcamento-analitico");
  revalidatePath("/execucao/solicitacoes-materiais");
  redirect(detailUrl(budgetId, "Orçamento salvo como base. Novos centros de custo serão gerados a partir desta revisão.", "success"));
}

export async function deleteBudget(formData: FormData) {
  const budgetId = text(formData, "budget_id");
  if (!budgetId) redirect(listUrl("Orçamento inválido."));

  const { supabase, companyId, budget } = await findBudget(budgetId, true);
  if (!budget) redirect(listUrl("Orçamento não localizado."));

  const { error } = await supabase.rpc("delete_engineering_budget", {
    p_company_id: companyId,
    p_project_id: budget.project_id,
    p_budget_id: budgetId,
  });

  if (error) redirect(detailUrl(budgetId, error.message));
  revalidatePath(LIST_PATH);
  revalidatePath("/engenharia/orcamento-analitico");
  revalidatePath("/execucao/solicitacoes-materiais");
  redirect(listUrl("Orçamento excluído com sucesso.", "success"));
}

'''
    text = replace_once(text, marker, insertion + marker, 'ações de base e exclusão')
    return text


def budget_dialogs(text: str) -> str:
    text = replace_once(
        text,
        '  closeBudgetRevision,\n  createBudgetGroup,\n  createBudgetItem,\n  updateBudget,',
        '  closeBudgetRevision,\n  createBudgetGroup,\n  createBudgetItem,\n  deleteBudget,\n  setBudgetAsBase,\n  updateBudget,',
        'imports das ações',
    )
    text = replace_once(
        text,
        '  notes: string | null;\n};',
        '  notes: string | null;\n  is_base: boolean;\n  base_set_at: string | null;\n};',
        'tipo do orçamento no diálogo',
    )
    text = replace_once(text, '  approved: "Revisão fechada",', '  approved: "Aprovado",', 'status aprovado diálogo')
    text = replace_once(
        text,
        '  itemCount,\n}: {\n  budget: Budget;\n  groups: BudgetGroup[];\n  units: string[];\n  itemCount: number;\n}) {',
        '  itemCount,\n  hasCostCenterTransactions,\n}: {\n  budget: Budget;\n  groups: BudgetGroup[];\n  units: string[];\n  itemCount: number;\n  hasCostCenterTransactions: boolean;\n}) {',
        'prop de lançamentos',
    )
    old = '''      {!['approved', 'archived'].includes(budget.status) ? (
        <form action={closeBudgetRevision}>
          <input type="hidden" name="budget_id" value={budget.id} />
          <button className="elos-button budget-close-revision-button" type="submit">
            Fechar revisão
          </button>
        </form>
      ) : null}
'''
    new = '''      {!['approved', 'archived'].includes(budget.status) ? (
        <form action={closeBudgetRevision}>
          <input type="hidden" name="budget_id" value={budget.id} />
          <button className="elos-button budget-close-revision-button" type="submit">
            Aprovar orçamento
          </button>
        </form>
      ) : null}
      {budget.status === "approved" && !budget.is_base ? (
        <form action={setBudgetAsBase}>
          <input type="hidden" name="budget_id" value={budget.id} />
          <button className="elos-button budget-base-button" type="submit">Salvar como orçamento base</button>
        </form>
      ) : null}
      {budget.is_base ? <span className="budget-base-badge budget-base-badge-header">Orçamento base</span> : null}
      <form
        action={deleteBudget}
        onSubmit={(event) => {
          if (!window.confirm(`Excluir definitivamente o orçamento ${budget.code} · ${budget.version}?`)) event.preventDefault();
        }}
      >
        <input type="hidden" name="budget_id" value={budget.id} />
        <button
          className="elos-button elos-button-danger"
          type="submit"
          disabled={hasCostCenterTransactions}
          title={hasCostCenterTransactions ? "Este orçamento possui lançamentos nos centros de custo e não pode ser excluído." : "Excluir orçamento e seus dados internos."}
        >
          Excluir orçamento
        </button>
      </form>
'''
    text = replace_once(text, old, new, 'botões de aprovação base e exclusão')
    return text


def budget_detail(text: str) -> str:
    text = replace_once(
        text,
        '  notes: string | null;\n  updated_at: string;\n};',
        '  notes: string | null;\n  is_base: boolean;\n  base_set_at: string | null;\n  updated_at: string;\n};',
        'tipo do orçamento no detalhe',
    )
    text = replace_once(text, '  approved: "Revisão fechada",', '  approved: "Aprovado",', 'status aprovado detalhe')
    text = replace_once(
        text,
        '.select("id, code, name, version, status, reference_date, area_m2, notes, updated_at")',
        '.select("id, code, name, version, status, reference_date, area_m2, notes, is_base, base_set_at, updated_at")',
        'consulta do detalhe',
    )
    text = replace_once(
        text,
        '''  const inputUnitsQuery = supabase
    .from("engineering_inputs")
    .select("unit")
    .eq("company_id", companyId)
    .limit(10000);

  const [''',
        '''  const inputUnitsQuery = supabase
    .from("engineering_inputs")
    .select("unit")
    .eq("company_id", companyId)
    .limit(10000);
  let transactionsQuery = supabase
    .from("execution_material_requests")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("budget_id", budgetId);
  if (projectId) transactionsQuery = transactionsQuery.eq("project_id", projectId);

  const [''',
        'consulta de lançamentos',
    )
    text = replace_once(
        text,
        '    inputUnitsResult,\n  ] = await Promise.all([',
        '    inputUnitsResult,\n    transactionsResult,\n  ] = await Promise.all([',
        'resultado de lançamentos',
    )
    text = replace_once(
        text,
        '    serviceUnitsQuery,\n    inputUnitsQuery,\n  ]);',
        '    serviceUnitsQuery,\n    inputUnitsQuery,\n    transactionsQuery,\n  ]);',
        'promise de lançamentos',
    )
    text = replace_once(
        text,
        '  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";\n  const project = projectResult.data;',
        '  const canManage = manageResult.data === true || roleKey === "owner" || roleKey === "admin";\n  const hasCostCenterTransactions = Number(transactionsResult.count ?? 0) > 0;\n  const project = projectResult.data;',
        'indicador de lançamentos',
    )
    text = replace_once(text, '      title="Orçamento analítico"', '      title="Orçamento"', 'título detalhe')
    text = replace_once(
        text,
        '{canManage ? <BudgetRevisionDialogs budget={budget} groups={groups} units={units} itemCount={items.length} /> : null}',
        '{canManage ? <BudgetRevisionDialogs budget={budget} groups={groups} units={units} itemCount={items.length} hasCostCenterTransactions={hasCostCenterTransactions} /> : null}',
        'prop no detalhe',
    )
    text = replace_once(
        text,
        '{canManage && budget.status !== "archived" ? (',
        '{canManage && budget.status !== "archived" && !budget.is_base ? (',
        'não arquivar base',
    )
    text = replace_once(text, '<Link href="/engenharia/orcamentos">▦ Visão geral</Link>', '<Link href="/engenharia/orcamentos">▦ Orçamentos</Link>', 'voltar para orçamentos')
    text = replace_once(
        text,
        '<span className={`budget-status ${budget.status}`}>{statusLabels[budget.status]}</span>\n          <small>',
        '<span className={`budget-status ${budget.status}`}>{statusLabels[budget.status]}</span>\n          {budget.is_base ? <span className="budget-base-badge">Orçamento base</span> : null}\n          <small>',
        'badge no detalhe',
    )
    text = replace_once(
        text,
        '  const structureError = budgetResult.error || groupsResult.error || itemsResult.error;',
        '  const structureError = budgetResult.error || groupsResult.error || itemsResult.error || transactionsResult.error;',
        'erro de lançamentos',
    )
    return text


def material_requests(text: str) -> str:
    text = replace_once(
        text,
        'type Budget = { id: string; code: string; name: string; version: string; status: string; updated_at: string };',
        'type Budget = { id: string; code: string; name: string; version: string; status: string; is_base: boolean; updated_at: string };',
        'tipo orçamento solicitações',
    )
    text = replace_once(
        text,
        '.select("id, code, name, version, status, updated_at")',
        '.select("id, code, name, version, status, is_base, updated_at")',
        'consulta orçamento solicitações',
    )
    text = replace_once(
        text,
        '  const approvedBudget = budgets[0] ?? null;',
        '  const approvedBudget = budgets.find((budget) => budget.is_base) ?? null;',
        'seleção da base',
    )
    text = replace_once(
        text,
        '    description={`${company.name} · ${context} · materiais apropriados diretamente aos serviços do orçamento.`}',
        '    description={`${company.name} · ${context} · materiais apropriados diretamente aos serviços do orçamento base.`}',
        'descrição da base',
    )
    text = replace_once(
        text,
        'A obra precisa ter um orçamento com status <strong>Revisão fechada</strong> antes de solicitar materiais.',
        'A obra precisa ter um orçamento <strong>aprovado e salvo como orçamento base</strong> antes de solicitar materiais.',
        'mensagem sem base',
    )
    return text


def analytical_redirect(text: str) -> str:
    old = '''  if (!budgetId) {
    const { data: latestBudget } = await supabase
      .from("engineering_budgets")
      .select("id")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    budgetId = latestBudget?.id ?? null;
  }
'''
    new = '''  if (!budgetId) {
    const { data: baseBudget } = await supabase
      .from("engineering_budgets")
      .select("id")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .eq("status", "approved")
      .eq("is_base", true)
      .maybeSingle();

    budgetId = baseBudget?.id ?? null;
  }

  if (!budgetId) {
    const { data: latestBudget } = await supabase
      .from("engineering_budgets")
      .select("id")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .neq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    budgetId = latestBudget?.id ?? null;
  }
'''
    return replace_once(text, old, new, 'preferir orçamento base')


def budgets_css(text: str) -> str:
    marker = '/* Budget base V0.71.6 */'
    if marker in text:
        return text
    return text + '''

/* Budget base V0.71.6 */
.budget-base-badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  margin-top: 0.35rem;
  padding: 0.24rem 0.55rem;
  border: 1px solid #8fc9b5;
  border-radius: 999px;
  background: #e1f5ed;
  color: #075c48;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.budget-base-badge-header {
  margin-top: 0;
  min-height: 2.35rem;
  padding-inline: 0.8rem;
}

.budget-base-button {
  border-color: #087965 !important;
  background: #087965 !important;
  color: #fff !important;
}

.budget-header-actions form:has(button:disabled) {
  cursor: not-allowed;
}

.budget-header-actions button:disabled {
  cursor: not-allowed;
  opacity: 0.46;
}
'''


update('components/app-shell.tsx', app_shell)
update('components/project-switcher.tsx', project_switcher)
update('app/engenharia/orcamentos/page.tsx', budget_list)
update('app/engenharia/orcamentos/actions.ts', budget_actions)
update('app/engenharia/orcamentos/[budgetId]/budget-revision-dialogs.tsx', budget_dialogs)
update('app/engenharia/orcamentos/[budgetId]/page.tsx', budget_detail)
update('app/execucao/solicitacoes-materiais/page.tsx', material_requests)
update('app/engenharia/orcamento-analitico/page.tsx', analytical_redirect)
update('app/budgets.css', budgets_css)
