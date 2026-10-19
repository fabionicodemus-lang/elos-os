export const qualityLabels: Record<string, string> = {
  low: "Baixa", medium: "Média", high: "Alta", critical: "Crítica",
  light: "Leve", serious: "Grave", pending: "Pendente", released: "Liberado",
  blocked: "Bloqueado", exception: "Liberado por exceção", closed: "Encerrada",
  open: "Aberta", awaiting_reinspection: "Aguardando reinspeção",
};
export function qualityLabel(value: string) { return qualityLabels[value] ?? "Não informado"; }
