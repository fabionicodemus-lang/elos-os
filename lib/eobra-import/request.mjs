export const MAX_REQUEST_BYTES = 4 * 1024 * 1024 + 200_000;

export class ImportRequestError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function assertImportOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new ImportRequestError("Origem da solicitação não permitida.", 403);
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_REQUEST_BYTES) {
    throw new ImportRequestError("O arquivo excede o limite de 4 MB.", 413);
  }
}

/** Enforces the same bound even when Content-Length is absent or incorrect. */
export async function readImportFormData(request) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().startsWith("multipart/form-data;") || !request.body) {
    throw new ImportRequestError("Envie o arquivo pelo formulário de importação.");
  }
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new ImportRequestError("O arquivo excede o limite de 4 MB.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    return await new Response(new Blob(chunks), { headers: { "Content-Type": type } }).formData();
  } catch {
    throw new ImportRequestError("Não foi possível ler o formulário. Selecione o arquivo novamente.");
  }
}
