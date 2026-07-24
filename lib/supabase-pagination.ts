type QueryError = {
  message: string;
  code?: string;
} | null;

type QueryPage<T> = {
  data: T[] | null;
  error: QueryError;
};

export async function fetchAllRows<T>(
  loadPage: (from: number, to: number) => Promise<QueryPage<T>>,
  pageSize = 1000,
): Promise<{ data: T[]; error: QueryError }> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const result = await loadPage(from, from + pageSize - 1);
    if (result.error) return { data: rows, error: result.error };

    const batch = result.data ?? [];
    rows.push(...batch);

    if (batch.length < pageSize) return { data: rows, error: null };
  }
}
