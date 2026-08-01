"use client";

export type SupplierOption = { id: string; legal_name: string; trade_name: string | null; tax_id: string | null };
export type BudgetOption = { id: string; code: string | null; name: string };
export type ServiceOption = { id: string; code: string; description: string; unit: string };
export type LocationOption = { id: string; code: string; name: string };
export type ActivityOption = { id: string; service_id: string | null; location_id: string | null; code: string; name: string; planned_start: string; planned_finish: string };
export type ContractItem = {
  id?: string; service_id: string; location_id: string | null; schedule_activity_id: string | null;
  service_code: string; service_name: string; location_name: string | null; unit_snapshot: string;
  contracted_quantity: number; unit_price: number; total_value: number; measured_quantity: number; measured_value: number;
  planned_start: string | null; planned_finish: string | null; scope_notes: string | null;
};
export type ContractRecord = {
  id: string; supplier_id: string; budget_id: string | null; title: string; scope_summary: string;
  start_date: string; end_date: string; signed_date: string | null; retention_percent: number; guarantee_percent: number;
  guarantee_months: number; payment_days: number; adjustment_index: string | null; adjustment_base_date: string | null;
  contact_name: string | null; contact_phone: string | null; contact_email: string | null; notes: string | null;
  status: string;
};

export function ServiceContractDialog({ contract, label }: {
  suppliers: SupplierOption[];
  budgets: BudgetOption[];
  services: ServiceOption[];
  locations: LocationOption[];
  activities: ActivityOption[];
  contract?: ContractRecord | null;
  items?: ContractItem[];
  autoOpen?: boolean;
  label?: string;
}) {
  const href = contract
    ? `/execucao/contratacoes-servicos?view=contracts&contract=${contract.id}`
    : "/execucao/contratacoes-servicos?view=requests&new=1";
  return <a className="elos-button contract-main-button" href={href}>
    {label ?? (contract ? "Abrir contrato e etapas" : "+ Iniciar contratação")}
  </a>;
}
