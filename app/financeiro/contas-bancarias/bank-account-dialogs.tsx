"use client";

import { useMemo, useRef, useState } from "react";
import { postBankTransaction, saveBankAccount, transferBankAccounts } from "./actions";

export type BankLegalEntityOption = { id: string; legal_name: string; trade_name: string | null; cnpj: string | null };
export type BankProjectOption = { id: string; name: string; code: string | null; legal_entity_id: string | null };
export type BankAccountOption = {
  id: string;
  legal_entity_id: string | null;
  label: string;
  bank_code: string | null;
  bank_name: string;
  agency: string | null;
  account_number: string;
  account_digit: string | null;
  account_type: string;
  pix_key: string | null;
  opening_balance: number;
  opening_balance_date: string;
  allow_negative: boolean;
  is_default: boolean;
  status: "active" | "inactive";
  notes: string | null;
  balance: number;
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function money(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}

const accountTypeLabels: Record<string, string> = {
  checking: "Conta corrente",
  savings: "Poupança",
  payment: "Conta de pagamento",
  investment: "Aplicação",
  cash: "Caixa físico",
};

export function BankAccountDialog({ legalEntities, initial, label }: {
  legalEntities: BankLegalEntityOption[];
  initial?: BankAccountOption | null;
  label?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  return <>
    <button className={initial ? "bank-card-action" : "elos-button"} type="button" onClick={() => dialogRef.current?.showModal()}>{label ?? (initial ? "Editar" : "+ Nova conta")}</button>
    <dialog className="bank-dialog" ref={dialogRef}>
      <form action={saveBankAccount}>
        <input type="hidden" name="account_id" value={initial?.id ?? ""} />
        <header><div><span>Financeiro · Contas bancárias</span><h2>{initial ? "Editar conta bancária" : "Nova conta bancária"}</h2><p>Conta utilizada nas baixas, movimentações e conciliações.</p></div><button type="button" onClick={() => dialogRef.current?.close()}>×</button></header>
        <div className="bank-dialog-body">
          <div className="bank-form-grid">
            <label className="wide">Empresa / SPE<select name="legal_entity_id" defaultValue={initial?.legal_entity_id ?? ""}><option value="">Conta corporativa da empresa</option>{legalEntities.map((entity) => <option key={entity.id} value={entity.id}>{entity.trade_name || entity.legal_name}{entity.cnpj ? ` · ${entity.cnpj}` : ""}</option>)}</select></label>
            <label>Nome da conta<input name="label" defaultValue={initial?.label ?? ""} placeholder="Ex.: Conta operacional Bossa" required /></label>
            <label>Banco<input name="bank_name" defaultValue={initial?.bank_name ?? ""} placeholder="Ex.: Sicredi" required /></label>
            <label>Código do banco<input name="bank_code" defaultValue={initial?.bank_code ?? ""} placeholder="Ex.: 748" /></label>
            <label>Agência<input name="agency" defaultValue={initial?.agency ?? ""} /></label>
            <label>Número da conta<input name="account_number" defaultValue={initial?.account_number ?? ""} required /></label>
            <label>Dígito<input name="account_digit" defaultValue={initial?.account_digit ?? ""} /></label>
            <label>Tipo<select name="account_type" defaultValue={initial?.account_type ?? "checking"}>{Object.entries(accountTypeLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
            <label>Chave PIX<input name="pix_key" defaultValue={initial?.pix_key ?? ""} /></label>
            <label>Saldo inicial<input name="opening_balance" inputMode="decimal" defaultValue={Number(initial?.opening_balance ?? 0).toFixed(2).replace(".", ",")} required /></label>
            <label>Data do saldo inicial<input name="opening_balance_date" type="date" defaultValue={initial?.opening_balance_date ?? today()} required /></label>
            <label>Status<select name="status" defaultValue={initial?.status ?? "active"}><option value="active">Ativa</option><option value="inactive">Inativa</option></select></label>
            <label className="bank-checkbox"><input type="checkbox" name="is_default" value="1" defaultChecked={initial?.is_default ?? false} /> Conta padrão para baixas</label>
            <label className="bank-checkbox"><input type="checkbox" name="allow_negative" value="1" defaultChecked={initial?.allow_negative ?? false} /> Permitir saldo negativo</label>
            <label className="wide">Observações<textarea name="notes" rows={3} defaultValue={initial?.notes ?? ""} /></label>
          </div>
          {initial ? <div className="bank-current-balance"><span>Saldo atual calculado</span><strong>{money(initial.balance)}</strong><small>O saldo inicial fica bloqueado depois da primeira movimentação.</small></div> : null}
        </div>
        <footer><button type="button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button className="primary" type="submit">Salvar conta</button></footer>
      </form>
    </dialog>
  </>;
}

export function BankTransactionDialog({ accounts, projects, activeProjectId, canManage }: {
  accounts: BankAccountOption[];
  projects: BankProjectOption[];
  activeProjectId: string | null;
  canManage: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const activeAccounts = accounts.filter((account) => account.status === "active");
  const [direction, setDirection] = useState("debit");
  if (!canManage) return null;
  return <>
    <button className="elos-button" type="button" disabled={!activeAccounts.length} onClick={() => dialogRef.current?.showModal()}>+ Movimentação</button>
    <dialog className="bank-dialog compact" ref={dialogRef}>
      <form action={postBankTransaction}>
        <header><div><span>Financeiro · Extrato</span><h2>Nova movimentação</h2><p>Lançamento avulso de entrada ou saída na conta.</p></div><button type="button" onClick={() => dialogRef.current?.close()}>×</button></header>
        <div className="bank-dialog-body"><div className="bank-form-grid">
          <label className="wide">Conta<select name="account_id" required defaultValue=""><option value="" disabled>Selecione a conta</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {money(account.balance)}</option>)}</select></label>
          <label>Natureza<select name="direction" value={direction} onChange={(event) => setDirection(event.target.value)}><option value="credit">Entrada</option><option value="debit">Saída</option></select></label>
          <label>Tipo<select name="transaction_type" defaultValue={direction === "credit" ? "receipt" : "payment"} key={direction}>{direction === "credit" ? <><option value="receipt">Recebimento</option><option value="interest">Rendimento / juros</option><option value="refund">Estorno / devolução</option><option value="adjustment">Ajuste de entrada</option><option value="other">Outra entrada</option></> : <><option value="payment">Pagamento</option><option value="fee">Tarifa bancária</option><option value="tax">Tributo</option><option value="refund">Devolução / estorno</option><option value="adjustment">Ajuste de saída</option><option value="other">Outra saída</option></>}</select></label>
          <label>Data<input name="transaction_date" type="date" defaultValue={today()} required /></label>
          <label>Competência<input name="competence_date" type="date" defaultValue={today()} /></label>
          <label>Valor<input name="amount" inputMode="decimal" placeholder="0,00" required /></label>
          <label>Documento<input name="document" /></label>
          <label className="wide">Empreendimento<select name="project_id" defaultValue={activeProjectId ?? ""}><option value="">Movimentação corporativa</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code ? `${project.code} · ` : ""}{project.name}</option>)}</select></label>
          <label className="wide">Descrição<input name="description" required placeholder="Descrição que aparecerá no extrato" /></label>
          <label className="wide">Favorecido / origem<input name="counterparty" /></label>
          <label className="wide">Observações<textarea name="notes" rows={3} /></label>
        </div></div>
        <footer><button type="button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button className="primary" type="submit">Lançar movimentação</button></footer>
      </form>
    </dialog>
  </>;
}

