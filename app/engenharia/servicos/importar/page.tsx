import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireCompanyPermission } from "@/lib/workspace";
import { importEngineeringServices } from "../import-actions";

export default async function EngineeringServicesImportPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; error?: string }>;
}) {
  const params = await searchParams;
  const { company } = await requireCompanyPermission("services.manage");

  return (
    <AppShell
      activeGroup="engineering"
      activeItem="services"
      eyebrow="Engenharia · Orçamento de Obras"
      title="Importar Serviços"
      description={`${company.name} · sincronização em lote do catálogo técnico de serviços.`}
      actions={<Link className="elos-button" href="/engenharia/servicos">← Voltar aos serviços</Link>}
    >
      {params.success ? <div className="auth-message success workspace-message">{params.success}</div> : null}
      {params.error ? <div className="auth-message error workspace-message">{params.error}</div> : null}

      <section className="price-import-intro">
        <div>
          <strong>Sincronização da Base Master de Serviços</strong>
          <p>Serviços novos serão cadastrados e códigos já existentes serão atualizados sem criar duplicidades. As composições e seus coeficientes serão importados na etapa seguinte.</p>
        </div>
      </section>

      <section className="price-import-rules">
        <div>
          <span>Aba esperada</span>
          <strong>Serviços</strong>
          <small>Se a aba não existir, o sistema tentará ler a primeira aba do arquivo.</small>
        </div>
        <div>
          <span>Colunas obrigatórias</span>
          <strong>codigo_servico, descricao e unidade</strong>
        </div>
        <div>
          <span>Colunas técnicas aceitas</span>
          <strong>Grupo, método, regras, observações e status</strong>
          <small>O arquivo da Base Master do Elos Engenharia já está neste padrão.</small>
        </div>
        <div>
          <span>Importação segura</span>
          <strong>Até 5.000 linhas e 5 MB</strong>
          <small>A planilha inteira é validada antes da gravação.</small>
        </div>
      </section>

      <section className="budget-modal-form" style={{ marginTop: 18 }}>
        <form action={importEngineeringServices} className="budget-modal-form">
          <label className="price-import-file-field">
            <span>Selecione a planilha de serviços</span>
            <input name="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required />
            <small>Use o XLSX preparado a partir da Base Master de Serviços do Elos Engenharia.</small>
          </label>
          <div className="budget-modal-foot">
            <Link className="budget-secondary-button" href="/engenharia/servicos">Cancelar</Link>
            <button className="budget-primary-button" type="submit">Importar serviços</button>
          </div>
        </form>
      </section>
    </AppShell>
  );
}
