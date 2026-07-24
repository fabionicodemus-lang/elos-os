"use client";

import { useRef } from "react";
import { CreatableCombobox } from "@/components/creatable-combobox";
import {
  closeBudgetRevision,
  createBudgetGroup,
  createBudgetItem,
  updateBudget,
} from "../actions";

type Budget = {
  id: string;
  code: string;
  name: string;
  version: string;
  status: "draft" | "in_progress" | "review" | "approved" | "archived";
  reference_date: string | null;
  area_m2: number;
  notes: string | null;
};

type BudgetGroup = {
  id: string;
  code: string;
  name: string;
};

const statusLabels: Record<Budget["status"], string> = {
  draft: "Rascunho",
  in_progress: "Em elaboração",
  review: "Em revisão",
  approved: "Revisão fechada",
  archived: "Arquivado",
};

export function BudgetRevisionDialogs({
  budget,
  groups,
  units,
  itemCount,
}: {
  budget: Budget;
  groups: BudgetGroup[];
  units: string[];
  itemCount: number;
}) {
  const generalRef = useRef<HTMLDialogElement>(null);
  const groupRef = useRef<HTMLDialogElement>(null);
  const serviceRef = useRef<HTMLDialogElement>(null);

  return (
    <div className="budget-header-actions">
      <button className="elos-button" type="button" onClick={() => generalRef.current?.showModal()}>
        Dados da revisão
      </button>
      {budget.status !== "archived" ? (
        <>
          <button className="elos-button" type="button" onClick={() => groupRef.current?.showModal()}>
            + Grupo
          </button>
          <button className="elos-button budget-primary-button" type="button" onClick={() => serviceRef.current?.showModal()}>
            + Serviço
          </button>
        </>
      ) : null}
      {!['approved', 'archived'].includes(budget.status) ? (
        <form action={closeBudgetRevision}>
          <input type="hidden" name="budget_id" value={budget.id} />
          <button className="elos-button budget-close-revision-button" type="submit">
            Fechar revisão
          </button>
        </form>
      ) : null}

      <dialog ref={generalRef} className="budget-modal">
        <form action={updateBudget} className="budget-modal-form">
          <input type="hidden" name="budget_id" value={budget.id} />
          <header className="budget-modal-head">
            <div><span>Orçamento de Obras</span><h2>Dados da revisão</h2></div>
            <button type="button" className="budget-modal-close" onClick={() => generalRef.current?.close()} aria-label="Fechar">×</button>
          </header>
          <div className="budget-modal-body budget-modal-grid">
            <label><span>Código</span><input name="code" defaultValue={budget.code} required /></label>
            <label><span>Revisão</span><input name="version" defaultValue={budget.version} required /></label>
            <label className="budget-modal-wide"><span>Nome</span><input name="name" defaultValue={budget.name} required /></label>
            <label><span>Status</span><select name="status" defaultValue={budget.status}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>Data-base</span><input name="reference_date" type="date" defaultValue={budget.reference_date ?? ""} /></label>
            <label><span>Área construída (m²)</span><input name="area_m2" type="number" min="0" step="0.01" defaultValue={budget.area_m2} /></label>
            <label className="budget-modal-wide"><span>Premissas e observações</span><textarea name="notes" rows={4} defaultValue={budget.notes ?? ""} /></label>
          </div>
          <footer className="budget-modal-foot">
            <button type="button" className="budget-secondary-button" onClick={() => generalRef.current?.close()}>Cancelar</button>
            <button type="submit" className="budget-primary-button">Salvar revisão</button>
          </footer>
        </form>
      </dialog>

      <dialog ref={groupRef} className="budget-modal budget-modal-small">
        <form action={createBudgetGroup} className="budget-modal-form">
          <input type="hidden" name="budget_id" value={budget.id} />
          <header className="budget-modal-head">
            <div><span>Estrutura analítica</span><h2>Novo grupo ou etapa</h2></div>
            <button type="button" className="budget-modal-close" onClick={() => groupRef.current?.close()} aria-label="Fechar">×</button>
          </header>
          <div className="budget-modal-body budget-modal-grid">
            <label><span>Código</span><input name="code" placeholder="Ex.: 01" required autoFocus /></label>
            <label><span>Ordem</span><input name="sort_order" type="number" defaultValue={groups.length + 1} /></label>
            <label className="budget-modal-wide"><span>Nome do grupo</span><input name="name" placeholder="Ex.: Serviços preliminares" required /></label>
            <label className="budget-modal-wide"><span>Observações</span><textarea name="notes" rows={3} /></label>
          </div>
          <footer className="budget-modal-foot">
            <button type="button" className="budget-secondary-button" onClick={() => groupRef.current?.close()}>Cancelar</button>
            <button type="submit" className="budget-primary-button">Adicionar grupo</button>
          </footer>
        </form>
      </dialog>

      <dialog ref={serviceRef} className="budget-modal budget-service-modal">
        <form action={createBudgetItem} className="budget-modal-form">
          <input type="hidden" name="budget_id" value={budget.id} />
          <header className="budget-modal-head">
            <div><span>Planilha orçamentária</span><h2>Adicionar serviço</h2></div>
            <button type="button" className="budget-modal-close" onClick={() => serviceRef.current?.close()} aria-label="Fechar">×</button>
          </header>
          <div className="budget-modal-body budget-modal-grid budget-service-grid">
            <label><span>Grupo</span><select name="group_id" defaultValue=""><option value="">Sem grupo</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.code} · {group.name}</option>)}</select></label>
            <label><span>Código</span><input name="code" placeholder="Ex.: 01.001" /></label>
            <label className="budget-modal-wide"><span>Descrição do serviço</span><input name="description" placeholder="Serviço conforme projeto, memorial e critério de medição" required /></label>
            <label>
              <span>Unidade</span>
              <CreatableCombobox
                name="unit"
                options={units}
                initialValue="un"
                placeholder="Pesquise uma unidade"
                required
                createLabel="Criar nova unidade"
              />
            </label>
            <label><span>Quantidade</span><input name="quantity" type="number" min="0" step="0.000001" defaultValue="0" /></label>
            <label><span>Material por un.</span><input name="material_unit_cost" type="number" min="0" step="0.000001" defaultValue="0" /></label>
            <label><span>Mão de obra por un.</span><input name="labor_unit_cost" type="number" min="0" step="0.000001" defaultValue="0" /></label>
            <label><span>Equipamento por un.</span><input name="equipment_unit_cost" type="number" min="0" step="0.000001" defaultValue="0" /></label>
            <label><span>Outros por un.</span><input name="other_unit_cost" type="number" min="0" step="0.000001" defaultValue="0" /></label>
            <label><span>Ordem</span><input name="sort_order" type="number" defaultValue={itemCount + 1} /></label>
            <label className="budget-modal-wide"><span>Observações</span><textarea name="notes" rows={3} /></label>
          </div>
          <footer className="budget-modal-foot">
            <button type="button" className="budget-secondary-button" onClick={() => serviceRef.current?.close()}>Cancelar</button>
            <button type="submit" className="budget-primary-button">Incluir serviço</button>
          </footer>
        </form>
      </dialog>
    </div>
  );
}
