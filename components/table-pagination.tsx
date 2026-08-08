import Link from "next/link";

/**
 * Rodapé de paginação das listagens. Reaproveita a marcação `registry-pagination`
 * que já existe no tema oficial — não introduz estilo paralelo.
 *
 * `query` deve conter os filtros já codificados da página, sem o `page`.
 */
export function TablePagination({
  page,
  totalPages,
  query = "",
  totalLabel,
}: {
  page: number;
  totalPages: number;
  query?: string;
  totalLabel?: string;
}) {
  if (totalPages <= 1 && !totalLabel) return null;

  const href = (target: number) => (query ? `?${query}&page=${target}` : `?page=${target}`);

  return (
    <div className="registry-pagination">
      <span>{totalLabel ? `${totalLabel} · ` : ""}Página {page} de {totalPages}</span>
      <div>
        {page > 1 ? <Link href={href(page - 1)}>Anterior</Link> : null}
        {page < totalPages ? <Link href={href(page + 1)}>Próxima</Link> : null}
      </div>
    </div>
  );
}
