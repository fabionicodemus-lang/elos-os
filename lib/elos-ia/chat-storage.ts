/** Keep the drawer and full-page conversation in the same authorized workspace. */
export function elosIaChatStorageKey(companyId: string, userId: string, projectId: string | null) {
  return `elos-ia-chat:v2:${companyId}:${userId}:${projectId ?? "company"}`;
}
