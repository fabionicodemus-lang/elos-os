"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { cancelarEobraImport, promoverEobraImport } from "./actions";

function ReviewButtons({ canPromote, canCancel, confirmed, readyCount }: {
  canPromote: boolean;
  canCancel: boolean;
  confirmed: boolean;
  readyCount: number;
}) {
  const { pending } = useFormStatus();
  return (
    <div className="eobra-actions">
      <button className="elos-button primary" type="submit" disabled={pending || !canPromote || !confirmed}>
        {pending ? "Processando…" : readyCount > 0 ? `Importar ${readyCount.toLocaleString("pt-BR")} registro(s)` : "Concluir lote sem novos registros"}
      </button>
      {canCancel ? (
        <button className="elos-button" type="submit" formAction={cancelarEobraImport} formNoValidate disabled={pending}>
          Cancelar prévia
        </button>
      ) : null}
      <span className="eobra-muted" aria-live="polite">{pending ? "Aguarde a confirmação do resultado." : "O resultado ficará registrado neste lote."}</span>
    </div>
  );
}

export function ImportControls({ batchId, previewHash, canPromote, canCancel, readyCount, financial }: {
  batchId: string;
  previewHash: string;
  canPromote: boolean;
  canCancel: boolean;
  readyCount: number;
  financial: boolean;
}) {
  const [confirmed, setConfirmed] = useState(false);
  if (!canPromote && !canCancel) return null;
  return (
    <form action={promoverEobraImport} className="eobra-review-actions">
      <input type="hidden" name="batch_id" value={batchId} />
      <input type="hidden" name="preview_hash" value={previewHash} />
      {canPromote ? (
        <label className="eobra-checkbox">
          <input name="confirm_review" type="checkbox" required checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          <span>{financial ? "Conferi a obra, os vínculos e os totais desta prévia." : "Conferi os cadastros, os vínculos e as observações desta prévia."}</span>
        </label>
      ) : <p className="eobra-muted">Resolva as pendências no arquivo e prepare uma nova prévia antes de importar.</p>}
      <ReviewButtons canPromote={canPromote} canCancel={canCancel} confirmed={confirmed} readyCount={readyCount} />
    </form>
  );
}
