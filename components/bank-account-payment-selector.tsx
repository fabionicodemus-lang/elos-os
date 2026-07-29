"use client";

import { useEffect } from "react";

type AccountOption = {
  id: string;
  label: string;
  bank_name: string;
  agency: string | null;
  account_number: string;
  account_digit: string | null;
  is_default: boolean;
  legal_entity_name: string | null;
};

function optionLabel(account: AccountOption) {
  const number = `${account.account_number}${account.account_digit ? `-${account.account_digit}` : ""}`;
  return `${account.is_default ? "★ " : ""}${account.label} · ${account.bank_name}${account.agency ? ` · Ag. ${account.agency}` : ""} · ${number}${account.legal_entity_name ? ` · ${account.legal_entity_name}` : ""}`;
}

export function BankAccountPaymentSelector() {
  useEffect(() => {
    let accounts: AccountOption[] = [];
    let disposed = false;

    const enhance = () => {
      document.querySelectorAll<HTMLInputElement>('input[name="paid_account_name"]:not([data-bank-selector-enhanced])').forEach((input) => {
        input.dataset.bankSelectorEnhanced = "1";
        const select = document.createElement("select");
        select.name = "bank_account_id";
        select.required = true;
        select.className = input.className;
        select.dataset.bankAccountSelector = "1";

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = accounts.length ? "Selecione a conta bancária" : "Cadastre uma conta bancária primeiro";
        placeholder.disabled = true;
        placeholder.selected = true;
        select.appendChild(placeholder);

        for (const account of accounts) {
          const option = document.createElement("option");
          option.value = account.id;
          option.textContent = optionLabel(account);
          if (input.value && input.value === account.label) option.selected = true;
          select.appendChild(option);
        }

        select.disabled = accounts.length === 0;
        input.replaceWith(select);
      });
    };

    const observer = new MutationObserver(enhance);
    observer.observe(document.body, { childList: true, subtree: true });

    void fetch("/api/financeiro/contas-bancarias/opcoes", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ accounts?: AccountOption[] }> : { accounts: [] })
      .then((payload) => {
        if (disposed) return;
        accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
        document.querySelectorAll('select[data-bank-account-selector="1"]').forEach((node) => node.remove());
        document.querySelectorAll<HTMLInputElement>('input[data-bank-selector-enhanced="1"]').forEach((input) => delete input.dataset.bankSelectorEnhanced);
        enhance();
      })
      .catch(() => enhance());

    enhance();
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, []);

  return null;
}
