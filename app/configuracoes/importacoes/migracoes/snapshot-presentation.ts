export const SNAPSHOT_ENTITY_LABELS: Record<string, string> = {
  project: 'Empreendimentos', person: 'Pessoas', unit: 'Unidades', sale: 'Vendas',
  receivable: 'Parcelas a receber', payable: 'Contas a pagar', settlement: 'Baixas e estornos',
  bank_account: 'Contas', bank_transaction: 'Movimentos', correction_index: 'Índices',
  index_value: 'Valores dos índices', raw_archive: 'Dados complementares',
};
export const SNAPSHOT_STATUS_LABELS: Record<string, string> = {
  building: 'Preparando', review: 'Com pendências', ready: 'Pronta para revisão',
  promoting: 'Importando em lotes', imported: 'Processada', cancelled: 'Cancelada', archived: 'Preservado para consulta',
  blocked: 'Bloqueado', conflict: 'Conflito', duplicate: 'Já importado',
};
export type SnapshotView = {
  ok: boolean; complete: boolean; allProjectsComplete: boolean; snapshotHash: string;
  transport?: string; verificationPending?: boolean; partCount?: number;
  source: { host: string; capturedAt: string; referenceDate: string };
  scope: { projectIds: string[]; allProjects: boolean };
  summary: {
    records: number; uniqueRecords: number; validRecords: number; blockedRecords: number; archivedRecords: number; promotionBlockedRecords: number; history_dates_complete?: boolean;
    financial?: Record<string, { totalsComplete?: boolean }>;
  };
  errors: string[]; warnings: string[];
  projects: { sourceId: string; name: string }[];
  coverage: { entity: string; sourceProjectId: string | null; archiveType?: string; expectedCount: number | null; collectedCount: number | null; complete: boolean; detailsExpected: number | null; detailsCollected: number; errors: string[]; warnings: string[] }[];
  sample: { entity: string; sourceId: string; sourceProjectId: string | null; label: string; disposition: string; errors: string[]; warnings: string[]; promotionBlockers: string[] }[];
};
export type MigrationSummary = {
  total?: number; ready?: number; blocked?: number; conflicts?: number; duplicates?: number; archived?: number;
  coverage_complete?: boolean; all_projects_complete?: boolean; history_dates_complete?: boolean; counts?: Record<string, number>;
  totals?: Record<string, {
    original_amount?: string; current_amount?: string; paid_amount?: string; balance_amount?: string; collectible_balance_amount?: string; complete?: boolean;
  }>; errors?: string[];
};
export type SnapshotProgress = {
  run_id: string; status: string; stage: 'loading' | 'validating' | 'sealed';
  transport?: string; expected_parts?: number; uploaded_parts?: number; next_part_ordinal?: number | null;
  next_step: 'upload_part' | 'append' | 'finish_append' | 'validate' | 'seal' | 'promote' | 'complete' | 'blocked';
  expected_records: number; loaded_records: number; validated_records: number; promoted_records: number;
};
export const snapshotLabel = (entity: string, archiveType?: string | null) => entity === 'raw_archive' && archiveType ? `Complementar · ${archiveType}` : SNAPSHOT_ENTITY_LABELS[entity] ?? entity;
