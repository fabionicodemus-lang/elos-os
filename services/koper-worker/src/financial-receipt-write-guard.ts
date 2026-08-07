type JsonRow = Record<string, unknown>;

const originalFetch = globalThis.fetch.bind(globalThis);

function numeric(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    if (input instanceof URL) return input;
    if (typeof input === "string") return new URL(input);
    return new URL(input.url);
  } catch {
    return null;
  }
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof input !== "string" && !(input instanceof URL)) return input.method.toUpperCase();
  return "GET";
}

function quotedIn(values: string[]): string {
  return `in.(${values.map((value) => `"${value.replaceAll("\"", "\\\"")}"`).join(",")})`;
}

async function cleanupPartialHeaders(
  sourceUrl: URL,
  sourceInit: RequestInit | undefined,
  receiptIds: string[],
): Promise<void> {
  if (!receiptIds.length) return;

  const cleanupUrl = new URL("/rest/v1/procurement_material_receipts", sourceUrl.origin);
  cleanupUrl.searchParams.set("id", quotedIn(receiptIds));

  const headers = new Headers(sourceInit?.headers);
  headers.delete("content-type");
  headers.set("prefer", "return=minimal");

  try {
    const response = await originalFetch(cleanupUrl, {
      method: "DELETE",
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    console.log("KOPER_FINANCIAL_RECEIPT_GUARD_CLEANUP", JSON.stringify({
      receiptCount: receiptIds.length,
      ok: response.ok,
      status: response.status,
    }));
  } catch (error: unknown) {
    console.error("KOPER_FINANCIAL_RECEIPT_GUARD_CLEANUP_FAILED", JSON.stringify({
      receiptCount: receiptIds.length,
      message: error instanceof Error ? error.message.slice(0, 300) : "unknown",
    }));
  }
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = requestUrl(input);
  const method = requestMethod(input, init);
  if (
    !url
    || method !== "POST"
    || !url.pathname.endsWith("/rest/v1/procurement_material_receipt_items")
    || typeof init?.body !== "string"
  ) {
    return originalFetch(input, init);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(init.body);
  } catch {
    return originalFetch(input, init);
  }

  const rows = (Array.isArray(parsed) ? parsed : [parsed])
    .filter((row): row is JsonRow => typeof row === "object" && row !== null && !Array.isArray(row));
  if (!rows.length) return originalFetch(input, init);

  let adjustedCount = 0;
  const adjustedRows = rows.map((row) => {
    const ordered = numeric(row.ordered_quantity);
    const previouslyAccepted = numeric(row.previously_accepted_quantity);
    const delivered = numeric(row.delivered_quantity);
    if (ordered === null || previouslyAccepted === null || delivered === null) return row;

    const minimumSnapshot = previouslyAccepted + delivered;
    if (minimumSnapshot <= ordered) return row;
    adjustedCount += 1;
    return { ...row, ordered_quantity: minimumSnapshot };
  });

  if (adjustedCount > 0) {
    console.log("KOPER_FINANCIAL_RECEIPT_GUARD_ADJUSTED", JSON.stringify({
      adjustedItems: adjustedCount,
      totalItems: adjustedRows.length,
    }));
  }

  const nextBody = JSON.stringify(Array.isArray(parsed) ? adjustedRows : adjustedRows[0]);
  const response = await originalFetch(input, { ...init, body: nextBody });

  if (!response.ok) {
    const receiptIds = [...new Set(adjustedRows.flatMap((row) =>
      typeof row.receipt_id === "string" && row.receipt_id ? [row.receipt_id] : []
    ))];
    await cleanupPartialHeaders(url, init, receiptIds);
  }

  return response;
};

console.log("KOPER_FINANCIAL_RECEIPT_WRITE_GUARD_READY");
