"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCompanyPermission } from "@/lib/workspace";

export async function saveContractAdjustments(formData: FormData) {
  const { supabase, companyId } = await requireCompanyPermission("sales.manage");
  const saleId = String(formData.get("sale_id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(saleId)) redirect("/comercial/vendas?error=Contrato%20inválido");
  const path = `/comercial/vendas/${saleId}`;
  const month = (name: string) => { const v = String(formData.get(name) ?? ""); return v ? `${v}-01` : null; };
  const index = (name: string) => String(formData.get(name) ?? "") || null;
  const { data, error } = await supabase.rpc("save_contract_adjustment", {
    p_company: companyId, p_sale: saleId, p_apply: formData.get("apply_existing") === "true", p_expected: index("expected_policy_id"),
    p_policy: {
      mode: String(formData.get("mode")), base_month: month("base_month"), keys_month: month("keys_month"),
      start_month: Number(formData.get("start_month")), limit_rule: String(formData.get("limit_rule")),
      pre_index_id: index("pre_index_id"), post_index_id: index("post_index_id"),
      pre_interval: Number(formData.get("pre_interval")), post_interval: Number(formData.get("post_interval")),
      pre_lag: Number(formData.get("pre_lag")), post_lag: Number(formData.get("post_lag")), reason: String(formData.get("reason") ?? ""),
    },
  });
  if (error) redirect(`${path}?error=${encodeURIComponent(error.message)}`);
  for (const route of [path, "/comercial/planos-de-pagamento", "/financeiro/contas-a-receber", "/financeiro/central-cobranca"]) revalidatePath(route);
  redirect(`${path}?success=${encodeURIComponent(`Condições registradas. ${data?.updated_installments ?? 0} parcela(s) aberta(s) elegível(is) revisada(s). Demais parcelas preservadas.`)}`);
}