export function BankTransferDialog({ accounts, projects, activeProjectId, canTransfer }: {
  accounts: BankAccountOption[];
  projects: BankProjectOption[];
  activeProjectId: string | null;
  canTransfer: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const activeAccounts = accounts.filter((account) => account.status === "active");
  const [fromId, setFromId] = useState("");
  const from = activeAccounts.find((account) => account.id === fromId) ?? null;
  const availableDestinations = useMemo(() => activeAccounts.filter((account) => account.id !== fromId && account.legal_entity_id === from?.legal_entity_id), [activeAccounts, fromId, from?.legal_entity_id]);
  if (!canTransfer) return null;
  return <>
    <button className="elos-button" type="button" disabled={activeAccounts.length < 2} onClick={() => dialogRef.current?.showModal()}>Transferir</button>
    <dialog className="bank-dialog compact" ref={dialogRef}>
      <form action={transferBankAccounts}>
        <header><div><span>Financeiro · Contas bancárias</span><h2>Transferência entre contas</h2><p>O sistema cria uma saída e uma entrada vinculadas.</p></div><button type="button" onClick={() => dialogRef.current?.close()}>×</button></header>
        <div className="bank-dialog-body"><div className="bank-form-grid">
          <label className="wide">Conta de origem<select name="from_account_id" value={fromId} onChange={(event) => setFromId(event.target.value)} required><option value="" disabled>Selecione a origem</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.label} · {money(account.balance)}</option>)}</select></label>
          <label className="wide">Conta de destino<select name="to_account_id" required defaultValue=""><option value="" disabled>Selecione o destino</option>{availableDestinations.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}</select></label>
          <label>Data<input name="transfer_date" type="date" defaultValue={today()} required /></label>
          <label>Valor<input name="amount" inputMode="decimal" placeholder="0,00" required /></label>
          <label className="wide">Empreendimento<select name="project_id" defaultValue={activeProjectId ?? ""}><option value="">Transferência corporativa</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.code ? `${project.code} · ` : ""}{project.name}</option>)}</select></label>
          <label className="wide">Descrição<input name="description" placeholder="Ex.: Reforço de caixa operacional" /></label>
        </div>{from ? <div className="bank-transfer-balance"><span>Saldo disponível na origem</span><strong>{money(from.balance)}</strong></div> : null}</div>
        <footer><button type="button" onClick={() => dialogRef.current?.close()}>Cancelar</button><button className="primary" type="submit">Confirmar transferência</button></footer>
      </form>
    </dialog>
  </>;
}
