import type { CountryCode } from "libphonenumber-js";

export const META_GRAPH_VERSION: string;

export interface MetaLeadgenChangeValue {
  leadgen_id?: string;
  form_id?: string;
  page_id?: string;
  ad_id?: string;
  adgroup_id?: string;
  created_time?: number;
}

export interface MetaWebhookChange {
  field?: string;
  value?: MetaLeadgenChangeValue;
}

export interface MetaWebhookEntry {
  id?: string;
  time?: number;
  changes?: MetaWebhookChange[];
}

export interface MetaWebhookPayload {
  object?: string;
  entry?: MetaWebhookEntry[];
}

export interface MetaLeadEvent {
  leadgenId: string;
  formId?: string;
  adId?: string;
  pageId?: string;
  createdTime?: number;
}

export interface MetaLeadFieldEntry {
  name: string;
  values: string[];
}

export interface MetaLeadDetails {
  id: string;
  created_time?: string;
  ad_id?: string;
  form_id?: string;
  field_data: MetaLeadFieldEntry[];
}

export interface ParsedLead {
  nome: string | null;
  email: string | null;
  telefoneBruto: string | null;
  mensagem: string | null;
  respostas: Record<string, string>;
}

export interface FetchMetaLeadOptions {
  version?: string;
  fetchImpl?: typeof fetch;
}

export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret: string,
): boolean;

export function extractLeadEvents(
  payload: MetaWebhookPayload | null | undefined,
): MetaLeadEvent[];

export function fetchMetaLeadDetails(
  leadgenId: string,
  pageAccessToken: string,
  options?: FetchMetaLeadOptions,
): Promise<MetaLeadDetails>;

export function parseLeadFieldData(fieldData?: MetaLeadFieldEntry[]): ParsedLead;

export function normalizePhone(
  raw: string | null | undefined,
  defaultCountry?: CountryCode,
): string | null;
