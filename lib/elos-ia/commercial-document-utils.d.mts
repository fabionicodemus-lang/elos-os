export type CommercialClientData = {
  name:string; personType:"PF"|"PJ"; taxId:string;
  identityDocument:string|null; birthDate:string|null; maritalStatus:string|null; profession:string|null;
  email:string|null; phone:string|null; secondaryPhone:string|null; address:string|null; postalCode:string|null;
  city:string|null; state:string|null; nationality:string|null;
};
export type CommercialDocumentPaymentItem = {
  category:string; description:string; installmentCount:number; firstDueDate:string; intervalMonths:number;
  amountPerInstallment:number; correctionIndexLabel:string|null; interestRateMonthly:number|null;
  paymentMethod:string|null; notes:string|null; total:number;
};
export type CommercialDocumentInstallment = {
  category:string; description:string; sequenceNumber:number; sequenceTotal:number; dueDate:string;
  amount:number; correctionIndexLabel:string|null; interestRateMonthly:number|null; paymentMethod:string|null;
};
export function validCommercialDate(value:unknown):boolean;
export function normalizeCommercialTaxId(value:unknown):string;
export function addCommercialMonths(value:string,months:number):string;
export function normalizeCommercialDocumentInput(raw:unknown,today:string):{
  saleDate:string; contractNumber:string; totalAmount:number; commissionPct:number; brokerName:string|null;
  correctionStartMonth:number|null; clientData:CommercialClientData;
  paymentItems:CommercialDocumentPaymentItem[]; installments:CommercialDocumentInstallment[];
  unsupportedClauses:string[]; notes:string|null;
};
