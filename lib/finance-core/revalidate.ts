import {revalidatePath} from "next/cache";
export function revalidateFinancialViews(){
 for(const path of ["/dashboard","/financeiro/contas-a-pagar","/financeiro/contas-a-receber","/financeiro/relatorios","/financeiro/fluxo-de-caixa","/financeiro/contas-bancarias","/comercial/planos-de-pagamento","/execucao/medicoes-contratos","/execucao/previsao-financeira"])revalidatePath(path);
}
