export const SCHEMA_VERSION: number;
export const PAYLOAD_SCRIPT_ID: string;
export const PAYLOAD_KIND: string;

export type PortableLocation = { id: string; code: string; name: string };
export type PortableService = { id: string; code: string; description: string };

export type PortableActivity = {
  code: string;
  name: string;
  serviceId: string | null;
  locationId: string | null;
  plannedStart: string;
  plannedFinish: string;
  durationDays: number;
  teamCount: number;
  productivity: number;
  quantity: number;
  plannedCost: number;
  planningStatus: string;
  color?: string;
  textColor?: string;
  abbr?: string;
};

export type PortableDependency = {
  predecessorCode: string;
  successorCode: string;
  relationType: "FS" | "SS" | "FF" | "SF";
  lagDays: number;
};

export type PortableMeta = {
  app?: string;
  kind?: string;
  schemaVersion?: number;
  baselineId: string | null;
  baselineCode?: string | null;
  baselineVersion?: string | null;
  budgetId?: string | null;
  projectName?: string | null;
  workOnSaturday?: boolean;
  startDate?: string | null;
  exportedAt?: string | null;
};

export type SchedulePayload = {
  meta: PortableMeta;
  instructions?: string;
  locations: PortableLocation[];
  services: PortableService[];
  activities: PortableActivity[];
  dependencies: PortableDependency[];
};

export type ScheduleModel = {
  meta: PortableMeta;
  locations: PortableLocation[];
  services: PortableService[];
  activities: PortableActivity[];
  dependencies: PortableDependency[];
};

export type PayloadResult =
  | { ok: true; payload: SchedulePayload; error?: undefined }
  | { ok: false; error: string; payload?: undefined };

export function buildSchedulePayload(model: ScheduleModel): SchedulePayload;
export function validateSchedulePayload(payload: unknown): PayloadResult;
export function extractSchedulePayload(html: string): PayloadResult;
export function buildScheduleHtml(model: ScheduleModel): string;
