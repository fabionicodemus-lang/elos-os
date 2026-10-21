export type FinancialTitleFields = {finance_managed?:boolean;finance_open_amount?:number;finance_principal_paid?:number;finance_interest_due?:number;finance_interest_paid?:number;finance_discount?:number;finance_noncash?:number;finance_advance_applied?:number;finance_cash_gross?:number;finance_cash_refunded?:number;finance_cash_pending?:number};
export const FINANCE_TITLE_COLUMNS:string;
export function titlePosition(row: object): {principalCents:number|null;openCents:number|null;cashCents:number|null;paidPrincipalCents:number|null;discountCents?:number;noncashCents?:number;interestOpenCents?:number;status:string;complete:boolean;origin?:string};
export function openTitleAmount(row:object):number;
export function paidTitleCash(row:object):number;
export function paidTitlePrincipal(row:object):number;
export function titleStatusLabel(row:object):string;
export function sumTitlePositions(rows:object[]):{openCents:number;cashCents:number;paidPrincipalCents:number;complete:boolean};

export function openPrincipalTitleAmount(row:object):number;
