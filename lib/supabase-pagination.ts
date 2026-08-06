type QueryError = {
  message: string;
  code?: string;
} | null;

type QueryPage<T> = {
  data: T[] | null;
  error: QueryError;
};

/**
 * Teto de linhas por chamada. Não é uma escolha de desempenho: é o que impede
 * que uma tabela transacional em crescimento derrube o render do servidor.
 *
 * Chegar ao teto significa que a página está lendo a tabela inteira e precisa
 * de paginação no servidor — ver `paginate()` e ops/README-shadow-db.md.
 */
export const MAX_ROWS_PER_FETCH = 20000;

export type FetchAllRowsResult<T> = {
  data: T[];
  error: QueryError;
  /**
   * `true` quando o teto foi atingido e existem mais linhas no banco. Qualquer
   * total calculado sobre `data` está incompleto e não deve ser exibido como
   * se fosse o número final.
   */
  truncated: boolean;
};

export async function fetchAllRows<T>(
  loadPage: (from: number, to: number) => Promise<QueryPage<T>>,
  pageSize = 1000,
  maxRows = MAX_ROWS_PER_FETCH,
): Promise<FetchAllRowsResult<T>> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const remaining = maxRows - rows.length;
    if (remaining <= 0) return { data: rows, error: null, truncated: true };

    const size = Math.min(pageSize, remaining);
    const result = await loadPage(from, from + size - 1);
    if (result.error) return { data: rows, error: result.error, truncated: false };

    const batch = result.data ?? [];
    rows.push(...batch);

    if (batch.length < size) return { data: rows, error: null, truncated: false };
  }
}

export type PageRange = {
  page: number;
  pageSize: number;
  from: number;
  to: number;
};

/**
 * Converte o `page` da URL em um intervalo para `.range()`. Página inválida ou
 * ausente cai na primeira, em vez de quebrar a consulta.
 */
export function pageRange(value: string | string[] | undefined, pageSize = 50): PageRange {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(String(raw ?? "1"), 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const from = (page - 1) * pageSize;

  return { page, pageSize, from, to: from + pageSize - 1 };
}

/** Número de páginas a partir do `count` exato devolvido pelo PostgREST. */
export function totalPages(count: number | null | undefined, pageSize = 50) {
  return Math.max(1, Math.ceil((count ?? 0) / pageSize));
}
