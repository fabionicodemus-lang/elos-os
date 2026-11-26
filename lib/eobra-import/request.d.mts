export const MAX_REQUEST_BYTES: number;
export class ImportRequestError extends Error {
  readonly status: number;
  constructor(message: string, status?: number);
}
export function assertImportOrigin(request: Request): void;
export function readImportFormData(request: Request): Promise<FormData>;
