export const MAX_UNIT_MAP_BYTES: number;
export const UNIT_MAP_PAGE_SIZE: number;
export type SnapshotUnitDecision = { action: 'create' } | { action: 'reuse'; unit_id: string; expected_identity_hash: string };
export type SnapshotUnitMap = Record<string, SnapshotUnitDecision>;
export function unitMapRequiredPermissions(runPermissions: unknown): string[];
export function parseSnapshotUnitMap(input: unknown, expectedCount?: number): SnapshotUnitMap;
export function readSnapshotUnitMapRequest(request: Request): Promise<{ company_id: string; run_id: string; confirm_units: true; unit_map: SnapshotUnitMap }>;
export function parseUnitMapPageQuery(parameters: URLSearchParams): { mode: 'source' | 'options'; page: number; search: string; projectId: string | null; companyId: string; runId: string };
export function unitMapSearchPattern(value: string): string;
